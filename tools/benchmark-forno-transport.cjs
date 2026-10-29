/* Read-only benchmark against an explicitly selected backend; does not deploy. */
const {encodeHistory}=require('../backend-dist/modules/forno/transport'),{decodeHistory}=require('../dist-ts/modules/forno/transport'),{gzipSync}=require('zlib'),assert=require('node:assert/strict');
(async()=>{
 const base=process.argv[2];if(!base)throw Error('Uso: node tools/benchmark-forno-transport.cjs http://server:3000');
 const toMs=Date.now(),fromMs=toMs-24*3600000;
 const response=await fetch(new URL(`/api/forno/history?fromMs=${fromMs}&toMs=${toMs}&intervalMs=1000&maxPoints=3000`,base),{signal:AbortSignal.timeout(18000)});if(!response.ok)throw Error('HTTP '+response.status);
 const json=await response.text(),value=JSON.parse(json),began=performance.now(),binary=encodeHistory(value),encoded=performance.now(),compressed=gzipSync(binary,{level:1}),gzipped=performance.now(),decoded=decodeHistory(binary),ended=performance.now();
 assert.deepEqual(decoded.channels,value.channels);
 console.log(JSON.stringify({jsonBytes:Buffer.byteLength(json),jsonGzipBytes:gzipSync(Buffer.from(json),{level:1}).length,protobufBytes:binary.length,protobufGzipBytes:compressed.length,reductionPercent:Math.round((1-compressed.length/Buffer.byteLength(json))*1000)/10,encodeMs:Math.round(encoded-began),gzipMs:Math.round(gzipped-encoded),decodeMs:Math.round(ended-gzipped),numericParity:true},null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
