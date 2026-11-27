// Deterministic idle-clock checks against the actual bot module in an Electron DOM.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict'), path = require('node:path'), fs = require('node:fs'), ts = require('typescript');
app.commandLine.appendSwitch('disable-gpu');
app.whenReady().then(async () => {
    const win = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false } });
    try {
        await win.loadURL('about:blank');
        const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/renderer/modules/agpress-bot.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
        await win.webContents.executeJavaScript(`
            document.body.innerHTML = ['assistant','spineAssistantPlayer','speechBubble','assistantLabel','assistantHeadHitbox','assistantSwitch','assistantPicker'].map(id=>'<div id="'+id+'"></div>').join('');
            Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});
            document.hasFocus=()=>true;
            let now=0, serial=0; const timers=new Map();
            window.setTimeout=(callback,delay=0)=>{const id=++serial;timers.set(id,{callback,due:now+delay});return id};
            window.clearTimeout=id=>timers.delete(id);
            window.advance=ms=>{const end=now+ms;let count=0;while(true){const next=[...timers].filter(([,t])=>t.due<=end).sort((a,b)=>a[1].due-b[1].due)[0];if(!next)break;if(++count>100)throw Error('Timer loop');now=next[1].due;timers.delete(next[0]);next[1].callback()}now=end};
            // Exercise the supported static fallback; timing and input logic are identical.
            class Stub {constructor(){this.position={}}}
            const three={Scene:Stub,Group:Stub,OrthographicCamera:Stub,WebGLRenderer:class{constructor(){throw Error('No WebGL in clock test')}}};
            const exports={};new Function('require','exports',${JSON.stringify(compiled)})(id=>id==='three'?three:id==='./assistant-analysis-confirm'?{openAssistantAnalysis:async()=>({ok:true,canceled:true})}:require(id),exports);
            window.bot=exports.mountAgpressBot(()=>({title:'Moduli',description:'Informazioni'}));
            window.visible=()=>document.querySelector('#speechBubble').classList.contains('visible');
            window.activity=type=>document.dispatchEvent(new Event(type,{bubbles:true}));
            void 0;
        `);
        const run = code => win.webContents.executeJavaScript(code);
        assert.equal(await run("document.querySelector('#spineAssistantPlayer').hasAttribute('title')"), false);
        assert.equal(await run('advance(3201);visible()'), false, 'No welcome message');
        assert.equal(await run("activity('pointermove');advance(59999);visible()"), false, 'Hover never speaks and resets idle');
        assert.equal(await run('advance(1);visible()'), true, 'Speaks at one minute idle');
        assert.equal(await run("advance(7000);activity('pointerdown');advance(30000);activity('wheel');advance(59999);visible()"), false);
        assert.equal(await run('advance(1);visible()'), true);
        assert.equal(await run("advance(7000);activity('keydown');document.querySelector('#spineAssistantPlayer').click();visible()"), true, 'Direct click speaks immediately');
        assert.equal(await run("advance(7000);window.dispatchEvent(new Event('blur'));advance(120000);visible()"), false, 'Background stays silent');
        assert.equal(await run("window.dispatchEvent(new Event('focus'));advance(59999);visible()"), false);
        assert.equal(await run('advance(1);visible()'), true);
        assert.equal(await run('bot.dispose();timers.size'), 0, 'Dispose clears all bot timers');
        console.log('OK: no tooltip/welcome/hover speech; exactly 60 seconds idle, activity resets, direct click, background pause and cleanup.');
        win.destroy(); app.exit(0);
    } catch (error) { console.error(error); win.destroy(); app.exit(1); }
});
