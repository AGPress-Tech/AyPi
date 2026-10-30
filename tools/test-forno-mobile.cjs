/* Bundle browser Android: nessun Node nel renderer, backend e bridge simulati. */
const electron=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
if(typeof electron==='string'){
    const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
    const run=require('node:child_process').spawnSync(electron,[__filename],{env,windowsHide:true,stdio:'inherit',timeout:60000});process.exit(run.status??1);
}
const {app,BrowserWindow,ipcMain}=electron;
app.disableHardwareAcceleration();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{
    const {buildFornoMobile}=require('./build-forno-mobile.cjs');
    const folder=path.resolve('.tmp-mobile-forno-test'),assets=await buildFornoMobile(path.join(folder,'assets'));
    const preload=path.join(folder,'preload.cjs');
    fs.writeFileSync(preload,"const {ipcRenderer}=require('electron');window.AyPiForno={request(id,channel,payload){ipcRenderer.invoke('mobile-forno-request',channel,JSON.parse(payload)).then(value=>window.__aypiResolve(id,true,JSON.stringify(value)),error=>window.__aypiResolve(id,false,error.message));}};");
    const calls=[],savedNotes=[];
    const phase=(number,type,extra={})=>({number,name:String(number),type,durationSeconds:0,targets:[200],rampSeconds:[3600],rates:[.1],endType:1,holdback:[0],goBackTo:1,cycles:1,...extra});
    ipcMain.handle('mobile-forno-request',(_event,channel,input)=>{
        calls.push({channel,input});const now=Date.now();
        if(channel==='forno-status')return {enabled:true,running:true,intervalMs:500,serverTimeMs:now,channels:[311,309.8,307.7,null].map((temperature,i)=>({id:i+1,name:'Canale '+(i+1),temperature,timestampMs:now,quality:i===3?'off':'good'})),lastSample:{timestampMs:now,temperature:311,quality:'good'}};
        if(channel==='forno-history'){
            assert(input.toMs-input.fromMs<=366*86400000);const interval=Math.max(input.intervalMs,Math.ceil((input.toMs-input.fromMs)/600/500)*500);
            const count=Math.min(600,Math.floor((input.toMs-input.fromMs)/interval)+1);
            const channels=[0,2,-3,null].map((shift,i)=>({id:i+1,name:'Canale '+(i+1),buckets:Array.from({length:count},(_,n)=>{const t=input.toMs-(count-1-n)*interval,v=shift===null?null:300+shift+Math.sin(n/45)*12;return {fromMs:t,toMs:t+interval-1,samples:2,valid:v===null?0:2,missing:v===null?2:0,min:v,max:v===null?null:v+1,mean:v,first:v,last:v,firstTime:t,lastTime:t+500};}),stats:{samples:1200,valid:shift===null?0:1200,missing:shift===null?1200:0,min:280,max:320,mean:300,delta:40}}));
            return {channels,effectiveIntervalMs:interval,snapshotMs:now};
        }
        if(channel==='forno-messages')return {notes:savedNotes,events:[],truncated:false};
        if(channel==='forno-sample')return {timestampMs:input.timestampMs,requestedMs:input.timestampMs,channels:[311,309.8,307.7,null].map((temperature,i)=>({id:i+1,name:'Canale '+(i+1),temperature,quality:i===3?'off':'good'})),mean:309.5};
        if(channel==='forno-programs-list')return {programs:['Ciclo_2_375_8h30m'],scope:'current',mode:2,readAtMs:now};
        if(channel==='forno-program-preview'){assert(!input.allowTemporaryLoad);return {name:input.name,readAtMs:now,channels:1,rampStyle:0,rampUnits:[0],servoTo:[0],holdback:[],segments:[phase(1,1),phase(2,2,{durationSeconds:3600}),phase(3,1,{targets:[375]}),phase(4,2,{durationSeconds:14400}),phase(5,0)]};}
        if(channel==='forno-analysis'){
            const one=(id)=>({id,name:id?'Canale '+id:'Tutti i canali',stats:{samples:100,valid:100,missing:0,min:300,max:315,mean:307,delta:15},windows:{count:20,meanDelta:2,maxDelta:null}});
            return {...input,combined:one(0),channels:[1,2,3,4].map(one)};
        }
        if(channel==='forno-note-save'){const note={id:'test-note',timestampMs:input.timestampMs,text:input.text,author:'Operatore mobile',revision:1,createdAt:now,updatedAt:now,editedBy:'Operatore mobile'};savedNotes.push(note);return note;}
        throw Error('Unexpected command '+channel);
    });
    const server=require('node:http').createServer((req,res)=>{
        const name=new URL(req.url,'http://localhost').pathname;
        const file=path.resolve(assets,'.'+name);
        if(!file.startsWith(assets+path.sep)){res.writeHead(404);res.end();return;}
        try{res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file));}catch{res.writeHead(404);res.end();}
    });
    await new Promise(r=>server.listen(0,'127.0.0.1',r));
    const win=new BrowserWindow({show:false,width:390,height:740,useContentSize:true,webPreferences:{preload,nodeIntegration:false,contextIsolation:false,sandbox:false,backgroundThrottling:false}});
    win.webContents.debugger.attach('1.3');
    const viewport=async(width,height)=>{
        win.setContentSize(width,height);
        await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:2.75,mobile:true,screenWidth:width,screenHeight:height});
        await sleep(120);
    };
    const errors=[];win.webContents.on('console-message',(_e,level,message)=>{if(level>=3)errors.push(message);});
    await win.loadURL('http://127.0.0.1:'+server.address().port+'/pages/forno.html?mobile=1');await sleep(900);
    await viewport(390,740);
    const js=code=>win.webContents.executeJavaScript(code);
    assert(await js("typeof require==='undefined'&&document.documentElement.dataset.platform==='android'"));
    assert(await js("devicePixelRatio>=2&&visualViewport.scale===1"));
    assert(await js("document.getElementById('temperature').textContent.includes('311')"));
    assert(await js("document.getElementById('status').textContent.includes('Risoluzione visualizzata')&&!document.getElementById('status').textContent.includes('Dati non aggiornati')"));
    await js("window.__aypiToggleFullscreen()");await sleep(100);
    assert(await js("document.querySelector('.plot').getBoundingClientRect().height>400"));
    fs.writeFileSync(path.join(folder,'forno-schermo-intero.png'),(await win.webContents.capturePage()).toPNG());
    await js("window.__aypiToggleFullscreen()");
    const checkDialog=async(id)=>{
        const rect=await js(`(()=>{const d=document.getElementById(${JSON.stringify(id)}),r=d.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom,scroll:d.scrollWidth,client:d.clientWidth,vw:innerWidth,vh:innerHeight}})()`);
        assert(rect.width>=rect.vw*.9&&rect.height>=rect.vh*.85,JSON.stringify(rect));
        assert(rect.x>=0&&rect.y>=0&&rect.right<=rect.vw+1&&rect.bottom<=rect.vh+1,JSON.stringify(rect));
        assert(rect.scroll<=rect.client+1,JSON.stringify(rect));
    };
    for(const [width,height]of [[320,600],[360,640],[390,740],[844,330],[768,960]]){
        await viewport(width,height);
        await js("window.scrollTo(0,0);document.body.scrollTop=0");
        const size=await js("({width:innerWidth,scroll:document.documentElement.scrollWidth,plot:document.querySelector('.plot').getBoundingClientRect().width})");
        assert(size.scroll<=size.width,JSON.stringify(size));assert(size.plot>220,JSON.stringify(size));
        const header=await js("Array.from(document.querySelectorAll('.topbar-actions > *, .live-channel')).filter(e=>e.getClientRects().length).map(e=>{const r=e.getBoundingClientRect();return {id:e.id||e.className,left:r.left,right:r.right,width:innerWidth}})");
        assert(header.every(r=>r.left>=0&&r.right<=r.width+1),JSON.stringify(header));
        assert(await js(`document.querySelector('.plot').getBoundingClientRect().height>=${width>height?300:360}`));
        await js("document.getElementById('open-options').click()");await checkDialog('options-dialog');await sleep(120);
        fs.writeFileSync(path.join(folder,`impostazioni-${width}.png`),(await win.webContents.capturePage()).toPNG());
        await js("document.getElementById('options-dialog').close();document.querySelector('.chart-panel').scrollIntoView({block:'center'})");
        await js("window.__aypiToggleFullscreen()");await sleep(100);
        const focus=await js("(()=>{const p=document.querySelector('.plot').getBoundingClientRect(),c=document.getElementById('chart').getBoundingClientRect();return {top:p.top,bottom:p.bottom,height:p.height,canvas:c.height,viewport:innerHeight,scroll:window.scrollY+document.body.scrollTop}})()");
        assert(focus.top>=0&&focus.bottom<=focus.viewport&&focus.height>100&&focus.canvas>100&&focus.scroll===0,JSON.stringify(focus));
        fs.writeFileSync(path.join(folder,`fullscreen-${width}.png`),(await win.webContents.capturePage()).toPNG());
        // Rotazione mentre il grafico è espanso, poi uscita e rientro.
        await viewport(height,width);await sleep(80);
        assert(await js("document.getElementById('chart').getBoundingClientRect().height>100&&document.querySelector('.plot').getBoundingClientRect().bottom<=innerHeight"));
        await js("window.__aypiToggleFullscreen()");await viewport(width,height);
        fs.writeFileSync(path.join(folder,`forno-${width}.png`),(await win.webContents.capturePage()).toPNG());
    }
    await viewport(390,740);await js("window.scrollTo(0,0);document.body.scrollTop=0");
    await js("document.getElementById('open-programs').click();document.getElementById('list-programs').click()");await sleep(150);
    assert.equal(await js("document.getElementById('programs-title').textContent"),'Ciclo in lavorazione');
    await js("document.querySelector('.stored-program-button').click()");await sleep(150);
    assert.equal(await js("document.querySelector('.recipe-duration strong').textContent"),'7 h');
    assert(await js("document.getElementById('programs-dialog').scrollWidth<=document.getElementById('programs-dialog').clientWidth"));
    fs.writeFileSync(path.join(folder,'ciclo-mobile.png'),(await win.webContents.capturePage()).toPNG());
    await js("document.getElementById('programs-dialog').close();document.querySelector('.chart-panel').scrollIntoView({block:'center'})");await sleep(100);
    const cdp=(type,points)=>win.webContents.debugger.sendCommand('Input.dispatchTouchEvent',{type,touchPoints:points});
    const bounds=await js("(()=>{const r=document.getElementById('chart').getBoundingClientRect();return {x:r.left+r.width*.35,y:r.top+r.height*.5,right:r.left+r.width*.75}})()");
    const touch=(x,id=1)=>({x,y:bounds.y,id});
    const previousHistory=calls.filter(c=>c.channel==='forno-history').length;
    await cdp('touchStart',[touch(bounds.x)]);await cdp('touchMove',[touch(bounds.x+30)]);await sleep(30);await cdp('touchEnd',[]);await sleep(220);
    assert.equal(await js("document.getElementById('live').checked"),false);assert(calls.filter(c=>c.channel==='forno-history').length>previousHistory);
    const beforePinch=await js("document.getElementById('range-label').textContent");
    await cdp('touchStart',[touch(bounds.x,1),touch(bounds.right,2)]);
    await cdp('touchMove',[touch(bounds.x-12,1),touch(bounds.right+12,2)]);await sleep(30);await cdp('touchEnd',[]);await sleep(150);
    assert.notEqual(await js("document.getElementById('range-label').textContent"),beforePinch,'Pinch senza aggiornamento della vista');
    await js("document.querySelector('button[data-touch-mode=analysis]').click()");
    await cdp('touchStart',[touch(bounds.x)]);await cdp('touchMove',[touch(bounds.right)]);await sleep(30);await cdp('touchEnd',[]);await sleep(180);
    assert(await js("document.getElementById('report').open"));assert(calls.some(c=>c.channel==='forno-analysis'));await checkDialog('report');
    fs.writeFileSync(path.join(folder,'analisi-mobile.png'),(await win.webContents.capturePage()).toPNG());
    await js("document.getElementById('report').close();document.querySelector('button[data-touch-mode=inspect]').click()");
    await cdp('touchStart',[touch(bounds.x)]);await cdp('touchEnd',[]);await sleep(500);
    assert(calls.some(c=>c.channel==='forno-sample'));
    await js("document.querySelector('.mobile-touch-actions button:last-child').click();document.getElementById('add-chart-note').click()");await sleep(100);
    assert(await js("document.getElementById('note-editor').open"));
    await js("document.getElementById('note-text').value='Nota dal telefono';document.getElementById('note-form').requestSubmit()");await sleep(100);
    assert.equal(savedNotes[0].text,'Nota dal telefono');
    await js("window.__aypiSetActive(false)");await sleep(150);const paused=calls.length;await sleep(1300);assert.equal(calls.length,paused,'Richieste ancora attive in background');
    await js("window.__aypiSetActive(true)");await sleep(1200);assert(calls.length>paused);
    assert.deepEqual(errors,[]);
    console.log('OK: renderer browser Android senza Node, layout telefono/tablet/landscape, cicli in Run, pan touch, analisi, lettura puntuale e pausa in background. Anteprime: '+folder);
    win.destroy();await new Promise(r=>server.close(r));app.exit(0);
}).catch(error=>{console.error(error);app.exit(1);});
