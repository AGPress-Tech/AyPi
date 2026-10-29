/* First-paint contract: runtime bundles are blocked, only the head bootstrap runs. */
const fs=require('fs'),os=require('os'),path=require('path'),assert=require('node:assert/strict');
const electron=require('electron');
if(typeof electron==='string'){
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 const r=require('child_process').spawnSync(electron,[__filename],{env,stdio:'inherit',windowsHide:true,timeout:25000});process.exit(r.status??1);
}
const {app,BrowserWindow}=electron;
app.disableHardwareAcceleration();app.setPath('userData',fs.mkdtempSync(path.join(os.tmpdir(),'aypi-theme-boot-')));
app.on('window-all-closed',()=>{});
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,width:1200,height:800,webPreferences:{offscreen:true,nodeIntegration:false,contextIsolation:true,backgroundThrottling:false}});
 win.webContents.session.webRequest.onBeforeRequest((r,cb)=>cb({cancel:/^(https?|wss?):/.test(r.url)||(r.resourceType==='script'&&!r.url.endsWith('/utility-layout-bootstrap.js'))}));
 const pages=[
  ['forge.html',null,'forge'],['forno.html',null,'forno'],
  ['inventario-magazzino.html','warehouse-bluearchive'],
  ['utilities/ferie-permessi.html','fp-bluearchive'],['utilities/ferie-permessi-hours.html','fp-bluearchive'],
  ['utilities/ferie-permessi-analysis.html','fp-bluearchive'],['utilities/assignees-manager.html','fp-bluearchive'],['utilities/admin-manager.html','fp-bluearchive'],
  ['utilities/product-manager.html','bluearchive-purchasing'],['utilities/product-manager-cart.html','bluearchive-purchasing'],['utilities/product-manager-interventions.html','bluearchive-purchasing'],
  ['utilities/ticket-support.html','bluearchive-ticket-support'],['utilities/ticket-support-admin.html','bluearchive-ticket-support'],
  ['utilities/timers.html','bluearchive-timers'],['utilities/production-planner.html','bluearchive-production-planner'],
  ['utilities/file-list.html','bluearchive-file-list'],['utilities/batch-rename.html','bluearchive-batch-rename'],['utilities/qr-generator.html','bluearchive-qr'],['utilities/compare-folders.html','bluearchive-compare'],['utilities/hierarchy.html','bluearchive-hierarchy'],
 ];
 for(const [page,bodyClass,kind]of pages){
  await win.loadFile(path.resolve('dist-ts/pages',page),{query:{theme:'bluearchive',splashTheme:'agpress'}});
  const state=await win.webContents.executeJavaScript("({root:document.documentElement.dataset.moduleTheme,forge:document.documentElement.dataset.forgeTheme,forno:document.documentElement.dataset.theme,bg:document.documentElement.style.backgroundColor,classes:[...document.body.classList],styles:[...document.querySelectorAll('link[rel=stylesheet]')].every(l=>!!l.sheet)})");
  assert.equal(state.root,'bluearchive',page);assert(!state.classes.includes('agpress-scripted-splash'),page);assert(!state.classes.includes('agpress-purchasing'),page);
  if(bodyClass)assert(state.classes.includes(bodyClass),page);
  if(kind==='forge')assert.equal(state.forge,'bluearchive',page);if(kind==='forno')assert.equal(state.forno,'blue',page);
  assert.equal(state.bg,'rgb(237, 249, 255)',page);
 }
 await win.loadFile(path.resolve('dist-ts/pages/forge.html'),{query:{theme:'standard'}});
 assert(await win.webContents.executeJavaScript("document.documentElement.dataset.forgeTheme==='standard'&&document.body.classList.contains('agpress-scripted-splash')"));
 await win.loadFile(path.resolve('dist-ts/pages/utilities/product-manager.html'),{query:{theme:'standard',splashTheme:'agpress'}});
 assert(await win.webContents.executeJavaScript("document.body.classList.contains('agpress-purchasing')&&document.body.classList.contains('agpress-scripted-splash')"));
 console.log('OK: tema Blue Archive già nel primo frame di '+pages.length+' pagine, senza bundle tardivi o IPC; ambra preservata.');
 win.destroy();app.exit(0);
}).catch(e=>{console.error(e);app.exit(1)});
