const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),net=require('net');
const {spawnSync}=require('child_process');
const {Archive,openDatabase,unpackBlock}=require('../backend-dist/modules/forno/archive');
const {MultiChannelArchive,historyChannels}=require('../backend-dist/modules/forno/multi-archive');
const {ModbusReader,qualityLabel}=require('../backend-dist/modules/forno/modbus');
const identity={host:'192.168.1.165',port:502,unit:255,address:256,scale:0.1};
const fixture=()=>path.join(fs.mkdtempSync(path.join(os.tmpdir(),'aypi-forno-4ch-')),'forno.db');
const frame=t=>[{t,v:5300,q:0},{t,v:-105,q:0},{t,v:5400,q:0},{t,v:null,q:9}];

test('migrazione: backup valido, storico CH1 conservato e nessun dato inventato CH2–4',()=>{
 const file=fixture(),old=new Archive(file,identity);old.append({t:1000,v:4175,q:0});old.close();
 const archive=new MultiChannelArchive(file,identity);assert(fs.existsSync(archive.migrationBackup));
 const backup=openDatabase(archive.migrationBackup,{readonly:true});assert.equal(backup.prepare('SELECT SUM(count) n FROM blocks').get().n,1);assert.equal(backup.pragma('integrity_check',{simple:true}),'ok');backup.close();
 archive.appendFrame(frame(2000));
 const result=historyChannels(archive.core.db,0,3000);assert.equal(result.stats.samples,2);assert.equal(result.channels.length,4);
 assert.equal(result.channels[1].stats.samples,1);assert.equal(result.channels[1].stats.min,-10.5);assert.equal(result.channels[3].stats.min,null);assert.equal(result.channels[3].stats.missing,1);
 assert.equal(historyChannels(archive.core.db,0,1500).channels[1].stats.samples,0);
 archive.close();const reopened=new MultiChannelArchive(file,identity);assert.equal(reopened.migrationBackup,null);reopened.close();
});

test('quattro canali: compressione lossless, pending, statistiche e risoluzioni indipendenti',()=>{
 const file=fixture(),archive=new MultiChannelArchive(file,identity),frames=Array.from({length:377},(_,i)=>frame(1700000000000+i*500).map((s,ch)=>({...s,v:s.v===null?null:s.v+(i%17)*ch})));
 for(const rows of frames)archive.appendFrame(rows);
 for(const [interval,limit]of [[500,2000],[5000,4000],[500,7],[300000,1]]){
  const result=historyChannels(archive.core.db,frames[0][0].t,frames.at(-1)[0].t,interval,limit);
  for(let ch=0;ch<4;ch++){
   const actual=result.channels[ch],values=frames.map(f=>f[ch]).filter(s=>s.q===0).map(s=>s.v);
   assert(actual.buckets.length<=limit);assert.equal(actual.stats.samples,frames.length);assert.equal(actual.stats.valid,values.length);
   assert.equal(actual.stats.mean,values.length?values.reduce((a,b)=>a+b,0)/values.length/10:null);
   assert.equal(actual.stats.min,values.length?Math.min(...values)/10:null);assert.equal(actual.stats.max,values.length?Math.max(...values)/10:null);
  }
 }
 archive.close();const db=openDatabase(file,{readonly:true});
 for(let id=1;id<=4;id++){
  const blocks=id===1?db.prepare('SELECT start,payload FROM blocks ORDER BY start').all():db.prepare('SELECT start,payload FROM blocks_channels WHERE channel=? ORDER BY start').all(id);
  assert.deepEqual(blocks.flatMap(b=>unpackBlock(b.start,b.payload)),frames.map(f=>f[id-1]));
 }
 assert.equal(db.pragma('integrity_check',{simple:true}),'ok');db.close();
});

test('frame atomico: errore a metà scrittura non lascia canali spaiati',()=>{
 const file=fixture(),a=new MultiChannelArchive(file,identity);a.appendFrame(frame(1000));
 const invalid=frame(1500);invalid[3].t=1600;assert.throws(()=>a.appendFrame(invalid));
 a.core.db.exec("CREATE TRIGGER fail_channel BEFORE INSERT ON pending_channels WHEN NEW.channel=3 BEGIN SELECT RAISE(ABORT,'simulated failure'); END");
 assert.throws(()=>a.appendFrame(frame(1500)),/simulated failure/);
 assert.deepEqual(historyChannels(a.core.db,0,3000).channels.map(c=>c.stats.samples),[1,1,1,1]);
 a.core.db.exec('DROP TRIGGER fail_channel');a.close();
 const b=new MultiChannelArchive(file,identity);b.appendFrame(frame(1500));assert.deepEqual(historyChannels(b.core.db,0,3000).channels.map(c=>c.stats.samples),[2,2,2,2]);b.close();
});

test('ripresa dopo crash: quattro pending recuperati, qualità Off preservata',()=>{
 const file=fixture();const source=`const {MultiChannelArchive}=require(${JSON.stringify(path.resolve('backend-dist/modules/forno/multi-archive'))});const a=new MultiChannelArchive(${JSON.stringify(file)},${JSON.stringify(identity)});a.appendFrame(${JSON.stringify(frame(1000))});process.exit(0)`;
 const child=spawnSync(process.execPath,['-e',source],{windowsHide:true,encoding:'utf8'});assert.equal(child.status,0,child.stderr);
 const a=new MultiChannelArchive(file,identity);a.appendFrame(frame(1500));const data=historyChannels(a.core.db,0,3000);assert.deepEqual(data.channels.map(c=>c.stats.samples),[2,2,2,2]);assert.equal(data.channels[3].stats.valid,0);a.close();
});

test('Modbus multicanale: un blocco di 14 registri, frame TCP frammentato, valori signed e qualità',async()=>{
 const sockets=new Set();let requests=0;
 const server=net.createServer(socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.on('data',req=>{
  assert.equal(req.readUInt16BE(8),256);assert.equal(req.readUInt16BE(10),14);requests++;
  if(requests===3)return;
  const response=Buffer.alloc(37);req.copy(response,0,0,2);response.writeUInt16BE(31,4);response[6]=255;response[7]=3;response[8]=28;
  const words=[5308,0,0,0,65431,0,0,0,5368,requests===2?2:0,0,0,0,1];words.forEach((v,i)=>response.writeUInt16BE(v,9+i*2));
  socket.write(response.subarray(0,10));setTimeout(()=>socket.write(response.subarray(10)),5);
 });});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const reader=new ModbusReader('127.0.0.1',server.address().port,255,256);
 try{
  assert.deepEqual(await reader.readChannels(),[{v:5308,q:0},{v:-105,q:0},{v:5368,q:0},{v:null,q:9}]);
  const next=await reader.readChannels();assert.equal(next[2].v,null);assert.equal(qualityLabel(next[2].q),'over_range');assert.equal(qualityLabel(next[3].q),'off');
  assert.deepEqual(await reader.readChannels(),Array.from({length:4},()=>({v:null,q:1})));assert.equal(requests,3);
 }finally{reader.close();for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));}
});
