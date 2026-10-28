const {app,BrowserWindow,ipcMain}=require('electron');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'aypi-analysis-ui-'));
app.setPath('userData',temp);
const metric={countedPieces:15,scrapPieces:1,manualPieces:15,plcPieces:0,adjustmentPieces:0,productionSeconds:40,setupSeconds:10,stoppedSeconds:40,unmonitoredSeconds:0,operatorSeconds:90};
const row={...metric,machineId:'m1',machine:'Centro 1',department:'Torneria',orderNumber:'OP1',phase:'01',article:'ART',operators:['Ada'],source:'MANUAL',from:'2026-10-01T08:00:00Z',to:'2026-10-01T09:00:00Z'};
const report={from:row.from,to:row.to,summary:metric,activations:[row],byMachine:[{...metric,id:'m1',label:'Centro 1',activations:1}],byOrder:[{...metric,label:'OP1',activations:1,targetQuantity:100,totalOrderPieces:15,remainingPieces:85}],byArticle:[{...metric,label:'ART',activations:1}],intervals:[{...row,state:'PRODUCTION',seconds:40}],declarations:[{...row,kind:'PIECES',quantity:15,actor:'Ada',reason:'PRODUZIONE_MANUALE',note:'Test'}],machines:[{machineId:'m1',name:'Centro 1',department:'Torneria'}],operators:['Ada'],basis:'Dati registrati',historyTruncated:false};
ipcMain.handle('mes-analysis',()=>({ok:true,data:report}));
ipcMain.handle('select-output-file',()=>path.join(temp,'analisi.xlsx'));
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,width:1280,height:720,webPreferences:{nodeIntegration:true,contextIsolation:false}});
 try{
  await win.loadFile(path.resolve('dist-ts/pages/utilities/mes-analysis.html'));
  const run=s=>win.webContents.executeJavaScript(s);
  await run('load()');
  assert.match(await run('document.getElementById("report-body").textContent'),/Centro 1/);
  await run('document.querySelector("[data-report-tab=declarations]").click()');
  assert.match(await run('document.getElementById("report-body").textContent'),/Versamento pezzi/);
  assert.match(await run('document.getElementById("report-body").textContent'),/Ada/);
  await run('exportExcel()');
  const book=require('xlsx').readFile(path.join(temp,'analisi.xlsx'));
  assert.ok(book.SheetNames.includes('Dichiarazioni'));
  assert.ok(book.SheetNames.includes('Perimetro'));
  assert.equal(await run('tab'),'declarations');
  await run('document.querySelector("[data-report-tab=byOrder]").click()');
  assert.match(await run('document.getElementById("report-head").textContent'),/Rimanenti/);
  await run('document.querySelector("[data-sort=countedPieces]").click()');
  assert.equal(await run('sortKey'),'countedPieces');
  console.log('MES analysis UI and Excel export: OK');
 }catch(e){console.error(e);process.exitCode=1;}finally{win.destroy();app.exit(process.exitCode||0);}
});
