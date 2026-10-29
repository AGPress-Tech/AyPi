const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const {Archive,openDatabase}=require('../backend-dist/modules/forno/archive');
const {MultiChannelArchive}=require('../backend-dist/modules/forno/multi-archive');
const {sampleAt}=require('../backend-dist/modules/forno/sample');
const identity={host:'192.168.1.165',port:502,unit:255,address:256,scale:0.1};
const file=()=>path.join(fs.mkdtempSync(path.join(os.tmpdir(),'aypi-cursor-sample-')),'forno.db');
test('campione cursore: originale vicino al tempo richiesto, blocchi/pending e parità',()=>{
 const a=new MultiChannelArchive(file(),identity);
 try{
  for(let i=0;i<130;i++)a.appendFrame([5300,5400,5500,null].map(v=>({t:100000+i*500,v:v===null?null:v+i,q:v===null?9:0})));
  const r=sampleAt(a.core.db,159750);assert.equal(r.timestampMs,159500);assert.equal(r.channels[0].temperature,541.9);assert.equal(r.channels[3].quality,'off');assert.equal(r.channels[3].temperature,null);assert.equal(r.mean,551.9);
  assert.equal(sampleAt(a.core.db,160010).timestampMs,160000);
  assert.equal(sampleAt(a.core.db,170000).timestampMs,null);assert.equal(sampleAt(a.core.db,170000).mean,null);
  assert.throws(()=>sampleAt(a.core.db,-1));
 }finally{a.close();}
});
test('campione cursore: CH1 non valido non sposta gli altri canali a un altro istante',()=>{
 const a=new MultiChannelArchive(file(),identity);
 try{
  a.appendFrame([{t:1000,v:500,q:0},{t:1000,v:0,q:0},{t:1000,v:200,q:0},{t:1000,v:null,q:9}]);
  a.appendFrame([{t:1500,v:null,q:1},{t:1500,v:0,q:0},{t:1500,v:-100,q:0},{t:1500,v:null,q:9}]);
  const r=sampleAt(a.core.db,1490);assert.equal(r.timestampMs,1500);assert.equal(r.channels[0].quality,'timeout');assert.equal(r.mean,-5);
 }finally{a.close();}
});
test('campione cursore: archivio precedente e buchi, senza dati inventati',()=>{
 const target=file(),a=new Archive(target,identity);a.append({t:1000,v:0,q:0});a.append({t:600000,v:50,q:0});a.close();
 const db=openDatabase(target,{readonly:true});try{
  const r=sampleAt(db,1000);assert.equal(r.mean,0);assert.equal(r.channels[1].quality,'unavailable');assert.equal(sampleAt(db,300000).timestampMs,null);
 }finally{db.close();}
});
