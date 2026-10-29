const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const {MultiChannelArchive}=require('../backend-dist/modules/forno/multi-archive');
const {analyzeChannels}=require('../backend-dist/modules/forno/analysis');
const identity={host:'192.168.1.165',port:502,unit:255,address:256,scale:0.1};
function fixture(run){const file=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'aypi-analysis-')),'forno.db'),a=new MultiChannelArchive(file,identity);try{return run(a);}finally{a.close();}}
test('analisi raw: statistiche canali e media per istante, Off esclusi',()=>fixture(a=>{
 for(let i=0;i<=10;i++)a.appendFrame([10,20,30,null].map(v=>({t:100000+i*500,v:v===null?null:(v+i)*10,q:v===null?9:0})));
 const r=analyzeChannels(a.core.db,100000,105000,2);
 assert.deepEqual(r.combined.stats,{samples:11,valid:11,missing:0,min:20,max:30,mean:25,delta:10});
 assert.equal(r.combined.windows.count,7);assert.equal(r.combined.windows.meanDelta,4);assert.equal(r.combined.windows.maxDelta.delta,4);
 assert.deepEqual(r.combined.windows.maxDelta,{fromMs:100000,toMs:102000,min:20,max:24,delta:4,minTime:100000,maxTime:102000});
 assert.equal(r.channels[0].stats.mean,15);assert.equal(r.channels[3].stats.mean,null);assert.equal(r.channels[3].windows.count,0);
 const selected=analyzeChannels(a.core.db,101000,104000,2);assert.equal(selected.channels[0].stats.samples,7);assert.equal(selected.combined.windows.count,3);
}));
test('delta finestre mobili: usa min/max interni, non solo differenza degli estremi',()=>fixture(a=>{
 [10,1,8,4,15].forEach((v,i)=>a.appendFrame([0,1,2,3].map(ch=>({t:10000+i*500,v:ch===0?v*10:null,q:ch===0?0:9}))));
 const r=analyzeChannels(a.core.db,10000,12000,1),w=r.channels[0].windows;
 assert.equal(w.count,3);assert.equal(w.meanDelta,9);assert.deepEqual(w.maxDelta,{fromMs:11000,toMs:12000,min:4,max:15,delta:11,minTime:11500,maxTime:12000});
 assert.deepEqual(r.combined.stats,r.channels[0].stats);
}));
test('analisi: zero e negativi validi, stati Off non diventano zeri, finestre brevi escluse',()=>fixture(a=>{
 for(let i=0;i<4;i++)a.appendFrame([{t:10000+i*500,v:i===1?null:i*10-20,q:i===1?9:0},{t:10000+i*500,v:0,q:0},{t:10000+i*500,v:null,q:9},{t:10000+i*500,v:null,q:1}]);
 const r=analyzeChannels(a.core.db,10000,11500,10);assert.equal(r.channels[0].stats.valid,3);assert.equal(r.channels[0].stats.missing,1);assert.equal(r.channels[0].stats.min,-2);
 assert.equal(r.channels[1].stats.mean,0);assert.equal(r.channels[3].stats.mean,null);assert.equal(r.combined.windows.count,0);
 assert.equal(analyzeChannels(a.core.db,20000,21000,1).combined.stats.mean,null);
 assert.throws(()=>analyzeChannels(a.core.db,0,100,0));assert.throws(()=>analyzeChannels(a.core.db,100,0,1));
}));
test('analisi compresso/pending: conserva picco originale e rilascia snapshot',()=>fixture(a=>{
 for(let i=0;i<250;i++)a.appendFrame([0,1,2,3].map(ch=>({t:100000+i*500,v:ch===3?null:i===130?9000:1000,q:ch===3?9:0})));
 const r=analyzeChannels(a.core.db,100000,224500,5);assert.equal(r.channels[0].stats.samples,250);assert.equal(r.combined.stats.max,900);assert.equal(r.combined.windows.maxDelta.delta,800);
 a.appendFrame([0,1,2,3].map(ch=>({t:225000,v:ch===3?null:1000,q:ch===3?9:0})));
 assert.equal(analyzeChannels(a.core.db,100000,225000,5).combined.stats.samples,251);
}));
