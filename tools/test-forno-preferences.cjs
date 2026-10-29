const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const {DEFAULT_VIEW_SETTINGS,normalizeViewSettings,divisionTicks,shouldLabel,dayRange}=require('../dist-ts/modules/forno/preferences');
const {readViewSettings,writeViewSettings}=require('../dist-ts/modules/forno/preferences-store');
test('griglia: 8 intervalli, etichette alternate ed estremi sempre visibili',()=>{
 for(const [start,end]of [[0,1000],[1700000000000,1700000000500],[1700000000000,1700086400000]]){
  const ticks=divisionTicks(start,end,8);assert.equal(ticks.length,9);assert.equal(ticks[0].value,start);assert.equal(ticks[8].value,end);
  assert.deepEqual(ticks.map((_,i)=>shouldLabel(i,ticks.length,2)),[true,false,true,false,true,false,true,false,true]);
  const odd=divisionTicks(start,end,7);assert(shouldLabel(7,8,2));
 }
});
test('preferenze: valori invalidi ignorati e nessun percorso arbitrario salvato',()=>{
 const prefs=normalizeViewSettings({xDivisions:500,yDivisions:-1,xLabelEvery:0,lineWidth:100,theme:'unknown',showPoints:true,path:'other',scaleMode:'zeroMax'});
 assert.equal(prefs.xDivisions,8);assert.equal(prefs.yDivisions,8);assert.equal(prefs.theme,'classic');assert.equal(prefs.showPoints,true);assert.equal(prefs.scaleMode,'zeroMax');assert.equal(prefs.path,undefined);
});

test('canali visibili: normalizzazione, nessun alias dei default e persistenza locale',()=>{
 assert.deepEqual(normalizeViewSettings({visibleChannels:[4,2,2]}).visibleChannels,[4,2]);
 assert.deepEqual(normalizeViewSettings({visibleChannels:[0,5]}).visibleChannels,[1,2,3,4]);
 assert.deepEqual(normalizeViewSettings({visibleChannels:[]}).visibleChannels,[]);
 const a=normalizeViewSettings({});a.visibleChannels.pop();assert.deepEqual(DEFAULT_VIEW_SETTINGS.visibleChannels,[1,2,3,4]);
 const file=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'aypi-ch-prefs-')),'settings.json');
 writeViewSettings(file,{visibleChannels:[1,3]});assert.deepEqual(readViewSettings(file).settings.visibleChannels,[1,3]);
});
test('nuove preferenze: scala manuale, passo in gradi, suddivisioni e finestra analisi',()=>{
 const settings={scaleMode:'manual',yMin:400,yMax:600,yFixedStep:true,yDegreeStep:0.5,ySubdivisions:4,analysisWindowSeconds:2.5,continuousTooltip:true,continuousTooltipOpacity:35};
 const file=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'aypi-axis-prefs-')),'settings.json');writeViewSettings(file,settings);
 const actual=readViewSettings(file).settings;for(const [key,value]of Object.entries(settings))assert.equal(actual[key],value);
 const invalid=normalizeViewSettings({yMin:10,yMax:-10,yDegreeStep:0,ySubdivisions:500,analysisWindowSeconds:0});
 assert.equal(invalid.yMin,0);assert.equal(invalid.yMax,1000);assert.equal(invalid.yDegreeStep,10);assert.equal(invalid.ySubdivisions,5);assert.equal(invalid.analysisWindowSeconds,60);
 assert.equal(normalizeViewSettings({}).continuousTooltipOpacity,100);assert.equal(normalizeViewSettings({continuousTooltipOpacity:0}).continuousTooltipOpacity,0);assert.equal(normalizeViewSettings({continuousTooltipOpacity:101}).continuousTooltipOpacity,100);
});
test('note/eventi: default nascosti per gli eventi, filtro valido e stesso catalogo del backend',()=>{
 const {EVENT_LABELS}=require('../dist-ts/modules/forno/preferences'),{EVENT_TYPES}=require('../backend-dist/modules/forno/messages');
 assert.deepEqual(Object.keys(EVENT_LABELS).sort(),[...EVENT_TYPES].sort());
 const a=normalizeViewSettings({});assert.equal(a.showNotes,true);assert.equal(a.showEvents,false);
 const b=normalizeViewSettings({showNotes:false,showEvents:true,eventTypes:['program_run','program_run']});assert.deepEqual(b.eventTypes,['program_run']);assert.equal(b.showNotes,false);
 a.eventTypes.pop();assert.equal(DEFAULT_VIEW_SETTINGS.eventTypes.length,EVENT_TYPES.length);
 assert.deepEqual(normalizeViewSettings({eventTypes:[]}).eventTypes,[]);
});
test('preferenze: persistenza su disco, riapertura e isolamento delle postazioni',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'aypi-forno-settings-'));const a=path.join(root,'pc-a','view-settings.json'),b=path.join(root,'pc-b','view-settings.json');
 assert.deepEqual(readViewSettings(a).settings,DEFAULT_VIEW_SETTINGS);
 const saved=writeViewSettings(a,{...DEFAULT_VIEW_SETTINGS,xDivisions:12,xLabelEvery:3,theme:'dark',scaleMode:'zeroMax'});
 assert.deepEqual(readViewSettings(a).settings,saved.settings);assert.equal(readViewSettings(b).settings.theme,'classic');
 writeViewSettings(a,{...saved.settings,xDivisions:8});assert.equal(readViewSettings(a).settings.xDivisions,8);assert(!fs.readdirSync(path.dirname(a)).some(n=>n.endsWith('.tmp')));
 fs.writeFileSync(a,'{invalid');assert.throws(()=>readViewSettings(a));assert.equal(fs.readFileSync(a,'utf8'),'{invalid');
});
test('giorno selezionato: mezzanotte locale, fine esatta e date invalide',()=>{
 const range=dayRange('2026-10-28');const first=new Date(range.start),last=new Date(range.end);
 assert.equal(first.getHours(),0);assert.equal(first.getDate(),28);assert.equal(last.getHours(),23);assert.equal(last.getMinutes(),59);assert.equal(last.getSeconds(),59);assert.equal(last.getMilliseconds(),999);
 assert.throws(()=>dayRange('2026-02-30'));assert.throws(()=>dayRange('invalid'));
 for(const date of ['2026-03-29','2026-10-25']){const r=dayRange(date);const d=new Date(r.start);const next=new Date(d);next.setDate(next.getDate()+1);assert.equal(r.end+1,next.getTime());}
});
