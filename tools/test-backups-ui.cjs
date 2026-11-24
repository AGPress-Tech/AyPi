const { app, BrowserWindow, ipcMain, session } = require('electron'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'aypi-backups-ui-')), base = path.join(temporary, 'AGPRESS');
app.setPath('userData', path.join(temporary, 'profile')); app.commandLine.appendSwitch('disable-gpu');
Object.assign(process.env, { AYPI_BACKEND_PROFILE: 'dev', AYPI_FP_GENERAL_DIR: path.join(base, 'General'), AYPI_DB_PATH: path.join(base, 'General', 'data', 'aypi.db'), AYPI_MES_DB_PATH: path.join(base, 'General', 'data', 'mes.db'), AYPI_FORNO_DB_PATH: path.join(base, 'General', 'data', 'forno.db'), AYPI_LOG_DIR: path.join(temporary, 'logs'), AYPI_FORNO_ENABLED: '0', AYPI_BACKUP_ADMIN_PASSWORD: 'AGPress' });
require('electron-log').transports.console.level = 'error';
process.on('unhandledRejection', error => { console.error(error); app.exit(1) });
app.whenReady().then(async () => {
    const watchdog = setTimeout(() => { console.error('Timeout backup UI'); app.exit(1) }, 90000); let win, server;
    try {
        const sqlite = require('../backend-dist/shared/db/sqlite'), mes = require('../backend-dist/shared/db/mes-sqlite'); await sqlite.initializeSqliteDatabase(); await mes.initializeMesSqliteDatabase();
        const storage = require('../backend-dist/shared/storage/agpress-backups'), data = require('../backend-dist/shared/storage/backup-data'), service = require('../backend-dist/modules/backups/service');
        sqlite.runSqliteTransaction(db => { for (const module of data.backupModules.filter(module => !module.image)) db.exec(`CREATE TABLE "${module.prefixes[0]}fixture"(id TEXT PRIMARY KEY,value TEXT)`); db.exec("CREATE TABLE fp_requests(id TEXT PRIMARY KEY,value TEXT);CREATE TABLE pm_requests(id TEXT PRIMARY KEY,value TEXT);INSERT INTO fp_requests VALUES('1','calendar-old');INSERT INTO pm_requests VALUES('1','purchasing-current')") });
        const original = storage.createAgpressBackup('manual-ui'); sqlite.runSqliteTransaction(db => db.exec("UPDATE fp_requests SET value='calendar-current'"));
        const { Router } = require('../backend-dist/shared/http/router'), { sendError } = require('../backend-dist/shared/http/response'), router = new Router(); require('../backend-dist/modules/backups/routes').registerBackupRoutes(router);
        server = http.createServer((req, res) => router.handle(req, res).catch(error => sendError(res, error))); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); process.env.AYPI_FP_BACKEND_URL = `http://127.0.0.1:${server.address().port}/api/ferie-permessi`;
        session.defaultSession.webRequest.onBeforeRequest({ urls: ['https://*/*'] }, (_details, callback) => callback({ cancel: true }));
        win = new BrowserWindow({ show: false, width: 1360, height: 820, webPreferences: { nodeIntegration: true, contextIsolation: false } });
        const admin = require('../dist-ts/modules/file-manager/admin-state-ipc').registerAdminStateIpc({ ipcMain, browserWindow: BrowserWindow });
        require('../dist-ts/modules/backups-ipc').registerBackupsIpc(win, admin.getManagementCredential);
        require('../dist-ts/modules/workstations').registerWorkstations(win, admin.canAccessManagement, { request: async () => ({ version: 1, revision: 0, profiles: [{ id: 'default', name: 'Standard', rules: {} }] }) });
        ipcMain.handle('get-app-version', () => 'test');
        const run = code => win.webContents.executeJavaScript(code, true), invoke = (channel, payload) => run(`require('electron').ipcRenderer.invoke(${JSON.stringify(channel)},${JSON.stringify(payload)})`), until = async code => { const start = Date.now(); while (Date.now() - start < 10000) { if (await run(code)) return; await new Promise(resolve => setTimeout(resolve, 30)) } throw Error('Timeout ' + code) };
        for (const theme of ['agpress', 'bluearchive']) {
            await win.loadFile(path.resolve('dist-ts/pages/bluearchive-preview.html'), { query: { theme } }); await until("document.querySelector('#backupsDialog')"); await run("window.alert=()=>{};document.querySelector('#startupSequence').click()");
            assert.equal(await run("document.querySelector('#menuBackups').hidden"), true); assert.equal((await invoke('backups-get')).ok, false);
            await invoke('admin-auth', { password: 'AGPress' }); await until("!document.querySelector('#menuBackups').hidden"); assert.equal(await run("document.querySelector('#quickMenu button').id"), 'menuBackups');
            const foreign = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false } }); await foreign.loadURL('about:blank'); assert.equal((await foreign.webContents.executeJavaScript("require('electron').ipcRenderer.invoke('backups-get')")).ok, false); foreign.destroy();
            await run("document.querySelector('#menuBackups').click()"); await until("document.querySelector('#backupSource option') && document.querySelector('#backupsDialog').getAttribute('aria-busy')==='false'");
            await run(`document.querySelector('#backupSource').value=${JSON.stringify(original.name)};document.querySelector('#backupSource').dispatchEvent(new Event('change'));document.querySelector('[name=backupScope][value=modules]').click();document.querySelectorAll('[data-backup-module]').forEach(input=>input.checked=input.value==='calendar');document.querySelector('#backupModules').dispatchEvent(new Event('change'));document.querySelector('#backupPreview').click()`);
            await until("!document.querySelector('#backupPreviewPanel').hidden && document.querySelector('#backupsDialog').getAttribute('aria-busy')==='false'");
            assert.equal(sqlite.getSqliteDatabase().exec('SELECT value FROM fp_requests')[0].values[0][0], 'calendar-current', 'Preview must not write data');
            assert.equal(await run("document.querySelector('#backupRestore').disabled"), true);
            await run("document.querySelector('#backupConfirmation').value='WRONG';document.querySelector('#backupConfirmation').dispatchEvent(new Event('input'));document.querySelector('#backupConfirmClosed').click()"); assert.equal(await run("document.querySelector('#backupRestore').disabled"), true);
            await run("document.querySelector('#backupConfirmation').value='RIPRISTINA';document.querySelector('#backupConfirmation').dispatchEvent(new Event('input'))"); assert.equal(await run("document.querySelector('#backupRestore').disabled"), false);
            for (const [width, height] of [[1360, 820], [1040, 640]]) {
                win.setSize(width, height); await new Promise(resolve => setTimeout(resolve, 100));
                const geometry = await run("(()=>{const d=document.querySelector('#backupsDialog'),r=d.getBoundingClientRect(),s=d.querySelector('#backupRestore');return {fits:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight,overflow:d.scrollWidth>d.clientWidth,enabled:!s.disabled}})()"); assert.deepEqual(geometry, { fits: true, overflow: false, enabled: true }, `${theme} ${width}`);
                await run("document.querySelector('#backupRestore').scrollIntoView({block:'nearest'})"); await win.webContents.capturePage(); fs.writeFileSync(path.join(temporary, `${theme}-${width}.png`), (await win.webContents.capturePage()).toPNG());
            }
            const blockedPlan = await invoke('backups-preview', { name: original.name, scope: 'modules', modules: ['calendar'] }); assert(blockedPlan.ok); const child = new BrowserWindow({ show: false }); child.isVisible = () => true; assert.equal((await invoke('backups-restore', { token: blockedPlan.data.token, confirmation: 'RIPRISTINA', clientsClosed: true })).ok, false); child.destroy();
            await run("document.querySelector('#backupRestore').click()"); await until("document.querySelector('#backupsDialog [data-status]').textContent.includes('Ripristino completato')");
            assert.equal(sqlite.getSqliteDatabase().exec('SELECT value FROM fp_requests')[0].values[0][0], 'calendar-old'); assert.equal(sqlite.getSqliteDatabase().exec('SELECT value FROM pm_requests')[0].values[0][0], 'purchasing-current');
            const safety = service.backupCatalog().items.find(item => item.protected); assert(safety); assert(fs.existsSync(path.join(storage.getAgpressBackupRootDir(), safety.name, 'AYPI_BACKUP_PROTECTED.json')));
            const undo = await invoke('backups-preview', { name: safety.name, scope: 'modules', modules: ['calendar'] }); assert.equal((await invoke('backups-restore', { token: undo.data.token, confirmation: 'RIPRISTINA', clientsClosed: true })).ok, true); assert.equal(sqlite.getSqliteDatabase().exec('SELECT value FROM fp_requests')[0].values[0][0], 'calendar-current');
            await invoke('admin-disable'); assert.equal(await run("document.querySelector('#menuBackups').hidden"), true); assert.equal(await run("document.querySelector('#backupsDialog').open"), false); assert.equal((await invoke('backups-preview', { name: original.name, scope: 'all' })).ok, false);
        }
        console.log('Backups Electron OK: admin-only first menu item, IPC origin, preview, confirmation, local open-window check, selective restore, protected undo, two themes and 1360×820 / 1040×640.'); console.log('Screenshots: ' + temporary);
        clearTimeout(watchdog); win.destroy(); await new Promise(resolve => server.close(resolve)); app.exit(0);
    } catch (error) { console.error(error); if (win) win.destroy(); if (server) server.close(); app.exit(1) }
});
