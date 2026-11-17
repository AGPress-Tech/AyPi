const {app,BrowserWindow,ipcMain}=require('electron');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),artifacts=path.join(root,'.tmp-customer-articles');fs.mkdirSync(artifacts,{recursive:true});app.setPath('userData',path.join(artifacts,'electron'));app.commandLine.appendSwitch('disable-gpu');
const {emptyCustomerPreferences}=require('../dist-ts/modules/customer-analysis/model.js');let prefs=emptyCustomerPreferences(),exportRequest;
const rows=[];
for(let article=0;article<45;article++)for(let year=2020;year<=2026;year++){
 if(article>=35&&year>2022||article>=25&&article<35&&year<2025)continue;
 rows.push({kind:'order',documentId:`${article}-${year}`,documentNo:`O-${article}-${year}`,documentDate:`${year}-02-10`,article:`ART-${String(article).padStart(3,'0')}`,description:`Articolo ${article}`,customerCode:'DEMO',customerName:'Cliente test',unit:'PZ',currency:'EUR',quantity:100+(year-2020)*10+article,netPrice:2+(year-2020)*.1,netAmount:300,deliveredQuantity:0,residual:50,cancelled:false,headerCancelled:false});
}
rows.push({...rows[0],documentId:'usd',article:'USD-ONLY',currency:'USD',unit:'KG',quantity:3});
ipcMain.handle('customer-analysis-preferences-load',()=>({ok:true,preferences:prefs}));ipcMain.handle('customer-analysis-preferences-save',(_e,p)=>{prefs=p;return {ok:true,preferences:p};});ipcMain.handle('customer-analysis-customers',()=>({ok:true,customers:[{code:'DEMO',name:'Cliente test'}]}));ipcMain.handle('customer-analysis-load',()=>({ok:true,customer:'DEMO',queriedAt:'2026-11-17T09:00:00Z',rows}));ipcMain.handle('customer-analysis-export',(_e,r)=>{exportRequest=r;return {ok:true,count:rows.length};});
app.whenReady().then(async()=>{
 const win=new BrowserWindow({width:1520,height:960,show:false,webPreferences:{nodeIntegration:true,contextIsolation:false,backgroundThrottling:false}}),errors=[];win.webContents.on('console-message',(_e,level,message)=>{if(level>=3)errors.push(message);});
 const run=code=>win.webContents.executeJavaScript(code,true);
 const wait=expression=>run(`new Promise((resolve,reject)=>{const start=Date.now();const tick=()=>{if(${expression})return resolve(true);if(Date.now()-start>8000)return reject(Error(${JSON.stringify(expression)}));setTimeout(tick,30)};tick()})`);
 const choose=async(id,value)=>run(`document.getElementById(${JSON.stringify(id)}).value=${JSON.stringify(value)};document.getElementById(${JSON.stringify(id)}).dispatchEvent(new Event('change',{bubbles:true}))`);
 const click=selector=>run(`document.querySelector(${JSON.stringify(selector)}).click()`);
 try{
 for(const theme of ['bluearchive','standard']){
  prefs=emptyCustomerPreferences();await win.loadFile(path.join(root,'dist-ts/pages/customer-analysis.html'),{query:{theme}});await wait("document.querySelector('#chartVisibility').children.length===4");
  await run("document.querySelector('#customerSearch').value='DE';document.querySelector('#customerSearchForm').requestSubmit()");await wait("!document.querySelector('#loadCustomer').disabled");await click('#loadCustomer');await wait("!!document.querySelector('#plot-history')");await click('[data-view=articles]');
  assert.equal(await run("document.querySelectorAll('.customer-chart-grid canvas').length"),7);
  assert(await run("document.querySelector('#analysisTable').textContent.includes('Ultimo ordine')"));
  await choose('articleDormancy','3');assert.equal(await run("document.querySelector('[data-kpi=articles] strong').textContent"),'11');
  await click('#export');await wait("!document.querySelector('#export').disabled");assert.equal(exportRequest.articleAnalysis.dormancy,'3');
  await click('#reset');assert.equal(await run("document.querySelector('#articleDormancy').value"),'');
  await run("require('chart.js/auto').getChart(document.querySelector('#plot-article-inactivity')).config.options.onClick(null,[{index:2}])");
  assert(await run("!!document.querySelector('[data-clear-chart-dimension=inactivity]')"));await click('[data-reset-chart]');
  await choose('articleAnalysisMode','annual');assert.equal(await run("document.querySelectorAll('#analysisTable tbody tr').length"),100);
  await run("window.first=document.querySelector('#analysisTable tbody tr');const sc=document.querySelector('#analysisTable').closest('.table-scroll');sc.scrollTop=sc.scrollHeight;sc.dispatchEvent(new Event('scroll'))");await wait("document.querySelectorAll('#analysisTable tbody tr').length>100");assert(await run("window.first===document.querySelector('#analysisTable tbody tr')"));
  const geometry=await run("(()=>{const t=document.querySelector('#analysisTable'),s=t.closest('.table-scroll'),h=t.tHead.getBoundingClientRect(),r=s.getBoundingClientRect();return {head:h.top,scroll:r.top,border:getComputedStyle(t.rows[1].cells[1]).borderRightWidth}})()");assert(Math.abs(geometry.head-geometry.scroll)<3,JSON.stringify(geometry));assert.notEqual(geometry.border,'0px');
  await choose('articleAnalysisMode','orders');await click('.document-link');await wait("document.querySelector('#documentDialog').open");await click('#documentDialog [data-close-dialog]');
  await choose('articleAnalysisMode','cohorts');assert(await run("document.querySelector('#analysisTable').textContent.includes('Quota nuovi %')"));
  await choose('articleAnalysisMode','forecast');assert(await run("document.querySelector('#analysisTable tbody').textContent.includes('2026')"));assert.equal(await run("document.querySelectorAll('.customer-chart-grid canvas').length"),2);
  await choose('articleHorizon','5');assert(await run("require('chart.js/auto').getChart(document.querySelector('.customer-chart-grid canvas')).data.labels.includes('2030')"));
  for(const size of [[1520,960],[1050,700]]){
   win.setSize(...size);await run("new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))");
   assert(await run("document.documentElement.scrollWidth<=innerWidth"));
   await click('[data-expand-chart]');await wait("!!document.querySelector('.chart-focused')");
   assert(await run("document.querySelector('.chart-focused').getBoundingClientRect().width>innerWidth*.9"));
   await run("new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))");fs.writeFileSync(path.join(artifacts,`${theme}-chart-focused-${size[0]}.png`),(await win.webContents.capturePage()).toPNG());
   const legend=await run("(()=>{const p=document.querySelector('.chart-focused'),b=p.querySelector('.analysis-html-legend button'),c=require('chart.js/auto').getChart(p.querySelector('canvas'));const size=getComputedStyle(b).fontSize,before=c.isDatasetVisible(0);b.click();return {hidden:c.isDatasetVisible(0)!==before,size}})()");assert.equal(legend.hidden,true);assert.equal(legend.size,'13px');
   await run("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");assert.equal(await run("document.querySelectorAll('.chart-focused').length"),0);assert(await run("document.activeElement.matches('[data-expand-chart]')"));
   await run("document.querySelector('#content').scrollTop=0");fs.writeFileSync(path.join(artifacts,`${theme}-forecast-${size[0]}.png`),(await win.webContents.capturePage()).toPNG());
  }
  await choose('articleAnalysisMode','forecast-new');assert(await run("document.querySelector('#analysisTable').textContent.includes('Indicatore')"));assert.equal(await run("document.querySelectorAll('.customer-chart-grid canvas').length"),3);
  await choose('articleDisplay','charts');assert(await run("document.querySelector('.customer-table-panel').hidden"));
  await choose('articleDisplay','table');assert.equal(await run("document.querySelectorAll('.customer-chart-grid canvas').length"),0);
  await choose('articleDisplay','both');
  await choose('articleAnalysisMode','summary');await click('#chartsMenu');assert.equal(await run("document.querySelector('#chartVisibility').children.length"),7);
  await run("document.querySelector('#chartTitle').value='Prezzo per articolo';document.querySelector('#chartMetric').value='weightedPrice';document.querySelector('#chartDimension').value='article';document.querySelector('#chartBuilder').requestSubmit()");assert.equal(await run("document.querySelector('#chartVisibility').children.length"),8);
  await run("document.querySelector('#presetName').value='Articoli test';document.querySelector('#savePreset').click()");await wait("document.querySelector('#chartsMessage').textContent.includes('Preset salvato')");assert.equal(prefs.presets[0].articleCharts.length,8);
  await click('#chartsDialog [data-close-dialog]');await click('[data-view=dashboard]');assert.equal(await run("document.querySelectorAll('.customer-chart-grid canvas').length"),4,'Dashboard remains independent');await click('[data-view=articles]');assert.equal(await run("document.querySelectorAll('.customer-chart-grid canvas').length"),8);
  win.setSize(1520,960);await run("document.querySelector('#content').scrollTop=0;new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))");fs.writeFileSync(path.join(artifacts,`${theme}-summary.png`),(await win.webContents.capturePage()).toPNG());
  await choose('articleDormancy','10');assert(await run("document.querySelector('#analysisTable tbody').textContent.includes('Nessun risultato')"));await choose('articleAnalysisMode','forecast');assert.equal(await run("document.querySelectorAll('.customer-chart-grid canvas').length"),0);
 }
 assert.deepEqual(errors,[]);console.log('OK: article analyzer in Electron, both themes and sizes, table append/sticky borders, inactivity selections, order detail, cohorts, forecasts/horizon, focus/legend keyboard controls, custom charts/presets, dashboard isolation and empty data.');win.destroy();app.exit(0);
 }catch(error){console.error(error);console.error(errors);win.destroy();app.exit(1);}
});
