const test=require('node:test'),assert=require('node:assert/strict');
const {channelAverage}=require('../dist-ts/scripts/forno/channel-average');
test('media complessiva: tre canali validi, quarto Off escluso',()=>{
 const result=channelAverage([{id:1,valid:2,mean:417.75},{id:2,valid:2,mean:419.75},{id:3,valid:2,mean:424.75},{id:4,valid:0,mean:null}]);
 assert.equal(result.temperature,420.75);assert.deepEqual(result.channels.map(c=>c.id),[1,2,3]);
});
test('media dei canali: stesso peso per canale, zeri e temperature negative validi',()=>{
 const result=channelAverage([{id:1,valid:100,mean:0},{id:2,valid:2,mean:-10},{id:3,valid:1,mean:40},{id:4,valid:0,mean:100}]);
 assert.equal(result.temperature,10);assert.equal(result.channels.length,3);
});
test('media complessiva: nessun dato valido non diventa una temperatura zero',()=>{
 for(const readings of [[],[{id:1,valid:0,mean:null}],[{id:1,valid:2,mean:NaN},{id:2,valid:1,mean:Infinity}]]){
  const result=channelAverage(readings);assert.equal(result.temperature,null);assert.deepEqual(result.channels,[]);
 }
});
