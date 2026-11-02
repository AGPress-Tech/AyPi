const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path'),zlib=require('zlib');
function compile(file){const m={exports:{}};const source=require('esbuild').buildSync({entryPoints:[file],bundle:true,platform:'node',format:'cjs',write:false}).outputFiles[0].text;new Function('module','exports','require',source)(m,m.exports,require);return m.exports;}
const native=compile('src/main/modules/forno/program-native.ts'),library=compile('src/main/modules/forno/program-library.ts'),model=compile('src/main/modules/forno/program-draft.ts');
const fixture=require('./fixtures/forno-native-2026-11-02.json');
const clone=()=>Buffer.from(';$SERVER-PROGID\nEurothermIDM.Serialize.4\n;$IDM-PROGID\nEurothermIDM.nanodac.811\nProgram0, 0, "09", 0, 0, 0, ""\n'+fixture.files.map(f=>`Program${f.index}, ${f.index}, "${f.cloneRecordHex}", 0, 0, 0, ""`).join('\n')+'\n');
function temp(run){const folder=fs.mkdtempSync(path.join(os.tmpdir(),'aypi-forno-library-'));try{return run(folder,path.join(folder,'library.json'));}finally{fs.rmSync(folder,{recursive:true,force:true});}}

test('clone reale: estrae tutti e 9 i gzip originali senza ricomprimerli; conteggio e CRC verificati',()=>{
    const files=native.extractClonePrograms(clone());assert.equal(files.length,9);
    assert.deepEqual(native.extractClonePrograms(Buffer.from('\uFEFF'+clone().toString().replaceAll('\n','\r\n'))),files);
    files.forEach((f,i)=>{assert.equal(f.sha256,fixture.files[i].sha256);assert.deepEqual(native.nativeBytes(f),Buffer.from(fixture.files[i].base64,'base64'));assert.equal(native.decodeNative(f).name,f.filename.replace('.uipz',''));});
    assert.throws(()=>native.extractClonePrograms(Buffer.from(clone().toString().replace('"09"','"0A"'))),/tutti/);
    const broken=clone().toString().replace(fixture.files[0].cloneRecordHex,fixture.files[0].cloneRecordHex.slice(0,-10)+'AAAAAAAAAA');assert.throws(()=>native.extractClonePrograms(Buffer.from(broken)));
});
test('rilettura indipendente: XML originale ciclo 1 corrisponde ai parametri FC03; stasi a zero conservate',()=>{
    const d=native.decodeNative(fixture.files[0]);assert.equal(model.reviewDraft(d).durationMs,39630000);assert.deepEqual(d.steps[6].events,[true,true,true]);assert.equal(d.steps[1].userValueDeci,50);
    const {decodeRecipeSegment}=require('../backend-dist/modules/forno/program-recipe'),fc03=require('./fixtures/forno-cycle1-2026-11-02.json');
    d.steps.forEach((s,i)=>{const raw=fc03.segments[i],decoded=decodeRecipeSegment(i+1,String(i+1),raw.words,1);assert.equal(s.durationMs,(s.kind==='ramp'?decoded.rampSeconds[0]:decoded.durationSeconds)*1000);assert.equal(s.userValueDeci,decoded.userValues[0]*10);assert.deepEqual(s.events,decoded.events.slice(0,3));});
    assert.equal(native.decodeNative(fixture.files[1]).steps[3].userValueDeci,0,'non associare automaticamente 5 a tutte le stasi importate');
    assert.equal(model.addStep(model.newProgramDraft(),'dwell').steps[0].userValueDeci,50,'solo nuove stasi propongono 5');
});
test('file generato: nomi XML escapati, nome Fine, tempi ms ed eventi singoli; rilettura e differenziale sui 9 originali',()=>{
    for(const f of fixture.files){const d=native.decodeNative(f),encoded=native.encodeNative(d),decoded=native.decodeNative(encoded);assert.deepEqual(decoded,d);}
    let d=model.addStep(model.addStep(model.newProgramDraft(),'ramp'),'end');d.name='Nuovo';d.steps[1].label='Fine & controllo';d=model.changeStep(d,0,{label:'Caldo < prova',targetDeciC:5301,durationMs:1234567,events:[false,true,false]});
    const decoded=native.decodeNative(native.encodeNative(d));assert.deepEqual(decoded,d);
    const firstDwell=model.changeStart(model.addStep(model.addStep(model.newProgramDraft(),'dwell'),'end'),375);assert.deepEqual(model.changeStart(native.decodeNative(native.encodeNative(firstDwell)),375),firstDwell);
    const bad=zlib.gunzipSync(native.nativeBytes(native.encodeNative(d))).toString().replace('<P>25</P>','<P>99</P>');
    assert.throws(()=>native.decodeNative(native.nativeFile('Nuovo.uipz',zlib.gzipSync(bad))),/aggiuntivi/);
});
test('backup/import multipli: originale e clone identici, archivi distinti non sovrascrivono per nome',()=>temp((folder,file)=>{
    const input=path.join(folder,'forno.uic');fs.writeFileSync(input,clone());const state=library.importProgramFiles(file,[input]);assert.equal(state.entries.length,9);
    const backup=path.join(folder,'originali.aypi-forno-backup.json');const result=library.exportBackupFile(file,backup);assert.equal(result.count,9);assert.equal(result.originals,9);assert.equal(result.hardwareRestoreVerified,false);
    const saved=JSON.parse(fs.readFileSync(backup));assert.deepEqual(Buffer.from(saved.payload.sources[0].base64,'base64'),clone());
    const imported=path.join(folder,'other.json');library.importProgramFiles(imported,[backup]);assert.equal(library.readLibrary(imported).entries.length,9);
    library.importProgramFiles(imported,[backup]);assert.equal(library.readLibrary(imported).entries.length,18);assert.equal(new Set(library.readLibrary(imported).entries.map(e=>e.id)).size,18);
    const originalState=library.readLibrary(file);const prepared=library.prepareRestoreFiles(file,folder,originalState.entries.map(e=>e.id),true);const manifest=JSON.parse(fs.readFileSync(path.join(prepared.path,'VERIFICA.json')));
    manifest.programs.forEach((p,i)=>assert.deepEqual(fs.readFileSync(path.join(prepared.path,p.filename)),Buffer.from(fixture.files[i].base64,'base64')));assert.equal(manifest.deviceWritesEnabled,false);
}));
test('backup alterato e importazione parziale rifiutati senza cambiare l’archivio',()=>temp((folder,file)=>{
    const one=path.join(folder,fixture.files[0].filename);fs.writeFileSync(one,Buffer.from(fixture.files[0].base64,'base64'));library.importProgramFiles(file,[one]);const before=fs.readFileSync(file,'utf8');
    const invalid=path.join(folder,'invalid.json');fs.writeFileSync(invalid,'{"format":"futuro"}');assert.throws(()=>library.importProgramFiles(file,[one,invalid]));assert.equal(fs.readFileSync(file,'utf8'),before);
    const backup=path.join(folder,'backup.json');library.exportBackupFile(file,backup);const b=JSON.parse(fs.readFileSync(backup));b.payload.entries[0].draft.steps[0].events=[true,false,false];fs.writeFileSync(backup,JSON.stringify(b));assert.throws(()=>library.importProgramFiles(file,[backup]),/SHA-256/);assert.equal(fs.readFileSync(file,'utf8'),before);
}));
test('modifica in nuova versione e cancellazione locale reversibile conservano sempre originali',()=>temp((folder,file)=>{
    const input=path.join(folder,'forno.uic');fs.writeFileSync(input,clone());const imported=library.importProgramFiles(file,[input]),first=imported.entries[0],modified=structuredClone(first.draft);modified.steps[0].events=[true,false,false];modified.name='Copia';
    const saved=library.archiveDraft(file,modified,first.id);assert.equal(saved.entries.length,10);assert.equal(saved.entries[0].original.sha256,first.original.sha256);assert.equal(saved.entries[9].original.sha256,first.original.sha256);
    assert.notDeepEqual(saved.entries[0].draft,saved.entries[9].draft);
    const deleted=library.setLocalDeletion(file,[first.id],saved.revision,true);assert(deleted.entries[0].deletedAtMs);assert.equal(deleted.entries[0].original.sha256,first.original.sha256);
    assert.throws(()=>library.setLocalDeletion(file,[first.id],saved.revision,false),/cambiato/);
    const recovered=library.setLocalDeletion(file,[first.id],deleted.revision,false);assert.equal(recovered.entries[0].deletedAtMs,undefined);
    const full=library.buildBackup(library.readLibrary(file));assert.equal(full.payload.entries.length,10);
}));
test('formato non supportato: originale salvato/esportabile ma nessuna conversione silenziosa',()=>temp((folder,file)=>{
    const xml=zlib.gunzipSync(Buffer.from(fixture.files[0].base64,'base64')).toString().replace('version="811"','version="999"');const input=path.join(folder,fixture.files[0].filename);fs.writeFileSync(input,zlib.gzipSync(xml));const imported=library.importProgramFiles(file,[input]);assert.equal(imported.entries.length,1);assert.equal(imported.entries[0].draft,undefined);assert(imported.entries[0].original);
    assert.throws(()=>library.prepareRestoreFiles(file,folder,[imported.entries[0].id],false),/non editabile/);
    assert.equal(library.prepareRestoreFiles(file,folder,[imported.entries[0].id],true).count,1);
}));
test('caricamento temporaneo bloccato dal servizio prima di qualsiasi accesso al forno',async()=>{
    const service=require('../backend-dist/modules/forno/service');await assert.rejects(service.getFornoProgramRecipe('Ciclo_1_530_8h',true,'Altro'),/Caricamento temporaneo sospeso/);
});

test('tutti i tipi nei file nativi: enum e indici Wait/GoBack verificati indipendentemente dal decoder',()=>{
    let d=model.addStep(model.newProgramDraft(),'step');d=model.changeStep(d,0,{targetDeciC:1000});d=model.addStep(d,'ramp');d=model.addStep(d,'dwell');d=model.addStep(d,'wait');d=model.changeStep(d,3,{waitFor:1,waitCondition:3,waitValueDeci:125});d=model.addStep(d,'goback');d=model.changeStep(d,4,{goBackTo:2,cycles:2});d=model.addStep(d,'end');d=model.changeStep(d,5,{endAction:'dwell',events:[true,false,true],userValueDeci:50});
    const file=native.encodeNative(d),xml=zlib.gunzipSync(native.nativeBytes(file)).toString();assert.deepEqual(native.decodeNative(file),d);
    const lists=Array.from(xml.matchAll(/<List type="segment"[^>]*>([\s\S]*?)<\/List>/g),m=>Object.fromEntries(Array.from(m[1].matchAll(/<M><P>(\d+)<\/P><V>([^<]*)<\/V><\/M>/g),p=>[p[1],p[2]])));
    assert.deepEqual(lists.map(p=>p[1]),['3','1','2','4','5','0']);assert.equal(lists[3][14],'1');assert.equal(lists[3][15],'3');assert.equal(lists[3][17],'12.5');assert.equal(lists[4][19],'2');assert.equal(lists[4][20],'2');assert.equal(lists[5][9],'0');assert.equal(lists[5][27],'1');assert.equal(lists[5][28],'0');assert.equal(lists[5][29],'1');
    assert.throws(()=>native.encodeNative(model.newProgramDraft()),/Fine/);
});
