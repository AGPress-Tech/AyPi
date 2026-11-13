// Explicit one-time operator tool. Writes only through the running backend API.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const {cleanMaintenanceImport}=require('../backend-dist/modules/maintenance/import-cleanup');
const root=path.resolve(__dirname,'..'),base='http://192.168.1.240:3000',actor='Ayrton Pizzi';
const source="\\\\Dl360\\pubbliche\\QUALITA'\\MANUTENZIONI MACCHINE\\AyPi - Manutenzione Macchine.accdb";
const database='\\\\Dl360\\pubbliche\\TECH\\AyPi\\AGPRESS\\General\\data\\aypi.db';
const privateDir=path.join(root,'.private'),stamp=new Date().toISOString().replace(/[:.]/g,'-');
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
async function request(route,body){const response=await fetch(base+'/api/maintenance/'+route,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','x-aypi-actor':actor,'x-aypi-user':actor,'x-aypi-client':'AyPi-Codex-Migration'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(120000)});const value=await response.json();if(!response.ok)throw Error(`${route}: HTTP ${response.status}: ${value.error||value.message||'operazione non riuscita'}`);return value}
(async()=>{
 assert(process.argv.includes('--apply'),'Richiede --apply: operazione di importazione nel backend operativo.');
 const employees=await request('employees');assert(Object.values(employees.groups).flat().includes(actor),'Operatore di migrazione non presente nella lista condivisa.');
 const before=await request('snapshot');assert(!before.importInfo&&!before.machines.length&&!before.plans.length&&!before.records.length,'Archivio già inizializzato: nessuna sovrascrittura consentita.');
 fs.mkdirSync(privateDir,{recursive:true});const output=path.join(root,'.tmp-maintenance-live-source.json');
 const localSource=path.join(root,'.tmp-maintenance-source.accdb');let sourceHash='';
 for(let attempt=0;attempt<5;attempt++){const bytes=fs.readFileSync(source),hash=digest(bytes);fs.writeFileSync(localSource,bytes);if(digest(fs.readFileSync(source))===hash){sourceHash=hash;break;}}
 assert(sourceHash,'Access cambia continuamente: nessuna importazione eseguita.');
 try{execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(root,'src/renderer/scripts/maintenance-access.ps1'),'-Source',localSource,'-AttachmentRoot',path.win32.dirname(source),'-Output',output],{windowsHide:true,timeout:180000,stdio:'pipe'})}finally{fs.unlinkSync(localSource)}
 const clean=cleanMaintenanceImport({...JSON.parse(fs.readFileSync(output,'utf8')),source});
 assert.equal(clean.machines.length,46);assert(clean.ordinary.length>0&&clean.extraordinary.length>0);
 assert(!clean.ordinary.some(r=>'legacyNextDate' in r));
 const backup=path.join(privateDir,'aypi-before-maintenance-'+stamp+'.db');fs.copyFileSync(database,backup);
 const init=require('sql.js'),SQL=await init({locateFile:f=>require.resolve('sql.js/dist/'+f)}),copy=new SQL.Database(fs.readFileSync(backup));assert.equal(copy.exec('PRAGMA integrity_check')[0].values[0][0],'ok');copy.close();
 const imported=await request('import',clean),after=await request('snapshot');
 assert.equal(after.machines.length,clean.machines.length);assert.equal(after.plans.length,clean.plans.length);assert.equal(after.records.length,clean.ordinary.length+clean.extraordinary.length);assert.equal(after.attachments.length,clean.attachments.length);assert.equal(after.issues.length,0);
 assert(!after.records.some(r=>r.legacy?.nextDate));assert(after.plans.every(p=>p.frequencyMonths==null));
 const report={at:new Date().toISOString(),actor,source,sourceHash,backup,imported:imported.info,cleanup:clean.cleanup,verified:{machines:after.machines.length,plans:after.plans.length,ordinary:after.records.filter(r=>r.kind==='ordinary').length,extraordinary:after.records.filter(r=>r.kind==='extraordinary').length,attachments:after.attachments.length,issues:after.issues.length}};
 fs.writeFileSync(path.join(privateDir,'maintenance-migration-report.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({imported:report.verified,manualDatesDiscarded:clean.cleanup.manualDatesDiscarded,anomaliesExcluded:clean.cleanup.excluded.length,report:'.private/maintenance-migration-report.json',sourceOpenedReadOnly:true}));
})().catch(e=>{console.error(e.message);process.exitCode=1});
