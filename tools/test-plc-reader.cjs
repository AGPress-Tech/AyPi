/* Integration QA: real Electron IPC, Node collector lifecycle and layout at three widths. */
const {app,BrowserWindow}=require('electron');
const path=require('path');
const fs=require('fs');
const os=require('os');
const output=fs.mkdtempSync(path.join(os.tmpdir(),'aypi-plc-qa-'));
app.setPath('userData',output);
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const assert=(condition,message)=>{if(!condition)throw new Error(message)};
app.whenReady().then(async()=>{
    // Nessun dato DEMO deve raggiungere il backend aziendale durante i test.
    const backend=require('http').createServer((req,res)=>{req.resume();res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true,totalRows:0,insertedEvents:0}));});
    await new Promise(resolve=>backend.listen(0,'127.0.0.1',resolve));
    process.env.AYPI_FP_BACKEND_URL='http://127.0.0.1:'+backend.address().port+'/api/ferie-permessi';
    BrowserWindow.prototype.show=function(){};
    BrowserWindow.prototype.maximize=function(){};
    let main,reader;
    try {
        main=new BrowserWindow({show:false,webPreferences:{nodeIntegration:true,contextIsolation:false}});
        require('../dist-ts/modules/plcReader').setupPlcReader(main);
        await main.loadURL('data:text/html,<body>QA</body>');
        await main.webContents.executeJavaScript("require('electron').ipcRenderer.send('open-plc-reader-window')");
        for(let i=0;i<100;i++){reader=BrowserWindow.getAllWindows().find(w=>w!==main);if(reader&&!reader.webContents.isLoading())break;await pause(100);}
        assert(reader,'Module window did not open');
        reader.webContents.setBackgroundThrottling(false);
        let errors=[];
        reader.webContents.on('console-message',(_e,level,message)=>{if(level===3)errors.push(message)});
        const evaluate=source=>reader.webContents.executeJavaScript(source);
        let snap;
        for(let i=0;i<80;i++){
            snap=await evaluate("require('electron').ipcRenderer.invoke('plc-reader-snapshot')");
            if(snap.machines.length===10)break;
            await pause(200);
        }
        assert(snap.machines.length===10,'Expected ten assets');
        assert(snap.machines.some(m=>m.code==='21D700'&&m.device?.frame_id==='0x8003'),'21D700 provisional mapping missing');
        assert(snap.flows.some(f=>f.machine==='21D700'&&f.fid==='0x8003'),'21D700 flow label missing');
        console.log('ROBOTS',JSON.stringify(snap.machines.filter(m=>m.asset_type==='robot').map(m=>({code:m.code,online:m.online,program:m.program}))));
        if(!process.env.AYPI_PLC_SKIP_INTERFACES){
            const interfaces=await evaluate(`require('electron').ipcRenderer.invoke('plc-reader-interfaces')`);
            assert(interfaces.length>0,'No acquisition interface detected');console.log('INTERFACES',interfaces.length);
        }
        await evaluate(`require('electron').ipcRenderer.invoke('plc-reader-control',{action:'start',mode:'DEMO',adapter:''})`);
        for(let i=0;i<50;i++){snap=await evaluate("require('electron').ipcRenderer.invoke('plc-reader-snapshot')");if(snap.machines.some(m=>m.pulses>0))break;await pause(200);}
        assert(!snap.session.error,snap.session.error);
        assert(snap.machines.some(m=>m.pulses>0),'Demo has not produced pulses');
        await evaluate("require('electron').ipcRenderer.invoke('plc-reader-marker',{machine:'21D500',note:'QA marker robot'})");
        await pause(1500);
        const events=await evaluate("require('electron').ipcRenderer.invoke('plc-reader-events')");
        assert(events.some(e=>e.kind==='MARCATORE'&&e.machine==='21D500'),'Robot marker missing');
        for(const [width,height] of [[1920,1080],[1440,900],[1000,700]]){
            reader.setSize(width,height);await pause(400);
            const layout=await evaluate(`(()=>{const strip=document.getElementById('overview-cards');return {cards:strip.querySelectorAll('.machine-card').length,clipped:[...document.querySelectorAll('.machine-card')].filter(c=>c.getClientRects().length&&c.lastElementChild?.getBoundingClientRect().bottom>c.getBoundingClientRect().bottom-4).length,horizontalOverflow:document.documentElement.scrollWidth>innerWidth+2,canScroll:strip.scrollWidth>strip.clientWidth,errors:document.getElementById('session-banner').textContent}})()`);
            if(layout.clipped){console.log('CLIPPED',width,await evaluate("[...document.querySelectorAll('.machine-card')].filter(c=>c.scrollHeight>c.clientHeight+2).map(c=>({code:c.querySelector('.mc-code').textContent,scroll:c.scrollHeight,height:c.clientHeight}))"));fs.writeFileSync(path.join(output,'failure.png'),(await reader.webContents.capturePage()).toPNG());console.log('FAILURE IMAGE',output);}
            assert(layout.cards===10,'Missing rendered cards');assert(!layout.clipped,'Card content clipped');assert(!layout.horizontalOverflow,'Page overflows horizontally');assert(layout.canScroll,'Carousel does not scroll');
            for(const view of ['overview','machines','signals','events']){
                await evaluate(`document.querySelector('[data-view=${view}]').click()`);
                const geometry=await evaluate(`(()=>{const page=document.getElementById('view-${view}');const panel=page.querySelector('.bottom-grid')||page.querySelector('.full-panel:last-child')||page.querySelector('.cards-interior');return {overflow:page.scrollHeight-page.clientHeight,bottom:panel?.getBoundingClientRect().bottom,limit:page.getBoundingClientRect().bottom};})()`);
                assert(geometry.overflow<=2,`${view} scrolls vertically at ${width}: ${JSON.stringify(geometry)}`);
                assert(!geometry.bottom||geometry.bottom<=geometry.limit+2,`${view} panel outside viewport at ${width}`);
            }
            await evaluate("document.querySelector('[data-view=overview]').click()");
            console.log('LAYOUT',width,JSON.stringify(layout));
        }
        reader.setSize(1920,1080);await pause(200);
        // A hidden QA window does not animate compositor smooth-scroll frames.
        await evaluate("(()=>{const strip=document.getElementById('overview-cards');const nativeScroll=strip.scrollBy.bind(strip);strip.scrollBy=options=>nativeScroll({...options,behavior:'instant'});})()");
        console.log('BEFORE ARROW',await evaluate("({disabled:document.getElementById('assets-next').disabled,width:document.getElementById('overview-cards').clientWidth,total:document.getElementById('overview-cards').scrollWidth})"));
        await evaluate("document.getElementById('assets-next').click()");await pause(600);
        const scrollBefore=await evaluate("document.getElementById('overview-cards').scrollLeft");
        await pause(1500);
        const scrollAfter=await evaluate("document.getElementById('overview-cards').scrollLeft");
        console.log('SCROLL',scrollBefore,scrollAfter);
        assert(scrollBefore>0&&Math.abs(scrollBefore-scrollAfter)<3,'Carousel position lost during refresh');
        await evaluate("document.getElementById('overview-cards').scrollLeft=137;window.__qaCard=document.querySelector('#overview-cards .machine-card');window.__qaCounter=window.__qaCard.querySelector('.mc-metric strong')");
        await pause(1200);
        assert(await evaluate("Math.abs(document.getElementById('overview-cards').scrollLeft-137)<2&&window.__qaCard===document.querySelector('#overview-cards .machine-card')&&window.__qaCounter===window.__qaCard.querySelector('.mc-metric strong')"),'Refresh moved free scroll or replaced card nodes');
        const dragPoint=await evaluate("(()=>{const r=document.getElementById('overview-cards').getBoundingClientRect();return {x:Math.round(r.left+500),y:Math.round(r.top+60)}})()");
        reader.webContents.sendInputEvent({type:'mouseMove',...dragPoint});
        reader.webContents.sendInputEvent({type:'mouseDown',...dragPoint,button:'left',clickCount:1});
        reader.webContents.sendInputEvent({type:'mouseMove',x:dragPoint.x-120,y:dragPoint.y,modifiers:['leftButtonDown']});
        for(let i=0;i<30;i++){if(await evaluate("Math.abs(document.getElementById('overview-cards').scrollLeft-257)<2"))break;await pause(100);}
        assert(await evaluate("document.getElementById('overview-cards').classList.contains('is-dragging')"),'Mouse drag did not capture the strip');
        const duringDrag=await evaluate("document.getElementById('overview-cards').scrollLeft");
        await pause(1300);
        console.log('DURING DRAG',duringDrag,await evaluate("({left:document.getElementById('overview-cards').scrollLeft,dragging:document.getElementById('overview-cards').classList.contains('is-dragging')})"));
        assert(await evaluate(`Math.abs(document.getElementById('overview-cards').scrollLeft-${duringDrag})<2`),'Refresh moved strip while dragging');
        reader.webContents.sendInputEvent({type:'mouseMove',x:dragPoint.x-180,y:dragPoint.y,modifiers:['leftButtonDown']});
        reader.webContents.sendInputEvent({type:'mouseUp',x:dragPoint.x-180,y:dragPoint.y,button:'left',clickCount:1});
        for(let i=0;i<30;i++){if(await evaluate("!document.getElementById('overview-cards').classList.contains('is-dragging')&&Math.abs(document.getElementById('overview-cards').scrollLeft-317)<3"))break;await pause(100);}
        const dragEnd=await evaluate("({left:document.getElementById('overview-cards').scrollLeft,dragging:document.getElementById('overview-cards').classList.contains('is-dragging')})");
        assert(Math.abs(dragEnd.left-317)<3&&!dragEnd.dragging,'Drag did not track pointer continuously or release capture');
        console.log('DRAG PASS',JSON.stringify(dragEnd));
        fs.writeFileSync(path.join(output,'dashboard.png'),(await reader.webContents.capturePage()).toPNG());
        await evaluate("document.querySelector('[data-view=machines]').click()");await pause(200);
        const count=await evaluate("document.querySelectorAll('#all-machines .machine-card').length");assert(count===10,'Full list missing assets');
        fs.writeFileSync(path.join(output,'machines.png'),(await reader.webContents.capturePage()).toPNG());
        await evaluate("document.querySelector('[data-view=signals]').click()");await pause(100);
        assert(await evaluate("document.querySelectorAll('#flow-body tr').length===8"),'Flow view missing nodes');
        await evaluate("document.querySelector('[data-view=events]').click()");await pause(100);
        fs.writeFileSync(path.join(output,'events.png'),(await reader.webContents.capturePage()).toPNG());
        await evaluate("require('electron').ipcRenderer.invoke('plc-reader-control',{action:'stop'})");
        snap=await evaluate("require('electron').ipcRenderer.invoke('plc-reader-snapshot')");assert(!snap.session.running,'Session did not stop');
        assert(!errors.length,errors.join('\n'));
        console.log('PASS',output);
    }catch(error){console.error(error);process.exitCode=1;}
    finally{for(const win of BrowserWindow.getAllWindows())win.destroy();app.exit(process.exitCode||0);}
});
