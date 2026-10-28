const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),net=require('net');
const {spawnSync}=require('child_process');
const {Archive,history,openDatabase,unpackBlock}=require('../backend-dist/modules/forno/archive');
const {ModbusReader}=require('../backend-dist/modules/forno/modbus');
const identity={host:'192.168.1.165',port:502,unit:255,address:256,scale:0.1};
function fixture(run){const folder=fs.mkdtempSync(path.join(os.tmpdir(),'aypi-forno-test-'));return run(path.join(folder,'forno.db'));}
test('forno: compressione lossless, statistiche e risoluzioni indipendenti',()=>fixture(file=>{
 const a=new Archive(file,identity);const rows=Array.from({length:1023},(_,i)=>({t:1700000000000+i*500+i%7,v:i%11===0?null:(i*31)%65536,q:i%11===0?1:0}));
 for(const row of rows)a.append(row);
 const db=openDatabase(file,{readonly:true});
 const lo=rows[12].t,hi=rows[1015].t,valid=rows.filter(r=>r.t>=lo&&r.t<=hi&&r.q===0);
 for(const [interval,limit]of [[500,4000],[5000,2000],[300000,2000],[500,7]]){
  const result=history(db,lo,hi,interval,limit);assert(result.buckets.length<=limit);assert.equal(result.stats.valid,valid.length);
  assert.equal(result.stats.min,Math.min(...valid.map(r=>r.v))/10);assert.equal(result.stats.max,Math.max(...valid.map(r=>r.v))/10);
  assert.equal(result.stats.mean,valid.reduce((n,r)=>n+r.v,0)/valid.length/10);assert.equal(result.stats.firstTime,valid[0].t);
 }
 db.close();a.close();const read=openDatabase(file,{readonly:true});
 const decoded=read.prepare('SELECT start,payload FROM blocks ORDER BY start').all().flatMap(b=>unpackBlock(b.start,b.payload));assert.deepEqual(decoded,rows);read.close();
}));
test('forno: recupero dopo crash e lunga interruzione',()=>fixture(file=>{
 const source=`const {Archive}=require(${JSON.stringify(path.resolve('backend-dist/modules/forno/archive'))});const a=new Archive(${JSON.stringify(file)},${JSON.stringify(identity)});a.append({t:1700000000000,v:4175,q:0});process.exit(0);`;
 const result=spawnSync(process.execPath,['-e',source],{env:process.env,windowsHide:true,encoding:'utf8'});assert.equal(result.status,0,result.stderr);
 const a=new Archive(file,identity);a.append({t:1700000000000+60*86400000,v:4200,q:0});a.close();
 const db=openDatabase(file);assert.equal(db.prepare('SELECT SUM(count) n FROM blocks').get().n,2);assert.equal(db.pragma('integrity_check',{simple:true}),'ok');db.close();
}));
test('forno: lock esclusivo, clock e campioni mancanti',()=>fixture(file=>{
 const a=new Archive(file,identity);assert.throws(()=>new Archive(file,identity));a.append({t:1000,v:null,q:1});assert.throws(()=>a.append({t:999,v:10,q:0}));a.append({t:1500,v:null,q:3});a.close();
 const db=openDatabase(file);assert.equal(history(db,1000,1500).stats.missing,2);assert.equal(history(db,1000,1500).stats.min,null);assert.deepEqual(history(db,2000,3000).buckets,[]);assert.throws(()=>history(db,0,100,1));db.close();
}));
test('Modbus: frame frammentati, connessione riutilizzata, eccezioni e timeout',async()=>{
 let requests=0;const sockets=new Set();const server=net.createServer(socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));let buffer=Buffer.alloc(0);socket.on('data',data=>{
  buffer=Buffer.concat([buffer,data]);if(buffer.length<12)return;const req=buffer.subarray(0,12);buffer=buffer.subarray(12);requests++;
  assert.equal(req[7],3);assert.equal(req.readUInt16BE(8),256);assert.equal(req.readUInt16BE(10),1);
  if(requests===3)return;
  const reply=Buffer.alloc(11);req.copy(reply,0,0,2);reply.writeUInt16BE(5,4);reply[6]=255;reply[7]=requests===2?0x83:3;reply[8]=2;reply.writeUInt16BE(4175,9);
  socket.write(reply.subarray(0,4));setTimeout(()=>socket.write(reply.subarray(4)),5);
 });});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const reader=new ModbusReader('127.0.0.1',server.address().port,255,256);
 try{assert.deepEqual(await reader.read(),{v:4175,q:0});assert.equal((await reader.read()).q,2);assert.equal((await reader.read()).q,1);}finally{reader.close();for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));}
});
const {resolveLocalDatabasePath}=require('../backend-dist/modules/forno/local-path');
test('forno: condivisione del server risolta sul disco locale, senza SMB',()=>{
 const options={platform:'win32',hostname:'DL360',addresses:['192.168.1.240'],shareRoot:share=>{assert.equal(share,'pubbliche');return 'E:\\Dati\\pubbliche';}};
 const expected='E:\\Dati\\pubbliche\\TECH\\AyPi\\AGPRESS\\General\\data\\forno.db';
 assert.equal(resolveLocalDatabasePath('\\\\Dl360\\pubbliche\\TECH\\AyPi\\AGPRESS\\General\\data\\forno.db',options),expected);
 assert.equal(resolveLocalDatabasePath('//Dl360/pubbliche/TECH/AyPi/AGPRESS/General/data/forno.db',options),expected);
 assert.equal(resolveLocalDatabasePath('\\\\192.168.1.240\\pubbliche\\TECH\\AyPi\\AGPRESS\\General\\data\\forno.db',options),expected);
 assert.equal(resolveLocalDatabasePath('D:\\Forno\\forno.db',options),'D:\\Forno\\forno.db');
});
test('forno: nessuna risoluzione di share su altri PC o percorsi fuori cartella',()=>{
 const options={platform:'win32',hostname:'CLIENT',shareRoot:()=>{throw Error('Non deve interrogare share remote');}};
 assert.throws(()=>resolveLocalDatabasePath('\\\\Dl360\\pubbliche\\forno.db',options),/altro computer/);
 assert.throws(()=>resolveLocalDatabasePath('C:forno.db',options),/assoluto/);
 assert.throws(()=>resolveLocalDatabasePath('\\\\CLIENT\\pubbliche\\..\\forno.db',{...options,shareRoot:()=> 'D:\\pubbliche'}),/esce/);
 assert.throws(()=>resolveLocalDatabasePath('\\\\CLIENT\\pubbliche\\forno.db',{...options,shareRoot:()=> '\\\\Other\\share'}),/disco locale/);
});
