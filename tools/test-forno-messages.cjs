const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),crypto=require('crypto');
const {MultiChannelArchive}=require('../backend-dist/modules/forno/multi-archive');
const {initializeMessages,saveNote,deleteNote,listMessages,EVENT_TYPES}=require('../backend-dist/modules/forno/messages');
const {EventRecorder,readProgrammer}=require('../backend-dist/modules/forno/events');
const identity={host:'192.168.1.165',port:502,unit:255,address:256,scale:0.1};
function fixture(run){const a=new MultiChannelArchive(path.join(fs.mkdtempSync(path.join(os.tmpdir(),'aypi-messages-')),'forno.db'),identity);try{initializeMessages(a.core.db);a.appendFrame([1,2,3,4].map(id=>({t:10000,v:id*100,q:0})));return run(a.core.db);}finally{a.close();}}
test('note: campione originale, autore, idempotenza, versioni, conflitto ed eliminazione con storico',()=>fixture(db=>{
 const input={timestampMs:10100,text:'Nota <b>non HTML</b>\nSeconda riga',clientToken:crypto.randomUUID()};
 const first=saveNote(db,input,'Alice');assert.equal(first.timestampMs,10000);assert.equal(first.author,'Alice');assert.equal(first.revision,1);
 assert.equal(saveNote(db,input,'Alice').id,first.id);const initialList=listMessages(db,0,20000,true,[]);assert.equal(initialList.notes.length,1);
 assert.equal(listMessages(db,0,20000,true,[],initialList.revision).unchanged,true);
 const edited=saveNote(db,{id:first.id,revision:1,text:'Modificata'},'Bob');assert.equal(edited.revision,2);assert.equal(edited.author,'Alice');assert.equal(edited.editedBy,'Bob');
 assert.equal(listMessages(db,0,20000,true,[],initialList.revision).notes[0].text,'Modificata');
 assert.throws(()=>saveNote(db,{id:first.id,revision:1,text:'Da PC obsoleto'},'Alice'),e=>e.code==='NOTE_CONFLICT');
 assert.throws(()=>deleteNote(db,{id:first.id,revision:1},'Alice'),e=>e.code==='NOTE_CONFLICT');
 deleteNote(db,{id:first.id,revision:2},'Bob');assert.equal(listMessages(db,0,20000,true,[]).notes.length,0);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM forno_note_history WHERE note_id=?').get(first.id).n,3);
 assert.throws(()=>saveNote(db,{timestampMs:999999,text:'Fuori dati',clientToken:crypto.randomUUID()},'Alice'),e=>e.code==='NOTE_INVALID');
 assert.throws(()=>saveNote(db,{timestampMs:10000,text:'x'.repeat(4001),clientToken:crypto.randomUUID()},'Alice'),e=>e.code==='NOTE_INVALID');
}));
test('eventi: transizioni, filtri e baseline dopo disconnessione senza eventi inventati',()=>fixture(db=>{
 const recorder=new EventRecorder(db),base=Date.now();
 const initial={mode:1,status:1,segmentType:1,segmentElapsed:0,program:'Ciclo A',segment:'1',configRev:18,pv:[0,0],outputs:[0,0,0,0,0,0,0,0]};
 recorder.accept(base,initial);
 recorder.accept(base+500,{...initial,mode:2,status:2});
 recorder.accept(base+1000,{...initial,mode:4,status:4});
 recorder.accept(base+1500,{...initial,mode:2,status:2,segmentElapsed:1});
 const next={...initial,mode:2,status:2,segment:'2',configRev:19,pv:[1,0],outputs:[1,0,0,0,0,0,0,0]};recorder.accept(base+2000,next);
 recorder.accept(base+2500,{...next,status:32});
 let result=listMessages(db,base-1000,base+5000,true,[...EVENT_TYPES]);
 for(const type of ['program_run','program_hold','program_resume','segment_start','segment_end','config_revision','pv_event','digital_event','program_complete'])assert(result.events.some(e=>e.type===type),type);
 const before=result.events.filter(e=>e.type==='program_reset').length;
 recorder.failure(base+3000,'offline');recorder.failure(base+3500,'offline');recorder.accept(base+4000,initial);
 result=listMessages(db,base-1000,base+5000,false,[...EVENT_TYPES]);assert.equal(result.events.filter(e=>e.type==='communication_lost').length,1);assert.equal(result.events.filter(e=>e.type==='program_reset').length,before);
 const filtered=listMessages(db,base-1000,base+5000,false,['program_run']);assert.equal(filtered.events.length,1);assert.deepEqual(filtered.notes,[]);
 assert.throws(()=>listMessages(db,base,base+5000,true,['inventato']));
}));
test('lettore eventi: indirizzi verificati, stringhe, revisione, controllo coerenza',async()=>{
 const addresses=[],run=Array(32).fill(0);run[0]=2;run[1]=2;run[2]=2;run[6]=20;
 const encode=s=>Array.from({length:21},(_,i)=>s.charCodeAt(i)||0),names=[...encode('2'),...encode('Ciclo_2_375_8h30m')];
 const reader={async readWords(address,count){addresses.push([address,count]);return {words:address===14928?run.slice(0,count):address===27302?names:[18],q:0};}};
 const result=await readProgrammer(reader);assert.equal(result.program,'Ciclo_2_375_8h30m');assert.equal(result.segment,'2');assert.equal(result.configRev,18);assert.deepEqual(addresses,[[14928,32],[27302,42],[4256,1],[14928,7]]);
 let reads=0;await assert.rejects(()=>readProgrammer({async readWords(a,n){const r=await reader.readWords(a,n);if(a===14928&&++reads===2)r.words[1]=4;return r;}}),e=>e.code==='EVENT_TRANSITION');
});
