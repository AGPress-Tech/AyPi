const { app, BrowserWindow, ipcMain } = require('electron');
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const root = path.resolve(__dirname, '..'), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aypi-login-ui-'));
app.setPath('userData', path.join(dir, 'profile')); app.commandLine.appendSwitch('disable-gpu');
let groups = { 'Addetto Pulizia': ['Sokna Sahr'], Torneria: ['Operatore Due', 'Operatore Tre'] }, fail = false;
for (const module of ['maintenance', 'measurement', 'tooling', 'supplier-evaluation']) ipcMain.handle(module + '-employees', () => ({ ok: true, groups }));
ipcMain.handle('maintenance-login', (_e, name) => fail ? { ok: false, error: 'Accesso non riuscito' } : ({ ok: true, actor: name, machines: [], plans: [], records: [], due: [], attachments: [], issues: [], today: '2026-11-25' }));
ipcMain.handle('maintenance-api', (_e, value) => ({ ok: true, preferences: {}, machines: [], plans: [], records: [], due: [], attachments: [] }));
app.whenReady().then(async () => {
    require('../dist-ts/modules/login-preferences').registerLoginPreferencesIpc();
    const win = new BrowserWindow({ show: false, width: 1000, height: 680, webPreferences: { nodeIntegration: true, contextIsolation: false, backgroundThrottling: false } });
    const errors = []; win.webContents.on('console-message', (_e, level, message) => { if (level >= 3) errors.push(message); });
    const run = code => win.webContents.executeJavaScript(code, true);
    const wait = async code => { const start = Date.now(); while (Date.now() - start < 10000) { if (await run(code)) return; await new Promise(r => setTimeout(r, 30)); } throw Error('Timeout ' + code); };
    const load = async (page, theme = 'standard') => { await win.loadFile(path.join(root, 'dist-ts/pages/' + page + '.html'), { query: { theme } }); await wait("document.querySelectorAll('#loginDepartment option').length===2"); };
    try {
        await load('maintenance');
        await run("document.querySelector('#loginDepartment').value='Torneria';document.querySelector('#loginDepartment').dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('#loginEmployee').value='Operatore Due';document.querySelector('#loginForm').requestSubmit()");
        await wait("document.querySelector('#workspace').hidden===false");
        const file = path.join(app.getPath('userData'), 'login-preferences.json');
        await wait("require('electron').ipcRenderer.invoke('login-preferences-read').then(v=>v.employee?.name==='Operatore Due')");
        assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).employee, { name: 'Operatore Due', department: 'Torneria' });
        for (const theme of ['standard', 'bluearchive']) for (const page of ['maintenance', 'measurement-instruments', 'tooling', 'supplier-evaluation']) {
            await load(page, theme);
            await wait("document.querySelector('#loginEmployee').value==='Operatore Due'");
            assert.equal(await run("document.querySelector('#loginDepartment').value"), 'Torneria');
            assert(await run("document.querySelector('#loginDialog').open"), 'A remembered name must not log in automatically');
            await run("document.querySelector('#loginEmployee').value='Operatore Tre';document.querySelector('#loginEmployee').dispatchEvent(new Event('change',{bubbles:true}))");
            await new Promise(r => setTimeout(r, 40));
            assert.equal(await run("document.querySelector('#loginEmployee').value"), 'Operatore Tre', 'Respect a manual selection');
        }
        await load('maintenance'); await wait("document.querySelector('#loginEmployee').value==='Operatore Due'");
        fail = true;
        await run("document.querySelector('#loginEmployee').value='Operatore Tre';document.querySelector('#loginEmployee').dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('#loginForm').requestSubmit()");
        await wait("document.querySelector('#loginError').textContent.includes('non riuscito')");
        assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).employee.name, 'Operatore Due');
        await run("document.querySelector('#loginDialog').close();document.querySelector('#loginDialog').showModal()");
        await wait("document.querySelector('#loginEmployee').value==='Operatore Due'");
        await run("require('electron').ipcRenderer.invoke('login-preferences-remember','employee',{name:'Operatore Tre',department:'Torneria'})");
        await run("document.querySelector('#loginDialog').close()"); await run("new Promise(r=>requestAnimationFrame(r))");
        await run("document.querySelector('#loginDialog').showModal()"); await wait("document.querySelector('#loginEmployee').value==='Operatore Tre'");
        await run("require('electron').ipcRenderer.invoke('login-preferences-remember','employee',{name:'Operatore Due',department:'Torneria'})");

        groups = { 'Addetto Pulizia': ['Sokna Sahr'], Torneria: ['Operatore Tre'] };
        await load('maintenance');
        assert.notEqual(await run("document.querySelector('#loginEmployee').value"), 'Operatore Due', 'Do not create an identity absent from the current list');
        assert.deepEqual(errors, []);
        console.log('OK: ultimo login riuscito condiviso e persistente, reparto corretto, quattro moduli/due temi, scelta manuale, utente rimosso e login fallito.');
        win.destroy(); app.exit(0);
    } catch (error) { console.error(error); console.error(errors); win.destroy(); app.exit(1); }
});
