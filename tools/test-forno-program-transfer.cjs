const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
function compile(file){const m={exports:{}};const source=require('esbuild').buildSync({entryPoints:[file],bundle:true,platform:'node',format:'cjs',write:false}).outputFiles[0].text;new Function('module','exports','require',source)(m,m.exports,require);return m.exports;}
const api=compile('backend/src/modules/forno/program-transfer.ts'),planApi=compile('backend/src/modules/forno/program-transfer-plan.ts');
const model=compile('src/main/modules/forno/program-draft.ts');
function draft(){let d=model.addStep(model.newProgramDraft(),'ramp');d.name='TEST_Prova';d=model.changeStep(d,0,{targetDeciC:4001,durationMs:65000,events:[true,false,true]});return model.addStep(d,'end');}
function rig(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'aypi-transfer-')),config={host:'simulator',port:502,unit:255,dbPath:path.join(root,'forno.db')};
 const state={name:'Ciclo_1_530_8h',mode:1,amended:0,revision:10,operation:1,status:1,selected:'',listing:0,scalars:{},native:{},strings:{},files:{},writes:[],badLoad:false,ackLost:false,mutateBefore:false};
 const save=()=>structuredClone({name:state.name,scalars:state.scalars,native:state.native,strings:state.strings});state.files[state.name]=save();state.files.TEST_Intruso=save();
 const putFloat=value=>{const b=Buffer.alloc(4);b.writeFloatBE(value);return [b.readUInt16BE(),b.readUInt16BE(2)];};
 const words=text=>Array.from({length:21},(_,i)=>text.charCodeAt(i)||0);
 const read=async(a,n)=>{
  if(a===14928)return [state.mode,state.mode===1?1:2].slice(0,n);if(a===14916)return [state.amended];if(a===4256)return [state.revision];
  if(a===14912)return [state.operation,state.status].slice(0,n);if(a===14917)return [1];
  if(a===14848)return [0,0,1,1];if(a===14880)return [1,0,0,0,1];if(a===14890)return [0,0,1,3];if(a===14894)return Array(8).fill(0);if(a===32768+14902*2)return Array(4).fill(0);
  if(a===15008&&n===8)return Array.from({length:8},(_,i)=>state.scalars[a+i]||0);
  if([5726,5727,5982,5983].some(x=>32768+x*2===a))return putFloat([32768+5726*2,32768+5982*2].includes(a)?700:0);
  if(a===14976)return [0];if(a>=30976&&a<31076)return words(Object.keys(state.files)[a-30976]||'');
  if(a===27323)return words(state.name);if(a>=27344&&a<=27869)return state.strings[a]||words(String(Math.floor((a-27344)/21)+1));
  if(a>=32768){const result=[];for(let i=0;i<n;i++){const addr=a+i,base=Math.floor((addr-32768)/2);result.push(state.native[addr]??((addr-32768)%2===0?(state.scalars[base]||0):0));}return result;}
  return [state.scalars[a]||0];
 };
 const connect=()=>({read,close(){},async refreshList(){state.listing++;},async selectFilename(name){state.selected=name;state.writes.push({kind:'select',name});},async writeRecipe(a,w){if(a===27323)throw Error('Nome programma di sola lettura');const off=(a-15040)%48;if([15008,15009,15014].includes(a)||(a>=15040&&a<16300&&[9,20,29,30,31,32,33].includes(off)))throw Error('Parametro opzionale non disponibile '+a);if(state.rejectAt===a)throw Error('Registro rifiutato '+a);if(a>=15040&&a<16300&&off===0&&(w[0]===0||state.scalars[a]!==w[0])){for(let base=a;base<=16240;base+=48){for(let j=0;j<36;j++){delete state.scalars[base+j];delete state.native[32768+(base+j)*2];delete state.native[32768+(base+j)*2+1];}if(w[0]!==0)break;}}state.writes.push({kind:'write',a,w:[...w]});state.amended=1;if(a===27323)state.name=String.fromCharCode(...w).split('\0')[0];else if(a>=27344&&a<27890)state.strings[a]=[...w];else if(a>=32768)w.forEach((v,i)=>state.native[a+i]=v);else state.scalars[a]=w[0];},async fileOperation(op){state.writes.push({kind:'operation',op,name:state.selected});if(op===4){state.files[state.selected]=save();state.amended=0;if(state.ackLost)throw Error('ACK perso dopo Store');}else if(op===2){const data=state.files[state.selected];if(!data)throw Error('File assente');Object.assign(state,structuredClone(data));state.name=state.selected;state.amended=0;if(state.badLoad)state.scalars[15040]=3;if(state.loadAckLost)throw Error('ACK perso durante Load');}else if(op===8)delete state.files[state.selected];else throw Error('Operazione vietata');state.operation=1;state.status=1;}});
 return {root,config,state,connect,cleanup(){fs.rmSync(root,{recursive:true,force:true});}};
}
async function fixture(run){process.env.AYPI_FORNO_PROGRAM_TRANSFERS='tests';const r=rig();try{await run(r);}finally{r.cleanup();}}
const prepare=(r,d=draft(),actor='Tech')=>api.prepareTransfer(r.config,{action:'upload',draft:d},actor,r.connect);
const execute=(r,ticket,actor='Tech')=>api.executeTransfer(r.config,{token:ticket.token},actor,r.connect);

test('piano indipendente: float32, time_t uint32, eventi, sei tipi e registri documentati',()=>{
 const p=planApi.buildTransferPlan(draft(),{min:0,max:700}),f=a=>p.fields.find(f=>f.address===a);assert(!p.fields.some(f=>f.address===27323),'Il nome caricato non deve essere scritto direttamente');assert(!p.fields.some(f=>[15008,15009,15014].includes(f.address)));assert(!p.fields.some(f=>f.address>=15040&&f.address<16300&&[9,20,29,30,31,32,33].includes((f.address-15040)%48)));assert(!p.fields.some(f=>f.address===15114||f.address===32768+15112*2),'Fine Reset usa uscite e User Value globali');
 assert.deepEqual(f(32768+15044*2).words,[0,65000]);const b=Buffer.alloc(4);b.writeFloatBE(400.1);assert.deepEqual(f(32768+15042*2).words,[b.readUInt16BE(),b.readUInt16BE(2)]);
 assert.deepEqual(f(15066).words,[1]);assert.deepEqual(f(15067).words,[0]);assert.deepEqual(f(15068).words,[1]);assert.deepEqual(f(15088).words,[0]);assert.deepEqual(f(15096).words,[1]);
 assert.throws(()=>planApi.buildTransferPlan({...draft(),name:'Ciclo_1_530_8h'},{min:0,max:700}),/TEST_/);
 let d=draft();d.steps[0].durationMs=1500;assert.throws(()=>planApi.buildTransferPlan(d,{min:0,max:700}),/secondo/);
 d=draft();d.steps[0].targetDeciC=7010;assert.throws(()=>planApi.buildTransferPlan(d,{min:0,max:700}),/limiti/);
 d=model.addStep(model.newProgramDraft(),'step');d.name='TEST_Tipi';d=model.addStep(d,'wait');d=model.addStep(d,'ramp');d=model.addStep(d,'goback');d=model.addStep(d,'end');const all=planApi.buildTransferPlan(d,{min:0,max:700});assert(all.fields.some(f=>f.address===15202&&f.words[0]===3));
});

test('creazione -> Store -> Load -> confronto; originali invariati, nessun Run, backup e ricevuta',()=>fixture(async r=>{
 const original=structuredClone(r.state.files),t=await prepare(r);assert.equal(r.state.writes.length,0);const receipt=await execute(r,t);
 assert(receipt.verified);assert.equal(r.state.mode,1);assert.equal(r.state.name,'TEST_Prova');for(const name of Object.keys(original))assert.deepEqual(r.state.files[name],original[name]);
 assert.deepEqual(r.state.writes.filter(w=>w.kind==='operation').map(w=>w.op),[4,2]);assert(!r.state.writes.some(w=>w.a===14904||w.op===16));
 assert(fs.existsSync(receipt.backup));const backup=JSON.parse(fs.readFileSync(receipt.backup));assert.equal(backup.before.before.name,'Ciclo_1_530_8h');assert.equal(backup.before.segments.length,26);
 const context=await api.transferContext(r.config,r.connect);assert.deepEqual(context.managed,['TEST_Prova']);assert.equal(context.pending,null);await assert.rejects(()=>execute(r,t),/scaduta/);
}));

test('modifica e cancellazione solo proprie prove; ripristina RAM iniziale e conserva tutti gli altri file',()=>fixture(async r=>{
 await execute(r,await prepare(r));let changed=draft();changed=model.changeStep(changed,0,{targetDeciC:5000,events:[false,true,false]});await execute(r,await prepare(r,changed));
 assert.equal(r.state.scalars[15067],1);const t=await api.prepareTransfer(r.config,{action:'delete',name:'TEST_Prova'},'Tech',r.connect);const receipt=await execute(r,t);
 assert(receipt.verified);assert(!r.state.files.TEST_Prova);assert(r.state.files.Ciclo_1_530_8h);assert(r.state.files.TEST_Intruso);assert.equal(r.state.name,'Ciclo_1_530_8h');assert.equal(r.state.writes.at(-1).op,8);
}));

test('conflitti, Run/Hold, collisioni e modifiche pannello sono bloccati prima delle scritture',()=>fixture(async r=>{
 const collision=draft();collision.name='TEST_Intruso';await assert.rejects(()=>prepare(r,collision),/protetto/);assert.equal(r.state.writes.length,0);
 for(const mode of [2,4]){r.state.mode=mode;await assert.rejects(()=>prepare(r),/Reset/);}r.state.mode=1;
 const t=await prepare(r);r.state.revision++;await assert.rejects(()=>execute(r,t),/cambiato/);assert.equal(r.state.writes.length,0);
 r.state.amended=1;await assert.rejects(()=>prepare(r),/Reset/);r.state.amended=0;
 const t2=await prepare(r);await assert.rejects(()=>execute(r,t2,'Altro'),/non valida/);assert(!r.state.writes.some(w=>w.kind==='write'||w.op===4||w.op===8));
}));

test('ACK perso dopo Store: niente retry n? ulteriori scritture; blocco persistente dopo riavvio',()=>fixture(async r=>{
 const t=await prepare(r);r.state.ackLost=true;await assert.rejects(()=>execute(r,t),/Esito non verificato/);
 assert.equal(r.state.writes.filter(w=>w.kind==='operation').length,1);assert(r.state.files.TEST_Prova);
 const state=JSON.parse(fs.readFileSync(path.join(r.root,'forno-program-transfers/state.json')));assert(state.pending);assert(fs.existsSync(state.pending.backup));
 await assert.rejects(()=>prepare(r),/precedente/);
 const restarted=compile('backend/src/modules/forno/program-transfer.ts');assert((await restarted.transferContext(r.config,r.connect)).pending);
}));

test('Load con parametri alterati non viene dichiarato riuscito e mantiene il backup',()=>fixture(async r=>{
 const t=await prepare(r);r.state.badLoad=true;await assert.rejects(()=>execute(r,t),/Rilettura diversa/);assert((await api.transferContext(r.config,r.connect)).pending);
}));


test('trasporto: Run, I/O, Delete All e scritture arbitrarie non sono rappresentabili',()=>{
 const {createProgramConnection}=compile('backend/src/modules/forno/programs.ts');const client=createProgramConnection({host:'127.0.0.1',port:1,unit:255});
 for(const address of [14904,14905,14906,14912,14893,5726,32768+14904*2])assert.throws(()=>client.writeRecipe(address,[1]),/consentiti/);
 assert.throws(()=>client.writeRecipe(27323,Array(21).fill(0)),/consentiti/);assert.throws(()=>client.fileOperation(16),/non consentita/);assert.throws(()=>client.writeRecipe(15042,[NaN,1]),/consentiti/);client.close();
});


test('recupero solo immagine invariata e prova assente: conserva tracce, rispetta il menu file del pannello e non modifica programmi',()=>fixture(async r=>{
 const t=await prepare(r);r.state.rejectAt=15013;await assert.rejects(()=>execute(r,t),/registro 15013/);
 r.state.operation=2;const files=structuredClone(r.state.files),writes=r.state.writes.length;
 await assert.rejects(()=>api.reconcileUnchangedTransfer(r.config,'Tech',r.connect),/pannello/);assert.equal(r.state.writes.length,writes);r.state.operation=1;
 const result=await api.reconcileUnchangedTransfer(r.config,'Tech',r.connect);assert(result.verified);assert.equal(r.state.operation,1);assert.deepEqual(r.state.files,files);
 assert.deepEqual(r.state.writes.slice(writes),[]);const state=JSON.parse(fs.readFileSync(path.join(r.root,'forno-program-transfers/state.json')));assert.equal(state.pending,null);assert(fs.existsSync(state.lastReconciliation));
 assert(fs.existsSync(state.lastReconciliation.replace('.reconciled.json','.state-before-reconcile.json')));
}));

test('recupero rifiutato con RAM parzialmente modificata',()=>fixture(async r=>{
 const t=await prepare(r);r.state.rejectAt=32768+15044*2;await assert.rejects(()=>execute(r,t),/Esito non verificato/);
 const writes=r.state.writes.length;await assert.rejects(()=>api.reconcileUnchangedTransfer(r.config,'Tech',r.connect),/RAM/);assert.equal(r.state.writes.length,writes);assert((await api.transferContext(r.config,r.connect)).pending);
}));


test('recupero rifiutato se compare un file TEST o se il backup non supera il checksum',()=>fixture(async r=>{
 const t=await prepare(r);r.state.rejectAt=15013;await assert.rejects(()=>execute(r,t),/Esito non verificato/);
 r.state.files.TEST_Prova=structuredClone(r.state.files.Ciclo_1_530_8h);await assert.rejects(()=>api.reconcileUnchangedTransfer(r.config,'Tech',r.connect),/Archivio/);delete r.state.files.TEST_Prova;
 const stateFile=path.join(r.root,'forno-program-transfers/state.json'),state=JSON.parse(fs.readFileSync(stateFile));const backup=JSON.parse(fs.readFileSync(state.pending.backup));backup.sha256='alterato';fs.writeFileSync(state.pending.backup,JSON.stringify(backup));
 await assert.rejects(()=>api.reconcileUnchangedTransfer(r.config,'Tech',r.connect),/Backup/);assert(JSON.parse(fs.readFileSync(stateFile)).pending);
}));


test('profilo macchina: parametri opzionali mai scritti e attesa digitale senza soglia analogica',()=>fixture(async r=>{
 let d=model.addStep(model.newProgramDraft(),'wait');d.name='TEST_Digitale';d=model.addStep(d,'end');
 d.steps[0].waitFor=0;
 const p=planApi.buildTransferPlan(d,{min:0,max:700});assert(p.fields.some(f=>f.address===15053));assert(!p.fields.some(f=>f.address===15054||f.address===32768+15056*2));
 const t=await prepare(r,d);await execute(r,t);
 assert(r.state.writes.filter(w=>w.kind==='write').every(w=>![15008,15009,15014].includes(w.a)));
}));

test('impostazioni globali rifiutate prima di troncare la coda dei segmenti',()=>fixture(async r=>{
 r.state.rejectAt=15013;const t=await prepare(r);await assert.rejects(()=>execute(r,t),/15013/);
 assert(!r.state.writes.some(w=>w.kind==='write'));assert(!r.state.writes.some(w=>w.kind==='operation'));
 const journal=JSON.parse(fs.readFileSync(path.join(r.root,'forno-program-transfers','state.json')));assert(journal.pending);assert.equal(journal.pending.lastField.address,15013);
}));


test('Fine tronca la coda RAM: errore successivo resta bloccato finche non si ricarica e confronta il salvato',()=>fixture(async r=>{
 r.state.scalars[15088]=2;r.state.scalars[15136]=1;
 const original=structuredClone(r.state.files);const t=await prepare(r);r.state.rejectAt=32768+15044*2;
 await assert.rejects(()=>execute(r,t),/Esito non verificato/);assert.equal(r.state.scalars[15136],undefined);
 await assert.rejects(()=>api.reconcileUnchangedTransfer(r.config,'Tech',r.connect),/RAM/);
 assert.deepEqual(r.state.files,original);assert(!r.state.writes.some(w=>w.kind==='operation'));
}));


test('Load: residuo EndType in una Stasi e inattivo; ricevuta conserva la differenza senza scrivere al forno',()=>fixture(async r=>{
 r.state.scalars[15088]=2;const t=await prepare(r);r.state.rejectAt=15013;await assert.rejects(()=>execute(r,t),/Esito non verificato/);
 r.state.scalars[15096]=1;const writes=r.state.writes.length;
 const result=await api.reconcileUnchangedTransfer(r.config,'Tech',r.connect);assert(result.verified);assert.equal(r.state.writes.length,writes);
 const proof=JSON.parse(fs.readFileSync(result.receipt));assert.equal(proof.outcome,'original-restored-test-absent');assert.deepEqual(proof.inactiveFields.map(f=>[f.phase,f.address,f.before,f.after]),[[2,15096,0,1]]);
}));

test('EndType resta vincolante per Fine; nomi, eventi e word adiacenti non sono ignorati',()=>fixture(async r=>{
 const t=await prepare(r);r.state.rejectAt=15013;await assert.rejects(()=>execute(r,t),/Esito non verificato/);
 for(const [address,value]of [[15096,1],[15089,3],[15066,1]]){
  r.state.scalars[address]=value;await assert.rejects(()=>api.reconcileUnchangedTransfer(r.config,'Tech',r.connect),/RAM/);delete r.state.scalars[address];
 }
 r.state.strings[27344]=Array.from({length:21},(_,i)=>'Altro'.charCodeAt(i)||0);await assert.rejects(()=>api.reconcileUnchangedTransfer(r.config,'Tech',r.connect),/RAM/);
 assert(JSON.parse(fs.readFileSync(path.join(r.root,'forno-program-transfers/state.json'))).pending);
}));


const inspect=(r,name=r.state.name,actor='Tech')=>api.inspectProgram(r.config,{name},actor,r.connect);
test('manage: nuovo programma senza TEST_, sovrascrittura esplicita con snapshot e backup del contenuto precedente',()=>fixture(async r=>{
 process.env.AYPI_FORNO_PROGRAM_TRANSFERS='manage';const original=structuredClone(r.state.files),name=r.state.name,recipe=await inspect(r);
 assert(recipe.editToken);assert(recipe.loadedInReset);assert.equal(recipe.name,name);assert.deepEqual(r.state.writes.filter(w=>w.kind==='operation').map(w=>w.op),[2]);
 const d=draft();d.name=name;
 await assert.rejects(()=>api.prepareTransfer(r.config,{action:'upload',draft:d},'Tech',r.connect),/esplicitamente/);
 await assert.rejects(()=>api.prepareTransfer(r.config,{action:'upload',draft:d,overwrite:true},'Tech',r.connect),/riferimento/);
 const t=await api.prepareTransfer(r.config,{action:'upload',draft:d,overwrite:true,expectedSnapshot:recipe.editToken},'Tech',r.connect);
 assert(t.exists);assert(t.message.includes('SOVRASCRITTURA'));const result=await execute(r,t);assert(result.verified);
 const b=JSON.parse(fs.readFileSync(result.backup));assert(b.targetExisted);assert.equal(b.before.before.name,name);assert.equal(b.recipeBefore.name,name);assert.equal(b.before.segments.length,26);
 assert.notDeepEqual(r.state.files[name],original[name]);assert.deepEqual(r.state.files.TEST_Intruso,original.TEST_Intruso);
 let fresh=draft();fresh.name='Ciclo_Nuovo';const nt=await prepare(r,fresh);await execute(r,nt);assert(r.state.files.Ciclo_Nuovo);
}));

test('manage: conflitto dopo lettura, token di altro operatore e collisione di maiuscole bloccati prima di Store',()=>fixture(async r=>{
 process.env.AYPI_FORNO_PROGRAM_TRANSFERS='manage';const recipe=await inspect(r),d=draft();d.name=r.state.name;
 const request={action:'upload',draft:d,overwrite:true,expectedSnapshot:recipe.editToken};
 await assert.rejects(()=>api.prepareTransfer(r.config,request,'Altro',r.connect),/riferimento/);
 r.state.scalars[15042]=5;await assert.rejects(()=>api.prepareTransfer(r.config,request,'Tech',r.connect),/cambiato/);delete r.state.scalars[15042];
 const variant={...d,name:d.name.toLowerCase()};await assert.rejects(()=>api.prepareTransfer(r.config,{...request,draft:variant},'Tech',r.connect),/maiuscole/);
 assert(!r.state.writes.some(w=>w.kind==='write'||w.op===4||w.op===8));
}));

test('manage: lettura di un altro file solo in Reset, poi eliminazione di un programma preesistente con backup',()=>fixture(async r=>{
 process.env.AYPI_FORNO_PROGRAM_TRANSFERS='manage';const name='TEST_Intruso',original=structuredClone(r.state.files),recipe=await inspect(r,name);
 assert.equal(r.state.name,name);assert.equal(recipe.name,name);assert.deepEqual(r.state.writes.filter(w=>w.kind==='operation').map(w=>w.op),[2]);
 const t=await api.prepareTransfer(r.config,{action:'delete',name,expectedSnapshot:recipe.editToken},'Tech',r.connect);const result=await execute(r,t);
 assert(result.verified);assert(!r.state.files[name]);assert.deepEqual(r.state.files.Ciclo_1_530_8h,original.Ciclo_1_530_8h);
 assert.equal(r.state.name,'Ciclo_1_530_8h');const b=JSON.parse(fs.readFileSync(result.backup));assert.equal(b.before.before.name,name);assert.equal(b.recipeBefore.name,name);
 assert.deepEqual(r.state.writes.filter(w=>w.kind==='operation').map(w=>w.op),[2,2,2,8]);
}));

test('manage: errore Load persiste nel journal e non consente successive mutazioni; off/tests non sbloccano originali',()=>fixture(async r=>{
 await assert.rejects(()=>inspect(r),/gestione completa/);process.env.AYPI_FORNO_PROGRAM_TRANSFERS='off';await assert.rejects(()=>inspect(r),/gestione completa/);
 process.env.AYPI_FORNO_PROGRAM_TRANSFERS='manage';r.state.mode=2;await assert.rejects(()=>inspect(r,'TEST_Intruso'),/Reset/);r.state.mode=1;r.state.amended=1;await assert.rejects(()=>inspect(r,'TEST_Intruso'),/Reset/);r.state.amended=0;
 r.state.loadAckLost=true;await assert.rejects(()=>inspect(r,'TEST_Intruso'),/Caricamento non verificato/);
 const state=JSON.parse(fs.readFileSync(path.join(r.root,'forno-program-transfers/state.json')));assert.equal(state.pending.action,'inspect');assert(fs.existsSync(state.pending.backup));
 await assert.rejects(()=>prepare(r),/precedente/);assert(!r.state.writes.some(w=>w.kind==='write'||w.op===4||w.op===8));
}));

test('manage: cambio modalita dopo preparazione e cancellazione ultimo programma bloccati',()=>fixture(async r=>{
 process.env.AYPI_FORNO_PROGRAM_TRANSFERS='manage';const recipe=await inspect(r),name=r.state.name;
 delete r.state.files.TEST_Intruso;await assert.rejects(()=>api.prepareTransfer(r.config,{action:'delete',name,expectedSnapshot:recipe.editToken},'Tech',r.connect),/altro programma/);
 const d=draft();d.name='Nuovo';const t=await prepare(r,d);process.env.AYPI_FORNO_PROGRAM_TRANSFERS='tests';await assert.rejects(()=>execute(r,t),/Modalita/);
 assert(!r.state.writes.some(w=>w.kind==='write'||w.op===4||w.op===8));
}));


test('manage: il file salvato e riletto prima di sovrascrivere/eliminare; cambiamento esterno blocca Store e Delete',()=>fixture(async r=>{
 process.env.AYPI_FORNO_PROGRAM_TRANSFERS='manage';const name=r.state.name,recipe=await inspect(r),d=draft();d.name=name;
 const t=await api.prepareTransfer(r.config,{action:'upload',draft:d,overwrite:true,expectedSnapshot:recipe.editToken},'Tech',r.connect);
 r.state.files[name].scalars[15066]=1;
 await assert.rejects(()=>execute(r,t),/file salvato e cambiato/);
 assert(!r.state.writes.some(w=>w.kind==='write'||w.op===4||w.op===8));
 const registry=JSON.parse(fs.readFileSync(path.join(r.root,'forno-program-transfers/state.json')));assert.equal(registry.pending.stage,'verify-stored-target');assert(fs.existsSync(registry.pending.backup));
}));
