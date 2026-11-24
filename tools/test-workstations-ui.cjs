// Build both the desktop and backend before running with Electron.
const {app, BrowserWindow, ipcMain, dialog, session} = require('electron');
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http'), {execFile} = require('node:child_process');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aypi-workstations-'));
const peer = process.argv.includes('--peer');
app.setPath('userData', process.env.AYPI_TEST_STATION_PROFILE || path.join(dir, 'profile'));
app.commandLine.appendSwitch('disable-gpu');
process.env.AYPI_BACKEND_PROFILE = 'dev';
process.env.AYPI_DB_PATH = path.join(dir, 'stations.db');
process.env.AYPI_LOG_DIR = dir;
process.env.AYPI_WORKSTATIONS_ADMIN_PASSWORD = 'AGPress';
const {installStationLaunchGuards, registerWorkstations} = require('../dist-ts/modules/workstations');
const {registerAdminStateIpc} = require('../dist-ts/modules/file-manager/admin-state-ipc');
require('electron-log').transports.console.level = 'error';
installStationLaunchGuards();
process.on('unhandledRejection', error => {console.error(error); app.exit(1)});
app.whenReady().then(async () => {
    const watchdog = setTimeout(() => {console.error('Timeout postazioni'); app.exit(1)}, 90000);
    let win, server;
    try {
        if (!peer) {
            await require('../backend-dist/shared/db/sqlite').initializeSqliteDatabase();
            const {Router} = require('../backend-dist/shared/http/router'), {sendError} = require('../backend-dist/shared/http/response');
            const router = new Router();
            require('../backend-dist/modules/shared/routes').registerSharedRoutes(router);
            server = http.createServer((req,res) => router.handle(req,res).catch(error=>sendError(res,error)));
            await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
            process.env.AYPI_FP_BACKEND_URL = `http://127.0.0.1:${server.address().port}/api/ferie-permessi`;
        }
        session.defaultSession.webRequest.onBeforeRequest({urls:['https://*/*']}, (_details, callback) => callback({cancel:true}));
        win = new BrowserWindow({show:false, width:1360, height:820, webPreferences:{nodeIntegration:true, contextIsolation:false}});
        const admin = registerAdminStateIpc({ipcMain, browserWindow:BrowserWindow});
        registerWorkstations(win, admin.canAccessManagement);
        ipcMain.handle('get-app-version', () => 'test');
        let launches = 0;
        ipcMain.on('open-address', () => launches++);
        ipcMain.handle('turning-analysis-open', () => {launches++; return {ok:true}});
        ipcMain.handle('analysis-navigate', () => {launches++; return {ok:true}});
        const run = code => win.webContents.executeJavaScript(code, true);
        const until = async code => {const start=Date.now(); while(Date.now()-start<10000){if(await run(code))return;await new Promise(r=>setTimeout(r,30))}throw Error('Timeout '+code)};
        const invoke = (channel, payload) => run(`require('electron').ipcRenderer.invoke(${JSON.stringify(channel)},${JSON.stringify(payload)})`);
        if (peer) {
            await win.loadURL('about:blank');
            const snapshot = await invoke('workstations-get');
            assert(snapshot.config.profiles.some(profile=>profile.id==='officina'),'Profiles created on another PC must be available');
            if (process.env.AYPI_TEST_PEER_SELECT === '1') {
                assert.equal(snapshot.config.activeId,'','New PCs must start without an assignment');
                assert.equal((await invoke('workstations-select',{id:'default'})).ok,true);
            } else assert.equal(snapshot.config.activeId,'default','Another PC saving profiles or selecting a station must not change this PC assignment');
            win.destroy(); clearTimeout(watchdog); console.log('PEER OK'); app.exit(0); return;
        }
        const peerProfile = path.join(dir,'peer-profile');
        async function otherPC(select) {
            const env = {...process.env, AYPI_TEST_STATION_PROFILE:peerProfile, AYPI_TEST_PEER_SELECT: select ? '1' : '0'};
            delete env.ELECTRON_RUN_AS_NODE;
            const output = await new Promise((resolve,reject)=>execFile(process.execPath,[__filename,'--peer'],{env,windowsHide:true,timeout:25000},(error,stdout,stderr)=>error?reject(Error(stdout+'\n'+stderr)):resolve(stdout)));
            assert(output.includes('PEER OK'));
        }
        let latest;
        async function get() {latest=await invoke('workstations-get');return latest;}
        async function save(profiles, extra={}) {await get(); const result=await invoke('workstations-save',{version:1,profiles,revision:latest.revision,...extra});if(result.ok)latest=result;return result;}
        for (const theme of ['agpress','bluearchive']) {
            await win.loadFile(path.resolve('dist-ts/pages/bluearchive-preview.html'),{query:{theme}});
            await until("document.querySelector('#workstationDialog') && !document.querySelector('[data-page=moduli]').disabled");
            await run("window.confirm=()=>true;window.alert=()=>{};document.querySelector('#startupSequence').click();document.querySelector('#menuWorkstation').click()");
            await until("document.querySelector('#workstationDialog').open && document.querySelector('[data-status]').textContent!=='Aggiornamento profili…'");
            assert.equal((await get()).config.activeId,'');
            assert.equal(await run("document.querySelector('[data-active]').closest('label').hidden"),false);
            assert.equal(await run("document.querySelector('[data-save]').hidden"),true);
            assert.equal((await invoke('workstations-save',latest.config)).ok,false,'Operators must not edit profiles');
            await run("document.querySelector('#workstationDialog [data-close]').click()");
            await invoke('admin-auth',{password:'AGPress'});
            await run("document.querySelector('#menuWorkstation').click()");
            await until("document.querySelector('[data-status]').textContent!=='Aggiornamento profili…'");
            assert.equal(await run("document.querySelector('[data-active]').closest('label').hidden"),true,'Management must not contain PC assignment controls');
            await run("document.querySelector('[data-new]').click();document.querySelector('[data-name]').value='Officina';document.querySelector('[data-name]').dispatchEvent(new Event('input'));document.querySelector('[data-name]').dispatchEvent(new Event('change'));document.querySelector('[data-rule=\"moduli.openFornitori\"]').value='blocked';document.querySelector('[data-rule=\"moduli.openFornitori\"]').dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('[data-rule=\"moduli.openDDT\"]').value='hidden';document.querySelector('[data-rule=\"moduli.openDDT\"]').dispatchEvent(new Event('change',{bubbles:true}))");
            for (const [width,height] of [[1360,820],[1040,640]]) {
                win.setSize(width,height);
                const geometry = await run("(()=>{const d=document.querySelector('#workstationDialog'),r=d.getBoundingClientRect(),f=d.querySelector('footer').getBoundingClientRect();return {fits:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight,footer:f.bottom<=r.bottom,overflow:d.scrollWidth>d.clientWidth}})()");
                assert.deepEqual(geometry,{fits:true,footer:true,overflow:false});
                await new Promise(resolve=>setTimeout(resolve,100));await win.webContents.capturePage();
                fs.writeFileSync(path.join(dir,`${theme}-admin-${width}.png`),(await win.webContents.capturePage()).toPNG());
            }
            await run("document.querySelector('[data-save]').click()");
            await until("document.querySelector('[data-status]').textContent.includes('Profili salvati')");
            await get();
            assert.equal(latest.config.activeId,'','Saving profiles must not assign this PC');
            const profiles=latest.config.profiles.map(profile=>profile.name==='Officina'?{...profile,id:'officina'}:profile);
            assert.equal((await save(profiles,{activeId:'officina'})).ok,true);
            assert.equal(latest.config.activeId,'','An admin payload cannot assign a PC through profile publication');
            assert.equal(await run("[...document.querySelectorAll('.module-card')].find(b=>b.dataset.label==='Valutazione Fornitori').disabled"),false,'All modules remain ON until the operator chooses a station');
            assert.equal(await run("[...document.querySelectorAll('.module-card')].find(b=>b.dataset.label==='DDT Fornitori').hidden"),false);
            if(theme==='agpress')await otherPC(true);
            await run("document.querySelector('#workstationDialog [data-close]').click()");
            await invoke('admin-disable');
            await run("document.querySelector('#menuWorkstation').click()");
            await until("document.querySelector('[data-active] option[value=officina]') && document.querySelector('[data-status]').textContent!=='Aggiornamento profili…'");
            await run("document.querySelector('[data-active]').value='officina';document.querySelector('[data-active]').dispatchEvent(new Event('change'))");
            assert.equal((await get()).config.activeId,'','Previewing a station must not apply it');
            assert.equal(await run("document.querySelector('[data-rule=\"moduli.openFornitori\"]').disabled"),true);
            for (const [width,height] of [[1360,820],[1040,640]]) {
                win.setSize(width,height);await new Promise(resolve=>setTimeout(resolve,100));
                const fits=await run("(()=>{const d=document.querySelector('#workstationDialog'),r=d.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&d.scrollWidth<=d.clientWidth})()");
                assert(fits);
                fs.writeFileSync(path.join(dir,`${theme}-operator-${width}.png`),(await win.webContents.capturePage()).toPNG());
            }
            await run("document.querySelector('[data-select]').click()");
            await until("document.querySelector('[data-status]').textContent.includes('solo su questo PC')");
            assert.equal((await get()).config.activeId,'officina');
            await run("document.querySelector('#workstationDialog [data-close]').click()");
            assert.equal(await run("[...document.querySelectorAll('.module-card')].find(b=>b.dataset.label==='Valutazione Fornitori').disabled"),true);
            assert.equal(await run("[...document.querySelectorAll('.module-card')].find(b=>b.dataset.label==='DDT Fornitori').hidden"),true);
            await run("require('electron').ipcRenderer.send('open-address',{key:'moduli.openFornitori'})");
            await new Promise(resolve=>setTimeout(resolve,30));assert.equal(launches,0);
            await win.reload();
            await until("document.querySelector('#workstationDialog') && [...document.querySelectorAll('.module-card')].some(b=>b.dataset.label==='Valutazione Fornitori'&&b.disabled)");
            await run("window.confirm=()=>true;window.alert=()=>{};document.querySelector('#startupSequence').click()");
            assert.equal((await get()).config.activeId,'officina','Local selection must survive reload');
            const child=new BrowserWindow({show:false});child.isVisible=()=>true;
            assert.equal((await invoke('workstations-select',{id:''})).ok,false,'Open modules must protect view changes');
            child.destroy();
            assert.equal((await invoke('workstations-select',{id:'missing'})).ok,false);
            assert.equal((await invoke('workstations-select',{id:'officina',profiles:[]})).ok,false,'Operators cannot inject profile rules');
            await invoke('admin-auth',{password:'AGPress'});
            const hidden=structuredClone(latest.config.profiles);
            hidden.find(profile=>profile.id==='officina').rules['section:analisi']='hidden';
            assert.equal((await save(hidden)).ok,true);
            assert.equal((await invoke('turning-analysis-open')).ok,false);
            assert.equal((await invoke('analysis-navigate',{target:'article-orders'})).ok,false);
            const exportPath=path.join(dir,'export.json');
            dialog.showSaveDialog=async()=>({canceled:false,filePath:exportPath});
            assert.equal((await invoke('workstations-export',latest.config)).ok,true);
            const exported=JSON.parse(fs.readFileSync(exportPath,'utf8'));
            assert.equal('activeId' in exported,false,'Exported profiles must never transfer PC assignment');
            dialog.showOpenDialog=async()=>({canceled:false,filePaths:[exportPath]});
            assert.equal((await invoke('workstations-import')).config.activeId,'');
            const endpoint=process.env.AYPI_FP_BACKEND_URL.replace('/api/ferie-permessi','/api/shared/workstations');
            const put=(body,password)=>fetch(endpoint,{method:'PUT',headers:{'Content-Type':'application/json',...(password?{'x-aypi-workstations-password':password}:{})},body:JSON.stringify(body)});
            assert.equal((await put(exported)).status,401);
            const current=await (await fetch(endpoint)).json();
            assert.equal((await put({...current,activeId:'officina'},'AGPress')).status,400,'The shared API must reject PC assignments');
            assert.equal((await put({...current,revision:current.revision-1},'AGPress')).status,409,'Concurrent administrators must not overwrite each other');
            if(theme==='agpress')await otherPC(false);
            assert.equal((await invoke('workstations-select',{id:''})).ok,true);
            assert.equal((await save([{id:'default',name:'Standard',rules:{}}])).ok,true);
            await invoke('admin-disable');
        }
        assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'profile','workstations.json'),'utf8')).activeId,'');
        console.log('Postazioni Electron: catalogo backend, scelta operatore locale persistente, due PC indipendenti, ruoli, conflitti, import/export e due temi a 1360×820 / 1040×640 OK.');
        console.log('Screenshot: '+dir);
        if(server)await new Promise(resolve=>server.close(resolve));
        clearTimeout(watchdog);win.destroy();app.exit(0);
    }catch(error){console.error(error);if(win)win.destroy();if(server)server.close();app.exit(1)}
});
