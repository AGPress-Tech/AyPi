// Real Home IPC and image libraries, with isolated profile and save destinations.
const { app, BrowserWindow, dialog, session } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { PNG } = require("pngjs");
const root = path.resolve(__dirname, "..");
const packaged = process.argv.includes("--packaged");
const runtime = process.env.AYPI_TEST_RUNTIME_DIR || (packaged
    ? path.join(root, "dist/module-refactor-preview/step-02-qr/win-unpacked/resources/app.asar/dist-ts")
    : path.join(root, "dist-ts"));
const page = path.join(runtime, "modules/qr-generator/qr-generator.html");
assert(fs.existsSync(page), "Relocated QR page must be present in the build");
assert(!fs.existsSync(path.join(runtime, "pages/utilities/qr-generator.html")), "Old QR page must not remain after a clean build");
assert(!fs.existsSync(path.join(runtime, "scripts/utilities/qr-generator-scripts.js")), "Old QR script must not remain after a clean build");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "aypi-qr-refactor-"));
app.setPath("userData", path.join(temp, "profile"));
app.commandLine.appendSwitch("disable-gpu");
for (const name of ["show", "focus", "maximize"]) BrowserWindow.prototype[name] = function () {};
const messages = [], errors = [], saves = [];
let saveChoices = [];
dialog.showMessageBox = async (_window, options) => { messages.push(options); return { response: 0 }; };
dialog.showSaveDialog = async (_window, options) => {
    saves.push(options);
    const selected = saveChoices.shift();
    return { canceled: !selected, filePath: selected || undefined };
};
const modulePath = file => path.join(runtime, "modules", file);
require(modulePath("file-manager/realtime-client.js")).setupRealtimeClient = () => {};
require(modulePath("file-manager/backend-client.js")).requestAypiBackend = async () => { throw Error("Backend disabled in isolated QR test"); };
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
function imageData(buffer) {
    assert.equal(buffer.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    const png = PNG.sync.read(buffer);
    assert(png.width > 20 && png.height > 20);
    let dark = 0, light = 0;
    for (let i = 0; i < png.data.length; i += 4) {
        if (png.data[i] < 64 && png.data[i + 3] > 0) dark++;
        if (png.data[i] > 240 && png.data[i + 3] > 0) light++;
    }
    assert(dark > 100 && light > 100, "Generated PNG must contain an actual code");
    return png;
}
app.whenReady().then(async () => {
    const watchdog = setTimeout(() => { console.error("QR test timeout"); app.exit(1); }, 90000);
    try {
        session.defaultSession.webRequest.onBeforeRequest({ urls: ["http://*/*", "https://*/*"] }, (_request, callback) => callback({ cancel: true }));
        app.on("web-contents-created", (_event, contents) => {
            contents.setBackgroundThrottling(false);
            contents.on("console-message", (_event, level, message) => { if (level >= 3) errors.push(message); });
        });
        const main = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false } });
        await main.loadURL("about:blank");
        const manager = require(modulePath("fileManager.js"));
        manager.setupFileManager(main);
        let win, originalWindow;
        async function launch(theme) {
            manager.setInterfaceIconTheme(theme);
            await run(main, `require('electron').ipcRenderer.send('open-qr-generator-window',{theme:${JSON.stringify(theme)}})`);
            await until(() => {
                win = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes("/modules/qr-generator/qr-generator.html"));
                return !!win;
            }, "Home opens QR");
            await until(() => run(win, `document.readyState==='complete' && document.documentElement.dataset.moduleTheme===${JSON.stringify(theme)} && !!document.querySelector('#btnSave')`), "QR page ready");
            await run(win, "document.querySelector('#baQrSplash')?.click()");
        }
        for (const theme of ["standard", "bluearchive"]) {
            await launch(theme);
            if (originalWindow) assert.equal(win.id, originalWindow, "Theme changes must reuse the window and load the new page");
            originalWindow = win.id;
            assert.equal(await run(win, "document.querySelector('#btnSave').disabled"), true);
            const warningCount = messages.length;
            await run(win, "document.querySelector('#btnGenerate').click()");
            await until(() => messages.slice(warningCount).some(message => message.type === "warning"), "empty input validation");
            assert.equal(await run(win, "document.querySelector('#btnSave').disabled"), true);
            async function generate(values) {
                const previous = await run(win, "document.querySelector('#previewImage').src");
                await run(win, `for(const [id,value] of Object.entries(${JSON.stringify(values)})){const element=document.getElementById(id);if(element.type==='checkbox')element.checked=value;else element.value=value;}document.querySelector('#typeSelect').dispatchEvent(new Event('change'));document.querySelector('#btnGenerate').click()`);
                await until(() => run(win, `document.querySelector('#previewImage').src!==${JSON.stringify(previous)} && document.querySelector('#previewImage').complete && document.querySelector('#previewImage').naturalWidth>0 && !document.querySelector('#btnSave').disabled`), "image generated");
                const value = await run(win, "document.querySelector('#previewImage').src.split(',')[1]");
                return Buffer.from(value, "base64");
            }
            async function save(buffer, name, expectedDefault) {
                const file = path.join(temp, theme, name), count = messages.length;
                saveChoices = [file];
                await run(win, "document.querySelector('#btnSave').click()");
                await until(() => messages.slice(count).some(message => message.message === "Immagine salvata con successo."), "PNG saved");
                assert(fs.readFileSync(file).equals(buffer), "Saved PNG must be identical to the preview");
                assert.equal(saves.at(-1).defaultPath, expectedDefault);
                assert.deepEqual(saves.at(-1).filters, [{ name: "Immagine PNG", extensions: ["png"] }]);
                imageData(fs.readFileSync(file));
            }
            const firstQr = await generate({ typeSelect: "qr", contentInput: "AyPi prova: qualità 123", sizeInput: 256, marginInput: 4 });
            const qr = imageData(firstQr); assert.equal(qr.width, 256); assert.equal(qr.height, 256);
            assert.equal(await run(win, "getComputedStyle(document.querySelector('#barcodeExtraOptions')).display"), "none");
            await save(firstQr, "unicode.png", "qrcode.png");
            const urlQr = await generate({ typeSelect: "qr", contentInput: "https://www.agpress.it/?prova=AyPi", sizeInput: 384, marginInput: 8 });
            assert.equal(imageData(urlQr).width, 384); assert(!urlQr.equals(firstQr));
            await save(urlQr, "url.png", "qrcode.png");
            const beforeCancel = saves.length, messageCount = messages.length;
            saveChoices = [null]; await run(win, "document.querySelector('#btnSave').click()");
            await until(() => saves.length > beforeCancel, "cancel save dialog");
            await run(win, "new Promise(resolve=>setTimeout(resolve,60))");
            assert.equal(messages.length, messageCount, "Cancel must not report a false save");
            assert.equal(await run(win, "document.querySelector('#btnSave').disabled"), false);
            await save(urlQr, "after-cancel.png", "qrcode.png");
            const noText = await generate({ typeSelect: "barcode", contentInput: "AYPI-123456", sizeInput: 320, barcodeHeight: 16, barcodeShowText: false });
            const plain = imageData(noText);
            assert.notEqual(await run(win, "getComputedStyle(document.querySelector('#barcodeExtraOptions')).display"), "none");
            const withText = await generate({ typeSelect: "barcode", contentInput: "AYPI-123456", sizeInput: 320, barcodeHeight: 16, barcodeShowText: true });
            assert(imageData(withText).height > plain.height, "Text option must affect barcode output");
            await save(withText, "barcode.png", "barcode.png");
            const tall = await generate({ typeSelect: "barcode", contentInput: "AYPI-123456", sizeInput: 320, barcodeHeight: 24, barcodeShowText: true });
            assert(imageData(tall).height > imageData(withText).height, "Barcode height must affect output");
            await save(tall, "barcode-tall.png", "barcode.png");
            await generate({ typeSelect: "qr", contentInput: "https://www.agpress.it/?prova=AyPi", sizeInput: 256, marginInput: 4 });
            assert.equal(await run(win, "getComputedStyle(document.querySelector('#barcodeExtraOptions')).display"), "none");
            await launch(theme);
            assert.equal(win.id, originalWindow);
            assert.equal(BrowserWindow.getAllWindows().filter(window => window.webContents.getURL().includes("/modules/qr-generator/")).length, 1);
            for (const [width, height] of [[1100, 820], [740, 640]]) {
                win.setContentSize(width, height);
                await run(win, "new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
                const layout = await run(win, "({overflow:document.body.scrollWidth>innerWidth,styles:Array.from(document.querySelectorAll('link[rel=stylesheet]'),link=>!!link.sheet),image:document.querySelector('#previewImage').naturalWidth})");
                assert(!layout.overflow, "Page must fit supported width"); assert(layout.styles.every(Boolean)); assert(layout.image > 0);
                fs.writeFileSync(path.join(temp, `${theme}-${width}.png`), (await win.webContents.capturePage()).toPNG());
            }
        }
        await run(win, "document.querySelector('#btnClose').click()");
        await until(() => win.isDestroyed(), "close QR");
        await launch("standard");
        assert.notEqual(win.id, originalWindow); assert.equal(await run(win, "document.querySelector('#btnSave').disabled"), true);
        assert.deepEqual(errors, []); assert(!messages.some(message => message.type === "error"));
        console.log(`OK: ${packaged ? "packaged ASAR" : "development"} QR/Code128, real Home IPC, theme reload/reuse, Unicode and URL, PNG dimensions/pixels, barcode text/height, exact PNG saves/filter, cancellation, close/reopen, both themes/sizes.`);
        console.log("Artifacts: " + temp);
        clearTimeout(watchdog); for (const window of BrowserWindow.getAllWindows()) window.destroy(); app.exit(0);
    } catch (error) {
        console.error(error, { errors, messages: messages.slice(-3) }); clearTimeout(watchdog); app.exit(1);
    }
});
