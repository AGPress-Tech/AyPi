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
 require('../dist-ts/modules/forgeHub').setupForgeHub();
 const mesRequests=[],robotRequests=[];let pings=0;
 ipcMain.on('open-production-planner-window',(_e,p)=>mesRequests.push(p));
 ipcMain.on('mostra-robot-popup',(_e,...args)=>robotRequests.push(args));
 ipcMain.handle('ping-robot-dialog',()=>{pings++;});
 for(const theme of ['agpress','bluearchive']){
  const main=new BrowserWindow({show:false,width:1400,height:900,webPreferences:{nodeIntegration:true,contextIsolation:false,offscreen:true}});
  await main.loadFile(path.resolve('dist-ts/pages/bluearchive-preview.html'),{query:{theme}});
  await main.webContents.executeJavaScript("document.getElementById('startupSequence').click();document.querySelector('[data-page=\"mes-scada\"]').click()");
  await delay(450);
  const selector='#open-forge';
  assert(await main.webContents.executeJavaScript(`(()=>{const b=document.querySelector(${JSON.stringify(selector)});return !!b&&b.getClientRects().length>0&&getComputedStyle(b).display!=='none'})()`),`Pulsante forno assente in ${theme}`);
  await main.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(selector)}).click()`);
  let hub;
  for(let i=0;i<50;i++){hub=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('/forge.html'));if(hub&&!hub.webContents.isLoading())break;await delay(100);}
  assert(hub,'Hub FORGE assente');await delay(150);
  const moduleTheme=theme==='agpress'?'standard':'bluearchive';
  assert.equal(await hub.webContents.executeJavaScript('document.documentElement.dataset.forgeTheme'),moduleTheme);
  assert((maximizations.get(hub.id)||0)>=1,'FORGE non massimizzato');
  assert.equal(await main.webContents.executeJavaScript("document.querySelectorAll('#pageContent .module-card').length"),0);
  assert(await main.webContents.executeJavaScript("(()=>{const f=document.querySelector('.forge-landing-footer').getBoundingClientRect(),p=document.querySelector('.forge-landing').getBoundingClientRect();return f.bottom<=p.bottom+1&&f.left>=p.left})()"),'Footer FORGE fuori dal contenitore');
  assert.equal(await hub.webContents.executeJavaScript("document.querySelectorAll('#forge-overview .forge-module').length"),3);
  assert.equal(await hub.webContents.executeJavaScript("document.getElementById('forge-future-editor').hidden"),theme==='agpress');
  hub.setSize(900,700);await delay(80);
  assert(await hub.webContents.executeJavaScript('document.documentElement.scrollWidth<=innerWidth'),'FORGE eccede la larghezza minima');
  hub.setSize(1400,900);await delay(80);
  await main.webContents.executeJavaScript("document.getElementById('open-forge').click()");await delay(70);
  assert.equal(BrowserWindow.getAllWindows().filter(w=>w.webContents.getURL().includes('/forge.html')).length,1);
  await hub.webContents.executeJavaScript("document.getElementById('forge-open-mes').click();document.getElementById('forge-open-robots').click()");await delay(70);
  assert.equal(mesRequests.at(-1).theme,moduleTheme);
  assert(await hub.webContents.executeJavaScript("!document.getElementById('forge-robots').hidden&&document.getElementById('forge-overview').hidden"));
  await hub.webContents.executeJavaScript("document.getElementById('show21D500').click();document.getElementById('show21D600').click();document.getElementById('show21D850').click();document.getElementById('pingRobots').click()");await delay(100);
  assert.deepEqual(robotRequests.slice(-3),[
   ['21D500','http://192.168.1.153/index1.html','STATO ROBOT P21160'],
   ['21D600','http://192.168.1.152/index1.html','STATO ROBOT P17259'],
   ['21D850','http://192.168.1.92/index1.html','STATO ROBOT P22022'],
  ]);assert.equal(pings,theme==='agpress'?1:2);
  fs.writeFileSync(path.join(output,theme+'-robots.png'),(await hub.webContents.capturePage()).toPNG());
  await hub.webContents.executeJavaScript("document.getElementById('forge-home').click()");await delay(100);
  fs.writeFileSync(path.join(output,theme+'-hub.png'),(await hub.webContents.capturePage()).toPNG());
  await hub.webContents.executeJavaScript("document.getElementById('forge-open-forno').click()");
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
  await hub.webContents.executeJavaScript("document.getElementById('forge-open-forno').click()");await delay(100);
  assert.equal(BrowserWindow.getAllWindows().filter(w=>w.webContents.getURL().includes('/forno.html')).length,1);
  assert.equal(forno.id,id);assert((maximizations.get(id)||0)>maxBefore,'Finestra non massimizzata alla riapertura');
  assert(await forno.webContents.executeJavaScript("!document.getElementById('back-to-robot')"));
  hub.close();await delay(80);assert(!forno.isDestroyed(),'La chiusura FORGE non deve chiudere il forno');
  forno.close();await delay(150);
  assert(forno.isDestroyed());assert(main.webContents.getURL().includes('bluearchive-preview.html'));
  fs.writeFileSync(path.join(output,theme+'.png'),(await main.webContents.capturePage()).toPNG());
  main.destroy();console.log('OK:',theme,'FORGE, tema, tre moduli, robot/ping invariati, forno indipendente e finestre riutilizzate');
 }
 const legacy=new BrowserWindow({show:false,width:1200,height:850,webPreferences:{nodeIntegration:true,contextIsolation:false,offscreen:true}});
 await legacy.loadFile(path.resolve('dist-ts/pages/robot.html'));await delay(500);
 assert(legacy.webContents.getURL().includes('/mes-scada.html'),'Il vecchio link robot non reindirizza');
 assert(await legacy.webContents.executeJavaScript("!!document.getElementById('open-forge')&&!document.getElementById('show21D500')"));
 fs.writeFileSync(path.join(output,'legacy-landing.png'),(await legacy.webContents.capturePage()).toPNG());legacy.destroy();
 console.log('Screenshot FORGE:',output);http.close();app.exit(0);
}).catch(e=>{console.error(e);app.exit(1)});
