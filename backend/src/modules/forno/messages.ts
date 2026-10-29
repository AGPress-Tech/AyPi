import { randomUUID } from 'crypto';
import { sampleAt } from './sample';

export const EVENT_TYPES=['collector_started','state_snapshot','program_run','program_hold','program_resume','program_reset','program_complete','segment_start','segment_end','holdback','waiting','pv_event','digital_event','config_revision','communication_lost','communication_restored'] as const;
export type EventType=typeof EVENT_TYPES[number];
export function initializeMessages(db:any) {
    db.exec(`CREATE TABLE IF NOT EXISTS forno_notes(id TEXT PRIMARY KEY,t INTEGER NOT NULL,text TEXT NOT NULL,author TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,edited_by TEXT NOT NULL,revision INTEGER NOT NULL,deleted INTEGER NOT NULL DEFAULT 0,client_token TEXT UNIQUE);
        CREATE INDEX IF NOT EXISTS forno_notes_time ON forno_notes(t) WHERE deleted=0;
        CREATE TABLE IF NOT EXISTS forno_note_history(note_id TEXT NOT NULL,revision INTEGER NOT NULL,text TEXT NOT NULL,actor TEXT NOT NULL,changed_at INTEGER NOT NULL,deleted INTEGER NOT NULL,PRIMARY KEY(note_id,revision));
        CREATE TABLE IF NOT EXISTS forno_events(id INTEGER PRIMARY KEY AUTOINCREMENT,t INTEGER NOT NULL,type TEXT NOT NULL,message TEXT NOT NULL,detail TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS forno_events_time ON forno_events(t,id);`);
}
function error(code:string,message:string):never {throw Object.assign(new Error(message),{code});}
function note(row:any){return {id:row.id,timestampMs:row.t,text:row.text,author:row.author,createdAt:row.created_at,updatedAt:row.updated_at,editedBy:row.edited_by,revision:row.revision};}
function bump(db:any){db.prepare("INSERT INTO metadata(key,value) VALUES('messages_revision','1') ON CONFLICT(key) DO UPDATE SET value=CAST(value AS INTEGER)+1").run();}
function text(value:unknown,max:number){if(typeof value!=='string'||!value.trim()||value.length>max||value.includes('\0'))error('NOTE_INVALID','Testo nota non valido');return value.trim();}
function history(db:any,row:any,actor:string,now:number){db.prepare('INSERT INTO forno_note_history VALUES (?,?,?,?,?,?)').run(row.id,row.revision,row.text,actor,now,row.deleted);}
export function saveNote(db:any,input:any,actor:string,toleranceMs=500) {
    const content=text(input?.text,4000);actor=text(actor,120);const now=Date.now();
    return db.transaction(()=>{
        if(input.id){
            if(typeof input.id!=='string'||!Number.isInteger(input.revision))error('NOTE_INVALID','Nota non valida');
            const previous=db.prepare('SELECT * FROM forno_notes WHERE id=? AND deleted=0').get(input.id);
            if(!previous)error('NOTE_NOT_FOUND','Nota eliminata o non trovata');
            if(previous.revision!==input.revision)error('NOTE_CONFLICT','Nota modificata da un’altra postazione. Chiudi e riapri la nota prima di salvarla.');
            db.prepare('UPDATE forno_notes SET text=?,updated_at=?,edited_by=?,revision=revision+1 WHERE id=?').run(content,now,actor,input.id);
            const updated=db.prepare('SELECT * FROM forno_notes WHERE id=?').get(input.id);history(db,updated,actor,now);bump(db);return note(updated);
        }
        if(typeof input.clientToken!=='string'||!/^[a-f0-9-]{36}$/i.test(input.clientToken)||!Number.isSafeInteger(input.timestampMs)||input.timestampMs<0)error('NOTE_INVALID','Istante o identificativo nota non valido');
        const existing=db.prepare('SELECT * FROM forno_notes WHERE client_token=?').get(input.clientToken);
        if(existing){if(existing.deleted)error('NOTE_NOT_FOUND','Nota già eliminata');return note(existing);}
        // La connessione è già in una transazione di scrittura: il lookup usa un
        // savepoint esterno, senza aprire una seconda transazione SQLite.
        const nearest=sampleAt(db,input.timestampMs,toleranceMs,false);
        if(nearest.timestampMs===null)error('NOTE_INVALID','Nessun campione registrato vicino a questo istante');
        const id=randomUUID();db.prepare('INSERT INTO forno_notes VALUES (?,?,?,?,?,?,?,?,0,?)').run(id,nearest.timestampMs,content,actor,now,now,actor,1,input.clientToken);
        const created=db.prepare('SELECT * FROM forno_notes WHERE id=?').get(id);history(db,created,actor,now);bump(db);return note(created);
    })();
}
export function deleteNote(db:any,input:any,actor:string) {
    if(typeof input?.id!=='string'||!Number.isInteger(input?.revision))error('NOTE_INVALID','Nota non valida');
    return db.transaction(()=>{
        const previous=db.prepare('SELECT * FROM forno_notes WHERE id=? AND deleted=0').get(input.id);
        if(!previous)error('NOTE_NOT_FOUND','Nota eliminata o non trovata');
        if(previous.revision!==input.revision)error('NOTE_CONFLICT','Nota modificata da un’altra postazione. Chiudi e riapri la nota.');
        const now=Date.now();db.prepare('UPDATE forno_notes SET deleted=1,revision=revision+1,edited_by=?,updated_at=? WHERE id=?').run(actor,now,input.id);
        history(db,db.prepare('SELECT * FROM forno_notes WHERE id=?').get(input.id),actor,now);bump(db);return {deleted:true};
    })();
}
export function insertEvent(db:any,t:number,type:EventType,message:string,detail:unknown={}) {
    if(!Number.isSafeInteger(t)||t<0||!EVENT_TYPES.includes(type))throw new Error('Evento non valido');
    db.transaction(()=>{db.prepare('INSERT INTO forno_events(t,type,message,detail) VALUES (?,?,?,?)').run(t,type,message,JSON.stringify(detail));bump(db);})();
}
export function listMessages(db:any,fromMs:number,toMs:number,showNotes:boolean,eventTypes:string[],knownRevision?:number) {
    if(!Number.isSafeInteger(fromMs)||!Number.isSafeInteger(toMs)||fromMs<0||toMs<fromMs||toMs-fromMs>366*86400000||!Array.isArray(eventTypes)||eventTypes.some(t=>!EVENT_TYPES.includes(t as EventType)))throw new Error('Intervallo messaggi non valido');
    db.exec('BEGIN');try{
        const revision=Number(db.prepare("SELECT value FROM metadata WHERE key='messages_revision'").get()?.value||0);
        if(knownRevision===revision)return {notes:[],events:[],truncated:false,revision,unchanged:true};
        const has=db.prepare("SELECT 1 FROM sqlite_master WHERE name='forno_notes'").get();
        if(!has)return {notes:[],events:[],truncated:false,revision};
        const notes=showNotes?db.prepare('SELECT * FROM forno_notes WHERE deleted=0 AND t BETWEEN ? AND ? ORDER BY t,id LIMIT 1001').all(fromMs,toMs):[];
        const events=eventTypes.length?db.prepare(`SELECT * FROM forno_events WHERE t BETWEEN ? AND ? AND type IN (${eventTypes.map(()=>'?').join(',')}) ORDER BY t,id LIMIT 2001`).all(fromMs,toMs,...eventTypes):[];
        return {notes:notes.slice(0,1000).map(note),events:events.slice(0,2000).map((r:any)=>({id:String(r.id),timestampMs:r.t,type:r.type,message:r.message,detail:JSON.parse(r.detail)})),truncated:notes.length>1000||events.length>2000,revision};
    }finally{db.exec('ROLLBACK');}
}
