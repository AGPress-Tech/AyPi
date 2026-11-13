import {randomUUID} from 'crypto';
import {getSqliteDatabase,runSqliteTransaction} from '../../shared/db/sqlite';
import {Entity,EntityKind,maintenanceDue,todayInRome,validateAttachment,validateEntity} from './model';
import {validateMaintenancePreferences} from './preferences';
import {cleanMaintenanceImport,validMaintenanceDate} from './import-cleanup';
import {attachmentSignature,buildAccessSync} from './access-sync';
import {badRequest,HttpError,notFound} from '../../shared/http/errors';
const conflict=(message:string)=>new HttpError(409,message);

function schema(){getSqliteDatabase().run(`CREATE TABLE IF NOT EXISTS maintenance_entities(kind TEXT NOT NULL,id TEXT NOT NULL,revision INTEGER NOT NULL,payload TEXT NOT NULL,deleted INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(kind,id));CREATE TABLE IF NOT EXISTS maintenance_audit(id TEXT PRIMARY KEY,at TEXT NOT NULL,actor TEXT NOT NULL,action TEXT NOT NULL,kind TEXT NOT NULL,entity_id TEXT NOT NULL,before_json TEXT,after_json TEXT);CREATE TABLE IF NOT EXISTS maintenance_attachments(id TEXT PRIMARY KEY,record_id TEXT NOT NULL,name TEXT NOT NULL,path TEXT,data BLOB);CREATE TABLE IF NOT EXISTS maintenance_settings(id TEXT PRIMARY KEY,payload TEXT NOT NULL);`)}
const select=(sql:string,args:any[]=[])=>{const s=getSqliteDatabase().prepare(sql);try{s.bind(args);const a:any[]=[];while(s.step())a.push(s.getAsObject());return a}finally{s.free()}};
function entities(kind:EntityKind,deleted=false):Entity[]{return select('SELECT id,revision,payload FROM maintenance_entities WHERE kind=?'+(deleted?'':' AND deleted=0'),[kind]).map(r=>({...JSON.parse(r.payload),id:r.id,revision:r.revision}))}
function write(kind:EntityKind,id:string,value:any,revision:number,actor:string,before:any=null,deleted=false){
    const after={...value,id,revision,updatedBy:actor,updatedAt:new Date().toISOString()};
    getSqliteDatabase().run('INSERT INTO maintenance_entities(kind,id,revision,payload,deleted) VALUES(?,?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload,deleted=excluded.deleted',[kind,id,revision,JSON.stringify(after),deleted?1:0]);
    getSqliteDatabase().run('INSERT INTO maintenance_audit VALUES(?,?,?,?,?,?,?,?)',[randomUUID(),after.updatedAt,actor,deleted?'delete':before?'update':'create',kind,id,before?JSON.stringify(before):null,JSON.stringify(after)]);return after;
}
export function maintenanceSnapshot(){
    schema();const machines=entities('machine'),plans=entities('plan'),records=entities('record'),attachments=select('SELECT id,record_id AS recordId,name,path,length(data) AS embeddedBytes FROM maintenance_attachments');
    const settings=select('SELECT payload FROM maintenance_settings WHERE id=?',['import']);
    const issues=[...plans.filter(p=>!machines.some(m=>m.id===p.machineId)).map(p=>`Manutenzione prevista ${p.id}: macchina ${p.machineId||'mancante'} non trovata.`),...records.filter(r=>!machines.some(m=>m.id===r.machineId)||r.kind==='ordinary'&&!plans.some(p=>p.id===r.planId)).map(r=>`Registrazione ${r.id}: collegamento macchina/manutenzione mancante.`),...records.filter(r=>!r.date||r.date>todayInRome()).map(r=>`Registrazione storica ${r.id}: data ${r.date||'mancante'} da verificare.`)];
    return {machines,plans,records,attachments,due:maintenanceDue(machines,plans,records),issues,importInfo:settings.length?JSON.parse(settings[0].payload):null,today:todayInRome()};
}
export function saveMaintenanceEntity(kind:EntityKind,input:any,actor:string){
    schema();if(!['machine','plan','record'].includes(kind))throw badRequest('Tipo di scheda non valido.');
    const current=input?.id?entities(kind).find(e=>e.id===input.id):null;
    if(input?.id&&!current)throw notFound('La scheda è stata eliminata o non esiste.');
    if(!Number.isInteger(input?.revision)||input.revision!==(current?.revision??0))throw conflict('La scheda è stata modificata da un altro operatore. Aggiorna i dati prima di salvare.');
    const machines=entities('machine'),plans=entities('plan');let value:any;
    try{value=validateEntity(kind,input,machines,plans)}catch(e){throw badRequest((e as Error).message)}
    if(kind==='plan'&&current&&current.machineId!==value.machineId&&entities('record',true).some(r=>r.planId===current.id))throw badRequest('La manutenzione ha uno storico: crea una nuova definizione per assegnarla a un’altra macchina.');
    if(kind==='machine'&&machines.some(m=>m.id!==current?.id&&m.code.toLocaleLowerCase('it')===value.code.toLocaleLowerCase('it')))throw conflict('Codice macchina già presente.');
    const attachments=kind==='record'?input.attachments:[];
    if(!Array.isArray(attachments)||attachments.length>100)throw badRequest('Elenco allegati non valido.');
    return runSqliteTransaction(()=>{
        const id=current?.id||randomUUID(),saved=write(kind,id,{...value,createdBy:current?.createdBy||actor,createdAt:current?.createdAt||new Date().toISOString(),...(current?.legacy?{legacy:current.legacy}:{})},(current?.revision??0)+1,actor,current);
        if(kind==='record'){
            const existing=select('SELECT * FROM maintenance_attachments WHERE record_id=?',[id]);
            const keep=new Set<string>();for(const a of attachments){
                if(a.id){const old=existing.find(v=>v.id===a.id);if(!old)throw badRequest('Allegato non appartenente alla registrazione.');keep.add(old.id);continue;}
                let clean;try{clean=validateAttachment(a)}catch(e){throw badRequest((e as Error).message)}
                if(!clean.path)throw badRequest('Percorso di rete allegato mancante.');
                const attachmentId=randomUUID();getSqliteDatabase().run('INSERT INTO maintenance_attachments VALUES(?,?,?,?,NULL)',[attachmentId,id,clean.name,clean.path]);keep.add(attachmentId);
            }
            const removed=readSyncSetting('access-removed-attachments',[]);
            for(const a of existing)if(!keep.has(a.id)){removed.push(attachmentSignature(id,a));getSqliteDatabase().run('DELETE FROM maintenance_attachments WHERE id=?',[a.id]);}
            saveSyncSetting('access-removed-attachments',[...new Set(removed)]);
        }
        return saved;
    });
}
export function deleteMaintenanceEntity(kind:EntityKind,id:string,revision:number,actor:string){
    schema();const current=entities(kind).find(e=>e.id===id);if(!current)throw notFound('Scheda non trovata.');if(current.revision!==revision)throw conflict('La scheda è cambiata: aggiorna prima di eliminarla.');
    if(kind==='machine'&&(entities('plan').some(p=>p.machineId===id)||entities('record').some(r=>r.machineId===id)))throw badRequest('La macchina ha manutenzioni collegate: puoi disattivarla senza perdere lo storico.');
    return runSqliteTransaction(()=>write(kind,id,current,revision+1,actor,current,true));
}
export function maintenanceAttachment(id:string){schema();const a=select('SELECT * FROM maintenance_attachments WHERE id=?',[id])[0];if(!a||!entities('record').some(r=>r.id===a.record_id))throw notFound('Allegato non trovato.');return {id:a.id,name:a.name,path:a.path,data:a.data?Buffer.from(a.data).toString('base64'):null}}
export function importMaintenance(input:any,actor:string){
    schema();if(select('SELECT id FROM maintenance_settings WHERE id=?',['import']).length||select('SELECT id FROM maintenance_entities LIMIT 1').length)throw conflict('L’archivio manutenzioni è già inizializzato. L’importazione non può sovrascriverlo.');
    if(input?.version!==1||!['machines','plans','ordinary','extraordinary','attachments','departments','equipmentTypes'].every(k=>Array.isArray(input[k])&&input[k].length<=100000))throw badRequest('Archivio Access non valido.');
    if(JSON.stringify(input).length>9*1024*1024)throw badRequest('Archivio di importazione troppo esteso.');
    input=cleanMaintenanceImport(input);
    return runSqliteTransaction(()=>{
        for(const m of input.machines){const id=String(m.id);if(!id||id.length>128)throw badRequest('Codice macchina storico non valido.');write('machine',id,{...m,active:true,createdBy:'Archivio Access',legacy:{sourceId:m.id}},1,actor)}
        for(const p of input.plans)write('plan',String(p.id),{machineId:p.machineId||'',description:p.description||'',frequencyMonths:null,active:true,createdBy:'Archivio Access',legacy:{sourceId:p.id}},1,actor);
        for(const [kind,list] of [['ordinary',input.ordinary],['extraordinary',input.extraordinary]] as const)for(const r of list){const plan=input.plans.find(p=>String(p.id)===String(r.planId));write('record',kind+':'+r.id,{machineId:r.machineId||'',planId:kind==='ordinary'?String(r.planId):null,kind,date:r.date,description:kind==='ordinary'?plan?.description||'':r.description||'',notes:r.notes||'',createdBy:'Archivio Access',legacy:{sourceId:r.id}},1,actor)}
        for(const a of input.attachments){let clean;try{clean=validateAttachment(a)}catch(e){throw badRequest((e as Error).message)}if(!clean.path&&(!a.data||!/^[a-zA-Z0-9+/]*={0,2}$/.test(a.data)))throw badRequest('Contenuto allegato storico mancante.');getSqliteDatabase().run('INSERT INTO maintenance_attachments VALUES(?,?,?,?,?)',[String(a.id),String(a.recordId),clean.name,clean.path,a.data?new Uint8Array(Buffer.from(a.data,'base64')):null])}
        const info={source:input.source,readAt:input.readAt,importedAt:new Date().toISOString(),actor,machines:input.machines.length,plans:input.plans.length,ordinary:input.ordinary.length,extraordinary:input.extraordinary.length,attachments:input.attachments.length,departments:input.departments.map(d=>d.name),equipmentTypes:input.equipmentTypes.map(d=>d.name),cleanup:input.cleanup,seedHash:typeof input.seedHash==='string'&&/^[a-f0-9]{64}$/.test(input.seedHash)?input.seedHash:null};
        getSqliteDatabase().run('INSERT INTO maintenance_settings VALUES(?,?)',['import',JSON.stringify(info)]);return info;
    });
}
/** One-off cleanup of imports made by the first maintenance build. */
export function cleanupMaintenanceArchive(){
    schema();if(select('SELECT id FROM maintenance_settings WHERE id=?',['cleanup-v2']).length)return;
    const machines=entities('machine'),plans=entities('plan'),records=entities('record');
    const validPlans=plans.filter(p=>machines.some(m=>m.id===p.machineId)&&p.description?.trim());
    const remove=[...plans.filter(p=>!validPlans.includes(p)).map(p=>({kind:'plan',id:p.id})),...records.filter(r=>!validMaintenanceDate(r.date)||!machines.some(m=>m.id===r.machineId)||r.kind==='ordinary'&&!validPlans.some(p=>p.id===r.planId&&p.machineId===r.machineId)||r.kind==='extraordinary'&&!r.description?.trim()).map(r=>({kind:'record',id:r.id}))];
    const strip=(value:any):any=>{if(!value||typeof value!=='object')return value;if(Array.isArray(value))return value.map(strip);return Object.fromEntries(Object.entries(value).filter(([key])=>!['nextDate','legacyNextDate'].includes(key)).map(([key,v])=>[key,strip(v)]))};
    return runSqliteTransaction(()=>{
        for(const e of remove){getSqliteDatabase().run('DELETE FROM maintenance_entities WHERE kind=? AND id=?',[e.kind,e.id]);if(e.kind==='record')getSqliteDatabase().run('DELETE FROM maintenance_attachments WHERE record_id=?',[e.id]);getSqliteDatabase().run('DELETE FROM maintenance_audit WHERE kind=? AND entity_id=?',[e.kind,e.id]);getSqliteDatabase().run('INSERT INTO maintenance_audit VALUES(?,?,?,?,?,?,NULL,NULL)',[randomUUID(),new Date().toISOString(),'Migrazione AyPi','cleanup-anomaly',e.kind,e.id])}
        for(const e of select('SELECT kind,id,payload FROM maintenance_entities')){const clean=JSON.stringify(strip(JSON.parse(e.payload)));if(clean!==e.payload)getSqliteDatabase().run('UPDATE maintenance_entities SET payload=? WHERE kind=? AND id=?',[clean,e.kind,e.id])}
        for(const e of select('SELECT id,before_json,after_json FROM maintenance_audit'))getSqliteDatabase().run('UPDATE maintenance_audit SET before_json=?,after_json=? WHERE id=?',[e.before_json?JSON.stringify(strip(JSON.parse(e.before_json))):null,e.after_json?JSON.stringify(strip(JSON.parse(e.after_json))):null,e.id]);
        getSqliteDatabase().run('INSERT INTO maintenance_settings VALUES(?,?)',['cleanup-v2',JSON.stringify({at:new Date().toISOString(),removed:remove})]);return {removed:remove};
    });
}
export function maintenancePreferences(actor:string,value?:any){schema();const id='preferences:'+actor.toLocaleLowerCase('it');if(value===undefined){const row=select('SELECT payload FROM maintenance_settings WHERE id=?',[id])[0];return row?validateMaintenancePreferences(JSON.parse(row.payload)):null;}if(JSON.stringify(value).length>500000)throw badRequest('Preferenze troppo estese.');let clean:any;try{clean=validateMaintenancePreferences(value)}catch(e){throw badRequest((e as Error).message)}return runSqliteTransaction(()=>{getSqliteDatabase().run('INSERT INTO maintenance_settings VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload',[id,JSON.stringify(clean)]);return clean})}

function readSyncSetting(id:string,fallback:any){const r=select('SELECT payload FROM maintenance_settings WHERE id=?',[id])[0];return r?JSON.parse(r.payload):fallback}
function saveSyncSetting(id:string,value:any){getSqliteDatabase().run('INSERT INTO maintenance_settings VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload',[id,JSON.stringify(value)])}
function syncState(){
    const all=select('SELECT kind,id,revision,payload,deleted FROM maintenance_entities').map(r=>({...JSON.parse(r.payload),id:r.id,revision:r.revision,deleted:!!r.deleted,entityKind:r.kind}));
    return {machine:all.filter(r=>r.entityKind==='machine'),plan:all.filter(r=>r.entityKind==='plan'),record:all.filter(r=>r.entityKind==='record'),attachments:select('SELECT * FROM maintenance_attachments'),aliases:readSyncSetting('access-aliases',[]),removedAttachments:readSyncSetting('access-removed-attachments',[])};
}
const syncPreviews=new Map<string,{input:any;actor:string;expires:number}>();
export function previewMaintenanceSync(value:any,actor:string){
    schema();for(const [token,p] of syncPreviews)if(p.expires<Date.now())syncPreviews.delete(token);
    if(syncPreviews.size>=3)throw conflict('Altri confronti Access sono in corso. Chiudi una delle anteprime prima di riprovare.');
    if(value?.version!==1||!['machines','plans','ordinary','extraordinary','attachments','departments','equipmentTypes'].every(k=>Array.isArray(value[k])&&value[k].length<=100000)||JSON.stringify(value).length>9*1024*1024)throw badRequest('Archivio Access non valido o troppo esteso.');
    const input=cleanMaintenanceImport(value),token=randomUUID(),merge=buildAccessSync(input,syncState());
    syncPreviews.set(token,{input,actor,expires:Date.now()+10*60000});return {token,source:input.source,readAt:input.readAt,...merge.report};
}
export function cancelMaintenanceSync(token:string,actor:string){if(syncPreviews.get(token)?.actor===actor)syncPreviews.delete(token);return {canceled:true}}
export function applyMaintenanceSync(token:string,actor:string){
    schema();const preview=syncPreviews.get(token);if(!preview||preview.actor!==actor||preview.expires<Date.now())throw conflict('Il confronto Access è scaduto o appartiene a un altro operatore. Ripeti la lettura.');
    const input=preview.input;
    const report=runSqliteTransaction(()=>{
        // Recompare within the write transaction: concurrent imports cannot duplicate entities.
        const merge=buildAccessSync(input,syncState());
        for(const op of merge.writes)write(op.kind,op.id,{...op.value,createdAt:new Date().toISOString()},1,actor);
        for(const a of merge.attachments){let clean:any;try{clean=validateAttachment(a)}catch(e){throw badRequest((e as Error).message)}if(!clean.path&&(!a.data||!/^[a-zA-Z0-9+/]*={0,2}$/.test(a.data)))throw badRequest('Allegato Access non valido.');getSqliteDatabase().run('INSERT INTO maintenance_attachments VALUES(?,?,?,?,?)',[a.id,a.recordId,clean.name,clean.path,a.data?new Uint8Array(Buffer.from(a.data,'base64')):null])}
        saveSyncSetting('access-aliases',merge.aliases);
        const info={at:new Date().toISOString(),actor,source:input.source,...merge.report};saveSyncSetting('access-last-sync',info);
        if(!readSyncSetting('import',null))saveSyncSetting('import',{source:input.source,readAt:input.readAt,importedAt:info.at,actor,machines:entities('machine').length,plans:entities('plan').length,ordinary:entities('record').filter(r=>r.kind==='ordinary').length,extraordinary:entities('record').filter(r=>r.kind==='extraordinary').length,attachments:select('SELECT id FROM maintenance_attachments').length,departments:input.departments.map(d=>d.name),equipmentTypes:input.equipmentTypes.map(d=>d.name),cleanup:input.cleanup});
        return info;
    });syncPreviews.delete(token);return report;
}
