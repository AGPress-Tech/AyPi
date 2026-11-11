// Read-only UI audit: synthetic data, isolated profile, no production services.
// Run with Electron after npm run build:ts, without ELECTRON_RUN_AS_NODE.
const {app,BrowserWindow,ipcMain}=require('electron');
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const root=path.resolve(__dirname,'..'),out=path.join(root,'.tmp-analysis-audit');
fs.mkdirSync(out,{recursive:true});app.setPath('userData',path.join(out,'profile'));app.commandLine.appendSwitch('disable-gpu');
const mg=require('../dist-ts/modules/management/model');
const tm=require('../dist-ts/modules/turning-analysis/model');
const cp=require('../dist-ts/modules/turning-analysis/chart-presets');
const excelExports={management:0,turning:0};
ipcMain.handle('management-save',(_event,bytes)=>{const XLSX=require('xlsx'),book=XLSX.read(Buffer.from(bytes),{type:'buffer',cellNF:true});assert(Object.values(book.Sheets['Conto economico']).some(c=>c?.t==='n'&&c.z&&!c.z.endsWith('.######')));excelExports.management++;return {ok:true}});
ipcMain.handle('turning-analysis-export',(_event,bytes)=>{const XLSX=require('xlsx'),book=XLSX.read(Buffer.from(bytes),{type:'buffer',cellNF:true});assert(Object.values(book.Sheets).some(sheet=>Object.values(sheet).some(c=>c?.t==='n'&&c.z==='mm/yyyy')));excelExports.turning++;return {ok:true}});
let uiPrefs=require('../dist-ts/modules/analysis-ui-model').emptyWorkspace();ipcMain.handle('analysis-ui-load',()=>({ok:true,preferences:uiPrefs}));ipcMain.handle('analysis-ui-save',(_e,p)=>{uiPrefs=p.preferences;return {ok:true,preferences:uiPrefs}});
const savedPreferences=cp.emptyChartPreferences();savedPreferences.pages.performance=cp.defaultChartLayout();savedPreferences.pages.performance.scatter.mode='bubble';
const groups=mg.CATEGORIES.map((category,i)=>({name:'Gruppo '+(i+1),category}));
const management={source:'AUDIT - dati sintetici',modifiedAt:'2026-11-11',loadedAt:'2026-11-11',sourceKind:'sql',years:[2025,2026],periods:{2025:[1,2,3],2026:[1,2,3]},categories:mg.CATEGORIES,groups,rules:groups.map((g,i)=>({group:g.name,code:String(10000000+i),share:1})),descriptions:{},points:[2025,2026].flatMap(year=>[1,2,3].flatMap(month=>groups.map((g,i)=>({year,month,group:g.name,value:(i===0?12000:-(i+1)*100)*month*(year===2026?1.2:1)})))),accounts:[],quality:{total:66,included:66,closing:0,invalidDates:0,unmatchedAccounts:0,unmatchedValue:0,overlappingAccounts:0}};
const records=[2025,2026].flatMap(year=>[1,2,3].flatMap(month=>['M1','M2'].map((machine,i)=>({id:year*100+month*10+i,customer:i?'Cliente B':'Cliente A',order:'O-'+month,article:i?'ART-B':'ART-A',phase:'F1',description:'Articolo audit',machine,date:`${year}-0${month}-01`,year,month,quantity:100+month,unitPrice:2,setup:1,production:2,hours:3,revenue:200+month*2,rate:(200+month*2)/3,ideal:70,cycle:72,sheetCycle:null,note:''}))));
const turning={source:'AUDIT - dati sintetici',modifiedAt:'2026-11-11',loadedAt:'2026-11-11',records,years:[2025,2026],machines:['M1','M2'].map(code=>({code,description:code,rate:70})),customers:['Cliente A','Cliente B'],articles:['ART-A','ART-B'],capacities:{2025:{},2026:{}},monitored:{2025:[],2026:[]},quality:{read:12,included:12,blank:0,invalidDates:0,invalidInputs:0,blankNumericCells:0,missingMachine:0,missingArticle:0,unpriced:0,noIdeal:0,cachedErrors:0,formulaDifferences:0,examples:[]}};
ipcMain.handle('management-load',()=>({ok:true,data:management}));ipcMain.handle('management-targets-load',()=>({ok:true,targets:{}}));
ipcMain.handle('turning-analysis-load',()=>({ok:true,data:turning}));ipcMain.handle('turning-analysis-settings-load',()=>({ok:true,settings:tm.emptyTurningSettings()}));ipcMain.handle('turning-analysis-charts-load',()=>({ok:true,preferences:savedPreferences}));
for(const kind of ['orders','offers'])ipcMain.handle(`article-${kind}-search`,()=>({ok:true,rows:['ART-A','ART-B'].map((article,i)=>({article,description:'Articolo audit',customerCode:'C001',customerName:'Cliente audit',customerType:'Cliente',orderId:1,offerId:2,orderNo:'26/001',offerNo:'26/OFF-1',orderDate:'2026-01-01',offerDate:'2026-01-01',deliveryDate:'2026-02-01',quantity:100+i,unit:'NR',deliveredQuantity:20,residual:80+i,delivered:0,cancelled:0,line:i+1,unitPrice:2,netPrice:2,currency:'EUR'})),total:2,offset:0,queriedAt:'2026-11-11T10:00:00Z'}));
const findings={screens:[],behaviors:{},errors:[]};
app.whenReady().then(async()=>{
 const watchdog=setTimeout(()=>{console.error('Audit timeout');app.exit(1)},45000);
 const w=new BrowserWindow({show:false,webPreferences:{nodeIntegration:true,contextIsolation:false}});
 w.webContents.on('console-message',(_e,level,message)=>{if(level>=3)findings.errors.push(message)});
 const run=code=>w.webContents.executeJavaScript(code,true);
 const until=async code=>{for(let i=0;i<150;i++){if(await run(code))return;await new Promise(r=>setTimeout(r,30))}throw Error('Timeout: '+code)};
 const snapshot=async(module,view,theme,width,height)=>{
  await run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  const metrics=await run(`(()=>{const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}};const visible=e=>!!(e.offsetWidth&&e.offsetHeight);return {vw:innerWidth,vh:innerHeight,bodyOverflow:document.body.scrollWidth>innerWidth,filters:rect(document.querySelector('.filters')||document.body),charts:[...document.querySelectorAll('canvas')].filter(visible).map(e=>({id:e.id,...rect(e)})),sharedControls:document.querySelectorAll('[data-reset-chart]').length,editor:!!document.querySelector('#chartsMenu'),layout:!!document.querySelector('#layoutToggle'),tableBorders:[...document.querySelectorAll('th,td')].filter(visible).slice(0,20).map(e=>getComputedStyle(e).borderInlineEndWidth)}})()`);
  findings.screens.push({module,view,theme,width,height,...metrics});
  fs.writeFileSync(path.join(out,`${module}-${view}-${theme}-${width}.png`),(await w.webContents.capturePage()).toPNG());
 };
 try{
  for(const module of ['management','turning-analysis'])for(const theme of ['bluearchive','standard']){
   w.setContentSize(1480,900);await w.loadFile(path.join(root,'dist-ts/pages',module+'.html'),{query:{theme}});
   await until(module==='management'?"!document.querySelector('#content').hidden && !document.querySelector('#refresh').disabled":"document.querySelectorAll('#kpis .kpi').length===6 && !document.querySelector('#refresh').disabled");
   for(const [width,height] of [[1480,900],[1000,680]]){
    w.setContentSize(width,height);
    for(const view of module==='management'?['overview','goals','trends','statement']:['dashboard','articles','performance']){
     await run(`document.querySelector('[data-view=${view}]').click()`);await snapshot(module,view,theme,width,height);
    }
   }
   if(theme==='bluearchive'&&module==='management'){
    await run("document.querySelector('[data-view=overview]').click()");
    findings.behaviors.managementBefore=await run("({kpis:Array.from(document.querySelectorAll('#kpis .kpi>strong')).map(n=>n.textContent).join('|'),groups:require('chart.js/auto').getChart(document.querySelector('#groupChart')).data.labels.length})");
    await run("(()=>{const c=require('chart.js/auto').getChart(document.querySelector('#categoryChart'));c.config.options.onClick({x:c.chartArea.left+1,y:c.chartArea.top+1,native:{ctrlKey:true}},[{index:0}],c)})()");
    findings.behaviors.managementAfter=await run("({kpis:Array.from(document.querySelectorAll('#kpis .kpi>strong')).map(n=>n.textContent).join('|'),groups:require('chart.js/auto').getChart(document.querySelector('#groupChart')).data.labels.length,highlight:require('chart.js/auto').getChart(document.querySelector('#categoryChart')).data.datasets.some(d=>d.highlightValues)})");
   }
   if(theme==='bluearchive'&&module==='management'){
    await until("document.querySelectorAll('[data-expand-chart]').length>=2");
    await run("require('chart.js/auto').getChart(document.querySelector('#categoryChart')).options.onAreaSelect([0,1],false)");assert.equal(await run("document.querySelectorAll('[data-selection-field=categories]').length"),2);
    await run("require('chart.js/auto').getChart(document.querySelector('#categoryChart')).options.onAreaSelect([0],true)");assert.equal(await run("document.querySelectorAll('[data-selection-field=categories]').length"),1);
    await run("document.querySelector('[data-reset-chart]').click()");
    await run("document.querySelector('[data-expand-chart=categoryChart]').click()");assert(await run("document.querySelector('.chart-focused').getAttribute('aria-modal')==='true'"));
    await run("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");assert.equal(await run("!!document.querySelector('.chart-focused')"),false);
    await run("document.querySelector('#chartsMenu').click();const form=document.querySelector('#workspaceBuilder');form.elements.title.value='Grafico di prova';form.requestSubmit()");await until("document.querySelectorAll('.workspace-custom-chart canvas').length===1");
    await run("document.querySelector('[data-save]').click()");await until("document.querySelector('[data-workspace-message]').textContent.includes('salvata')");assert.equal(uiPrefs.layout.charts.length,1);
    await run("document.querySelector('#workspacePresetName').value='Audit';document.querySelector('[data-save-preset]').click()");await until("document.querySelector('#workspacePreset').options.length===1");assert.equal(uiPrefs.presets.length,1);
    await run("document.querySelector('[data-close]').click();document.querySelector('#layoutToggle').click()");assert(await run("document.body.classList.contains('analysis-workspace-expanded')"));await run("document.querySelector('#layoutToggle').click()");
    await run("document.querySelector('#export').click()");for(let i=0;i<100&&!excelExports.management;i++)await new Promise(r=>setTimeout(r,30));assert.equal(excelExports.management,1);
   }
   if(theme==='bluearchive'&&module==='turning-analysis'){
    findings.behaviors.turningScatterPreference={saved:'bubble',loaded:await run("document.querySelector('#scatterMode').value")};
    assert.equal(findings.behaviors.turningScatterPreference.loaded,'bubble');
    await run("document.querySelector('[data-view=dashboard]').click();const input=document.querySelector('[data-dimension=machines] input[type=checkbox]');input.checked=true;input.dispatchEvent(new Event('change',{bubbles:true}))");
    findings.behaviors.turningBeforeReset=await run("document.querySelector('#selectionChips').textContent");
    await run("require('chart.js/auto').getChart(document.querySelector('#turningMonthly')).options.onAreaSelect([0,2],false)");
    assert.equal(await run("document.querySelector('[data-metric=registrations] strong').textContent"),'2');
    assert.equal(await run("require('chart.js/auto').getChart(document.querySelector('#turningMonthly')).data.labels.length"),3);
    await run("document.querySelector('[data-reset-chart]').click()");
    findings.behaviors.turningAfterReset=await run("document.querySelector('#selectionChips').textContent");
    assert(findings.behaviors.turningBeforeReset.includes('M1'));assert(findings.behaviors.turningAfterReset.includes('M1'));
    await run("document.querySelector('#export').click()");for(let i=0;i<100&&!excelExports.turning;i++)await new Promise(r=>setTimeout(r,30));assert.equal(excelExports.turning,1);
   }
  }
  for(const module of ['article-orders','article-offers'])for(const theme of ['bluearchive','standard']){
   w.setContentSize(1480,900);await w.loadFile(path.join(root,'dist-ts/pages',module+'.html'),{query:{theme}});
   await until("!!document.querySelector('[data-key=articles] .value')");
   await run("document.querySelector('[data-key=articles] .value').value='ART-A';document.querySelector('#searchForm').requestSubmit()");
   await until("document.querySelectorAll('#results tbody tr[data-analysis-row]').length===2");
   for(const [width,height] of [[1480,900],[1000,680]]){w.setContentSize(width,height);await snapshot(module,'table',theme,width,height)}
  }
  assert.equal(findings.behaviors.managementBefore.kpis,findings.behaviors.managementAfter.kpis);
  assert.equal(findings.behaviors.managementAfter.highlight,true);
  assert.equal(findings.behaviors.managementBefore.groups,findings.behaviors.managementAfter.groups);
  assert.equal(findings.errors.length,0,JSON.stringify(findings.errors));
  fs.writeFileSync(path.join(out,'audit.json'),JSON.stringify(findings,null,2));console.log(JSON.stringify({screens:findings.screens.length,behaviors:findings.behaviors,errors:findings.errors},null,2));
  clearTimeout(watchdog);w.destroy();app.exit(0);
 }catch(e){console.error(e);fs.writeFileSync(path.join(out,'audit.json'),JSON.stringify(findings,null,2));w.destroy();app.exit(1)}
});
