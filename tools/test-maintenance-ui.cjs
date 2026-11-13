const {app,BrowserWindow,dialog,Menu}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),http=require('node:http');
const root=path.resolve(__dirname,'..'),dir=path.join(root,'.tmp-maintenance-ui');fs.mkdirSync(dir,{recursive:true});app.setPath('userData',path.join(dir,'profile-'+Date.now()));app.commandLine.appendSwitch('disable-gpu');
process.on('uncaughtException',e=>{console.error(e);app.exit(1)});process.on('unhandledRejection',e=>{console.error(e);app.exit(1)});
process.env.AYPI_BACKEND_PROFILE='dev';process.env.AYPI_DB_PATH=path.join(dir,'test-'+Date.now()+'.db');process.env.AYPI_LOG_DIR=dir;
for(const method of ['maximize','show','focus'])BrowserWindow.prototype[method]=function(){};
const storage=require('../backend-dist/shared/db/sqlite'),service=require('../backend-dist/modules/maintenance/service');
require('../backend-dist/modules/shared/service').getAssignees=()=>({groups:{Torneria:['Operatore Uno','Admin Senza Password'],Stampaggio:['Operatore Due']}});
const {Router}=require('../backend-dist/shared/http/router'),{registerMaintenanceRoutes}=require('../backend-dist/modules/maintenance/routes'),{sendError}=require('../backend-dist/shared/http/response');
const source={version:1,source:'Access fixture',readAt:'2026-11-12',departments:[{name:'Torneria'},{name:'Stampaggio'}],equipmentTypes:[{name:'Nuova'},{name:'Usata'}],machines:[{id:'M1',code:'M1',department:'Torneria',description:'Transfer',equipmentTypes:['Usata'],year:2000},{id:'M2',code:'M2',department:'Stampaggio',description:'Pressa',equipmentTypes:['Nuova']}],plans:[{id:1,machineId:'M1',description:'Pulizia filtri'},{id:2,machineId:'M2',description:'Controllo sicurezze mai eseguito'},{id:3,machineId:'M1',description:'Senza frequenza'}],ordinary:[{id:1,machineId:'M1',planId:1,date:'2020-01-01'},{id:2,machineId:'M1',planId:3,date:'2020-01-01'}],extraordinary:[{id:3,machineId:'M2',date:'2025-06-01',description:'Sostituzione pompa',notes:'Test'}],attachments:[]};
const fixtureAccess=path.join(dir,'fixture.accdb');fs.writeFileSync(fixtureAccess,'Access fixture');let accessInput=JSON.parse(JSON.stringify(source));
if(process.env.AYPI_TEST_ACCESS_IMPORT!=='1'){
 const cp=require('node:child_process'),original=cp.execFile;
 cp.execFile=function(command,args,options,callback){if(command==='powershell.exe'&&args.includes('-Output')){fs.writeFileSync(args[args.indexOf('-Output')+1],JSON.stringify(accessInput));queueMicrotask(()=>callback(null,'',''));return {kill(){}}}return original.apply(this,arguments)};
}
app.whenReady().then(async()=>{
 const errors=[],watchdog=setTimeout(()=>{console.error('Timeout manutenzioni');app.exit(1)},90000);let win,server;
 try{
  await storage.initializeSqliteDatabase();service.importMaintenance(source,'Importatore');const p=service.maintenanceSnapshot().plans.find(p=>p.id==='1');service.saveMaintenanceEntity('plan',{...p,frequencyMonths:6},'Configuratore');
  const router=new Router();registerMaintenanceRoutes(router);server=http.createServer((req,res)=>router.handle(req,res).catch(e=>sendError(res,e)));await new Promise(r=>server.listen(0,'127.0.0.1',r));
  process.env.AYPI_FP_BACKEND_URL=`http://127.0.0.1:${server.address().port}/api/ferie-permessi`;
  const post=(pathname,body,actor)=>fetch(`http://127.0.0.1:${server.address().port}/api/maintenance/${pathname}`,{method:'POST',headers:{'Content-Type':'application/json',...(actor?{'x-aypi-actor':actor}:{})},body:JSON.stringify(body)});
  assert.equal((await post('entities/plan',{},'Unknown')).status,401);
  const main=new BrowserWindow({show:false,webPreferences:{nodeIntegration:true,contextIsolation:false}});await main.loadURL('about:blank');
  const ipcModule=process.env.AYPI_TEST_PACKAGED==='1'?path.join(root,'dist/win-unpacked/resources/app.asar/dist-ts/modules/maintenance/ipc.js'):path.join(root,'dist-ts/modules/maintenance/ipc.js');
  const controller=require(ipcModule).registerMaintenanceIpc(main,()=> '');win=await controller.open();
  if(process.env.AYPI_TEST_ACCESS_IMPORT!=='1')require(path.join(path.dirname(ipcModule),'..','file-manager','address-book.js')).getAddressEntry=()=>({path:fixtureAccess});
  win.webContents.on('console-message',(_e,level,message)=>{if(level>=3)errors.push(message)});
  const run=code=>win.webContents.executeJavaScript(code,true),until=async code=>{const t=Date.now();while(Date.now()-t<10000){if(await run(code))return;await new Promise(r=>setTimeout(r,40))}throw Error('Timeout: '+code)};
  await until("document.querySelectorAll('#loginEmployee option').length>1");
  await run("document.querySelector('#loginDepartment').value='Torneria';document.querySelector('#loginDepartment').dispatchEvent(new Event('change'));document.querySelector('#loginEmployee').value='Admin Senza Password';document.querySelector('#loginForm').requestSubmit()");
  await until("!document.querySelector('#workspace').hidden && document.querySelectorAll('[data-expand-chart]').length>=4");
  assert.equal(await run("document.querySelectorAll('input[type=password]').length"),0);
  await run("document.querySelector('[data-view=due]').click()");assert.equal(await run("document.querySelectorAll('[data-due-machine]').length"),2);assert.equal(await run("document.querySelectorAll('[data-due-plan]').length"),1);
  let menu=[];Menu.buildFromTemplate=items=>({popup(){menu=items}});
  await run("document.querySelector('[data-due-machine=M1]').open=true;document.querySelector('[data-due-plan]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))");
  for(let i=0;!menu.length&&i<100;i++)await new Promise(r=>setTimeout(r,30));assert.equal(menu.length,1);menu[0].click();
  await until("document.querySelector('#editDialog').open");assert.equal(await run("document.querySelector('[name=machineId]').value"),'M1');assert.equal(await run("document.querySelector('[name=planId]').value"),'1');
  assert.equal(await run("document.querySelector('[name=date]').value===document.querySelector('[name=date]').max"),true);
  await run("document.querySelector('#editForm').requestSubmit()");await until("!document.querySelector('#editDialog').open && document.querySelectorAll('[data-due-plan]').length===0");
  assert(service.maintenanceSnapshot().records.some(r=>r.createdBy==='Admin Senza Password'));
  await run("document.querySelector('[data-view=records]').click()");assert.equal(await run("document.querySelectorAll('#maintenanceTable tbody tr').length"),4);
  const newRecord=service.maintenanceSnapshot().records.find(r=>r.createdBy==='Admin Senza Password');
  menu=[];await run(`document.querySelector('[data-entity-id="${newRecord.id}"]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))`);
  for(let i=0;!menu.length&&i<100;i++)await new Promise(r=>setTimeout(r,30));assert.deepEqual(menu.map(m=>m.label),['Modifica','Elimina']);menu[1].click();await until("document.querySelector('#confirmDialog').open");
  await run("document.querySelector('#confirmDialog button[value=delete]').click()");
  await until("!document.querySelector('#editDialog').open && document.querySelectorAll('#maintenanceTable tbody tr').length===3");assert.equal(service.maintenanceSnapshot().due.length,1);
  await run("document.querySelector('[data-view=machines]').click();document.querySelector('#newEntity').click()");
  await run("(()=>{for(const [k,v] of Object.entries({code:'M3',department:'Torneria',description:'Nuova macchina',year:'2020'}))document.querySelector('[name='+k+']').value=v;document.querySelector('#editForm').requestSubmit()})()");
  await until("!document.querySelector('#editDialog').open && document.querySelectorAll('#maintenanceTable tbody tr').length===3");
  const newMachine=service.maintenanceSnapshot().machines.find(m=>m.code==='M3');assert(newMachine);
  await run("document.querySelector('.advanced-filters').open=true;document.querySelector('#addRule').click();document.querySelector('#advancedRules [data-field]').value='year';document.querySelector('#advancedRules [data-field]').dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('#advancedRules [data-op]').value='range';document.querySelector('#advancedRules [data-op]').dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('#advancedRules [data-value]').value='2010';document.querySelector('#advancedRules [data-to]').value='2025';document.querySelector('#applyRules').click()");
  assert.equal(await run("document.querySelectorAll('#maintenanceTable tbody tr').length"),1);
  await run("document.querySelector('#filterPresetName').value='Macchine recenti';document.querySelector('#saveFilterPreset').click()");await until("document.querySelectorAll('#filterPreset option').length===2");
  assert.equal(service.maintenancePreferences('Admin Senza Password').filterPresets[0].filters.rules[0].to,'2025');
  await run("document.querySelector('#resetFilters').click()");
  await run("document.querySelector('[data-view=plans]').click();document.querySelector('#newEntity').click()");
  await run(`document.querySelector('[name=machineId]').value='${newMachine.id}';document.querySelector('[name=description]').value='Lubrificazione';document.querySelector('[name=frequencyMonths]').value='6';document.querySelector('#editForm').requestSubmit()`);
  await until("!document.querySelector('#editDialog').open && document.querySelectorAll('#maintenanceTable tbody tr').length===4");assert.equal(service.maintenanceSnapshot().due.length,1,'Nuova manutenzione mai eseguita non scaduta');
  assert.deepEqual(await run("[...document.querySelectorAll('#maintenanceTable tbody tr td:first-child')].map(e=>e.textContent)"),['M1','M1','M2','M3'],'Ordine macchina A-Z predefinito');
  assert.equal(await run("[...document.querySelectorAll('#maintenanceTable th')].some(e=>e.textContent==='Azioni')"),false);
  await run("document.querySelector('[data-view=dashboard]').click()");
  const labels=await run("require('chart.js/auto').getChart(document.querySelector('#maintenance-machines')).data.labels.length");
  await run("require('chart.js/auto').getChart(document.querySelector('#maintenance-machines')).options.onAreaSelect([0],false)");assert.equal(await run("require('chart.js/auto').getChart(document.querySelector('#maintenance-machines')).data.labels.length"),labels);
  assert(await run("require('chart.js/auto').getChart(document.querySelector('#maintenance-machines')).data.datasets.some(d=>d.highlightValues)"));
  await run("document.querySelector('[data-reset-chart]').click();document.querySelector('[data-expand-chart]').click()");assert.equal(await run("!!document.querySelector('.chart-focused')"),true);
  await run("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");assert.equal(await run("!!document.querySelector('.chart-focused')"),false);
  await run("document.querySelector('#chartsMenu').click();document.querySelector('#workspacePresetName').value='Manutenzioni';document.querySelector('[data-save-preset]').click()");await until("document.querySelectorAll('#workspacePreset option').length===1");
  await run("document.querySelector('#workspaceBuilder [name=title]').value='Interventi custom';document.querySelector('#workspaceBuilder [name=source]').value='maintenance-months';document.querySelector('#workspaceBuilder').requestSubmit()");
  await until("document.querySelectorAll('.workspace-custom-chart').length===1");
  await run("document.querySelector('[data-save]').click()");await until("document.querySelector('[data-workspace-message]').textContent.includes('salvata')");
  await run("document.querySelector('[data-close]').click()");assert.equal(service.maintenancePreferences('Admin Senza Password').workspace.presets[0].name,'Manutenzioni');
  const exportPath=path.join(dir,'maintenance.xlsx');dialog.showSaveDialog=async()=>({filePath:exportPath,canceled:false});await run("document.querySelector('[data-view=records]').click();document.querySelector('#export').click()");await until("document.querySelector('#status').textContent.includes('esportate')");
  const XLSX=require('xlsx'),sheet=XLSX.readFile(exportPath,{cellNF:true}).Sheets.Manutenzioni;assert.equal(sheet.E2.t,'n');assert.equal(sheet.E2.z,'dd/mm/yyyy');
  await run("document.querySelector('.advanced-filters').open=true;document.querySelector('#maintenanceYears [data-year=\"2020\"]').click()");
  assert.equal(await run("document.querySelectorAll('#maintenanceTable tbody tr').length"),2);
  await run("document.querySelector('#maintenanceYears [data-year=\"2025\"]').click()");assert.equal(await run("document.querySelectorAll('#maintenanceTable tbody tr').length"),3,'Multiselezione anni');
  await run("document.querySelector('#maintenanceYears [data-year=\"2020\"]').click()");assert.equal(await run("document.querySelectorAll('#maintenanceTable tbody tr').length"),1);
  await run("document.querySelector('#filterPresetName').value='Anno 2025';document.querySelector('#saveFilterPreset').click()");await until("document.querySelectorAll('#filterPreset option').length===3");
  assert.equal(service.maintenancePreferences('Admin Senza Password').filterPresets[1].filters.rules[0].value,'2025-01-01');
  await run("document.querySelector('#resetFilters').click();document.querySelector('#filterPreset').value='1';document.querySelector('#filterPreset').dispatchEvent(new Event('change'))");
  assert.equal(await run("document.querySelectorAll('#maintenanceTable tbody tr').length"),1);assert(await run("document.querySelector('#maintenanceYears [data-year=\"2025\"]').checked"));
  await run("document.querySelector('#maintenanceYears [data-years=last2]').click()");assert.equal(await run("document.querySelectorAll('#maintenanceTable tbody tr').length"),3);
  await run("document.querySelector('#maintenanceYears [data-years=all]').click()");assert.equal(await run("document.querySelectorAll('#maintenanceTable tbody tr').length"),3);
  await run("document.querySelector('#resetFilters').click()");
  if(process.env.AYPI_TEST_ACCESS_IMPORT!=='1'){
   accessInput.ordinary.push({id:4,machineId:'M1',planId:1,date:'2025-01-01'});accessInput.extraordinary[0].notes='Access modificato';accessInput.attachments.push({id:'report',recordId:'extraordinary:3',name:'delta.pdf',path:'\\\\server\\share\\delta.pdf'});
   await run("document.querySelector('[data-view=info]').click();document.querySelector('#importAccess').click()");await until("document.querySelector('#accessImportDialog').open");
   assert.equal(service.maintenanceSnapshot().records.length,3,'Anteprima non scrive');assert(await run("document.querySelector('#accessImportDetails').textContent.includes('Access modificato')"));
   await run("document.querySelector('#accessImportApply').click()");await until("!document.querySelector('#accessImportDialog').open && document.querySelector('#status').textContent.includes('Importazione completata')");
   assert.equal(service.maintenanceSnapshot().records.length,4);assert.equal(service.maintenanceSnapshot().attachments.length,1);assert.equal(service.maintenanceSnapshot().records.find(r=>r.id==='extraordinary:3').notes,'Test');
   await run("document.querySelector('#importAccess').click()");await until("document.querySelector('#accessImportDialog').open");assert.equal(await run("document.querySelector('#accessImportApply').textContent"),'Conferma confronto');
   await run("document.querySelector('#accessImportCancel').click()");assert.equal(service.maintenanceSnapshot().records.length,4);
  }
  for(const theme of ['standard','bluearchive']){
   await win.loadFile(path.join(root,'dist-ts/pages/maintenance.html'),{query:{theme}});await until("document.querySelectorAll('#loginEmployee option').length>1");
   for(const [width,height] of [[1520,960],[1000,680]]){
    win.setContentSize(width,height);await run("new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))");
    const login=await run("(()=>{const d=document.querySelector('#loginDialog'),r=d.getBoundingClientRect();return {theme:document.documentElement.dataset.forgeTheme,accent:getComputedStyle(document.body).getPropertyValue('--ops-accent').trim(),button:getComputedStyle(document.querySelector('#loginSubmit')).backgroundColor,open:d.open,inside:r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight,overflow:d.scrollWidth>d.clientWidth}})()");
    assert.equal(login.theme,theme);assert.equal(login.accent,theme==='standard'?'#cc930e':'#168eea');assert.equal(login.button,theme==='standard'?'rgb(204, 147, 14)':'rgb(22, 142, 234)');assert(login.open&&login.inside&&!login.overflow,JSON.stringify(login));
    fs.writeFileSync(path.join(dir,`login-${theme}-${width}.png`),(await win.webContents.capturePage()).toPNG());
   }
   await run("document.querySelector('#loginDepartment').value='Torneria';document.querySelector('#loginDepartment').dispatchEvent(new Event('change'));document.querySelector('#loginEmployee').value='Operatore Uno';document.querySelector('#loginForm').requestSubmit()");await until("!document.querySelector('#workspace').hidden && document.querySelectorAll('[data-expand-chart]').length>=4");
   for(const [width,height] of [[1520,960],[1000,680]]){
    win.setContentSize(width,height);await run("new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))");
    assert.equal(await run("document.body.scrollWidth>innerWidth"),false);fs.writeFileSync(path.join(dir,`dashboard-${theme}-${width}.png`),(await win.webContents.capturePage()).toPNG());
    await run("document.querySelector('[data-view=records]').click()");assert.notEqual(await run("getComputedStyle(document.querySelector('#maintenanceTable td')).borderRightWidth"),'0px');assert(await run("document.querySelector('#tablePanel .table-scroll').clientHeight>180"));
    await run("new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))");
    // Real scroll geometry: the first header must remain visible above pinned body cells.
    const sticky=await run(`(async()=>{const sc=document.querySelector('#tablePanel .table-scroll'),body=document.querySelector('#maintenanceTable tbody'),original=body.innerHTML;body.innerHTML=original.repeat(45);const th=document.querySelector('#maintenanceTable th'),before=th.getBoundingClientRect().top;sc.scrollTop=180;sc.scrollLeft=45;await new Promise(r=>requestAnimationFrame(r));const rect=th.getBoundingClientRect(),hit=document.elementFromPoint(Math.max(sc.getBoundingClientRect().left+4,rect.left+4),rect.top+8);const result={before,after:rect.top,hit:!!hit?.closest('thead'),scroll:sc.scrollTop};body.innerHTML=original;sc.scrollTop=0;sc.scrollLeft=0;return result})()`);
    assert(sticky.scroll>0&&Math.abs(sticky.before-sticky.after)<2&&sticky.hit,JSON.stringify(sticky));
    await run("document.querySelector('[data-view=machines]').click();document.querySelector('.advanced-filters').open=true");
    const popup=await run("(()=>{const r=document.querySelector('.maintenance-filter-popup').getBoundingClientRect();return {left:r.left,right:r.right,bottom:r.bottom,width:innerWidth,height:innerHeight}})()");
    assert(popup.left>=0&&popup.right<=popup.width&&popup.bottom<=popup.height,JSON.stringify(popup));
    assert(await run("(()=>{const p=document.querySelector('.maintenance-filter-popup');return [...p.querySelectorAll('input,select,button')].filter(e=>e.offsetWidth).every(e=>{const r=e.getBoundingClientRect();return p.contains(document.elementFromPoint(r.left+3,r.top+r.height/2))})})()"),'Table headers must not cover popup fields');
    await run("new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))");
    fs.writeFileSync(path.join(dir,`filters-${theme}-${width}.png`),(await win.webContents.capturePage()).toPNG());
    await run("document.querySelector('[data-standard-field=year] [data-standard-value]').value='2010';document.querySelector('[data-standard-field=year] [data-standard-to]').value='2025';document.querySelector('#applyRules').click()");
    assert.equal(await run("document.querySelectorAll('#maintenanceTable tbody tr').length"),1);
    assert(await run("getComputedStyle(document.querySelector('#newEntity')).borderTopColor===getComputedStyle(document.querySelector('#newRecord')).backgroundColor"));
    await run("document.querySelector('.maintenance-filter-popup').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));document.querySelector('.maintenance-filter-popup').dispatchEvent(new MouseEvent('mouseleave',{bubbles:true}))");
    assert(await run("document.querySelector('.advanced-filters').open"),'Inside clicks and mouseleave keep filter open');
    const outside=await run("(()=>{const r=document.querySelector('h1').getBoundingClientRect();return {x:Math.round(r.left+4),y:Math.round(r.top+4)}})()");
    win.webContents.sendInputEvent({type:'mouseDown',...outside,button:'left',clickCount:1});win.webContents.sendInputEvent({type:'mouseUp',...outside,button:'left',clickCount:1});
    await until("!document.querySelector('.advanced-filters').open");
    assert.equal(await run("document.querySelector('.advanced-filters').open"),false);
    await run("document.querySelector('#resetFilters').click();document.querySelector('[data-view=records]').click()");
    await run("document.querySelector('[data-view=plans]').click();document.querySelector('#newEntity').click();document.querySelector('[name=frequencyMonths]').focus()");
    const focusRing=await run("(()=>{const input=document.querySelector('[name=frequencyMonths]'),r=input.getBoundingClientRect(),p=document.querySelector('#editFields').getBoundingClientRect(),css=getComputedStyle(input),space=parseFloat(css.outlineOffset)+parseFloat(css.outlineWidth);return {left:r.left-space>=p.left,right:r.right+space<=p.right,top:r.top-space>=p.top,bottom:r.bottom+space<=p.bottom}})()");
    assert(Object.values(focusRing).every(Boolean),JSON.stringify(focusRing));
    await run("new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))");fs.writeFileSync(path.join(dir,`focus-${theme}-${width}.png`),(await win.webContents.capturePage()).toPNG());
    await run("document.querySelector('#editCancel').click();document.querySelector('[data-view=records]').click()");
    await run("new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))");
    fs.writeFileSync(path.join(dir,`records-${theme}-${width}.png`),(await win.webContents.capturePage()).toPNG());await run("document.querySelector('[data-view=dashboard]').click()");
    if(process.env.AYPI_TEST_ACCESS_IMPORT!=='1'){
     await run("document.querySelector('[data-view=info]').click();document.querySelector('#importAccess').click()");await until("document.querySelector('#accessImportDialog').open");await run("new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))");
     assert.equal(await run("document.body.scrollWidth>innerWidth"),false);assert.notEqual(await run("getComputedStyle(document.querySelector('#accessImportDetails td')).borderRightWidth"),'0px');fs.writeFileSync(path.join(dir,`import-${theme}-${width}.png`),(await win.webContents.capturePage()).toPNG());
     await run("document.querySelector('#accessImportClose').click();document.querySelector('[data-view=dashboard]').click()");
    }
   }
  }
  assert.deepEqual(errors,[]);console.log('OK: manutenzioni Electron, login dipendenti/admin senza password, notifiche raggruppate, menu precompilato, CRUD, scadenze, grafici, preset, Excel e due temi/dimensioni.');
  if(process.env.AYPI_TEST_ACCESS_IMPORT==='1'){
   storage.closeSqliteDatabase();require('../backend-dist/config').backendConfig.database.path=path.join(dir,'real-import-'+Date.now()+'.db');await storage.initializeSqliteDatabase();
   require(path.join(path.dirname(ipcModule),'..','file-manager','address-book.js')).getAddressEntry=()=>({path:"\\\\Dl360\\pubbliche\\QUALITA'\\MANUTENZIONI MACCHINE\\AyPi - Manutenzione Macchine.accdb"});
   const preview=await run("require('electron').ipcRenderer.invoke('maintenance-import',{phase:'preview'})");assert(preview.ok,preview.error);
   const imported=await run(`require('electron').ipcRenderer.invoke('maintenance-import',{phase:'apply',token:${JSON.stringify(preview.comparison.token)}})`);assert(imported.ok,imported.error);assert.equal(imported.report.added.machines,46);assert.equal(service.maintenanceSnapshot().attachments.length,153);console.log('OK: importazione Access reale via confronto IPC/PowerShell temporaneo/HTTP in ayPi.db isolato.');
  }
 }catch(e){console.error(e);console.error('Renderer:',errors);if(win&&!win.isDestroyed())console.error(await win.webContents.executeJavaScript("({status:document.querySelector('#status')?.textContent,edit:document.querySelector('#editError')?.textContent,login:document.querySelector('#loginError')?.textContent})"));process.exitCode=1}
 finally{clearTimeout(watchdog);for(const w of BrowserWindow.getAllWindows())w.destroy();if(server)await new Promise(r=>server.close(r));storage.closeSqliteDatabase();app.exit(process.exitCode||0)}
});
