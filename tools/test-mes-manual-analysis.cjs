const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {randomUUID:id}=require('node:crypto');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'aypi-mes-manual-'));
process.env.AYPI_BACKEND_PROFILE='dev';process.env.AYPI_MES_DB_PATH=path.join(root,'mes.db');process.env.AYPI_DB_PATH=path.join(root,'aypi.db');process.env.AYPI_FP_GENERAL_DIR=path.join(root,'General');process.env.AYPI_LOG_DIR=path.join(root,'logs');
const store=require('../backend-dist/shared/db/mes-sqlite'),primary=require('../backend-dist/shared/db/sqlite');
const production=require('../backend-dist/modules/mes/production-repository');
const sessions=require('../backend-dist/modules/mes/session-repository');
const repository=require('../backend-dist/modules/mes/repository');
const {declareManualProduction}=require('../backend-dist/modules/mes/manual-production');
const {mesAnalysis}=require('../backend-dist/modules/mes/analysis');
const sheets=require('../backend-dist/modules/mes/setup-sheets');
const transfer=require('../backend-dist/modules/transfer-attrezzaggio/repository');
const haas=require('../backend-dist/modules/haas-attrezzaggio/repository');
const base=Date.now()-3600000,time=s=>new Date(base+s*1000).toISOString();
const meta=s=>({now:time(s),actor:'Operatore test',requestId:id(),auditId:id()});
const draft={orderNumber:'MAN-1',customer:'Cliente',articleCode:'ART-M',targetQuantity:100,unit:'pz',orderType:'MACHINING',materialAlloy:'',grossWeight:0,netWeight:0,kilogramsToStamp:0,barBundles:'',materialOwner:'',barSize:'',firstDeliveryAt:'',dueAt:'',priority:'NORMAL',notes:'',status:'OPEN'};
const phase={phaseCode:'01',sequence:1,articleCode:'ART-M',targetQuantity:100,unit:'pz',standardCycleSeconds:10,plannedSetupSeconds:0,plannedMachineId:'',scheduledStart:'',scheduledEnd:'',planningStatus:'BACKLOG',executionStatus:'NOT_STARTED'};
const current=()=>sessions.listMachineSessions().find(s=>s.status==='ACTIVE');
async function declaration(kind,s,quantity=0,declarationId=id()) {const session=current();return declareManualProduction({declarationId,sessionId:session.sessionId,baseRevision:session.revision,kind,quantity,reasonCode:'TEST',note:'Prova',actor:'Operatore test',now:time(s)});}
(async()=>{
 await primary.initializeSqliteDatabase();await store.initializeMesSqliteDatabase();
 try{
  const order=production.createMesOrder({...meta(0),order:{...draft,orderId:id()},phases:[{...phase,phaseId:id()}],auditIds:[id(),id()]});
  const phaseId=order.phases[0].phaseId;
  sessions.startMachineSession({...meta(0),sessionId:id(),phaseId,machineId:'MANUAL-1',mode:'PRODUCTION',collectionMode:'MANUAL',piecesPerPulse:1,note:'',transitionId:id(),resolutionId:id(),auditIds:[id(),id()]});
  assert.equal(current().manualState,'STOPPED');
  await declaration('START',10);
  assert.equal(current().manualState,'PRODUCTION');
  await assert.rejects(()=>declaration('START',11),/già/);
  const duplicateId=id();await declaration('PIECES',20,10,duplicateId);await declaration('PIECES',20,10,duplicateId);
  assert.equal(current().goodPieces,10,'Retrying the same declaration must not duplicate production');
  await declaration('STOP',30);
  assert.equal(current().manualState,'STOPPED');
  // PLC frames on a manually managed activation cannot add pieces or change its state.
  repository.storeMachineEvents([{eventId:id(),source:'PLC_CSV',sourceSessionId:'EDGE',sourcePosition:'1',machineId:'MANUAL-1',occurredAt:time(31),receivedAt:time(31),pulseDelta:1,pieceDelta:2,multiplier:2}],
   {importId:id(),source:'PLC_CSV',sourceSessionId:'EDGE',sourceFile:'impulsi.csv',totalRows:1,validRows:1,insertedEvents:0,duplicateEvents:0,rejectedRows:0,issues:[],importedAt:time(31)},'Test');
  assert.equal(current().goodPieces,10);
  assert.equal(sessions.loadActivationPreview('MANUAL-1',phaseId).unassignedPieces,0);
  let s=current();const setupId=id();sessions.beginSetupForMachineSession({...meta(40),sessionId:s.sessionId,baseRevision:s.revision,setupSessionId:setupId,closeTransitionId:id(),startTransitionId:id(),note:''});
  assert.equal(current().collectionMode,'MANUAL');await declaration('PIECES',45,4);
  s=current();assert.equal(s.setupPieces,4);const productionId=id();
  sessions.reconcileSetupSession({...meta(50),sessionId:s.sessionId,baseRevision:s.revision,goodPieces:3,scrapPieces:1,excludedPieces:0,startProduction:true,closeOrder:false,note:'',reconciliationId:id(),adjustmentId:id(),productionSessionId:productionId,closeTransitionId:id(),startTransitionId:id()});
  assert.equal(current().collectionMode,'MANUAL');assert.equal(current().manualState,'STOPPED');assert.equal(current().goodPieces,13);
  await declaration('START',60);await declaration('PIECES',70,2);await declaration('STOP',80);
  s=current();sessions.changeMachineSessionState({...meta(90),sessionId:s.sessionId,baseRevision:s.revision,action:'PAUSE',transitionId:id(),note:''});
  const report=mesAnalysis({from:time(0),to:time(100)});
  assert.equal(report.summary.countedPieces,15);assert.equal(report.summary.manualPieces,15);assert.equal(report.summary.plcPieces,0);
  assert.equal(report.summary.scrapPieces,1);assert.equal(report.summary.productionSeconds,40);assert.equal(report.summary.setupSeconds,10);
  assert.equal(report.summary.stoppedSeconds,40);assert.equal(report.summary.unmonitoredSeconds,0);assert.equal(report.activations.length,1);
  assert.equal(report.activations[0].coveragePercent,100);
  const partial=mesAnalysis({from:time(15),to:time(25)});assert.equal(partial.summary.countedPieces,10);assert.equal(partial.summary.productionSeconds,10);
  assert.equal(mesAnalysis({from:time(0),to:time(100),article:'NO-MATCH'}).activations.length,0);
  // Existing setup archives are linked by stable record IDs and retained as a selected version.
  const tr=transfer.saveTransferItem({code:'ART-M__01__TR1__A',codiceArticolo:'ART-M',fase:'01',codiceMacchina:'TR1',metodoVariante:'A',note:'Versione originale',utensili:[],attachments:[]});
  const ce=haas.saveHaasItem({code:'ART-M__CENTRO1__A',codiceArticolo:'ART-M',macchina:'CENTRO1',metodo:'A',note:'Centro',utensili:[],attachments:[]});
  assert.ok(sheets.setupSheetCatalog('ART-M').some(r=>r.recordId===tr.recordId&&r.type==='TRANSFER'));
  const variant=transfer.saveTransferItem({code:'ART-M__01__TR1__B',codiceArticolo:'ART-M',fase:'01',codiceMacchina:'TR1',metodoVariante:'B',utensili:[],attachments:[]});
  const choices=sheets.setupSheetCatalog('ART-M').filter(r=>r.type==='TRANSFER');
  assert.equal(choices.length,2);
  assert.notEqual(choices[0].label,choices[1].label,'Same article and machine must show distinct setup variants');
  assert.equal(sheets.phaseSetupSheets(phaseId).length,0,'Catalog matches must never attach automatically');
  sheets.linkSetupSheet(phaseId,'TRANSFER',tr.recordId,'Test');sheets.linkSetupSheet(phaseId,'TRANSFER',tr.recordId,'Test');
  sheets.linkSetupSheet(phaseId,'CENTRI',ce.recordId,'Test');let links=sheets.phaseSetupSheets(phaseId);assert.equal(links.length,2);
  assert.ok(!links.some(l=>l.recordId===variant.recordId),'Only explicitly selected sheets must be linked');
  transfer.saveTransferItem({...tr,previousCode:tr.code,note:'Versione nuova'});
  assert.equal(sheets.phaseSetupSheets(phaseId).find(l=>l.type==='TRANSFER').sheet.note,'Versione originale');
  sheets.unlinkSetupSheet(phaseId,links[0].linkId,'Test');assert.equal(sheets.phaseSetupSheets(phaseId).length,1);
  assert.ok(transfer.loadTransferItem(tr.recordId),'Unlinking must not remove the original setup record');
  console.log('MES manual declarations, real analysis and setup sheet links: OK');
 }finally{store.closeMesSqliteDatabase();primary.closeSqliteDatabase();}
})().catch(error=>{console.error(error);process.exitCode=1;});
