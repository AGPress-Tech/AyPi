const fs=require('fs'),path=require('path'),os=require('os'),assert=require('node:assert/strict'),http=require('http');
const electron=require('electron');
if(typeof electron==='string'){
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 const r=require('child_process').spawnSync(electron,[__filename],{env,windowsHide:true,stdio:'inherit',timeout:60000});process.exit(r.status??1);
}
const {app,BrowserWindow,ipcMain,dialog}=electron;
const output=fs.mkdtempSync(path.join(os.tmpdir(),'aypi-article-orders-ui-'));app.setPath('userData',output);app.disableHardwareAcceleration();app.on('window-all-closed',()=>{});
const delay=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{
 BrowserWindow.prototype.show=function(){};
 const dataset=Array.from({length:260},(_,i)=>({article:i<255?'1272AOA77':'SECOND',description:i===0?'<img src=x onerror=alert(1)>':'Corpo miscelatore',orderNo:'26/00913',orderId:29238+i,line:2,orderDate:'2026-11-02',deliveryDate:'2026-11-06',customerCode:'0567',customerName:'RAF 1933 SERVICE SRLS',unit:'NR',quantity:30,deliveredQuantity:0,residual:30,unitPrice:5.58,netPrice:5.58,currency:'EUR',delivered:0,cancelled:0}));
 const requests=[];let failure=false;
 const offerRequests=[];
 const offerDataset=dataset.map((row,i)=>({article:row.article,description:row.description,offerNo:'26/00622',offerId:8750+i,line:3,offerDate:'2026-11-02',customerCode:'0567',customerName:'RAF 1933 SERVICE SRLS',customerType:'Cliente',quantity:1,unit:'NR',unitPrice:5.58,netPrice:5.58,currency:'EUR'}));
 const server=http.createServer(async(req,res)=>{let body='';for await(const c of req)body+=c;const filters=JSON.parse(body),offers=req.url.endsWith('/article-offers'),source=offers?offerDataset:dataset;(offers?offerRequests:requests).push(filters);res.setHeader('Content-Type','application/json');if(failure){res.statusCode=503;res.end(JSON.stringify({error:'Rete assente simulata'}));return}res.end(JSON.stringify({rows:source.slice(filters.offset,filters.offset+filters.limit),total:source.length,queriedAt:'2026-11-06T10:00:00Z'}))});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));process.env.AYPI_FP_BACKEND_URL=`http://127.0.0.1:${server.address().port}/api/ferie-permessi`;
 ipcMain.handle('get-app-version',()=>app.getVersion());ipcMain.handle('management-is-enabled',()=>false);ipcMain.handle('admin-is-enabled',()=>false);
 let managementOpens=0,denials=0;ipcMain.handle('management-open',()=>{managementOpens++;return {ok:true}});
 dialog.showMessageBox=async()=>{denials++;return {response:0}};
 const exportFile=path.join(output,'export.xlsx');dialog.showSaveDialog=async()=>({canceled:false,filePath:exportFile});
 const home=new BrowserWindow({show:false,width:1400,height:900,webPreferences:{nodeIntegration:true,contextIsolation:false,offscreen:true,backgroundThrottling:false}});
 home.webContents.session.webRequest.onBeforeRequest((r,cb)=>cb({cancel:/^https?:/.test(r.url)}));
 require('../dist-ts/modules/article-orders/ipc').registerArticleOrdersIpc(home,()=>path.resolve('assets/app-icon.ico'));
 const js=(win,code)=>win.webContents.executeJavaScript(code);
 for(const theme of ['agpress','bluearchive']){
  const opensBefore=managementOpens;
  await home.loadFile(path.resolve('dist-ts/pages/bluearchive-preview.html'),{query:{theme}});
  await js(home,`document.getElementById('startupSequence').click();document.querySelector('[data-page=analisi]').click()`);await delay(350);
  assert.equal(await js(home,`document.querySelector('.main-nav button:last-child').textContent`),'Analisi');
  assert.equal(await js(home,`!!document.getElementById('menuManagement')`),false);
  assert.equal(await js(home,`document.querySelectorAll('.module-card').length`),3);
  assert.equal(await js(home,`document.querySelectorAll('.module-card')[2].dataset.label`),'Analisi Offerte per Articolo');
  assert.equal(await js(home,`document.querySelector('[data-admin-required]').getAttribute('aria-disabled')`),'true');
  await js(home,`document.querySelector('[data-admin-required]').click()`);await delay(80);
  assert.equal(managementOpens,opensBefore);
  if(theme==='agpress')assert.equal(denials,1);else assert.match(await js(home,`document.querySelector('.speech-bubble, #assistantBubble')?.textContent || Array.from(document.querySelectorAll('.visible')).map(e=>e.textContent).join(' ')`),/riservato agli amministratori/);
  home.webContents.send('admin-state-changed',{enabled:true,management:true});await delay(40);
  assert.equal(await js(home,`document.querySelector('[data-admin-required]').classList.contains('access-restricted')`),false);
  await js(home,`document.querySelector('[data-admin-required]').click()`);await delay(50);
  assert.equal(managementOpens,opensBefore+1);
  home.webContents.send('admin-state-changed',{enabled:false,management:false});await delay(30);
  const before=new Set(BrowserWindow.getAllWindows().map(w=>w.id));
  await js(home,`document.querySelectorAll('.module-card')[1].click()`);await delay(200);
  const win=BrowserWindow.getAllWindows().find(w=>!before.has(w.id));assert(win,'dedicated article window opened without admin');
  await delay(150);
  assert.equal(await js(home,`require('electron').ipcRenderer.invoke('article-orders-search',{}).then(r=>r.ok)`),false,'home cannot use the result window IPC');
  assert.equal(await js(win,`document.documentElement.dataset.forgeTheme`),theme==='agpress'?'standard':'bluearchive');
  const requestsBefore=requests.length;
  await js(win,`document.getElementById('search').click()`);await delay(40);assert.equal(requests.length,requestsBefore);
  await js(win,`document.querySelector('[data-key=articles] .value').value='1272AOA77';document.querySelector('[data-key=articles] .add-rule').click();document.querySelectorAll('[data-key=articles] .value')[1].value='SECOND';document.querySelector('[data-key=quantities]').open=true;document.querySelector('[data-key=quantities] .from').value='30';document.getElementById('search').click()`);
  for(let i=0;i<80;i++){if(await js(win,`document.querySelectorAll('#results tbody tr').length>=250`))break;await delay(30)}
  assert.equal(requests.at(-1).articles.length,2);assert.equal(requests.at(-1).quantities[0].from,30);
  assert.match(await js(win,`document.querySelector('#results tbody').textContent`),/5,58/);
  assert.equal(await js(win,`document.querySelector('#total').textContent`),'260');
  await js(win,`(()=>{const input=document.querySelector('#columnPicker input[data-column=description]');if(!input.checked)input.click()})()`);
  assert.equal(await js(win,`document.querySelectorAll('#results img').length`),0,'SQL descriptions escaped');
  assert.match(await js(win,`document.querySelector('#results tbody').textContent`),/<img src=x/);
  await js(win,`document.getElementById('more').click()`);await delay(120);
  assert.match(await js(win,`document.getElementById('loaded').textContent`),/260 righe/);
  await js(win,`document.getElementById('export').click()`);for(let i=0;i<80;i++){if(fs.existsSync(exportFile))break;await delay(30)}
  const workbook=require('xlsx').readFile(exportFile);assert.equal(require('xlsx').utils.sheet_to_json(workbook.Sheets['Ordini per articolo']).length,260);fs.unlinkSync(exportFile);
  win.unmaximize();await delay(100);
  for(const [width,height] of [[1920,1080],[1366,768],[1024,680]]){
   win.setContentSize(width,height);await delay(80);
   const layout=await js(win,`({viewport:innerHeight,height:document.documentElement.scrollHeight,table:document.getElementById('tableScroll').clientHeight,filters:document.querySelector('.filter-scroll').clientHeight})`);
   assert(layout.height<=layout.viewport+1,JSON.stringify(layout));assert(layout.table>150);assert(layout.filters>150);
   assert.equal(await js(win,'innerWidth'),width);
   fs.writeFileSync(path.join(output,theme+'-'+width+'.png'),(await win.webContents.capturePage()).toPNG());
  }
  failure=true;await js(win,`document.getElementById('search').click()`);await delay(100);assert.match(await js(win,`document.getElementById('status').textContent`),/precedenti restano visibili/);failure=false;
  await js(win,`document.getElementById('reset').click()`);assert.equal(await js(win,`document.querySelectorAll('[data-key=articles] .rule').length`),1);assert.equal(await js(win,`document.getElementById('results').hidden`),true);
  const beforeOffers=new Set(BrowserWindow.getAllWindows().map(w=>w.id));
  await js(home,`document.querySelectorAll('.module-card')[2].click()`);await delay(180);
  const offers=BrowserWindow.getAllWindows().find(w=>!beforeOffers.has(w.id));assert(offers,'offerte in finestra indipendente, insieme agli ordini');
  assert.equal(await js(win,`require('electron').ipcRenderer.invoke('article-offers-search',{}).then(r=>r.ok)`),false,'IPC offerte non accessibile dalla finestra ordini');
  assert.equal(await js(offers,`document.querySelector('h1').textContent`),'Analisi Offerte per Articolo');
  assert.equal(await js(offers,`document.querySelector('[data-key=residuals]')!==null`),false);
  assert.equal(await js(offers,`document.getElementById('delivered')!==null`),false);
  assert.equal(await js(offers,`document.querySelector('#columnPicker input[data-column=description]').checked`),false,'preferenze colonne offerte separate dagli ordini');
  await js(offers,`document.querySelector('[data-key=articles] .value').value='1272AOA77';document.querySelector('[data-key=articles] .add-rule').click();document.querySelectorAll('[data-key=articles] .value')[1].value='SECOND';document.querySelector('[data-key=offerDates]').open=true;document.querySelector('[data-key=offerDates] .from').value='2026-11-01';document.querySelector('[data-key=offerDates] .to').value='2026-11-06';document.querySelector('[data-key=offerDates] .add-rule').click();document.querySelectorAll('[data-key=offerDates] .from')[1].value='2025-11-01';document.querySelectorAll('[data-key=offerDates] .to')[1].value='2025-11-06';document.getElementById('search').click()`);
  for(let i=0;i<80;i++){if(await js(offers,`document.querySelectorAll('#results tbody tr').length>=250`))break;await delay(30)}
  assert.equal(offerRequests.at(-1).articles.length,2);assert.equal(offerRequests.at(-1).offerDates.length,2);assert(!('delivered' in offerRequests.at(-1)));
  assert.match(await js(offers,`document.querySelector('#results tbody').textContent`),/26\/00622/);
  assert.match(await js(offers,`document.querySelector('#results tbody').textContent`),/5,58/);
  assert.equal(await js(offers,`document.getElementById('orders').textContent`),'250');
  await js(offers,`document.getElementById('export').click()`);for(let i=0;i<80;i++){if(fs.existsSync(exportFile))break;await delay(30)}
  const exportedOffers=require('xlsx').readFile(exportFile),offerRows=require('xlsx').utils.sheet_to_json(exportedOffers.Sheets['Offerte per articolo']);
  assert.equal(offerRows.length,260);assert.equal(offerRows[0]['Prezzo offerto'],5.58);assert.equal(offerRows[0]['Quantità offerta'],1);assert.equal(offerRows[0]['Codice cliente / contatto'],'0567');fs.unlinkSync(exportFile);
  offers.unmaximize();await delay(100);
  for(const [width,height] of [[1920,1080],[1366,768],[1024,680]]){
   offers.setContentSize(width,height);await delay(70);
   const layout=await js(offers,`({viewport:innerHeight,height:document.documentElement.scrollHeight,table:document.getElementById('tableScroll').clientHeight})`);assert(layout.height<=layout.viewport+1);assert(layout.table>150);
   fs.writeFileSync(path.join(output,'offerte-'+theme+'-'+width+'.png'),(await offers.webContents.capturePage()).toPNG());
  }
  await js(offers,`document.getElementById('more').click()`);await delay(80);assert.match(await js(offers,`document.getElementById('loaded').textContent`),/260 righe/);
  await js(offers,`document.getElementById('reset').click()`);assert.equal(await js(offers,`document.querySelectorAll('[data-key=articles] .rule').length`),1);
  offers.destroy();win.destroy();
 }
 home.destroy();await new Promise(r=>server.close(r));console.log('OK: home Analisi, accesso admin, assistenti, ordini e offerte in finestre indipendenti, filtri multipli, scroll, colonne separate, export completo, errore rete e layout nei due temi. Screenshot: '+output);app.exit(0);
}).catch(error=>{console.error(error);app.exit(1)});
