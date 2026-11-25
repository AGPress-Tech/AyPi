// Run after build:ts; --packaged uses the isolated electron-builder preview.
const { app, BrowserWindow, dialog, session } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const root = path.resolve(__dirname, "..");
const packaged = process.argv.includes("--packaged");
const runtime = process.env.AYPI_TEST_RUNTIME_DIR || (packaged
    ? path.join(root, "dist/module-refactor-preview/win-unpacked/resources/app.asar/dist-ts")
    : path.join(root, "dist-ts"));
const page = path.join(runtime, "modules/compare-folders/compare-folders.html");
assert(fs.existsSync(page), "Missing module page in built application");
assert(!fs.existsSync(path.join(runtime, "pages/utilities/compare-folders.html")), "Old page must not survive a clean build");
assert(!fs.existsSync(path.join(runtime, "scripts/utilities/compare-folders-scripts.js")), "Old script must not survive a clean build");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "aypi-compare-refactor-"));
app.setPath("userData", path.join(temp, "profile"));
app.commandLine.appendSwitch("disable-gpu");
for (const name of ["show", "focus", "maximize"]) BrowserWindow.prototype[name] = function () {};
const folderA = path.join(temp, "A"), folderB = path.join(temp, "B");
const original = new Map();
function fixture(folder, name, content, offset = 0) {
    const file = path.join(folder, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    const at = new Date(Date.UTC(2020, 0, 1) + offset);
    fs.utimesSync(file, at, at);
    original.set(file, fs.readFileSync(file));
}
fixture(folderA, "same.txt", "same"); fixture(folderB, "same.txt", "same");
fixture(folderA, "only-a.txt", "only A"); fixture(folderB, "only-b.txt", "only B");
fixture(folderA, "changed.txt", "old"); fixture(folderB, "changed.txt", "changed content");
fixture(folderA, "timestamp.txt", "same content"); fixture(folderB, "timestamp.txt", "same content", 10000);
fixture(folderA, "sub/nested-a.txt", "nested");
const messages = [], opened = [], errors = [], backendCalls = [];
let folderChoices = [];
dialog.showMessageBox = async (_window, options) => { messages.push(options); return { response: 0 }; };
dialog.showOpenDialog = async () => {
    const selected = folderChoices.shift();
    return { canceled: !selected, filePaths: selected ? [selected] : [] };
};
const modulePath = file => path.join(runtime, "modules", file);
require(modulePath("file-manager/realtime-client.js")).setupRealtimeClient = () => {};
require(modulePath("file-manager/backend-client.js")).requestAypiBackend = async endpoint => {
    backendCalls.push(endpoint);
    throw Error("Backend disabled in isolated comparison test");
};
require(modulePath("file-manager/network-files.js")).openNetworkFile = (_window, folder) => opened.push(folder);
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
app.whenReady().then(async () => {
    const watchdog = setTimeout(() => { console.error("Comparison test timeout"); app.exit(1); }, 90000);
    try {
        session.defaultSession.webRequest.onBeforeRequest({ urls: ["https://*/*", "http://*/*"] }, (_request, callback) => callback({ cancel: true }));
        app.on("web-contents-created", (_event, contents) => {
            contents.setBackgroundThrottling(false);
            contents.on("console-message", (_event, level, message) => { if (level >= 3) errors.push(message); });
        });
        const main = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false } });
        await main.loadURL("about:blank");
        const manager = require(modulePath("fileManager.js"));
        manager.setupFileManager(main);
        for (const theme of ["standard", "bluearchive"]) {
            manager.setInterfaceIconTheme(theme);
            await run(main, `require('electron').ipcRenderer.send('open-compare-folders-window',{theme:${JSON.stringify(theme)}})`);
            let win;
            await until(() => {
                win = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes("/modules/compare-folders/compare-folders.html"));
                return !!win;
            }, "home opens relocated page");
            await until(() => run(win, `!!window.__aypiCompareInitAttached && new URLSearchParams(location.search).get('theme')===${JSON.stringify(theme)}`), "module initialized");
            const id = win.id;
            await run(win, "document.querySelector('#baCompareSplash')?.click();document.querySelector('#btnCompare').click()");
            await until(() => messages.some(message => message.type === "warning"), "missing folder validation");
            await run(main, `require('electron').ipcRenderer.send('open-compare-folders-window',{theme:${JSON.stringify(theme)}})`);
            assert.equal(BrowserWindow.getAllWindows().filter(window => window.webContents.getURL().includes("/modules/compare-folders/")).length, 1);
            assert.equal(win.id, id, "Opening again must reuse the window");
            // Exercise the actual Hierarchy channels, including delivery after a new load.
            const sendContext = async (slot, folder) => {
                await run(main, `require('electron').ipcRenderer.send('hierarchy-compare-folder-${slot}',{folder:${JSON.stringify(folder)}})`);
                await until(() => run(win, `document.querySelector('#lblFolder${slot}').textContent===${JSON.stringify(folder)}`), "hierarchy context " + slot);
            };
            await sendContext("A", folderA); await sendContext("B", folderB);
            assert.equal(await run(win, "document.documentElement.dataset.moduleTheme"), theme);
            async function compare(mode, subfolders = true) {
                const count = messages.length;
                await run(win, `document.querySelector('#compareMode').value=${JSON.stringify(mode)};document.querySelector('#chkIncludeSubfolders').checked=${subfolders};document.querySelector('#btnCompare').click()`);
                await until(() => messages.slice(count).some(message => message.message === "Confronto completato."), "comparison " + mode);
                return run(win, "Array.from(document.querySelectorAll('#resultsTable tbody tr'),row=>({name:row.cells[0].textContent,state:row.cells[1].textContent}))");
            }
            await run(win, "document.querySelector('#filterSame').checked=true");
            let rows = await compare("name"); assert.equal(rows.length, 6); assert.equal(rows.filter(row => row.state === "Diversi").length, 0);
            rows = await compare("meta"); assert.equal(rows.filter(row => row.state === "Diversi").length, 2);
            rows = await compare("hash"); assert.equal(rows.filter(row => row.state === "Diversi").length, 1);
            rows = await compare("hash", false); assert.equal(rows.length, 5); assert(!rows.some(row => row.name.includes("nested")));
            await run(win, "for(const id of ['filterOnlyA','filterOnlyB','filterSame'])document.getElementById(id).checked=false;document.querySelector('#filterDiff').dispatchEvent(new Event('change'))");
            assert.equal(await run(win, "document.querySelectorAll('#resultsTable tbody tr').length"), 1);
            await run(win, "document.querySelector('#resultsTable tbody tr').click();document.querySelector('#btnOpenInA').click();document.querySelector('#btnOpenInB').click()");
            await until(() => opened.includes(folderA) && opened.includes(folderB), "open parent folders");
            // A cancelled picker must preserve the context and allow a second attempt.
            folderChoices = [null]; await run(win, "document.querySelector('#btnSelectFolderA').click()");
            await until(() => run(win, "!document.querySelector('#btnSelectFolderA').disabled"), "picker cancellation");
            assert.equal(await run(win, "document.querySelector('#lblFolderA').textContent"), folderA);
            folderChoices = [folderB]; await run(win, "document.querySelector('#btnSelectFolderA').click()");
            await until(() => run(win, `document.querySelector('#lblFolderA').textContent===${JSON.stringify(folderB)} && !document.querySelector('#btnSelectFolderA').disabled`), "picker reopens");
            for (const [width, height] of [[1100, 820], [780, 640]]) {
                win.setContentSize(width, height);
                await run(win, "new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
                const state = await run(win, "({overflow:document.body.scrollWidth>innerWidth,styles:Array.from(document.querySelectorAll('link[rel=stylesheet]'),link=>!!link.sheet),rows:document.querySelectorAll('#resultsTable tbody tr').length})");
                assert(!state.overflow, "Horizontal page overflow at minimum size");
                assert(state.styles.every(Boolean), "All shared and module styles must load");
                fs.writeFileSync(path.join(temp, `${theme}-${width}.png`), (await win.webContents.capturePage()).toPNG());
            }
            // Close then reopen through Hierarchy: pending A must arrive after initialization.
            await run(win, "document.querySelector('#btnClose').click()");
            await until(() => win.isDestroyed(), "close module");
            await run(main, `require('electron').ipcRenderer.send('hierarchy-compare-folder-A',{folder:${JSON.stringify(folderA)}})`);
            await until(() => {
                win = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes("/modules/compare-folders/"));
                return !!win;
            }, "hierarchy opens closed window");
            await until(() => run(win, `!!window.__aypiCompareInitAttached && document.querySelector('#lblFolderA').textContent===${JSON.stringify(folderA)}`), "pending hierarchy context");
            win.destroy();
        }
        assert.deepEqual(errors, []);
        assert(!messages.some(message => message.type === "error"));
        for (const [file, content] of original) assert(fs.readFileSync(file).equals(content), "Comparison must not modify input files");
        console.log(`OK: ${packaged ? "packaged ASAR" : "development"} comparison; real Home/Hierarchy IPC, window reuse, all modes, filters, folder picker/cancel, open A/B, unchanged files, themes and minimum size.`);
        console.log("Artifacts: " + temp);
        clearTimeout(watchdog); for (const window of BrowserWindow.getAllWindows()) window.destroy(); app.exit(0);
    } catch (error) {
        console.error(error, { errors, messages: messages.slice(-5) }); clearTimeout(watchdog); app.exit(1);
    }
});
