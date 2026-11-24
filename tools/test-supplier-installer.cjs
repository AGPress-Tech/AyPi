const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {validateOptionalSupplierImport}=require('./prepare-supplier-evaluation-installer.cjs');
const root=path.resolve(__dirname,'..'),folder=path.join(root,'.tmp-supplier-installer',String(Date.now()));fs.mkdirSync(folder,{recursive:true});
const file=path.join(folder,'supplier-evaluation-import.json');
assert.deepEqual(validateOptionalSupplierImport(file),{available:false});
const seed={version:1,readAt:'2026-11-20',suppliers:[{id:1,name:'Alfa',erpCode:'001'}],records:[{id:1,supplier:'Alfa',date:'2026-01-02',ddt:'001',notes:'Archivio Access'}],attachments:[]};
fs.writeFileSync(file,JSON.stringify(seed));assert.deepEqual(validateOptionalSupplierImport(file),{available:true,records:1,suppliers:1});
fs.writeFileSync(file,JSON.stringify({...seed,records:[seed.records[0],seed.records[0]]}));assert.throws(()=>validateOptionalSupplierImport(file),/duplicati/);fs.writeFileSync(file,JSON.stringify(seed));
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')),builder=JSON.parse(fs.readFileSync(path.join(root,'electron-builder.backend.json'),'utf8'));
assert(!pkg.scripts['dist:backend'].includes('prepare-supplier-evaluation-installer'));
assert(!builder.extraResources.some(r=>/supplier-evaluation-import/.test(r.from||'')||/supplier-evaluation-import/.test(r.to||'')));
process.env.AYPI_BACKEND_PROFILE='dev';process.env.AYPI_DB_PATH=path.join(folder,'test.db');process.env.AYPI_LOG_DIR=folder;process.env.AYPI_FP_GENERAL_DIR=path.join(folder,'general');
process.env.AYPI_SUPPLIER_SEED_FILE=file; // Even a residual environment setting must not re-enable automatic imports.
const db=require('../backend-dist/shared/db/sqlite'),service=require('../backend-dist/modules/supplier-evaluation/service');
(async()=>{try{
 await db.initializeSqliteDatabase();const erp=[{code:'001',name:'Alfa',disabled:false}];service.setSupplierDirectoryProvider(async()=>({suppliers:erp,queriedAt:new Date().toISOString()}));
 service.initializeSupplierEvaluation();assert.equal((await service.supplierSnapshot()).records.length,0,'Startup must not import a legacy seed');
 service.importSupplierSource(seed,'Importazione manuale',true,erp);let snapshot=await service.supplierSnapshot();assert.equal(snapshot.records.length,1,'Explicit manual import remains available');
 const saved=await service.saveSupplierRecord({...snapshot.records[0],notes:'Modifica manuale in AyPi'},'Operatore');
 fs.writeFileSync(file,JSON.stringify({...seed,records:[{...seed.records[0],notes:'Nuova versione Access'},{id:2,supplier:'Alfa',date:'2026-01-03'}]}));
 const audit=()=>db.getSqliteDatabase().exec('SELECT COUNT(*) FROM supplier_evaluation_audit')[0].values[0][0],before=audit();
 service.initializeSupplierEvaluation();service.initializeSupplierEvaluation();snapshot=await service.supplierSnapshot();assert.equal(snapshot.records.length,1);assert.equal(snapshot.records[0].notes,saved.notes);assert.equal(audit(),before,'Restart must not add an import audit');
 fs.writeFileSync(file,'invalid residual seed');service.initializeSupplierEvaluation();assert.equal(audit(),before,'A stale malformed file must not affect startup');
 console.log('OK: backend packaging without supplier seed, optional validation, no startup import, preserved manual edits and explicit manual import.');
}finally{db.closeSqliteDatabase();}})().catch(error=>{console.error(error);process.exitCode=1;});
