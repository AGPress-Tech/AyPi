/* Integrazione del pacchetto Windows: TCP simulato, SQLite nativo, IPC e API note. */
const fs=require('fs'),os=require('os'),path=require('path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),resources=path.join(root,'dist-backend/win-unpacked/resources');
if(!process.versions.electron){
 const {spawn}=require('child_process');
 const child=spawn(path.join(resources,'../AyPi Backend.exe'),[__filename],{windowsHide:true,stdio:'inherit',env:{...process.env,ELECTRON_RUN_AS_NODE:'1',PATH:path.join(process.env.SystemRoot,'System32')}});
 const timeout=setTimeout(()=>child.kill(),25000);
 child.on('exit',code=>{clearTimeout(timeout);process.exitCode=code??1;});
}else{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'aypi-packaged-messages-'));
 Object.assign(process.env,{AYPI_BACKEND_PROFILE:'dev',AYPI_FP_GENERAL_DIR:directory,AYPI_LOG_DIR:directory,AYPI_DB_PATH:path.join(directory,'aypi.db'),AYPI_FORNO_ENABLED:'1',AYPI_FORNO_HOST:'127.0.0.1',AYPI_FORNO_DB_PATH:path.join(directory,'forno.db')});
 process.resourcesPath=resources;
 const packed=path.join(resources,'app.asar/backend-dist');
 const sockets=new Set();let phase=-1,service,httpServer;
 const mock=require('net').createServer(socket=>{
  sockets.add(socket);socket.on('close',()=>sockets.delete(socket));let pending=Buffer.alloc(0);
  socket.on('data',data=>{pending=Buffer.concat([pending,data]);while(pending.length>=12){
   const length=pending.readUInt16BE(4)+6;if(pending.length<length)return;
   const request=pending.subarray(0,length);pending=pending.subarray(length);
   const address=request.readUInt16BE(8),count=request.readUInt16BE(10);let words;
   if(address===256){words=Array(14).fill(0);words[0]=4175;words[4]=4200;words[8]=4250;words[13]=1;}
   else if(address===14928){if(count===32)phase=Math.min(phase+1,5);words=Array(count).fill(0);words[0]=[1,2,4,2,2,2][phase];words[1]=[1,2,4,2,2,32][phase];words[2]=2;words[6]=phase<4?phase+1:1;}
   else if(address===27302){const encode=s=>Array.from({length:21},(_,i)=>s.charCodeAt(i)||0);words=[...encode(phase<4?'1':'2'),...encode('Demo')];}
   else if(address===4256)words=[18];
   else throw Error('Registro inatteso '+address);
   const response=Buffer.alloc(9+2*count);request.copy(response,0,0,7);response.writeUInt16BE(3+count*2,4);response[7]=3;response[8]=count*2;words.forEach((v,i)=>response.writeUInt16BE(v,9+i*2));socket.write(response);
  }});
 });
 const delay=ms=>new Promise(r=>setTimeout(r,ms));
 (async()=>{try{
  await new Promise(r=>mock.listen(0,'127.0.0.1',r));process.env.AYPI_FORNO_PORT=String(mock.address().port);
  service=require(path.join(packed,'modules/forno/service'));
  const {Router}=require(path.join(packed,'shared/http/router')),{sendError}=require(path.join(packed,'shared/http/response'));
  const router=new Router();require(path.join(packed,'modules/forno/routes')).registerFornoRoutes(router);
  httpServer=require('http').createServer((req,res)=>router.handle(req,res).catch(e=>sendError(res,e)));
  await new Promise(r=>httpServer.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+httpServer.address().port;
  const api=async(url,method='GET',body,actor='Alice',expected=200)=>{const response=await fetch(base+url,{method,headers:{'content-type':'application/json','x-aypi-user':actor},body:body===undefined?undefined:JSON.stringify(body)});const value=await response.json();assert.equal(response.status,expected,JSON.stringify(value));return value;};
  await service.startFornoService();await delay(3200);
  const status=await api('/api/forno/status');assert.equal(status.running,true);assert.equal(status.events.error,'');assert(status.events.lastReadMs);assert.equal(status.channels.length,4);
  const range=`fromMs=${Date.now()-15000}&toMs=${Date.now()+15000}&showNotes=1&eventTypes=program_run,program_hold,program_resume,segment_start,program_complete`;
  let messages=await api('/api/forno/messages?'+range);for(const type of ['program_run','program_hold','program_resume','segment_start','program_complete'])assert(messages.events.some(e=>e.type===type),type);
  const input={timestampMs:status.lastSample.timestampMs,text:'Nota condivisa',clientToken:require('crypto').randomUUID()};
  const note=await api('/api/forno/notes','POST',input,'Alice',201);assert.equal(note.author,'Alice');
  assert.equal((await api('/api/forno/notes','POST',input,'Alice',201)).id,note.id);
  messages=await api('/api/forno/messages?'+range);assert.equal(messages.notes[0].text,input.text);
  const edited=await api('/api/forno/notes/'+note.id,'PUT',{revision:1,text:'Corretta'},'Bob');assert.equal(edited.revision,2);assert.equal(edited.author,'Alice');assert.equal(edited.editedBy,'Bob');
  const conflict=await api('/api/forno/notes/'+note.id,'PUT',{revision:1,text:'Obsoleta'},'Alice',409);assert.equal(conflict.code,'NOTE_CONFLICT');
  await api('/api/forno/notes/'+note.id,'DELETE',{revision:2},'Bob');messages=await api('/api/forno/messages?'+range);assert.equal(messages.notes.length,0);
  assert.equal((await api('/api/forno/messages?'+range+'&revision='+messages.revision)).unchanged,true);
  console.log('OK: backend impacchettato senza Node/Python nel PATH; 4 canali, eventi, note condivise, conflitto HTTP 409, eliminazione e revisione condizionale. DB temporaneo: '+directory);
 }finally{if(service)await service.stopFornoService();if(httpServer)await new Promise(r=>httpServer.close(r));for(const socket of sockets)socket.destroy();await new Promise(r=>mock.close(r));}})().catch(e=>{console.error(e);process.exitCode=1;});
}
