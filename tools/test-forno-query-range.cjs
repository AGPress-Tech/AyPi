const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const source=require('esbuild').buildSync({entryPoints:[path.resolve('src/renderer/scripts/forno/query-range.ts')],bundle:true,platform:'node',format:'cjs',write:false}).outputFiles[0].text;
const compiled={exports:{}};new Function('module','exports',source)(compiled,compiled.exports);
const {boundedQueryRange,MAX_FORNO_RANGE_MS:MAX}=compiled.exports;

test('richiesta dello screenshot: elimina il millisecondo oltre il limite senza escludere campioni della vista',()=>{
    const start=1776644408575.5,end=start+MAX;
    assert.equal(Math.ceil(end)-Math.floor(start),MAX+1);
    const query=boundedQueryRange(start,end);
    assert.deepEqual(query,{fromMs:1776644408576,toMs:1808266808576});
    assert(query.fromMs<=Math.ceil(start));assert(query.toMs>=Math.floor(end));
});
test('margini frazionari vicino a 366 giorni: estremi interi, limite rispettato e copertura della vista',()=>{
    for(const fraction of [0,.001,.25,.5,.999])for(const gap of [0,1,2,500,86400000]){
        const start=1776644408575+fraction,end=start+MAX-gap;
        const margin=Math.max(0,Math.min((end-start)/4,(MAX-(end-start))/2));
        const q=boundedQueryRange(start-margin,end+margin);
        assert(Number.isSafeInteger(q.fromMs)&&Number.isSafeInteger(q.toMs));
        assert(q.toMs-q.fromMs<=MAX);assert(q.fromMs<=Math.ceil(start));assert(q.toMs>=Math.floor(end));
    }
});
test('live: riduce l’allineamento del primo bucket e conserva i dati più recenti',()=>{
    const end=1808266808575,start=end-MAX,aligned=Math.floor(start/21600000)*21600000;
    const q=boundedQueryRange(aligned,end);assert.equal(q.toMs,end);assert.equal(q.fromMs,start);
});
test('range ordinari e inizio archivio: margine preservato senza date negative',()=>{
    assert.deepEqual(boundedQueryRange(1000.25,2000.75),{fromMs:1000,toMs:2001});
    assert.deepEqual(boundedQueryRange(-1000.25,2000.75),{fromMs:0,toMs:2001});
    assert.deepEqual(boundedQueryRange(1000,1000),{fromMs:1000,toMs:1000});
    for(const [a,b]of [[NaN,100],[0,Infinity],[200,100],[0,-100],[0,Number.MAX_SAFE_INTEGER+1]])assert.throws(()=>boundedQueryRange(a,b));
});
