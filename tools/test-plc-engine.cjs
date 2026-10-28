const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs');
const {ProfinetReader,decode,CENTRAL_CPU_MAC}=require('../dist-ts/modules/plc-reader/engine');
const config=JSON.parse(fs.readFileSync('src/renderer/templates/plc-reader/macchine.json','utf8'));
function frame(signal,level,status=4,transfer=0,vlan=false){const data=Buffer.alloc(40);data[signal.byte]=level<<signal.bit;const header=Buffer.from('000000000000'+signal.mac.replace(/:/g,'')+(vlan?'810000018892':'8892'),'hex');const tail=Buffer.alloc(6);tail.writeUInt16BE(parseInt(signal.frame_id,16));tail[4]=status;tail[5]=transfer;return Buffer.concat([header,tail.subarray(0,2),data,tail.subarray(2)]);}
test('MES: sirene configurate alimentano gli stessi contatori e CSV pezzi',()=>{
 const writes=[];const reader=new ProfinetReader(config,(file,row)=>writes.push({file,row}));
 for(const code of ['21F400','21D300']){const m=reader.machines.get(code);assert.equal(m.segnale.tipo,'sirena');assert.equal(m.pezzi_per_impulso,1);[0,1,1,0,1].forEach((level,i)=>reader.receive(frame(m.segnale,level),1700000000+i/10));assert.equal(reader.machineState.get(code).pulses,2);assert.equal(reader.machineState.get(code).pieces,2);assert.deepEqual(writes.filter(w=>w.file==='impulsi'&&w.row[1]===code).map(w=>w.row[7]),[1,2]);}
});
test('MES: primo livello alto, dati invalidi e gap non creano falsi pezzi',()=>{
 const reader=new ProfinetReader(config,()=>{}),m=reader.machines.get('21D450'),sig=m.segnale;
 for(const [t,level,status]of [[1,1,4],[2,0,4],[3,1,4],[4,0,0],[5,1,4],[6,0,4],[7,1,4],[20,1,4],[21,0,4],[22,1,4]])reader.receive(frame(sig,level,status),t);
 const state=reader.machineState.get(m.codice);assert.equal(state.pulses,3);assert.equal(state.pieces,6);assert.equal(state.invalid,1);assert.equal(state.gap,true);assert.equal(state.last-state.previous,15);
});
test('MES: VLAN, frame non RT e CPU centrale esclusa',()=>{
 const reader=new ProfinetReader(config,()=>{}),sig=reader.machines.get('21D450').segnale;
 assert(decode(frame(sig,1,4,0,true)));assert.equal(decode(Buffer.alloc(10)),null);
 const wrong=frame(sig,1);wrong.writeUInt16BE(0x1234,14);assert.equal(decode(wrong),null);
 const cpu={...sig,mac:CENTRAL_CPU_MAC};reader.receive(frame(cpu,1),1);assert(![...reader.flows.values()].some(f=>f.mac===CENTRAL_CPU_MAC));
 [0,1,1,0,1].forEach((level,i)=>reader.receive(frame(sig,level,4,0,true),100+i));assert.equal(reader.machineState.get('21D450').pulses,2);
});
test('MES: discovery limitato e nessun conteggio per mapping non validati',()=>{
 const reader=new ProfinetReader(config,()=>{}),provisional=config.macchine.find(m=>m.codice==='21D700');assert.equal(provisional.segnale,null);
 const signal={...provisional.dispositivo_profinet,byte:4,bit:1};[0,1,0,1].forEach((level,i)=>reader.receive(frame(signal,level),100+i));assert.equal(reader.machineState.get('21D700').pulses,0);
 for(let i=0;i<140;i++)reader.receive(frame({mac:'00:11:22:33:44:55',frame_id:'0x'+(0x9000+i).toString(16),byte:4,bit:1},0),1000+i);
 assert.equal(reader.flows.size,config.flussi_et200sp.length+128);
});
