const test = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');
const { buildManagementData, margins, percentage } = require('../dist-ts/modules/management/model');
const { registerAdminStateIpc } = require('../dist-ts/modules/file-manager/admin-state-ipc');
const { queryMovements } = require('../dist-ts/modules/management/movement-query');
const {readTargets,saveTarget,targetKey,targetResult,validateTarget}=require('../dist-ts/modules/management/targets');

function workbook() {
  const wb=XLSX.utils.book_new();
  const add=(name,rows)=>XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(rows),name);
  add('Filtri', [['Gruppo','Categoria'],['Vendite','Ricavi di Produzione'],['Energia','Costi Variabili'],['Fissi','Costi Fissi']]);
  add('Calcoli', [['Gruppo','Codice','% applicata'],['Vendite','0701','100%'],['Energia','06021003','90%'],['Fissi','06021003','0,1']]);
  add('Bilancino', [['DataCompetenza','Codice','TipoCodice','Valore','Descrizione'],['2026-01-31','07011001',1,-1000,'Vendite'],['2026-01-31','06021003',1,200,'Energia'],['2026-01-31','060210030',1,400,'Non è il conto esatto'],['2026-01-31','07011001',5177346,1000,'Chiusura'],['data errata','07011001',1,-20,'Esclusa'],['2004-02-01','07011001',1,-50,'Storico']]);
  return wb;
}
test('ripartizioni, codice esatto, segno, chiusure, date e anni storici',()=>{
  const d=buildManagementData(workbook());
  assert.deepEqual(d.years,[2004,2026]);
  assert.deepEqual(d.periods[2026],[1]);
  assert.equal(d.quality.closing,1); assert.equal(d.quality.invalidDates,1);
  assert.equal(d.quality.unmatchedAccounts,1); assert.equal(d.quality.unmatchedValue,400);
  assert.equal(d.points.find(p=>p.year===2026&&p.group==='Vendite').value,1000);
  assert.equal(d.points.find(p=>p.group==='Energia').value,-180);
  assert.equal(d.points.find(p=>p.group==='Fissi').value,-20);
  for(const v of ['90%','90','0,9',0.9,90]) assert.equal(percentage(v),0.9);
  assert.equal(percentage(null),0); assert.throws(()=>percentage('non numero'));
});
test('formule dei margini: ammortamenti inclusi in M2, Algeria e gestioni in M3',()=>{
  const r=margins({'Ricavi di Produzione':1000,'Costi Variabili':-180,'Costi Fissi':-20,'Ammortamento e Svalutazioni':-50,'Subtotale Ricavi non legati alla Produzione':70,'Subtotale Costi non legati alla Produzione':-10,'Gestione Finanziaria':-5,'Gestione Straordinaria':3});
  assert.deepEqual(r,{'Margine 1':820,'Margine 2':750,'Totale Algeria':60,'Margine 3':808});
});
test('movimenti: stessa origine dei saldi, quote, periodi, esclusioni e lettura progressiva',()=>{
  const index=Object.create(null);
  const wb=workbook();
  const data=buildManagementData(wb,'fixture.xlsx','2026-11-06',m=>(index[m.code]||=[]).push(m));
  assert.equal(Object.values(index).flat().length,3);
  assert.equal(index['060210030'],undefined);
  assert.equal(index['06021003'][0].competenceDate,'2026-01-31');
  assert.equal(index['06021003'][0].sourceRow,3);
  const request={snapshot:data.loadedAt,code:'06021003',group:'Energia',ranges:[{year:2026,from:1,to:1}],offset:0,limit:1};
  const result=queryMovements(data,index,request);
  assert.equal(result.total,1);assert.equal(result.items[0].value,200);
  assert.equal(result.items[0].allocatedValue,-180);assert.equal(result.share,.9);
  assert.equal(queryMovements(data,index,{...request,ranges:[{year:2026,from:2,to:2}]}).total,0);
  const sales={...request,code:'07011001',group:'Vendite',ranges:[{year:2004,from:1,to:12},{year:2026,from:1,to:12}]};
  const first=queryMovements(data,index,sales),second=queryMovements(data,index,{...sales,offset:first.nextOffset});
  assert.equal(first.total,2);assert.equal(first.items[0].year,2004);assert.equal(second.items[0].year,2026);
  assert.notEqual(first.items[0].sourceRow,second.items[0].sourceRow);
  assert.throws(()=>queryMovements(data,index,{...request,snapshot:'old'}),/aggiornati/);
  assert.throws(()=>queryMovements(data,index,{...request,group:'Vendite'}),/non appartiene/);
  assert.throws(()=>queryMovements(data,index,{...request,ranges:[{year:2026,from:0,to:13}]}),/Periodo/);
  assert.throws(()=>queryMovements(data,index,{...request,offset:-1}),/Intervallo/);
});
test('strutture incoerenti bloccano l’importazione; sovrapposizioni segnalate',()=>{
  let wb=workbook(); delete wb.Sheets.Calcoli; assert.throws(()=>buildManagementData(wb),/Calcoli/);
  wb=workbook(); wb.Sheets.Filtri=XLSX.utils.aoa_to_sheet([['Gruppo','Categoria'],['Vendite','A'],['Vendite','A']]);
  assert.throws(()=>buildManagementData(wb),/duplicato/);
  wb=workbook(); wb.Sheets.Calcoli=XLSX.utils.aoa_to_sheet([['Gruppo','Codice','% applicata'],['Assente','07',1]]);
  assert.throws(()=>buildManagementData(wb),/assente in Filtri/);
  wb=workbook(); wb.Sheets.Calcoli=XLSX.utils.aoa_to_sheet([['Gruppo','Codice','% applicata'],['Vendite','07',1],['Energia','07011001',1]]);
  assert.equal(buildManagementData(wb).quality.overlappingAccounts,1);
});
test('accesso con AGPress, rifiuto AGPRESS, revoca e broadcast per tutte le finestre',async()=>{
  const handlers=new Map(), events=[];let revoked=0;
  const state=registerAdminStateIpc({ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},browserWindow:{getAllWindows:()=>[{webContents:{send:(...args)=>events.push(args)}}]},onManagementDisabled:()=>revoked++});
  assert.equal(state.canAccessManagement(),false);
  assert.deepEqual(await handlers.get('admin-auth')({},'AGPRESS'),{ok:false});
  assert.equal(state.canAccessManagement(),false);
  assert.deepEqual(await handlers.get('admin-auth')({},'AGPress'),{ok:true});
  assert.equal(await handlers.get('management-is-enabled')(),true);
  assert.deepEqual(events.at(-1),['admin-state-changed',{enabled:true,management:true}]);
  await handlers.get('admin-disable')();
  assert.equal(state.canAccessManagement(),false);assert.equal(revoked,1);
});
test('obiettivi: persistenza per anno e periodo, rimozione e file incoerenti preservati',async()=>{
  const fs=require('fs'),os=require('os'),path=require('path');
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'aypi-goals-test-')),file=path.join(folder,'targets.json');
  try{
    const scope={year:2026,from:1,to:7,metric:'Ricavi di Produzione',value:1200};
    assert.deepEqual(Object.keys(await readTargets(file)),[]);
    await saveTarget(file,scope);
    await saveTarget(file,{...scope,to:12,value:2000});
    let saved=await readTargets(file);assert.equal(saved[targetKey(scope)].value,1200);assert.equal(Object.keys(saved).length,2);
    await saveTarget(file,{...scope,value:null});saved=await readTargets(file);assert.equal(saved[targetKey(scope)],undefined);
    assert.equal(saved[targetKey({...scope,to:12})].value,2000);
    assert.deepEqual(targetResult(800,1000,'Costi gestionali'),{gap:200,reached:true,percent:80});
    assert.deepEqual(targetResult(1200,1000,'Ricavi di Produzione'),{gap:200,reached:true,percent:120});
    assert.equal(targetResult(-10,0,'Margine 3').reached,false);
    assert.equal(targetResult(0,0,'Margine 3').reached,true);
    assert.throws(()=>validateTarget({...scope,value:-1}));assert.throws(()=>validateTarget({...scope,value:Infinity}));
    assert.throws(()=>validateTarget({...scope,metric:'inventato'}));assert.throws(()=>validateTarget({...scope,from:8,to:7}));
    fs.writeFileSync(file,'corrotto');await assert.rejects(saveTarget(file,scope),/leggere/);assert.equal(fs.readFileSync(file,'utf8'),'corrotto');
  }finally{if(fs.existsSync(file))fs.unlinkSync(file);fs.rmdirSync(folder);}
});
test('IPC: apertura e lettura richiedono sessione e mittente corretti; cache e revoca',async(t)=>{
  const vm=require('vm'),fs=require('fs'),os=require('os'),path=require('path'),{EventEmitter}=require('events');
  const folder=fs.mkdtempSync(path.join(os.tmpdir(),'aypi-goals-ipc-'));
  t.after(()=>{const file=path.join(folder,'management-targets.json');if(fs.existsSync(file))fs.unlinkSync(file);fs.rmdirSync(folder)});
  const handlers=new Map();let allowed=false,created=0,reads=0,active;
  const main={webContents:{id:1}};
  class Window extends EventEmitter {
    constructor(options){super();this.options=options;created++;active=this;this.closed=false;this.webContents=new EventEmitter();this.webContents.setWindowOpenHandler=()=>{};this.webContents.isDestroyed=()=>this.closed}
    setMenu(){} maximize(){this.maximized=true} show(){} focus(){} async loadFile(){} isDestroyed(){return this.closed} destroy(){this.closed=true;this.emit('closed')}
  }
  class Worker extends EventEmitter {
    constructor(){super();reads++;setImmediate(()=>this.emit('message',{ok:true,data:{points:[],sourceKind:'sql'}}))}
    terminate(){this.emit('exit',0)}
  }
  const module={exports:{}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../dist-ts/modules/management/ipc'),'utf8'),{
    module,exports:module.exports,__dirname:__dirname,Buffer,Uint8Array,setTimeout,clearTimeout,
    require:name=>name==='electron'?{BrowserWindow:Window,ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},dialog:{},app:{getPath:()=>folder}}:name==='worker_threads'?{Worker}:name==='./model'?{SOURCE_PATH:'fixture.xlsx'}:name==='./movement-query'?{queryMovements}:name==='./targets'?{readTargets,saveTarget}:name==='./analytics-client'?{createAnalyticsClient:()=>({query:async()=>({rows:[],columns:[]}),logout:async()=>{}})}:require(name),
  });
  const service=module.exports.registerManagementIpc(main,()=>allowed,()=> '');
  const call=(name,sender,...args)=>handlers.get(name)({sender},...args);
  assert.equal((await call('management-open',main.webContents)).ok,false);assert.equal(created,0);
  assert.equal((await call('management-load',main.webContents)).ok,false);assert.equal(reads,0);
  allowed=true;
  assert.equal((await call('management-open',{})).ok,false);
  assert.equal((await call('management-open',main.webContents)).ok,true);assert.equal(created,1);assert.equal(active.maximized,true);assert.equal(active.options.parent,undefined);
  assert.equal((await call('management-load',main.webContents)).ok,false);
  assert.equal((await call('management-save',main.webContents,new Uint8Array())).ok,false);
  assert.equal((await call('management-movements',main.webContents,{})).ok,false);
  assert.equal((await call('management-targets-load',main.webContents)).ok,false);
  assert.equal((await call('management-targets-save',main.webContents,{})).ok,false);
  assert.equal((await call('management-load',active.webContents)).ok,true);assert.equal(reads,1);
  assert.equal((await call('management-movements',active.webContents,{snapshot:'stale'})).ok,false);
  await call('management-load',active.webContents);assert.equal(reads,1);
  await call('management-load',active.webContents,true);assert.equal(reads,2);
  assert.equal((await call('management-save',active.webContents,'invalid')).ok,false);
  const scope={year:2026,from:1,to:1,metric:'Margine 3',value:100};
  const writes=await Promise.all([call('management-targets-save',active.webContents,scope),call('management-targets-save',active.webContents,{...scope,to:2,value:200})]);
  assert(writes.every(r=>r.ok));
  const savedTargets=await call('management-targets-load',active.webContents);
  assert.equal(Object.keys(savedTargets.targets).length,2);assert.equal(savedTargets.targets[targetKey({...scope,to:2})].value,200);
  allowed=false;service.revoke();assert(active.closed);
  assert.equal((await call('management-load',active.webContents)).ok,false);
  assert.equal((await call('management-targets-load',active.webContents)).ok,false);
});
