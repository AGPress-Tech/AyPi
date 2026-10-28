/* Regressione: il vero launcher condiviso deve aprire il forno in entrambi i temi. */
const fs=require('fs'),os=require('os'),path=require('path'),assert=require('assert');
const electron=require('electron');
if(typeof electron==='string'){
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 const result=require('child_process').spawnSync(electron,[__filename],{env,windowsHide:true,stdio:'inherit',timeout:30000});process.exit(result.status??1);
}
const {app,BrowserWindow,ipcMain}=electron;
const output=fs.mkdtempSync(path.join(os.tmpdir(),'aypi-forno-launcher-'));
app.on('window-all-closed',()=>{});
app.setPath('userData',output);app.disableHardwareAcceleration();
const delay=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{
 const maximizations=new Map();
 BrowserWindow.prototype.maximize=function(){maximizations.set(this.id,(maximizations.get(this.id)||0)+1)};
 BrowserWindow.prototype.show=function(){};
 const http=require('http').createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(req.url.includes('/status')?{enabled:true,running:true,intervalMs:500,serverTimeMs:Date.now()}:{buckets:[],stats:{valid:0},effectiveIntervalMs:1000}));});
 await new Promise(r=>http.listen(0,'127.0.0.1',r));
 process.env.AYPI_FP_BACKEND_URL=`http://127.0.0.1:${http.address().port}/api/ferie-permessi`;
 ipcMain.handle('get-app-version',()=>app.getVersion());ipcMain.handle('admin-is-enabled',()=>false);
 require('../dist-ts/modules/fornoReader').setupFornoReader();
 for(const theme of ['agpress','bluearchive']){
  const main=new BrowserWindow({show:false,width:1400,height:900,webPreferences:{nodeIntegration:true,contextIsolation:false,offscreen:true}});
  await main.loadFile(path.resolve('dist-ts/pages/bluearchive-preview.html'),{query:{theme}});
  await main.webContents.executeJavaScript("document.querySelector('[data-page=robot]').click()");
  await delay(450);
  const selector='.module-card[data-label="Forno — Temperature e cicli"]';
  assert(await main.webContents.executeJavaScript(`(()=>{const b=document.querySelector(${JSON.stringify(selector)});return !!b&&b.getClientRects().length>0&&getComputedStyle(b).display!=='none'})()`),`Pulsante forno assente in ${theme}`);
  await main.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(selector)}).click()`);
  let forno;
  for(let i=0;i<50;i++){forno=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/forno.html'));if(forno&&!forno.webContents.isLoading())break;await delay(100);}
  assert(forno,`Finestra forno assente in ${theme}`);await delay(200);
  assert((maximizations.get(forno.id)||0)>=1,'Finestra non massimizzata all apertura');
  await forno.webContents.executeJavaScript("document.getElementById('skip-forno-splash').click()");await delay(900);
  assert(await forno.webContents.executeJavaScript("!!document.getElementById('chart')"));
  const expectedDivisions=theme==='agpress'?8:12;
  const loadedPrefs=await forno.webContents.executeJavaScript("require('electron').ipcRenderer.invoke('forno-view-settings-load')");
  assert.equal(loadedPrefs.settings.xDivisions,expectedDivisions);
  if(theme==='agpress') {
      await forno.webContents.executeJavaScript("document.getElementById('open-options').click();document.getElementById('opt-x-divisions').value='12';document.getElementById('options-form').requestSubmit()");
      await delay(150);
      assert.equal(JSON.parse(fs.readFileSync(loadedPrefs.path,'utf8')).xDivisions,12);
  }
  const id=forno.id;const maxBefore=maximizations.get(id)||0;
  await main.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(selector)}).click()`);await delay(100);
  assert.equal(BrowserWindow.getAllWindows().filter(w=>w.webContents.getURL().includes('/forno.html')).length,1);
  assert.equal(forno.id,id);assert((maximizations.get(id)||0)>maxBefore,'Finestra non massimizzata alla riapertura');
  assert(await forno.webContents.executeJavaScript("!document.getElementById('back-to-robot')"));
  forno.close();await delay(150);
  assert(forno.isDestroyed());assert(main.webContents.getURL().includes('bluearchive-preview.html'));
  fs.writeFileSync(path.join(output,theme+'.png'),(await main.webContents.capturePage()).toPNG());
  main.destroy();console.log('OK:',theme,'pulsante visibile, grafico aperto, finestra riutilizzata e chiusura standard');
 }
 http.close();app.exit(0);
}).catch(e=>{console.error(e);app.exit(1)});
