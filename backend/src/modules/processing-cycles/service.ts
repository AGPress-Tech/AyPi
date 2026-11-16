import crypto from 'crypto';
import {getSqliteDatabase,runSqliteTransaction} from '../../shared/db/sqlite';
import {badRequest,HttpError,notFound} from '../../shared/http/errors';
import {logger} from '../../shared/logging/logger';
import {ensureAgpressDailyBackup} from '../../shared/storage/agpress-backups';

const headerFields=['metodo','codiceProdotto','numeroDisegno','edizione','denominazione','data','revisione','materiale','dimensioni','pesoGrezzo','pesoFinito','cliente'];
const phaseFields=['macchina','numeroProgramma','cassettaAttrezzatura','tempoAttrezzaggio','tempoMacchinaPrevisto','tempoCambioPezzo','pezziOra','attrezzista','data','descrizione'];
function text(value:any,max=1000){if(value==null)return '';if(typeof value!=='string'&&typeof value!=='number')throw badRequest('Campo non valido.');const result=String(value).trim();if(result.length>max)throw badRequest('Campo troppo lungo.');return result;}
function date(value:string){if(value&&(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value))throw badRequest('Data non valida.');return value;}
export function normalizeProcessingCycle(input:any){
    if(!input||typeof input!=='object'||Array.isArray(input))throw badRequest('Ciclo non valido.');
    const item:any=Object.fromEntries(headerFields.map(key=>[key,text(input[key],key==='codiceProdotto'?200:1000)]));
    if(!item.codiceProdotto)throw badRequest('Il codice prodotto è obbligatorio.');
    item.data=date(item.data);
    if(!Array.isArray(input.fasi)||!input.fasi.length||input.fasi.length>200)throw badRequest('Inserire da una a 200 fasi.');
    const ids=new Set<string>();
    item.fasi=input.fasi.map((phase:any,index:number)=>{
        if(!phase||typeof phase!=='object'||Array.isArray(phase))throw badRequest('Fase non valida.');
        const row:any=Object.fromEntries(phaseFields.map(key=>[key,text(phase[key],key==='descrizione'?10000:1000)]));
        row.id=text(phase.id,100)||crypto.randomUUID();if(ids.has(row.id))throw badRequest('Fasi duplicate.');ids.add(row.id);
        row.fase=(index+1)*5;row.data=date(row.data);return row;
    });
    return item;
}
function schema(){getSqliteDatabase().exec(`CREATE TABLE IF NOT EXISTS processing_cycles(id TEXT PRIMARY KEY,revision INTEGER NOT NULL,deleted INTEGER NOT NULL DEFAULT 0,payload_json TEXT NOT NULL);CREATE TABLE IF NOT EXISTS processing_cycle_audit(id INTEGER PRIMARY KEY AUTOINCREMENT,cycle_id TEXT NOT NULL,action TEXT NOT NULL,actor TEXT NOT NULL,at TEXT NOT NULL,before_json TEXT,after_json TEXT);`);}
function stored(id:string){return getSqliteDatabase().exec('SELECT revision,deleted,payload_json FROM processing_cycles WHERE id=?',[id])?.[0]?.values?.[0];}
export function listProcessingCycles(){schema();return (getSqliteDatabase().exec('SELECT payload_json FROM processing_cycles WHERE deleted=0')?.[0]?.values||[]).map(row=>JSON.parse(String(row[0]))).sort((a,b)=>a.codiceProdotto.localeCompare(b.codiceProdotto,'it',{numeric:true})||a.metodo.localeCompare(b.metodo,'it',{numeric:true}));}
export function loadProcessingCycle(id:string){schema();const row=stored(id);if(!row||row[1])throw notFound('Ciclo non trovato.');return JSON.parse(String(row[2]));}
export function saveProcessingCycle(input:any,actor:string){
    const value=normalizeProcessingCycle(input);schema();ensureAgpressDailyBackup('auto',30);
    const id=text(input.id,100)||crypto.randomUUID(),now=new Date().toISOString();
    const result=runSqliteTransaction(db=>{
        const row=stored(id),previous=row?JSON.parse(String(row[2])):null;
        if(input.id&&(!row||row[1]||input.revision!==row[0]))throw new HttpError(409,'Il ciclo è stato modificato o eliminato da un altro utente. Ricaricare la scheda prima di salvarla.');
        const next={...value,id,revision:Number(row?.[0]||0)+1,createdAt:previous?.createdAt||now,createdBy:previous?.createdBy||actor,updatedAt:now,updatedBy:actor};
        db.exec('INSERT INTO processing_cycles(id,revision,deleted,payload_json) VALUES(?,?,0,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,payload_json=excluded.payload_json',[id,next.revision,JSON.stringify(next)]);
        db.exec('INSERT INTO processing_cycle_audit(cycle_id,action,actor,at,before_json,after_json) VALUES(?,?,?,?,?,?)',[id,previous?'update':'create',actor,now,previous?JSON.stringify(previous):null,JSON.stringify(next)]);return next;
    });
    logger.info('Ciclo di lavorazione salvato',{event:'processing_cycle_saved',module:'processing-cycles',id,actor});return result;
}
export function deleteProcessingCycle(id:string,revision:number,actor:string){schema();ensureAgpressDailyBackup('auto',30);runSqliteTransaction(db=>{const row=stored(id);if(!row||row[1])throw notFound('Ciclo non trovato.');if(revision!==row[0])throw new HttpError(409,'Il ciclo è stato modificato da un altro utente. Ricaricare prima di eliminarlo.');db.exec('UPDATE processing_cycles SET deleted=1,revision=revision+1 WHERE id=?',[id]);db.exec('INSERT INTO processing_cycle_audit(cycle_id,action,actor,at,before_json) VALUES(?,?,?,?,?)',[id,'delete',actor,new Date().toISOString(),String(row[2])]);});logger.info('Ciclo di lavorazione eliminato',{event:'processing_cycle_deleted',module:'processing-cycles',id,actor});}
