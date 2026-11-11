const {app,BrowserWindow,ipcMain}=require('electron');
const assert=require('assert/strict'),fs=require('fs'),path=require('path'),http=require('http');
const root=path.resolve(__dirname,'..'),out=path.join(root,'.tmp-analysis-workspace');fs.mkdirSync(out,{recursive:true});app.setPath('userData',path.join(out,'profile-'+Date.now()));app.commandLine.appendSwitch('disable-gpu');
let lastExport='',exportIndex=0;ipcMain.handle('select-output-file',()=>lastExport=path.join(out,'export-'+(++exportIndex)+'.xlsx'));
const machines=[1,2].map(i=>({id:'M'+i,machineId:'M'+i,name:'Macchina '+i,department:'Reparto '+i,category:'Torneria'}));
const jobs=[1,2,3,4].map(i=>({id:'J'+i,machineId:'M'+(i%2+1),article:'ART-'+i,customer:'Cliente '+i,start:'2026-11-02',end:'2026-11-05',firstDeliveryDate:'2026-11-10',completedAt:'2026-11-05',workStatus:i%2?'done':'running',quantity:100,producedQuantity:80,producedKg:20,progressDays:1,durationDays:2}));
ipcMain.handle('production-planner-load',()=>({ok:true,snapshot:{state:{machines,jobs,unavailabilities:[]},revision:1,updatedAt:'2026-11-11'}}));
ipcMain.handle('mes-analysis',(_e,filters)=>{const rows=machines.filter(m=>!filters.machineIds.length||filters.machineIds.includes(m.id)).map(m=>({id:m.id,machineId:m.id,label:m.name,name:m.name,productionSeconds:3600,setupSeconds:600,stoppedSeconds:300,unmonitoredSeconds:0,countedPieces:100,activations:1,from:'2026-11-09T08:00:00Z',to:'2026-11-09T09:00:00Z',coveragePercent:100}));return {ok:true,data:{from:filters.from,to:filters.to,summary:{countedPieces:rows.length*100,scrapPieces:0,productionSeconds:rows.length*3600,setupSeconds:rows.length*600,stoppedSeconds:0,unmonitoredSeconds:0},machines,operators:['Operatore'],byMachine:rows,activations:rows,byOrder:[],byArticle:[],intervals:[],declarations:[]}}});
const requests=[1,2].map(i=>({id:'R'+i,employee:'Dipendente '+i,department:'Reparto '+i,status:'approved',type:'ferie',start:'2026-11-09',end:'2026-11-10',allDay:true}));
const server=http.createServer((req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(req.url.includes('assignees')?{groups:{'Reparto 1':['Dipendente 1'],'Reparto 2':['Dipendente 2']}}:{requests,balances:{},holidays:[],closures:[]}))});
app.whenReady().then(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));process.env.AYPI_BACKEND_URL=`http://127.0.0.1:${server.address().port}`;
 require('../dist-ts/modules/analysis-ui-preferences').registerAnalysisUiPreferences();
 const w=new BrowserWindow({show:false,webPreferences:{nodeIntegration:true,contextIsolation:false}}),errors=[];
 w.webContents.on('console-message',(_e,level,message)=>{if(level>=3)errors.push(message)});
 const run=code=>w.webContents.executeJavaScript(code,true);
 const wait=async code=>{for(let i=0;i<180;i++){if(await run(code))return;await new Promise(r=>setTimeout(r,35))}throw Error('Timeout: '+code)};
 try{
  for(const module of ['production-planner-analysis','mes-analysis','ferie-permessi-analysis'])for(const theme of ['bluearchive','standard']){
   errors.length=0;w.setContentSize(1480,900);await w.loadFile(path.join(root,'dist-ts/pages/utilities',module+'.html'),{query:{theme}});
   const canvas=module==='production-planner-analysis'?'chart-machines':module==='ferie-permessi-analysis'?'fpa-bars-canvas':null;
   await wait(canvas?`!!require('chart.js/auto').getChart(document.querySelector('#${canvas}'))`:'document.querySelectorAll("#report-chart [data-machine]").length===2');
   await wait(`!!document.querySelector('[data-expand-chart="${canvas||'report-chart'}"]')`);
   await run(`document.querySelector('[data-expand-chart="${canvas||'report-chart'}"]').click()`);assert(await run("!!document.querySelector('.chart-focused')"));
   await run("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");assert.equal(await run("!!document.querySelector('.chart-focused')"),false);
   if(canvas){
    const before=await run(`require('chart.js/auto').getChart(document.querySelector('#${canvas}')).data.labels.length`);
    await run(`(()=>{const c=require('chart.js/auto').getChart(document.querySelector('#${canvas}'));c.config.options.onClick({native:{ctrlKey:false}},[{index:0}])})()`);
    await wait(`require('chart.js/auto').getChart(document.querySelector('#${canvas}')).data.datasets.some(d=>d.highlightValues||d.highlightSeries)`);
    assert.equal(await run(`require('chart.js/auto').getChart(document.querySelector('#${canvas}')).data.labels.length`),before);
    if(module==='production-planner-analysis')assert.equal(await run("document.querySelector('#kpi-jobs').textContent"),'2');
    if(module==='ferie-permessi-analysis')assert.equal(await run("document.querySelectorAll('#fpa-employee-table tbody tr').length"),1);
    await run(`require('chart.js/auto').getChart(document.querySelector('#${canvas}')).options.onAreaSelect([0,1],false)`);
    if(module==='production-planner-analysis')assert.equal(await run("document.querySelector('#kpi-jobs').textContent"),'4');
    if(module==='ferie-permessi-analysis')assert.equal(await run("document.querySelectorAll('#fpa-employee-table tbody tr').length"),2);
   }else{
    await run("document.querySelector('#report-chart [data-machine]').click()");await wait("document.querySelectorAll('#report-chart [data-machine]').length===2 && document.querySelectorAll('#report-body tr').length===1");
    const r=await run("(()=>{const a=[...document.querySelectorAll('#report-chart .chart-track')].map(e=>e.getBoundingClientRect());return {x1:Math.round(a[0].left+2),y1:Math.round(a[0].top+1),x2:Math.round(a[1].right-2),y2:Math.round(a[1].bottom-1)}})()");
    w.webContents.sendInputEvent({type:'mouseMove',x:r.x1,y:r.y1});w.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,x:r.x1,y:r.y1});w.webContents.sendInputEvent({type:'mouseMove',x:r.x2,y:r.y2});w.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:r.x2,y:r.y2});
    await wait("document.querySelectorAll('#report-body tr').length===2");
    const point=await run("(()=>{const r=document.querySelector('#report-chart [data-machine]').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()");
    w.webContents.sendInputEvent({type:'mouseMove',...point});w.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...point});w.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...point});await wait("document.querySelectorAll('#report-body tr').length===1");
   }
   await run("document.querySelector('[data-reset-chart]').click()");
   if(module==='production-planner-analysis'){
    assert.equal(await run("document.querySelector('#kpi-jobs').textContent"),'4');
    await run("document.querySelector('#filter-only-completed').checked=true;document.querySelector('#analysis-apply').click();document.querySelector('[data-reset-chart]').click()");
    assert.equal(await run("document.querySelector('#kpi-jobs').textContent"),'2');assert(await run("document.querySelector('#filter-only-completed').checked"));
   }
   if(theme==='bluearchive'&&module!=='ferie-permessi-analysis'){
    lastExport='';await run(`document.querySelector('#${module==='mes-analysis'?'report-export':'analysis-export'}').click()`);
    for(let i=0;i<100&&(!lastExport||!fs.existsSync(lastExport));i++)await new Promise(r=>setTimeout(r,30));assert(lastExport&&fs.existsSync(lastExport));
    const XLSX=require('xlsx'),book=XLSX.readFile(lastExport,{cellNF:true}),sheet=book.Sheets[module==='mes-analysis'?'Attivazioni':'Dettaglio'],data=XLSX.utils.sheet_to_json(sheet,{header:1}),dateColumn=data[0].indexOf(module==='mes-analysis'?'Inizio attivazione':'Inizio'),dateCell=sheet[XLSX.utils.encode_cell({r:1,c:dateColumn})];assert.equal(dateCell.t,'n');assert.equal(dateCell.z,module==='mes-analysis'?'dd/mm/yyyy hh:mm:ss':'dd/mm/yyyy');
    if(module==='mes-analysis'){const c=data[0].indexOf('Produzione');assert.equal(sheet[XLSX.utils.encode_cell({r:1,c})].z,'[h]:mm:ss');}
   }
   await run("document.querySelector('#chartsMenu').click();const f=document.querySelector('#workspaceBuilder');f.elements.title.value='Grafico test';f.requestSubmit()");await wait("!!document.querySelector('.workspace-custom-chart canvas')");
   await run("document.querySelector('[data-save]').click()");await wait("document.querySelector('[data-workspace-message]').textContent.includes('salvata')");
   await run("document.querySelector('[data-close]').click()");
   for(const [width,height] of [[1480,900],[1000,680]]){w.setContentSize(width,height);await run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');fs.writeFileSync(path.join(out,`${module}-${theme}-${width}.png`),(await w.webContents.capturePage()).toPNG())}
   assert.equal(await run('document.querySelectorAll("table").length>0'),true);
   assert.deepEqual(errors,[]);console.log('OK',module,theme);
  }
  w.destroy();server.close();app.exit(0);
 }catch(error){console.error(error,errors);console.error(await run("document.body.textContent.slice(-1200)"));w.destroy();server.close();app.exit(1)}
});
