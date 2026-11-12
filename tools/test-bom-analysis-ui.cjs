// Electron integration: real IPC, native context menus intercepted, isolated profile.
const {app,BrowserWindow,Menu,dialog}=require('electron');
process.on('uncaughtException',e=>{console.error(e);app.exit(1)});process.on('unhandledRejection',e=>{console.error(e);app.exit(1)});
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),XLSX=require('xlsx');
const root=path.resolve(__dirname,'..'),dir=path.join(root,'.tmp-bom-ui');fs.mkdirSync(dir,{recursive:true});app.setPath('userData',path.join(dir,'profile'));app.commandLine.appendSwitch('disable-gpu');
for(const m of ['maximize','show','focus'])BrowserWindow.prototype[m]=function(){};
const base={bom:'BOM-1',bomDescription:'Distinta uno',bomUnit:'NR',disabled:0,inProduction:1,created:'2026-01-01',modified:'2026-11-11',quantity:.123456,unit:'KG',hasBom:0,netWeight:2.58,grossWeight:2.586,validFrom:null,validTo:null};
const fixture=[{...base,line:1,component:'ART-A',description:'Primo articolo'},{...base,line:2,component:'SUB',description:'Sottodistinta',hasBom:1},{...base,line:3,component:'',description:'Istruzione di lavorazione'},
 {...base,bom:'SUB',bomDescription:'Sottodistinta',line:1,component:'ART-C',description:'Terzo articolo'},
 {...base,bom:'DISABLED',disabled:1,line:1,component:'ART-A',description:'Primo articolo'},
 {...base,bom:'EMPTY',line:null,component:null,quantity:null,description:null}];
let menu=[],fail=false;
require('../dist-ts/modules/file-manager/backend-client').requestAypiBackend=async(endpoint,{body})=>{
 if(endpoint.endsWith('bom-analysis')){if(fail)throw Error('Backend non disponibile');return {rows:fixture.filter(r=>(!body.article||r.component===body.article)&&(!body.bom||r.bom===body.bom)),queriedAt:'2026-11-11T10:00:00Z'}}
 if(endpoint.endsWith('article-orders')||endpoint.endsWith('article-offers'))return {rows:body.articles?.[0]?.value==='ART-A'?[{article:'ART-A'}]:[],total:0};
 return {rows:[]};
};
const run=(w,c)=>w.webContents.executeJavaScript(c,true);
const until=async(fn)=>{const t=Date.now();while(Date.now()-t<10000){if(await fn())return;await new Promise(r=>setTimeout(r,35))}throw Error('Timeout UI BoM')};
const rule=(field,value,op='exact')=>`(()=>{const g=document.querySelector('[data-field=${field}]');g.open=true;const o=g.querySelector('[data-op]');if(o){o.value=${JSON.stringify(op)};o.dispatchEvent(new Event('change',{bubbles:true}))}g.querySelector('[data-value]').value=${JSON.stringify(value)}})()`;
app.whenReady().then(async()=>{
 Menu.buildFromTemplate=items=>({popup(){menu=items}});
 const watchdog=setTimeout(()=>{console.error('Timeout globale BoM');app.exit(1)},60000),errors=[];
 app.on('web-contents-created',(_e,c)=>c.on('console-message',(_e,level,message)=>{if(level>=3)errors.push(message)}));
 const main=new BrowserWindow({show:false,webPreferences:{nodeIntegration:true,contextIsolation:false}});await main.loadURL('about:blank');
 require('../dist-ts/modules/analysis-navigation').registerAnalysisNavigation(main,()=> '');
 require('../dist-ts/modules/bom-analysis/ipc').registerBomAnalysisIpc(main,()=> '');
 const open=async context=>{const result=await run(main,`require('electron').ipcRenderer.invoke('analysis-navigate',${JSON.stringify({target:'bom-analysis',context})})`);assert(result.ok,result.error)};
 try{
  const prefFile=path.join(dir,'profile','bom-analysis.settings.json');if(fs.existsSync(prefFile))fs.unlinkSync(prefFile);
  await open({article:'ART-A'});let win;
  await until(()=>{win=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/bom-analysis.html'));return !!win});
  await until(()=>run(win,"document.querySelector('#rowCount').textContent==='2' && !document.querySelector('#refresh').disabled"));
  assert.equal(await run(win,"document.querySelector('#bomCount').textContent"),'2');
  assert.equal(await run(win,"document.querySelector('[data-field=component] [data-value]').value"),'ART-A');
  await run(win,rule('disabled','0'));await run(win,"document.querySelector('#searchForm').requestSubmit()");assert.equal(await run(win,"document.querySelector('#bomCount').textContent"),'1');
  await run(win,"document.querySelector('#results [data-expand-bom]').click()");
  assert.equal(await run(win,"document.querySelector('#bomDetail').open"),false);
  assert.equal(await run(win,"document.querySelector('#results [data-expand-bom]').getAttribute('aria-expanded')"),'true');
  assert.equal(await run(win,"document.querySelectorAll('#results > tbody > .bom-composition-row table > tbody > tr').length"),3);
  assert.equal(await run(win,"document.querySelector('#rowCount').textContent"),'1');
  assert.equal(await run(win,"document.querySelector('#results .bom-inline-composition').textContent.includes('Istruzione di lavorazione')"),true);
  await run(win,"document.querySelector('#results .bom-inline-composition [data-expand-bom=SUB]').click()");
  assert.equal(await run(win,"document.querySelectorAll('#results .bom-inline-composition').length"),2);
  assert.equal(await run(win,"document.querySelector('#results .bom-inline-composition .bom-inline-composition').textContent.includes('ART-C')"),true);
  await run(win,"document.querySelector('#results .bom-inline-composition [data-open-bom=SUB]').click()");
  assert.equal(await run(win,"document.querySelector('#detailTitle').textContent"),'Distinta SUB');
  await run(win,"document.querySelector('#detailClose').click()");
  await run(win,"document.querySelector('#results > tbody > tr > td [data-expand-bom]').click()");
  assert.equal(await run(win,"document.querySelectorAll('#results .bom-composition-row').length"),0);
  assert.equal(await run(win,"document.querySelector('#results [data-expand-bom]').getAttribute('aria-expanded')"),'false');
  await run(win,"document.querySelector('#results [data-open-bom]').click()");
  assert.equal(await run(win,"document.querySelector('#bomDetail').open"),true);assert.equal(await run(win,"document.querySelectorAll('#detailTable tbody tr').length"),3);
  assert.equal(await run(win,"document.querySelector('#detailTable').textContent.includes('Istruzione di lavorazione')"),true);
  await run(win,"document.querySelector('#detailTable [data-open-bom=SUB]').click()");assert.equal(await run(win,"document.querySelector('#detailTitle').textContent"),'Distinta SUB');
  await run(win,"document.querySelector('#detailBack').click()");assert.equal(await run(win,"document.querySelectorAll('#detailTable tbody tr').length"),3);
  await run(win,"document.querySelector('#detailSearch').value='Primo';document.querySelector('#detailSearch').dispatchEvent(new Event('input'))");assert.equal(await run(win,"document.querySelectorAll('#detailTable tbody tr').length"),1);
  menu=[];await run(win,"document.querySelector('#detailTable [data-analysis-article]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))");await until(()=>menu.length===2);assert(menu.every(m=>/venduto|offerte/.test(m.label)));
  menu=[];await run(win,"document.querySelector('#detailTable td.numeric').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))");await new Promise(r=>setTimeout(r,100));assert.equal(menu.length,0);
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});await until(()=>run(win,"!document.querySelector('#bomDetail').open"));
  await until(()=>run(win,"!!document.activeElement.closest('[data-open-bom]')"));
  await open({bom:'BOM-1'});await until(()=>run(win,"document.querySelector('[data-mode=composition]').getAttribute('aria-pressed')==='true'"));assert.equal(await run(win,"document.querySelectorAll('#results tbody tr').length"),1);
  await run(win,"document.querySelector('#savePreset').click();document.querySelector('#presetName').value='Distinta uno';document.querySelector('#presetDialog button[value=save]').click()");await until(()=>fs.existsSync(prefFile));await until(()=>run(win,"document.querySelectorAll('#presets option').length===2"));
  await run(win,"document.querySelector('#reset').click();document.querySelector('#presets').value='0';document.querySelector('#presets').dispatchEvent(new Event('change'))");assert.equal(await run(win,"document.querySelectorAll('#results tbody tr').length"),1);
  const exportPath=path.join(dir,'bom.xlsx');if(fs.existsSync(exportPath))fs.unlinkSync(exportPath);dialog.showSaveDialog=async()=>({filePath:exportPath,canceled:false});
  await run(win,"document.querySelector('#export').click()");assert.equal(await run(win,"document.querySelector('#exportDialog').open"),true);
  assert.equal(await run(win,"document.querySelector('#exportLayout').value"),'summary');
  await run(win,"document.querySelector('#exportDialog button[value=export]').click()");await until(()=>run(win,"document.querySelector('#status').textContent.includes('esportate in Excel')"));
  const summary=XLSX.readFile(exportPath).Sheets['Distinte e componenti'];assert.equal(XLSX.utils.sheet_to_json(summary).length,1);
  assert(!XLSX.utils.sheet_to_json(summary,{header:1})[0].includes('Articolo componente'));
  const exported=await run(win,"require('electron').ipcRenderer.invoke('bom-analysis-export',{layout:'exploded',search:{mode:'composition',rules:[{field:'bom',op:'exact',value:'BOM-1'},{field:'component',op:'exact',value:'ART-A'}],sort:[]},columns:['bom']})");assert(exported.ok,exported.error);assert.equal(exported.count,3);
  const sheet=XLSX.readFile(exportPath,{cellNF:true}).Sheets['Distinte e componenti'],headers=XLSX.utils.sheet_to_json(sheet,{header:1})[0];
  const cell=label=>sheet[XLSX.utils.encode_cell({r:1,c:headers.indexOf(label)})];
  assert.equal(cell('Quantit\u00e0').v,.123456);assert.equal(cell('Quantit\u00e0').t,'n');assert.equal(cell('Quantit\u00e0').z,'#,##0.000');assert.equal(cell('Peso netto articolo').v,2.58);assert.equal(cell('Peso netto articolo').z,'#,##0.000');assert.equal(cell('Creazione distinta').t,'n');assert.equal(cell('Creazione distinta').z,'dd/mm/yyyy');
  assert.equal((await run(win,"require('electron').ipcRenderer.invoke('bom-analysis-export',{layout:'invalid',search:{mode:'composition',rules:[],sort:[]},columns:['bom']})")).ok,false);
  assert.equal((await run(main,"require('electron').ipcRenderer.invoke('bom-analysis-load')")).ok,false);
  assert.equal((await run(win,"require('electron').ipcRenderer.invoke('bom-analysis-export',{search:{mode:'composition',rules:[],sort:[]},columns:['injection']})")).ok,false);
  fail=true;await run(win,"document.querySelector('#refresh').click()");await until(()=>run(win,"document.querySelector('#status').classList.contains('error')"));assert.equal(await run(win,"document.querySelectorAll('#results tbody tr').length"),1);fail=false;
  const stored=JSON.parse(fs.readFileSync(prefFile));assert.equal(stored.presets[0].name,'Distinta uno');
  await new Promise(resolve=>{win.webContents.once('did-finish-load',resolve);win.webContents.reload()});await until(()=>run(win,"document.querySelectorAll('#presets option').length===2"));
  for(const theme of ['standard','bluearchive']){
   await win.loadFile(path.join(root,'dist-ts/pages/bom-analysis.html'),{query:{theme}});await until(()=>run(win,"document.querySelector('#bomCount').textContent==='3'"));
   // Use actual, read-only ERP snapshot when available to check realistic long descriptions and row volume.
   const snapshot=path.join(root,'.tmp-bom-live.json');
   if(fs.existsSync(snapshot)){fixture.splice(0,fixture.length,...JSON.parse(fs.readFileSync(snapshot)).rows);await run(win,"document.querySelector('#refresh').click()");await until(()=>run(win,"!document.querySelector('#refresh').disabled"));}
   for(const [width,height] of [[1500,940],[1000,680]]){
    win.setContentSize(width,height);await run(win,"new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))");
    const box=await run(win,"({overflow:document.body.scrollWidth>innerWidth,table:document.querySelector('.table-scroll').clientHeight,filter:document.querySelector('.filter-scroll').clientHeight,border:getComputedStyle(document.querySelector('#results tbody td')).borderRightWidth,header:getComputedStyle(document.querySelector('#results th')).borderRightWidth})");
    assert(!box.overflow,JSON.stringify(box));assert(box.table>200&&box.filter>150,JSON.stringify(box));assert.notEqual(box.border,'0px');assert.notEqual(box.header,'0px');
    fs.writeFileSync(path.join(dir,`bom-${theme}-${width}.png`),(await win.webContents.capturePage()).toPNG());
    await run(win,"document.querySelector('#results [data-expand-bom]').click()");
    assert.equal(await run(win,"document.querySelectorAll('#results > tbody > .bom-composition-row').length"),1);
    await run(win,"new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))");
    assert.equal(await run(win,"document.body.scrollWidth>innerWidth"),false);
    fs.writeFileSync(path.join(dir,`inline-${theme}-${width}.png`),(await win.webContents.capturePage()).toPNG());
    await run(win,"document.querySelector('#results [data-expand-bom]').click()");
    await run(win,"document.querySelector('#results [data-open-bom]').click()");
    const detail=await run(win,"(()=>{const d=document.querySelector('#bomDetail').getBoundingClientRect();return {w:d.width,h:d.height,iw:innerWidth,ih:innerHeight}})()");assert(detail.w>detail.iw*.95&&detail.h>detail.ih*.94,JSON.stringify(detail));
    fs.writeFileSync(path.join(dir,`detail-${theme}-${width}.png`),(await win.webContents.capturePage()).toPNG());await run(win,"document.querySelector('#detailClose').click()");
   }
   // Next theme starts from deterministic fixture again.
   fixture.splice(0,fixture.length,...[{...base,line:1,component:'ART-A'},{...base,bom:'SUB',line:1,component:'ART-C'},{...base,bom:'DISABLED',line:1,component:'ART-A'}]);
  }
  assert.deepEqual(errors,[]);console.log('OK: BoM Electron, due viste, filtri, dettagli completi e sottodistinte, menu direzionali, Escape/focus, preset persistenti, export tipizzato, errori, due temi a 1500x940 e 1000x680.');
 }catch(e){console.error(e);console.error('Renderer errors:',errors);for(const w of BrowserWindow.getAllWindows())if(w!==main)console.error(await run(w,"({status:document.querySelector('#status')?.textContent,count:document.querySelector('#rowCount')?.textContent,body:document.body.textContent.slice(-500)})"));app.exitCode=1}finally{clearTimeout(watchdog);for(const w of BrowserWindow.getAllWindows())w.destroy();app.exit(app.exitCode||0)}
});
