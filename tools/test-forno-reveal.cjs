const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
function fixture() {
 let time=0,reduced=false;const rects=[],context={module:{exports:{}},exports:{},matchMedia:()=>({get matches(){return reduced}}),performance:{now:()=>time},requestAnimationFrame:()=>1,cancelAnimationFrame:()=>{}};
 vm.runInNewContext(fs.readFileSync('dist-ts/scripts/forno/chart-reveal.js','utf8'),context);
 const ctx={globalAlpha:1,save(){},restore(){},beginPath(){},clip(){},rect(...values){rects.push(values)}};
 const chart={ctx,chartArea:{left:0,right:1000,top:0,width:1000,height:100},scales:{x:{min:0,max:1000,getPixelForValue:t=>t}},draw(){}};
 return {reveal:context.module.exports.createChartReveal(),chart,rects,advance:t=>{time=t},reduce:()=>{reduced=true}};
}
test('animazione: estensioni connesse agli estremi esistenti, verso sinistra e destra',()=>{
 const f=fixture();f.reveal.start(f.chart,{start:400,end:600});f.advance(160);f.reveal.plugin.beforeDatasetsDraw(f.chart);
 assert.deepEqual(f.rects,[[400,0,200,100],[100,0,300,100],[600,0,300,100]]);
 assert.equal(f.chart.ctx.globalAlpha,1,'La traccia esistente non deve sfumare');
 f.reveal.plugin.afterDatasetsDraw(f.chart);
});
test('animazione: senza traccia precedente compare senza scansione da sinistra',()=>{
 for(const previous of [null,{start:-500,end:-100}]){
  const f=fixture();f.reveal.start(f.chart,previous);f.advance(160);f.reveal.plugin.beforeDatasetsDraw(f.chart);
  assert.deepEqual(f.rects,[]);assert.equal(f.chart.ctx.globalAlpha,0.75);
 }
});
test('animazione: impostazione di movimento ridotto rispettata',()=>{
 const f=fixture();f.reduce();f.reveal.start(f.chart,{start:400,end:600});f.reveal.plugin.beforeDatasetsDraw(f.chart);
 assert.deepEqual(f.rects,[]);assert.equal(f.chart.ctx.globalAlpha,1);
});
