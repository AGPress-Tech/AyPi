/* Preview isolata: nessun main AyPi, backend, collector o archivio operativo. */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { pathToFileURL, fileURLToPath } = require('url');
const electron = require('electron');
const root = path.resolve(__dirname, '..');

if (typeof electron === 'string') {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = require('child_process').spawn(electron, [__filename, ...process.argv.slice(2)], {
        cwd: root, env, stdio: 'inherit', windowsHide: process.argv.includes('--smoke'),
    });
    child.once('error', error => { console.error(error); process.exitCode = 1; });
    child.once('exit', code => { process.exitCode = code ?? 1; });
    process.once('SIGINT', () => child.kill());
    process.once('SIGTERM', () => child.kill());
} else {
    const { app, BrowserWindow, Menu, ipcMain, dialog } = electron;
    const smoke = process.argv.includes('--smoke');
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'aypi-forge-preview-'));
    const source = path.join(root, 'src/renderer');
    app.setPath('userData', path.join(workspace, 'profile'));
    if (smoke) app.disableHardwareAcceleration();
    let win, compiler, timer, building = false, pending = false, closing = false;
    let view = 'landing', theme = process.argv.includes('--bluearchive') ? 'bluearchive' : 'standard';
    let reloads = 0;
    const watchers = [];
    const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

    function menu() {
        Menu.setApplicationMenu(Menu.buildFromTemplate([
            { label: 'Pagina', submenu: [
                { label: 'Presentazione', type: 'radio', checked: view === 'landing', accelerator: 'Alt+1', click: () => selectView('landing') },
                { label: 'Centrale FORGE', type: 'radio', checked: view === 'hub', accelerator: 'Alt+2', click: () => selectView('hub') },
                { label: 'Verifica robot', type: 'radio', checked: view === 'robots', accelerator: 'Alt+3', click: () => selectView('robots') },
                { type: 'separator' }, { label: 'Chiudi preview', role: 'quit' },
            ] },
            { label: 'Tema', submenu: [
                { label: 'Ambra AGPress', type: 'radio', checked: theme === 'standard', click: () => selectTheme('standard') },
                { label: 'Azzurro Blue Archive', type: 'radio', checked: theme === 'bluearchive', click: () => selectTheme('bluearchive') },
            ] },
            { label: 'Strumenti', submenu: [
                { label: 'Ricarica', accelerator: 'F5', click: () => rebuild() },
                { label: 'Strumenti sviluppatore', accelerator: 'F12', click: () => win.webContents.toggleDevTools() },
            ] },
        ]));
    }

    async function load() {
        if (closing) return;
        await win.loadFile(path.join(workspace, 'pages', view === 'landing' ? 'forge-preview.html' : 'forge.html'), { query: { theme } });
        if (view === 'robots') await win.webContents.executeJavaScript("document.getElementById('forge-open-robots').click()");
        win.setTitle(`FORGE · Preview ${theme === 'standard' ? 'AGPress' : 'Blue Archive'} · Salva per aggiornare`);
        reloads++;
    }
    async function selectView(next) { view = next; menu(); await load(); }
    async function selectTheme(next) {
        if (view !== 'landing') {
            const robots = await win.webContents.executeJavaScript("!document.getElementById('forge-robots').hidden");
            view = robots ? 'robots' : 'hub';
        }
        theme = next; menu(); await load();
    }

    async function rebuild() {
        if (closing) return;
        if (building) { pending = true; return; }
        building = true;
        try {
            await compiler.rebuild();
            fs.cpSync(path.join(source, 'pages'), path.join(workspace, 'pages'), { recursive: true });
            fs.cpSync(path.join(source, 'styles'), path.join(workspace, 'styles'), { recursive: true });
            fs.copyFileSync(path.join(__dirname, 'forge-preview/landing.html'), path.join(workspace, 'pages/forge-preview.html'));
            fs.copyFileSync(path.join(source,'scripts/utility-layout-bootstrap.js'),path.join(workspace,'scripts/utility-layout-bootstrap.js'));
            let scroll = 0;
            if (win.webContents.getURL()) {
                const state = await win.webContents.executeJavaScript("({scroll:scrollY,robots:!!document.getElementById('forge-robots')&&!document.getElementById('forge-robots').hidden})");
                scroll = state.scroll;
                if (view !== 'landing') view = state.robots ? 'robots' : 'hub';
            }
            await load();
            await win.webContents.executeJavaScript(`scrollTo(0,${Number(scroll) || 0})`);
            console.log('[FORGE preview] Aggiornata —', new Date().toLocaleTimeString('it-IT'));
        } catch (error) {
            console.error('[FORGE preview] Correggi il file e salva di nuovo:', error.message);
        } finally {
            building = false;
            if (pending) { pending = false; void rebuild(); }
        }
    }
    function watch(directory) {
        watchers.push(fs.watch(directory, { recursive: true }, (_event, filename) => {
            if (!filename || /\.(html|css|ts|js|svg|png|jpg|webp)$/i.test(String(filename))) {
                clearTimeout(timer); timer = setTimeout(() => void rebuild(), 180);
            }
        }));
    }
    function simulated(module) {
        const message = `${module}: comando simulato. La preview non interroga macchine o backend.`;
        console.log('[FORGE preview]', message);
        if (!smoke) void dialog.showMessageBox(win, { type: 'info', title: 'Preview FORGE', message });
    }

    app.whenReady().then(async () => {
        compiler = await require('esbuild').context({
            entryPoints: {
                'forge-scripts': path.join(source, 'scripts/forge-scripts.ts'),
                'forge-preview-landing': path.join(__dirname, 'forge-preview/landing.ts'),
            },
            outdir: path.join(workspace, 'scripts'), bundle: true, platform: 'node', format: 'cjs',
            target: 'es2020', packages: 'external', logLevel: 'silent',
        });
        win = new BrowserWindow({ width: 1400, height: 900, minWidth: 750, minHeight: 600,
            show: false, title: 'FORGE · Preview locale',
            webPreferences: { nodeIntegration: true, contextIsolation: false, ...(smoke ? { offscreen: true } : {}) },
        });
        // Local assets stay in the source tree; all remote requests are blocked.
        win.webContents.session.webRequest.onBeforeRequest((details, callback) => {
            const url = new URL(details.url);
            if (['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) return callback({ cancel: true });
            if (url.protocol === 'file:') {
                const relative = path.relative(path.join(workspace, 'assets'), fileURLToPath(url));
                if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
                    return callback({ redirectURL: pathToFileURL(path.join(root, 'assets', relative)).href });
                }
            }
            callback({});
        });
        win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        win.webContents.on('will-navigate', (event, url) => { if (!url.startsWith('file:')) event.preventDefault(); });
        ipcMain.on('open-forge-window', () => { void selectView('hub'); });
        ipcMain.on('open-production-planner-window', () => simulated('MES e Pianificatore'));
        ipcMain.on('open-forno-window', () => simulated('Scada Forno'));
        ipcMain.handle('robot-status-custom',async(_event,robotId)=>{
            await delay(1400);return {ok:true,robotId,ip:'PREVIEW',program:'Programma dimostrativo',state:'SIMULAZIONE',counter:'1250',cycleTime:'32',details:'Dati simulati: nessuna connessione alla macchina.'};
        });
        ipcMain.handle('ping-robot-custom',async(_event,robotId)=>{
            await delay(1400);return {ok:true,robotId,ip:'PREVIEW',reachable:true,summary:'Risposta simulata: nessun pacchetto inviato.',expectedMac:'SIMULAZIONE',detectedMac:'SIMULAZIONE'};
        });
        menu(); await rebuild();
        if (!smoke) {
            win.center(); win.maximize(); win.show(); win.focus(); app.focus({ steal: true });
            console.log('[FORGE preview] Finestra visibile:', win.isVisible(), '· PID:', process.pid);
        }
        watch(path.join(source, 'pages')); watch(path.join(source, 'styles'));
        watch(path.join(source, 'scripts')); watch(path.join(__dirname, 'forge-preview'));
        watch(path.join(root, 'assets'));
        console.log('FORGE preview attiva. Salva HTML/CSS/TypeScript per aggiornare. Menu Pagina e Tema; F12 per gli strumenti. Chiudi la finestra per terminare.');
        if (smoke) {
            const assert = require('node:assert/strict');
            const testFile = path.join(source, 'styles', `forge-preview-${require('crypto').randomUUID()}.css`);
            try {
                assert(await win.webContents.executeJavaScript("!!document.getElementById('open-forge')"));
                await selectView('hub');
                await selectTheme('bluearchive');
                assert.equal(await win.webContents.executeJavaScript('document.documentElement.dataset.forgeTheme'), 'bluearchive');
                await selectView('robots');
                const before = reloads;
                fs.writeFileSync(testFile, 'body { --forge-preview-test: ready; }');
                for (let i = 0; i < 50 && reloads === before; i++) await delay(100);
                assert(reloads > before, 'Salvataggio senza ricaricamento automatico');
                assert(await win.webContents.executeJavaScript("!document.getElementById('forge-robots').hidden"));
                assert(fs.readFileSync(path.join(workspace, 'styles', path.basename(testFile)), 'utf8').includes('ready'));
                console.log('OK: preview, temi, pagine e ricaricamento dopo salvataggio con sezione preservata.');
            } finally { fs.rmSync(testFile, { force: true }); app.quit(); }
        }
    }).catch(error => { console.error(error); process.exitCode = 1; app.quit(); });
    app.on('window-all-closed', () => app.quit());
    app.on('before-quit', () => {
        closing = true; clearTimeout(timer);
        for (const watcher of watchers) watcher.close();
        void compiler?.dispose();
    });
}
