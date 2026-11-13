// Real Electron IPC + worker with a synthetic workbook. No production file is read or written.
const {app,BrowserWindow,dialog}=require('electron'),fs=require('fs'),path=require('path'),assert=require('assert/strict'),XLSX=require('xlsx');
const root=path.resolve(__dirname,'..'),dir=path.join(root,'.tmp-turning-workbook-ui');fs.mkdirSync(dir,{recursive:true});app.setPath('userData',path.join(dir,'profile-'+Date.now()));app.commandLine.appendSwitch('disable-gpu');
for(const method of ['show','focus','maximize'])BrowserWindow.prototype[method]=function(){};
app.whenReady().then(async()=>{
 const watchdog=setTimeout(()=>{console.error('Timeout vista Excel');app.exit(1)},60000),errors=[];
 try{
  const headers=Array.from({length:28},(_,i)=>'Campo '+i);for(const [i,h] of [[0,'Cliente'],[2,'Articolo'],[5,'EUR/pezzo'],[6,'Pezzi'],[7,'Ore Att'],[8,'Ore Lav'],[10,'Ricavo Tot'],[12,'Mese/Anno'],[19,'Macchina'],[13,' mese esatto '],[14,'Anno'],[20,'Rapporto formattazione'],[16,'s/pezzo reali'],[17,'s/pezzo ideale'],[18,'\u20ac/pezzo ideale'],[25,'Importo'],[26,'Data'],[27,'Codice']])headers[i]=h;
  const rows=Array.from({length:310},(_,i)=>{const r=Array(28).fill(null);Object.assign(r,{0:i%2?'Cliente B':'Cliente A',1:'Ordine '+i,2:'ART-'+i,5:2.58,6:i+0.125,7:1,8:2,10:(i+0.125)*2.58,12:i===309?'periodo errato':'2026-01-01',19:i%2?'M2':'M1',24:'Extra '+i,25:i%2?0.125:2.58,26:{v:i%2?46024:46023,t:'n',z:'dd/mm/yyyy'},27:i%2?'002':'001',13:'escluso mese',14:2026,20:'escluso formato',16:42,17:43,18:44});return r;});
  const book=XLSX.utils.book_new(),source=path.join(dir,'source.xlsm');XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([headers,...rows]),'COMPLETO');
  XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['Codice','Importo','Data'],['001',2.58,{v:46023,t:'n',z:'dd/mm/yyyy'}],['002',0.125,{v:46024,t:'n',z:'dd/mm/yyyy'}]]),'Extra');XLSX.writeFile(book,source);const original=fs.readFileSync(source);
  require('../dist-ts/modules/turning-analysis/model').TURNING_SOURCE=source;
  const {buildWorkbookTables}=require('../dist-ts/modules/turning-analysis/workbook-table');
  const raw=buildWorkbookTables(XLSX.readFile(source,{dense:true,cellNF:true}));assert.equal(raw.sheets[0].rows.length,310);assert.equal(raw.sheets[0].columns.length,25);assert.equal(raw.sheets[0].rows[309].cells[12].value,'periodo errato');assert.equal(raw.sheets.length,1);assert.equal(raw.sheets[0].columns.some(c=>['N','O','U'].includes(c.key)),false);assert.equal(raw.sheets[0].rows[309].cells[raw.sheets[0].columns.findIndex(c=>c.key==='Y')].value,'Extra 309');
  assert.equal(raw.sheets[0].rows[0].cells[6].display,'0,13');assert.equal(raw.sheets[0].rows[0].cells[6].value,0.125,'Solo visualizzazione arrotondata');
  const main=new BrowserWindow({show:false,webPreferences:{nodeIntegration:true,contextIsolation:false}});await main.loadURL('about:blank');require('../dist-ts/modules/turning-analysis/ipc').registerTurningAnalysisIpc(main,()=> '');
  assert.equal((await main.webContents.executeJavaScript("require('electron').ipcRenderer.invoke('turning-analysis-workbook-load')")).ok,false);
  app.on('web-contents-created',(_e,contents)=>contents.on('console-message',(_e,level,message)=>{if(level>=3)errors.push(message)}));
  await main.webContents.executeJavaScript("require('electron').ipcRenderer.invoke('turning-analysis-open')");
  const win=BrowserWindow.getAllWindows().find(w=>w!==main),run=code=>win.webContents.executeJavaScript(code,true);
  const until=async code=>{const start=Date.now();while(Date.now()-start<15000){if(await run(code))return;await new Promise(r=>setTimeout(r,30))}throw Error('Timeout '+code)};
  for(const theme of ['bluearchive','standard']){
   await win.loadFile(path.join(root,'dist-ts/pages/turning-analysis.html'),{query:{theme}});await until("!document.querySelector('#export').disabled");await run("document.querySelector('[data-view=workbook]').click()");await until("!!document.querySelector('#workbookTable tbody tr')");
   assert.equal(await run("document.querySelectorAll('#workbookTable tbody tr').length"),250);assert(await run("document.querySelector('#workbookCount').textContent.includes('310')"));
   assert.equal(await run("document.querySelectorAll('#workbookTable thead tr:first-child th').length"),22);
   assert.equal(await run("document.querySelector('#workbookTable th .sort-header-button').firstChild.textContent"),'Cliente');
   await run("document.querySelector('#workbookMore').click()");assert.equal(await run("document.querySelectorAll('#workbookTable tbody tr').length"),310);assert(await run("document.querySelector('#workbookTable').textContent.includes('periodo errato')"));
   await run("document.querySelector('[data-column-search=Y]').value='Extra 309';document.querySelector('[data-column-search=Y]').dispatchEvent(new Event('input'))");assert.equal(await run("document.querySelectorAll('#workbookTable tbody tr').length"),1);
   await run("document.querySelector('#workbookReset').click();document.querySelector('[data-sort-key=G]').click()");assert(await run("document.querySelector('#workbookTable tbody tr td:nth-child(3)').textContent==='ART-0'"));
   assert.equal(await run("!!document.querySelector('#workbookSheet')"),false);
   assert.equal(await run("!!document.querySelector('[data-column-search=Q]')"),false);
   await run("document.querySelector('[data-visible=Q]').checked=true;document.querySelector('[data-visible=Q]').dispatchEvent(new Event('change'))");assert(await run("!!document.querySelector('[data-column-search=Q]')"));
   await run("document.querySelector('[data-visible=Q]').checked=false;document.querySelector('[data-visible=Q]').dispatchEvent(new Event('change'));document.querySelector('[data-column-search=Y]').value='Extra 309';document.querySelector('[data-column-search=Y]').dispatchEvent(new Event('input'))");
   await run("document.querySelector('#workbookAddRule').click();document.querySelector('[data-field]').value='Z';document.querySelector('[data-op]').value='range';document.querySelector('[data-op]').dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('[data-value]').value='0,1';document.querySelector('[data-to]').value='0,2';document.querySelector('#workbookApply').click()");
   assert.equal(await run("document.querySelectorAll('#workbookTable tbody tr').length"),1);assert(await run("document.querySelector('#workbookTable tbody').textContent.includes('002')"));
   const target=path.join(dir,'export-'+theme+'.xlsx');if(fs.existsSync(target))fs.unlinkSync(target);dialog.showSaveDialog=async()=>({canceled:false,filePath:target});await run("document.querySelector('#export').click()");let output;const started=Date.now();while(!output&&Date.now()-started<10000){try{output=XLSX.readFile(target,{cellNF:true}).Sheets.COMPLETO}catch{}if(!output)await new Promise(r=>setTimeout(r,30));}
   assert(output,'Export completato');const labels=XLSX.utils.sheet_to_json(output,{header:1})[0],get=label=>output[XLSX.utils.encode_cell({r:1,c:labels.indexOf(label)})];assert.equal(get('Codice').v,'002');assert.equal(get('Importo').v,0.125);assert.equal(get('Data').t,'n');assert.equal(get('Data').z,'dd/mm/yyyy');assert(!labels.includes('Anno')&&!labels.includes('s/pezzo reali'));
   await run("document.querySelector('#workbookReset').click();document.querySelector('#workbookAddRule').click();document.querySelector('[data-field]').value='AA';document.querySelector('[data-op]').value='gte';document.querySelector('[data-op]').dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('[data-value]').value='2026-01-02';document.querySelector('#workbookApply').click()");
   assert.equal(await run("document.querySelectorAll('#workbookTable tbody tr').length"),155,'Intervalli sulle date originali Excel');
   await run("document.querySelector('#workbookReset').click()");
   for(const [width,height] of [[1520,960],[1000,680]]){
    win.setContentSize(width,height);await run("new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))");assert.equal(await run("document.body.scrollWidth>innerWidth"),false);
    const size=await run("(()=>{const r=document.querySelector('.workbook-panel .table-scroll').getBoundingClientRect();return {height:r.height,bottom:r.bottom,vh:innerHeight}})()");assert(size.height>220&&size.bottom<=size.vh,JSON.stringify(size));
    fs.writeFileSync(path.join(dir,theme+'-'+width+'.png'),(await win.webContents.capturePage()).toPNG());
   }
   await run("document.querySelector('[data-view=dashboard]').click();document.querySelector('[data-view=workbook]').click()");assert.equal(await run("!!document.querySelector('#workbookTable')"),true);
  }
  assert.deepEqual(fs.readFileSync(source),original);assert.deepEqual(errors,[]);console.log('OK: vista Excel originale, solo Completo, colonne escluse e nascoste, righe escluse dalle analisi, ricerca colonne, intervalli, ordinamento, paginazione, export tipizzato, due temi e dimensioni.');
 }catch(error){console.error(error);process.exitCode=1}finally{clearTimeout(watchdog);BrowserWindow.getAllWindows().forEach(w=>w.destroy());app.exit(process.exitCode||0)}
});
