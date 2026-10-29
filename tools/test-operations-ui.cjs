/* Chrome e console robot, con IPC simulato e nessun accesso agli impianti. */
const fs=require('fs'),os=require('os'),path=require('path'),assert=require('node:assert/strict');
const electron=require('electron');
if(typeof electron==='string'){
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 const r=require('child_process').spawnSync(electron,[__filename],{env,windowsHide:true,stdio:'inherit',timeout:20000});process.exit(r.status??1);
}
const {app,BrowserWindow,ipcMain}=electron,delay=ms=>new Promise(r=>setTimeout(r,ms));
const output=fs.mkdtempSync(path.join(os.tmpdir(),'aypi-operations-ui-'));
app.disableHardwareAcceleration();app.setPath('userData',output);app.on('window-all-closed',()=>{});
app.whenReady().then(async()=>{
 ipcMain.handle('robot-status-custom',async(_e,id)=>{await delay(700);return {ok:true,robotId:id,ip:'127.0.0.1',program:'Programma test',state:'AUTO',counter:'1250',cycleTime:'32'};});
 ipcMain.handle('ping-robot-custom',async(_e,id)=>{await delay(700);return {ok:true,robotId:id,ip:'127.0.0.1',reachable:true,summary:'Verifica simulata'};});
 let mesHeader;
 for(const theme of ['standard','bluearchive']){
  const win=new BrowserWindow({show:false,width:1400,height:900,webPreferences:{offscreen:true,nodeIntegration:true,contextIsolation:false,backgroundThrottling:false}});
  await win.loadFile(path.resolve('dist-ts/pages/forge.html'),{query:{theme}});await delay(120);
  assert(await win.webContents.executeJavaScript("!document.getElementById('forge-splash').hidden&&document.querySelector('.forge-workspace').inert"));
  await delay(700);fs.writeFileSync(path.join(output,theme+'-splash.png'),(await win.webContents.capturePage()).toPNG());
  if(theme==='standard')await win.webContents.executeJavaScript("document.getElementById('skip-forge-splash').click()");
  for(let i=0;i<40;i++){if(await win.webContents.executeJavaScript("document.getElementById('forge-splash').hidden"))break;await delay(100);}
  assert(await win.webContents.executeJavaScript("document.getElementById('forge-splash').hidden&&!document.querySelector('.forge-workspace').inert"));
  assert(await win.webContents.executeJavaScript("getComputedStyle(document.querySelector('.aypi-module-logo')).fontFamily.includes('Trebuchet')"));
  // Let the compositor paint the first frame after the splash unlocks.
  await delay(100);
  fs.writeFileSync(path.join(output,theme+'-hub.png'),(await win.webContents.capturePage()).toPNG());
  for(const width of [900,1920]){
   win.setSize(width,1000);await delay(100);
   assert(await win.webContents.executeJavaScript("document.documentElement.scrollWidth<=window.innerWidth&&[...document.querySelectorAll('#forge-overview .forge-module')].every(card=>card.scrollWidth<=card.clientWidth)"),'Hub must fit at '+width+'px');
   fs.writeFileSync(path.join(output,theme+'-hub-'+width+'.png'),(await win.webContents.capturePage()).toPNG());
  }
  win.setSize(1400,900);await delay(50);
  win.webContents.debugger.attach('1.3');
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  assert(await win.webContents.executeJavaScript("[...document.querySelectorAll('.forge-model-lift,.forge-flow-line,.forge-node-pulse,.forge-ambient-orbit')].every(node=>getComputedStyle(node).animationName==='none')"),'Decorative motion must respect reduced motion');
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[]});
  win.webContents.debugger.detach();
  await win.webContents.executeJavaScript("document.getElementById('forge-open-robots').click();document.getElementById('show21D500').click()");await delay(200);
  assert(await win.webContents.executeJavaScript("!document.getElementById('robotConsoleLoading').hidden&&getComputedStyle(document.querySelector('.robot-radar-ring:nth-child(2)')).animationName==='slowSpin'"));
  fs.writeFileSync(path.join(output,theme+'-robot-loading.png'),(await win.webContents.capturePage()).toPNG());
  await delay(800);
  assert(await win.webContents.executeJavaScript("document.getElementById('robotResultGrid').textContent.includes('Programma test')"));
  fs.writeFileSync(path.join(output,theme+'-robot-result.png'),(await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript("document.getElementById('robotConsoleDone').click();document.getElementById('pingRobots').click()");await delay(250);
  assert(await win.webContents.executeJavaScript("!document.getElementById('robotConsoleSelector').hidden"));
  fs.writeFileSync(path.join(output,theme+'-ping-selector.png'),(await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript("document.querySelector('[data-robot-ping=\"21D500\"]').click()");await delay(80);
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});await delay(50);
  assert(await win.webContents.executeJavaScript("document.getElementById('robotConsoleBackdrop').getAttribute('aria-hidden')==='true'&&!document.getElementById('forge-robots').hidden"));
  await delay(800);assert(await win.webContents.executeJavaScript("document.getElementById('robotConsoleBackdrop').getAttribute('aria-hidden')==='true'"));win.destroy();
  // Run MES startup/theme scripts, with no operational scripts or backend access.
  const mes=new BrowserWindow({show:false,width:1600,height:900,webPreferences:{offscreen:true,backgroundThrottling:false,partition:'mes-style-'+theme}});
  mes.webContents.session.webRequest.onBeforeRequest((request,callback)=>callback({cancel:(request.resourceType==='script'&&!/\/(utility-layout-bootstrap|production-planner-entry)\.js(?:\?|$)/.test(request.url))||/^https?:/.test(request.url)}));
  await mes.loadFile(path.resolve('dist-ts/pages/utilities/production-planner.html'),{query:{theme,plannerSplash:'1'}});await delay(100);
  assert(await mes.webContents.executeJavaScript("!document.getElementById('planner-splash')&&!document.body.classList.contains('planner-splash-active')&&getComputedStyle(document.querySelector('.planner-app')).visibility==='visible'&&getComputedStyle(document.querySelector('.planner-app')).opacity==='1'"),'MES must open directly, including with legacy splash links');
  const header=await mes.webContents.executeJavaScript("(()=>{const h=getComputedStyle(document.querySelector('.topbar')),l=getComputedStyle(document.querySelector('.planner-aypi-logo'));return {background:h.backgroundImage,color:h.color,font:l.fontFamily}})()");
  assert(header.font.includes('Trebuchet'));if(mesHeader)assert.deepEqual(header,mesHeader);mesHeader=header;
  fs.writeFileSync(path.join(output,theme+'-mes.png'),(await mes.webContents.capturePage()).toPNG());mes.destroy();
 }
 console.log('OK: header/logo comuni, animazioni robot, annullamento e MES con stile unico. Screenshot:',output);app.exit(0);
}).catch(error=>{console.error(error);app.exit(1)});
