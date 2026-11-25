// Exercise the relocated module through real Home and filesystem IPC.
const { app, BrowserWindow, dialog, session } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const XLSX = require("xlsx");
const root = path.resolve(__dirname, "..");
const packaged = process.argv.includes("--packaged");
const runtime = process.env.AYPI_TEST_RUNTIME_DIR || (packaged
    ? path.join(root, "dist/module-refactor-preview/step-03-file-list/win-unpacked/resources/app.asar/dist-ts")
    : path.join(root, "dist-ts"));
assert(fs.existsSync(path.join(runtime, "modules/file-list/file-list.html")));
assert(!fs.existsSync(path.join(runtime, "pages/utilities/file-list.html")));
assert(!fs.existsSync(path.join(runtime, "scripts/utilities/file-list-scripts.js")));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "aypi-file-list-refactor-"));
app.setPath("userData", path.join(temp, "profile"));
app.commandLine.appendSwitch("disable-gpu");
for (const name of ["show", "focus", "maximize"]) BrowserWindow.prototype[name] = function () {};
const messages = [], errors = [], saves = [], original = new Map();
let folderChoices = [], saveChoices = [];
dialog.showMessageBox = async (_window, options) => { messages.push(options); return { response: 0 }; };
dialog.showOpenDialog = async () => {
    const folder = folderChoices.shift(); return { canceled: !folder, filePaths: folder ? [folder] : [] };
};
dialog.showSaveDialog = async (_window, options) => {
    saves.push(options); const file = saveChoices.shift(); return { canceled: !file, filePath: file || undefined };
};
const modulePath = file => path.join(runtime, "modules", file);
require(modulePath("file-manager/realtime-client.js")).setupRealtimeClient = () => {};
require(modulePath("file-manager/backend-client.js")).requestAypiBackend = async () => { throw Error("Backend disabled in isolated file list test"); };
require(require.resolve("electron-log", { paths: [path.join(runtime, "modules")] })).transports.console.level = false;
const run = (win, code) => win.webContents.executeJavaScript(code, true);
async function until(fn, label) {
    const start = Date.now();
    while (Date.now() - start < 10000) {
        if (await fn()) return;
        await new Promise(resolve => setTimeout(resolve, 35));
    }
    throw Error("Timeout: " + label);
}
function fixture(folder) {
    const entries = {
        "alpha.txt": "alpha", "file2.txt": "two", "file10.txt": "ten", "zero.bin": "",
        "nome-à.txt": "caffè", "sub/nested.txt": "nested", "sub/deep/last.txt": "last",
    };
    for (const [name, content] of Object.entries(entries)) {
        const file = path.join(folder, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content);
        const at = new Date("2020-01-01T00:00:00Z"); fs.utimesSync(file, at, at); original.set(file, fs.readFileSync(file));
    }
    fs.mkdirSync(path.join(folder, "empty"));
    return Object.keys(entries).map(name => name.replaceAll("/", path.sep));
}
app.whenReady().then(async () => {
    const watchdog = setTimeout(() => { console.error("File list test timeout"); app.exit(1); }, 90000);
    try {
        session.defaultSession.webRequest.onBeforeRequest({ urls: ["http://*/*", "https://*/*"] }, (_request, callback) => callback({ cancel: true }));
        app.on("web-contents-created", (_event, contents) => {
            contents.setBackgroundThrottling(false);
            contents.on("console-message", (_event, level, message) => { if (level >= 3) errors.push(message); });
        });
        const main = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false } });
        await main.loadURL("about:blank");
        const manager = require(modulePath("fileManager.js")); manager.setupFileManager(main);
        let win, firstId;
        async function launch(theme) {
            manager.setInterfaceIconTheme(theme);
            await run(main, `require('electron').ipcRenderer.send('open-file-list-window',{theme:${JSON.stringify(theme)}})`);
            await until(() => {
                win = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes("/modules/file-list/file-list.html"));
                return !!win;
            }, "Home opens relocated file list");
            await until(() => run(win, `document.readyState==='complete' && document.documentElement.dataset.moduleTheme===${JSON.stringify(theme)} && !!document.querySelector('#btnScan')`), "file list ready");
            await run(win, "document.querySelector('#baFileListSplash')?.click()");
        }
        for (const theme of ["standard", "bluearchive"]) {
            const input = path.join(temp, "input-" + theme), names = fixture(input), empty = path.join(temp, "empty-" + theme);
            fs.mkdirSync(empty);
            await launch(theme);
            if (firstId) assert.equal(win.id, firstId, "Theme changes must reuse the existing window");
            firstId = win.id;
            assert(await run(win, "document.querySelector('#btnScan').disabled && document.querySelector('#btnExport').disabled"));
            async function select(folder, files, folders, accessErrors = 0) {
                folderChoices = [folder]; await run(win, "document.querySelector('#btnSelectFolder').click()");
                await until(() => run(win, `document.querySelector('#selectedFolder').textContent===${JSON.stringify(folder)} && !document.querySelector('#btnScan').disabled && document.querySelector('#statFiles').textContent===${JSON.stringify(String(files))} && document.querySelector('#statFolders').textContent===${JSON.stringify(String(folders))} && document.querySelector('#statErrors').textContent===${JSON.stringify(String(accessErrors))}`), "folder scan");
            }
            await select(input, 7, 4);
            assert(await run(win, "getComputedStyle(document.querySelector('#emptyState')).display==='none' && !document.querySelector('#fileListTable').hidden"), "Empty placeholder must not cover existing results");
            assert.equal(await run(win, "document.querySelector('#statSize').textContent"), "27 B");
            let rows = await run(win, "Array.from(document.querySelectorAll('#fileListTable tbody tr'),row=>Array.from(row.cells,cell=>cell.textContent))");
            assert.equal(rows.length, 7); assert.deepEqual(rows.map(row => row[1]).sort(), names.slice().sort());
            assert(rows.findIndex(row => row[0] === "file2.txt") < rows.findIndex(row => row[0] === "file10.txt"));
            assert.equal(rows.find(row => row[0] === "zero.bin")[2], "0 B");
            async function exportExcel(filename, expected) {
                const file = path.join(temp, filename), count = messages.length;
                saveChoices = [file]; await run(win, "document.querySelector('#btnExport').click()");
                await until(() => messages.slice(count).some(message => message.message === "File Excel creato con successo."), "Excel exported");
                const book = XLSX.readFile(file), exported = XLSX.utils.sheet_to_json(book.Sheets.File);
                assert.deepEqual(book.SheetNames, ["File"]); assert.equal(exported.length, expected.length);
                assert.deepEqual(exported.map(row => row["Percorso relativo"]).sort(), expected.slice().sort());
                for (const row of exported) {
                    assert.equal(row["Nome file"], path.basename(row["Percorso relativo"]));
                    assert.equal(row["Percorso completo"], path.join(input, row["Percorso relativo"]));
                }
                assert.equal(saves.at(-1).defaultPath, "lista_file.xlsx");
                return fs.readFileSync(file);
            }
            const workbook = await exportExcel(theme + "-recursive.xlsx", names);
            const count = saves.length, noteCount = messages.length;
            saveChoices = [null]; await run(win, "document.querySelector('#btnExport').click()");
            await until(() => saves.length > count, "cancel export");
            await run(win, "new Promise(resolve=>setTimeout(resolve,60))");
            assert.equal(messages.length, noteCount); assert(fs.readFileSync(path.join(temp, theme + "-recursive.xlsx")).equals(workbook));
            folderChoices = [null]; await run(win, "document.querySelector('#btnSelectFolder').click()");
            await run(win, "new Promise(resolve=>setTimeout(resolve,100))");
            assert.equal(await run(win, "document.querySelector('#selectedFolder').textContent"), input);
            assert.equal(await run(win, "document.querySelector('#statFiles').textContent"), "7");
            await run(win, "document.querySelector('#includeSubfolders').checked=false;document.querySelector('#includeSubfolders').dispatchEvent(new Event('change'))");
            await until(() => run(win, "!document.querySelector('#btnScan').disabled && document.querySelector('#statFiles').textContent==='5'"), "exclude subfolders");
            assert.equal(await run(win, "document.querySelector('#statFolders').textContent"), "1");
            await exportExcel(theme + "-root.xlsx", names.filter(name => !name.includes(path.sep)));
            const added = path.join(input, "added.txt"); fs.writeFileSync(added, "added"); original.set(added, fs.readFileSync(added));
            await run(win, "document.querySelector('#btnScan').click()");
            await until(() => run(win, "!document.querySelector('#btnScan').disabled && document.querySelector('#statFiles').textContent==='6'"), "refresh after new file");
            assert(await run(win, "document.querySelector('#fileListTable').textContent.includes('added.txt')"));
            await launch(theme); assert.equal(win.id, firstId);
            assert.equal(BrowserWindow.getAllWindows().filter(window => window.webContents.getURL().includes("/modules/file-list/")).length, 1);
            for (const [width, height] of [[1100, 820], [780, 640]]) {
                win.setContentSize(width, height);
                await run(win, "new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
                const layout = await run(win, "({overflow:document.body.scrollWidth>innerWidth,styles:Array.from(document.querySelectorAll('link[rel=stylesheet]'),link=>!!link.sheet),table:document.querySelector('#fileListTable').getBoundingClientRect().height})");
                assert(!layout.overflow); assert(layout.styles.every(Boolean)); assert(layout.table > 0);
                fs.writeFileSync(path.join(temp, `${theme}-${width}.png`), (await win.webContents.capturePage()).toPNG());
            }
            await select(empty, 0, 1); assert(await run(win, "document.querySelector('#fileListTable').hidden && getComputedStyle(document.querySelector('#fileListTable')).display==='none' && !document.querySelector('#emptyState').hidden && getComputedStyle(document.querySelector('#emptyState')).display!=='none' && document.querySelector('#btnExport').disabled"));
            await select(path.join(temp, "missing-" + theme), 0, 1, 1);
            await run(win, "document.querySelector('#includeSubfolders').checked=true");
            await select(input, 8, 4); assert.equal(await run(win, "document.querySelector('#statErrors').textContent"), "0");
            await exportExcel(theme + "-recovery.xlsx", names.concat("added.txt"));
        }
        await run(win, "document.querySelector('#btnClose').click()"); await until(() => win.isDestroyed(), "close file list");
        await launch("standard"); assert.notEqual(win.id, firstId);
        assert(await run(win, "document.querySelector('#btnScan').disabled && document.querySelector('#btnExport').disabled"));
        for (const [file, buffer] of original) assert(fs.readFileSync(file).equals(buffer), "Input file must not be modified");
        assert.deepEqual(errors, []); assert(!messages.some(message => message.type === "error"));
        console.log(`OK: ${packaged ? "packaged ASAR" : "development"} file list; real Home/picker/export IPC, automatic scan, recursion/counts/order/Unicode/empty files, exact Excel paths, cancel/refresh/empty/missing/recovery, unchanged input, window reuse/theme/close/reopen and sizes.`);
        console.log("Artifacts: " + temp);
        clearTimeout(watchdog); for (const window of BrowserWindow.getAllWindows()) window.destroy(); app.exit(0);
    } catch (error) {
        console.error(error, { errors, messages: messages.slice(-3) }); clearTimeout(watchdog); app.exit(1);
    }
});
