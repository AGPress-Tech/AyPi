const test=require('node:test'),assert=require('node:assert/strict'),zlib=require('zlib');
const {encodeHistory,encodeFrame}=require('../backend-dist/modules/forno/transport');
const {decodeHistory,decodeFrame}=require('../dist-ts/modules/forno/transport');
const {appendLiveFrame}=require('../dist-ts/scripts/forno/live-series');
const stats={samples:2,valid:2,missing:0,min:-1.2,max:0,mean:-0.6,delta:1.2,first:-1.2,last:0,firstTime:1000,lastTime:1500,minTime:1000,maxTime:1500};
const off={samples:2,valid:0,missing:2,min:null,max:null,mean:null,delta:null,first:null,last:null,firstTime:null,lastTime:null,minTime:null,maxTime:null};
function fixture(count=1){return {fromMs:1000,toMs:1000+count*1000-1,requestedIntervalMs:1000,effectiveIntervalMs:1000,snapshotMs:1500,channels:[1,2,3,4].map(id=>({id,name:'Canale '+id,fromMs:1000,toMs:1000+count*1000-1,requestedIntervalMs:1000,effectiveIntervalMs:1000,stats:id===4?off:stats,buckets:Array.from({length:count},(_,i)=>({fromMs:1000+i*1000,toMs:1999+i*1000,...(id===4?off:stats)}))}))};}
test('Protobuf: parità numerica float64, valori negativi/zero, Off, timestamp e statistiche',()=>{
 const original=fixture(),decoded=decodeHistory(encodeHistory(original));assert.deepEqual(decoded.channels,original.channels);assert.equal(decoded.snapshotMs,1500);
 const empty=fixture();empty.channels.forEach(c=>{c.buckets=[];c.stats={...off,samples:0,missing:0};});assert.deepEqual(decodeHistory(encodeHistory(empty)).channels,empty.channels);
 const future=encodeHistory(original);future[1]=2;assert.throws(()=>decodeHistory(future));assert.throws(()=>decodeHistory(Buffer.from([255])));
});
test('Live: campioni originali, quattro qualità, identificativo riavvio e sequenza',()=>{
 const frame={timestampMs:1793260800123,values:[4175,0,-120,-2147483648],qualities:[0,0,0,9],epoch:'test',sequence:123,intervalMs:500};
 assert.deepEqual(decodeFrame(encodeFrame(frame)),{version:1,...frame,values:[4175,0,-120,null]});
 assert.throws(()=>decodeFrame(encodeFrame({...frame,values:[1]})));
});
test('Live: aggregazione esatta come lo storico, Off escluso e nessun campione inventato',()=>{
 const series=[[],[],[],[]],frame={timestampMs:1000,values:[-12,0,100,null],qualities:[0,0,0,9]};
 appendLiveFrame(series,frame,1000,0,10000);appendLiveFrame(series,{...frame,timestampMs:1500,values:[0,0,200,null]},1000,0,10000);
 for(const [key,value]of Object.entries(stats))assert.equal(series[0][0][key],value,key);
 for(const [key,value]of Object.entries(off))assert.equal(series[3][0][key],value,key);
 appendLiveFrame(series,{...frame,timestampMs:3000},1000,0,10000);assert.equal(series[0].length,2);assert.equal(series[0][1].fromMs,3000);assert.equal(series[0][0].toMs,1999);
});
test('Trasporto: confronto riproducibile 3000 bucket x 4 canali, gzip senza perdita',()=>{
 const original=fixture(3000),json=Buffer.from(JSON.stringify(original,null,2)),binary=encodeHistory(original),compressed=zlib.gzipSync(binary,{level:1});
 assert.deepEqual(decodeHistory(zlib.gunzipSync(compressed)).channels,original.channels);assert(compressed.length<json.length/5);
 console.log(`Trasporto simulato: JSON ${json.length} B; Protobuf ${binary.length} B; gzip ${compressed.length} B`);
});
