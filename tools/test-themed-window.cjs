const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('events');
const {revealThemedWindow}=require('../dist-ts/modules/file-manager/themed-window');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
test('splash: Blue Archive prevale anche nei controller caricati dopo il bootstrap',()=>{
 const fs=require('fs'),vm=require('vm');
 const code=fs.readFileSync(require.resolve('../dist-ts/scripts/shared/scripted-splash-mode.js'),'utf8');
 for(const query of ['?theme=bluearchive&splashTheme=agpress','?theme=standard&splashTheme=agpress']){
  const classes=new Set(),module={exports:{}};
  const context={module,exports:module.exports,URLSearchParams,window:{location:{search:query}},document:{body:{classList:{add:(...xs)=>xs.forEach(x=>classes.add(x)),remove:(...xs)=>xs.forEach(x=>classes.delete(x)),contains:x=>classes.has(x)}}}};
  vm.runInNewContext(code,context);
  const mode=module.exports.createScriptedSplashMode(['fp-bluearchive']);
  const blue=query.includes('theme=bluearchive');assert.equal(mode.isAgpress,!blue);assert.equal(classes.has('agpress-scripted-splash'),!blue);
  mode.attach({});mode.cleanup();assert.equal(classes.has('fp-bluearchive'),blue);
 }
});
function fixture(){const win=new EventEmitter(),contents=new EventEmitter();let loading=true,closed=false,shows=0;
 Object.assign(contents,{isDestroyed:()=>closed,isLoadingMainFrame:()=>loading});
 Object.assign(win,{webContents:contents,isDestroyed:()=>closed,hide(){},show(){shows++;},focus(){}});
 return {win,contents,loading:v=>loading=v,close:()=>{closed=true;win.emit('closed')},shows:()=>shows};}
test('finestra: non mostrare il documento col tema precedente durante il caricamento',async()=>{
 const f=fixture();revealThemedWindow(f.win);revealThemedWindow(f.win);assert.equal(f.shows(),0);assert.equal(f.contents.listenerCount('did-finish-load'),1);
 f.loading(false);f.contents.emit('did-finish-load');assert.equal(f.shows(),0);await delay(55);assert.equal(f.shows(),1);
 assert.equal(f.contents.listenerCount('did-finish-load'),0);assert.equal(f.contents.listenerCount('did-fail-load'),0);
});
test('finestra: chiusura e fallimenti di caricamento rilasciano i listener',async()=>{
 const f=fixture();revealThemedWindow(f.win);f.close();await delay(40);assert.equal(f.shows(),0);assert.equal(f.contents.listenerCount('did-finish-load'),0);
 const g=fixture();revealThemedWindow(g.win);g.contents.emit('did-fail-load',{},-3,'abort','file:',false);assert.equal(g.shows(),0);
 g.loading(false);g.contents.emit('did-fail-load',{},-6,'not found','file:',true);await delay(55);assert.equal(g.shows(),1);
});
