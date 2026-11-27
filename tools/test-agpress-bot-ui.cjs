// The company bot and managerial gestures are intentionally inactive for operators.
const { app, BrowserWindow, ipcMain } = require('electron');
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '..'), dir = path.join(root, '.tmp-assistants-simple'); fs.mkdirSync(dir, { recursive: true });
app.setPath('userData', path.join(dir, 'profile')); app.commandLine.appendSwitch('enable-unsafe-swiftshader');
for (const name of ['show', 'maximize', 'focus']) BrowserWindow.prototype[name] = function () {};
for (const [channel, value] of [['get-app-version', 'test'], ['management-is-enabled', false], ['admin-is-enabled', false]]) ipcMain.handle(channel, () => value);
process.on('uncaughtException', error => { console.error(error); app.exit(1); }); process.on('unhandledRejection', error => { console.error(error); app.exit(1); });
app.whenReady().then(async () => {
    const timeout = setTimeout(() => app.exit(1), 40000), errors = [];
    const main = new BrowserWindow({ show: false, width: 1360, height: 820, webPreferences: { nodeIntegration: true, contextIsolation: false, backgroundThrottling: false } });
    main.webContents.on('console-message', (_, level, text) => { if (level >= 3) errors.push(text); });
    const run = code => main.webContents.executeJavaScript(code, true);
    const wait = async code => { for (let i = 0; i < 180; i++) { if (await run(code)) return; await new Promise(resolve => setTimeout(resolve, 40)); } throw Error('Timeout: ' + code); };
    try {
        require('../dist-ts/modules/analysis-navigation').registerAnalysisNavigation(main, () => '');
        require('../dist-ts/modules/workstations').registerWorkstations(main, () => false, { request: async () => ({ version: 1, revision: 0, profiles: [{ id: 'default', name: 'Standard', rules: {} }] }) });
        await main.loadFile(path.join(root, 'dist-ts/pages/bluearchive-preview.html'), { query: { theme: 'agpress' } });
        await wait("document.querySelectorAll('.module-card').length>0");
        await run("document.querySelector('#startupSequence')?.click()");
        for (const [width, height] of [[1360, 820], [1040, 640]]) {
            main.setContentSize(width, height); assert.equal(await run("getComputedStyle(document.querySelector('#assistant')).display"), 'none');
            assert.equal(await run("document.querySelectorAll('#spineAssistantPlayer canvas').length"), 0);
            await run("document.querySelector('#spineAssistantPlayer').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))");
            assert.equal(await run("!!document.querySelector('.assistant-analysis-confirm')"), false);
        }
        await run("localStorage.setItem('aypi-bluearchive-assistant-v1','arona')");
        await main.loadFile(path.join(root, 'dist-ts/pages/bluearchive-preview.html'), { query: { theme: 'bluearchive' } });
        for (const character of ['arona', 'plana']) {
            if (character === 'plana') await run("document.querySelector('#assistantSwitch').click();document.querySelector('[data-assistant-id=plana]').click()");
            await wait(`document.querySelector('#assistantLabel').textContent==='${character.toUpperCase()} // ONLINE'`);
            await run("document.querySelector('#startupSequence')?.click();document.querySelector('#spineAssistantPlayer').dispatchEvent(new MouseEvent('dblclick',{bubbles:true,cancelable:true}));document.querySelector('#spineAssistantPlayer').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',shiftKey:true,bubbles:true,cancelable:true}))");
            assert.equal(await run("!!document.querySelector('.assistant-analysis-confirm')"), false);
            assert.equal(await run("document.querySelector('#spineAssistantPlayer').hasAttribute('aria-keyshortcuts')"), false);
            await run("document.querySelector('#spineAssistantPlayer').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))");
            assert.equal(await run("document.querySelector('#nameBackdrop').getAttribute('aria-hidden')"), 'false');
            await run("document.querySelector('#nameCancel').click()");
        }
        assert.equal((await run("require('electron').ipcRenderer.invoke('analysis-overview-open')")).ok, false);
        assert.equal(BrowserWindow.getAllWindows().length, 1);
        assert.deepEqual(errors, []); console.log('OK: AGPress bot hidden without 3D initialization, no managerial gestures/dialogs, ordinary Arona/Plana interactions retained, normal/minimum home sizes.');
        clearTimeout(timeout); main.destroy(); app.exit(0);
    } catch (error) { console.error(error, errors); app.exit(1); }
});
