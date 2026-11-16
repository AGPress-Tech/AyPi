// Isolated SQLite archive + Electron form and print preview; no production writes.
const {app,BrowserWindow,ipcMain}=require('electron'),fs=require('fs'),path=require('path'),assert=require('assert/strict');
const root=path.resolve(__dirname,'..'),dir=path.join(root,'.tmp-transfer-recesso');fs.mkdirSync(dir,{recursive:true});
process.env.AYPI_BACKEND_PROFILE='dev';process.env.AYPI_DB_PATH=path.join(dir,'test-'+Date.now()+'.db');process.env.AYPI_LOG_DIR=dir;process.env.AYPI_FP_GENERAL_DIR=path.join(dir,'AGPRESS','General');process.env.AYPI_TRANSFER_DIR=path.join(dir,'AGPRESS','Transfer');fs.mkdirSync(process.env.AYPI_FP_GENERAL_DIR,{recursive:true});
app.setPath('userData',path.join(dir,'profile-'+Date.now()));app.commandLine.appendSwitch('disable-gpu');
const db=require('../backend-dist/shared/db/sqlite'),repo=require('../backend-dist/modules/transfer-attrezzaggio/repository');
app.whenReady().then(async()=>{
 const timeout=setTimeout(()=>{console.error('Timeout Transfer');app.exit(1)},45000);let win;
 try{
  await db.initializeSqliteDatabase();
  const legacy=repo.saveTransferItem({code:'ART - Fase: 1 - TRANSFER - A',codiceArticolo:'ART',fase:'1',codiceMacchina:'TRANSFER',metodo:'A',utensili:[{nrUnita:'1',iso:'ISO',descrizione:'Lavorazione',col4:'TM-01',col5:'P-01'}]});
  assert.equal(legacy.utensili[0].col15,'');
  let saved=null,preview=null;const errors=[];
  ipcMain.handle('show-message-box',()=>({response:0}));
  ipcMain.handle('transfer-attrezzaggio-list',()=>({ok:true,items:repo.listTransferItems()}));
  ipcMain.handle('transfer-attrezzaggio-load',(_e,p)=>({ok:true,item:repo.loadTransferItem(p.code)}));
  ipcMain.handle('transfer-attrezzaggio-save',(_e,p)=>{saved=repo.saveTransferItem(p);return {ok:true,item:saved,code:saved.code,recordId:saved.recordId};});
  ipcMain.handle('attrezzaggio-preview-pdf',(_e,p)=>{preview=p;return {ok:true};});
  win=new BrowserWindow({show:false,width:1520,height:960,webPreferences:{nodeIntegration:true,contextIsolation:false}});
  win.webContents.on('console-message',(_e,level,message)=>{if(level>=3)errors.push(message)});
  const run=code=>win.webContents.executeJavaScript(code,true),until=async code=>{const start=Date.now();while(Date.now()-start<10000){if(await run(code))return;await new Promise(r=>setTimeout(r,30))}throw Error('Timeout '+code)};
  await win.loadFile(path.join(root,'dist-ts/pages/attrezzaggio.html'));
  await run("document.querySelector('#openTransferTypeBtn').click();document.querySelector('#showListBtn').click()");await until("document.querySelector('#cardsList button')");
  await run("[...document.querySelectorAll('#cardsList button')].find(b=>b.textContent==='Modifica').click()");await until("!document.querySelector('#formView').classList.contains('hidden')");
  assert.deepEqual(await run("[...document.querySelectorAll('#utensiliTable th img')].map(i=>i.dataset.colIcon)"),['1','2','3','4','15','5','6','7','8','10','12','13','14']);
  assert.equal(await run("document.querySelector('[data-key=col15]').value"),'');
  await run("document.querySelector('[data-key=col15]').value='AR-42';document.querySelector('#saveFormBtn').click()");await until("document.querySelector('#methodIdLabel').textContent.includes('ART')");for(let i=0;!saved&&i<100;i++)await new Promise(r=>setTimeout(r,30));assert(saved);
  const stored=repo.loadTransferItem(saved.recordId);assert.equal(stored.utensili[0].col15,'AR-42');assert.equal(stored.utensili[0].col4,'TM-01');assert.equal(stored.utensili[0].col5,'P-01');
  await run("document.querySelector('#printFormBtn').click()");for(let i=0;!preview&&i<100;i++)await new Promise(r=>setTimeout(r,30));assert(preview);assert(preview.html.includes('Apparecchio Recesso'));assert(preview.html.includes('AR-42'));assert(preview.html.indexOf('Testa Multipla')<preview.html.indexOf('Apparecchio Recesso'));assert(preview.html.indexOf('Apparecchio Recesso')<preview.html.indexOf('Pulegge'));
  for(const [width,height] of [[1520,960],[1000,680]]){
   win.setContentSize(width,height);await run("document.querySelector('[data-key=col15]').scrollIntoView({block:'center',inline:'center'});new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))");
   const sizes=await run("[...document.querySelectorAll('#utensiliTable th img')].map(i=>({width:i.width,height:i.height,loaded:i.complete&&i.naturalWidth>0}))");assert(sizes.every(s=>s.width===48&&s.height===48&&s.loaded));
   fs.writeFileSync(path.join(dir,'transfer-'+width+'.png'),(await win.webContents.capturePage()).toPNG());
  }
  assert.deepEqual(errors,[]);console.log('OK: colonna Recesso ordinata, icona 48px, schede precedenti, salvataggio/rilettura SQLite e stampa, Electron normale/minimo.');
 }catch(error){console.error(error);process.exitCode=1}finally{clearTimeout(timeout);win?.destroy();db.closeSqliteDatabase();app.exit(process.exitCode||0)}
});
