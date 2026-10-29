import { ModbusReader } from './modbus';
import { insertEvent, type EventType } from './messages';
export type ProgrammerSnapshot={mode:number;status:number;segmentType:number;segmentElapsed:number;program:string;segment:string;configRev:number;pv:number[];outputs:number[]};
const decode=(words:number[])=>words.map(v=>v&255).map(v=>v?String.fromCharCode(v):'\0').join('').split('\0')[0].replace(/[\x00-\x1f\x7f]/g,'').trim();
export async function readProgrammer(reader:ModbusReader):Promise<ProgrammerSnapshot> {
    const read=async(address:number,count:number)=>{const r=await reader.readWords(address,count);if(!r.words)throw new Error('Lettura eventi Modbus: '+r.q);return r.words;};
    const run=await read(14928,32),names=await read(27302,42),revision=await read(4256,1),verify=await read(14928,7);
    if(![1,2,4].includes(run[0])||run[1]<1||run[1]>63)throw new Error('Stato programmatore non disponibile');
    if(run[0]!==verify[0]||run[1]!==verify[1]||run[2]!==verify[2]||verify[6]<run[6])throw Object.assign(new Error('Programmatore in transizione'),{code:'EVENT_TRANSITION'});
    return {mode:run[0],status:run[1],segmentType:run[2],segmentElapsed:run[6],program:decode(names.slice(21)),segment:decode(names.slice(0,21)),configRev:revision[0],pv:[run[28],run[29]],outputs:run.slice(18,26)};
}
export class EventRecorder {
    private previous:ProgrammerSnapshot|null=null;
    private online:boolean|null=null;
    constructor(private db:any){insertEvent(db,Date.now(),'collector_started','Avvio raccolta eventi del backend');}
    failure(t:number,message:string) {
        if(this.online===false)return;
        insertEvent(this.db,t,'communication_lost','Lettura eventi interrotta',{reason:message});this.online=false;this.previous=null;
    }
    accept(t:number,current:ProgrammerSnapshot) {
        const previous=this.previous;
        this.db.transaction(()=>{
            const emit=(type:EventType,label:string,extra:unknown={})=>insertEvent(this.db,t,type,label,{...current,observed:true,extra});
            const prefix=current.program||'Programma';
            if(this.online===false)emit('communication_restored','Lettura eventi ripristinata');
            if(!previous){const label=current.status&32?'Completato':current.status&8?'Holdback':current.status&16?'Attesa':current.mode===4?'Hold':current.mode===1?'Reset':'Run';emit('state_snapshot',`${prefix} · ${label} · segmento ${current.segment||'—'} · revisione ${current.configRev}`);return;}
            if(current.configRev!==previous.configRev)emit('config_revision',`Revisione configurazione: ${current.configRev}`,{previous:previous.configRev});
            if(current.mode!==previous.mode){
                if(current.mode===1)emit('program_reset',`${prefix}: Reset`);
                if(current.mode===4)emit('program_hold',`${prefix}: Hold`);
                if(current.mode===2)emit(previous.mode===4?'program_resume':'program_run',`${prefix}: ${previous.mode===4?'Resume':'Run'}`);
            }
            if(current.mode===2&&previous.mode===2&&(previous.status&28)&&(current.status&2))emit('program_resume',`${prefix}: Ripresa`);
            if((current.status&32)&&!(previous.status&32))emit('program_complete',`${prefix}: Complete`);
            if((current.status&8)&&!(previous.status&8))emit('holdback',`${prefix}: Holdback`);
            if((current.status&16)&&!(previous.status&16))emit('waiting',`${prefix}: Attesa`);
            const wrapped=previous.segmentElapsed>65000&&current.segmentElapsed<1000;
            const changed=current.segment!==previous.segment||current.segmentType!==previous.segmentType||current.program!==previous.program||(current.mode===2&&previous.mode===2&&!wrapped&&current.segmentElapsed+1<previous.segmentElapsed);
            if(changed&&previous.mode!==1)emit('segment_end',`${previous.program||'Programma'}: Fine segmento ${previous.segment||'—'}`);
            if((changed&&current.mode!==1)||(current.mode===2&&previous.mode===1))emit('segment_start',`${prefix}: Inizio segmento ${current.segment||'—'}`);
            current.pv.forEach((v,i)=>{if(v!==previous.pv[i])emit('pv_event',`${prefix}: Evento PV canale ${i+1} ${v?'attivo':'terminato'}`);});
            current.outputs.forEach((v,i)=>{if(v!==previous.outputs[i])emit('digital_event',`${prefix}: Uscita evento ${i+1} ${v?'attiva':'disattiva'}`);});
        })();
        this.previous=current;this.online=true;
    }
}
