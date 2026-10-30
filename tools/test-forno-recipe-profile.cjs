const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const source=require('esbuild').buildSync({entryPoints:[path.resolve('src/renderer/scripts/forno/recipe-profile.ts')],bundle:true,platform:'node',format:'cjs',write:false}).outputFiles[0].text;
const compiled={exports:{}};new Function('module','exports',source)(compiled,compiled.exports);
const {buildRecipeProfile}=compiled.exports;
const segment=(number,type,extra={})=>({number,name:String(number),type,durationSeconds:0,targets:[200],rampSeconds:[3600],rates:[100],endType:1,holdback:[0],goBackTo:1,cycles:1,...extra});
const recipe=segments=>({name:'Ricetta prova',readAtMs:Date.now(),channels:1,rampStyle:0,rampUnits:[2],servoTo:[0],holdback:[],segments});

test('rampa-sosta-rampa-sosta: tempi dei parametri, non del nome né Duration sulle rampe',()=>{
    const r=recipe([segment(1,1),segment(2,2,{durationSeconds:3600}),segment(3,1,{targets:[375],durationSeconds:7200}),segment(4,2,{durationSeconds:14400}),segment(5,0)]);
    r.name='Ciclo_2_375_8h30m';const p=buildRecipeProfile(r,0);
    assert.equal(p.durationSeconds,7*3600);assert.equal(p.maximum,375);
    assert.deepEqual(p.points[0].map(({x,y})=>[x,y]),[[0,0],[1,200],[2,200],[3,375],[7,375]]);
});
test('rampe in velocità, discesa, valori negativi, step verticale e partenza modificabile',()=>{
    const r=recipe([segment(1,1,{targets:[100]}),segment(2,3,{targets:[-20]}),segment(3,1,{targets:[-100],rates:[80]}),segment(4,0)]);r.rampStyle=1;
    const p=buildRecipeProfile(r,0);assert.equal(p.durationSeconds,7200);assert.equal(p.minimum,-100);
    assert.deepEqual(p.points[0].map(({x,y})=>[x,y]),[[0,0],[1,100],[1,-20],[2,-100]]);
    assert.equal(buildRecipeProfile(r,50).durationSeconds,5400);
});
test('Wait, Holdback e mantenimento finale non inventano durate finite',()=>{
    const r=recipe([segment(1,1,{holdback:[1]}),segment(2,4),segment(3,2,{durationSeconds:9999}),segment(4,0)]);
    const p=buildRecipeProfile(r,0);assert.equal(p.durationSeconds,null);assert.equal(p.shownSeconds,3600);assert.equal(p.phases.length,1);assert.equal(p.warnings.length,2);
    assert(buildRecipeProfile(recipe([segment(1,1),segment(2,0,{endType:0})]),0).warnings.some(w=>w.includes('indeterminato')));
});
test('GoBack finito, continuo e limite di espansione',()=>{
    const r=recipe([segment(1,1),segment(2,5,{cycles:2}),segment(3,0)]);
    assert.equal(buildRecipeProfile(r,0).phases.length,3);
    r.segments[1].cycles=0;assert.equal(buildRecipeProfile(r,0).durationSeconds,null);
    r.segments[1].cycles=1000;const p=buildRecipeProfile(r,0);assert.equal(p.phases.length,500);assert.equal(p.durationSeconds,null);
});
test('due canali sincronizzati: il canale più veloce mantiene il target fino al completamento della rampa',()=>{
    const r=recipe([segment(1,1,{targets:[200,100],rampSeconds:[7200,3600],rates:[100,100],holdback:[0,0]}),segment(2,0,{targets:[200,100],rates:[100,100],holdback:[0,0]})]);r.channels=2;
    const p=buildRecipeProfile(r,0);assert.equal(p.durationSeconds,7200);assert.deepEqual(p.points[1].map(({x,y})=>[x,y]),[[0,0],[1,100],[2,100]]);
});
