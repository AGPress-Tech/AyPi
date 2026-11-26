const { app, BrowserWindow, Menu, screen } = require('electron');
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const root = path.resolve(__dirname, '..'), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aypi-menu-ui-'));
app.setPath('userData', path.join(dir, 'profile'));
app.commandLine.appendSwitch('disable-gpu');
app.whenReady().then(async () => {
    let main, source, stranger;
    try {
        const bundle = path.join(dir, 'links.cjs');
        require('esbuild').buildSync({ entryPoints: [path.join(root, 'src/renderer/modules/analysis-links.ts')], outfile: bundle, bundle: true, platform: 'node', format: 'cjs', external: ['electron'] });
        const fixture = path.join(dir, 'fixture.html');
        fs.writeFileSync(fixture, `<table><tr><td data-article="A">A</td><td data-article="B">B</td><td data-article="C">C</td><td id="value">100</td></tr></table><script>require(${JSON.stringify(bundle)}).installAnalysisLinks(element=>{const cell=element.closest('[data-article]');return cell?{article:cell.dataset.article}:null},message=>{throw Error(message)})</script>`);
        const options = { show: false, webPreferences: { nodeIntegration: true, contextIsolation: false, backgroundThrottling: false } };
        main = new BrowserWindow(options); source = new BrowserWindow(options); stranger = new BrowserWindow(options);
        const navigation = require('../dist-ts/modules/analysis-navigation');
        navigation.registerAnalysisNavigation(main, () => '');
        navigation.registerAnalysisTarget('erp-explorer', async () => source, event => event.sender === source.webContents);
        const probes = [], popups = []; let position = { x: 120, y: 240 }, opened = 0;
        navigation.registerAnalysisTarget('stock-analysis', async () => { opened++; return source; }, () => false, async context => {
            probes.push(context.article); await new Promise(resolve => setTimeout(resolve, 250)); return true;
        });
        Menu.buildFromTemplate = items => ({
            popup(options) { this.options = options; popups.push({ items, options, at: Date.now() }); },
            closePopup() { this.options?.callback(); },
        });
        screen.getCursorScreenPoint = () => ({ ...position });
        await source.loadFile(fixture); await stranger.loadURL('about:blank');
        const run = code => source.webContents.executeJavaScript('{' + code + '}', true);
        const until = async condition => { const start = Date.now(); while (Date.now() - start < 5000) { if (await condition()) return; await new Promise(resolve => setTimeout(resolve, 15)); } throw Error('Menu UI timeout'); };
        await run("document.querySelector('[data-article=A]').dispatchEvent(new PointerEvent('pointerover',{bubbles:true}))");
        await until(() => probes.includes('A'));
        await new Promise(resolve => setTimeout(resolve, 300));
        assert.equal(popups.length, 0, 'Hover must not open a menu or module'); assert.equal(opened, 0);
        await run("document.querySelector('[data-article=A]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))");
        await until(() => popups.length > 0);
        assert.equal(popups.length, 1, 'A warmed cell opens only the final native menu');
        assert.equal(popups[0].items[0].enabled, undefined);
        assert.deepEqual(probes, ['A'], 'Right click reuses hover verification');
        await run("document.querySelector('[data-article=B]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))");
        await until(() => popups.at(-1).items[0].enabled === false);
        position = { x: 900, y: 600 };
        await until(() => popups.at(-1).items[0].enabled !== false);
        assert.equal(popups.at(-1).options.x, 120); assert.equal(popups.at(-1).options.y, 240, 'Mouse movement cannot move a delayed menu');
        await run("document.querySelector('[data-article=C]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))");
        await until(() => popups.at(-1).items[0].enabled === false);
        await run("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
        const afterEscape = popups.length;
        await new Promise(resolve => setTimeout(resolve, 350));
        assert.equal(popups.length, afterEscape, 'Escape prevents a delayed popup');
        const beforeValue = popups.length;
        assert.equal(await run("const event=new MouseEvent('contextmenu',{bubbles:true,cancelable:true});document.querySelector('#value').dispatchEvent(event);event.defaultPrevented"), false);
        assert.equal(popups.length, beforeValue, 'Generic values must not acquire row-wide actions');
        const unauthorized = await stranger.webContents.executeJavaScript("require('electron').ipcRenderer.invoke('analysis-context-menu',{article:'A'})");
        assert.equal(unauthorized.ok, false);
        console.log('OK: real Electron hover/IPC, warm menu without repeat probes, native slow feedback, fixed click position, Escape cancellation, generic cells and unauthorized windows.');
        app.exit(0);
    } catch (error) { console.error(error); app.exit(1); }
});
