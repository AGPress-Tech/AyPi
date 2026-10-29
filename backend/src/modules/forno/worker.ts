import fs from 'fs';
import { performance } from 'perf_hooks';
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import { openDatabase } from './archive';
import { MultiChannelArchive, historyChannels } from './multi-archive';
import { ModbusReader, qualityLabel } from './modbus';
import { analyzeChannels } from './analysis';
import { sampleAt } from './sample';
import { initializeMessages, listMessages, saveNote, deleteNote } from './messages';
import { EventRecorder, readProgrammer } from './events';
import { encodeHistory } from './transport';
import { randomUUID } from 'crypto';

async function main() {
    if (!isMainThread) {
        const db = openDatabase(workerData.dbPath, { readonly: true, fileMustExist: true });
        db.pragma('query_only = ON');
        parentPort!.on('message', request => {
            try {
                let result:any=request.command==='messages'?listMessages(db,request.fromMs,request.toMs,request.showNotes,request.eventTypes,request.revision):request.command==='sample'?sampleAt(db,request.timestampMs,Math.max(500,workerData.intervalMs||500)):request.command==='analysis'?analyzeChannels(db,request.fromMs,request.toMs,request.windowSeconds):historyChannels(db, request.fromMs, request.toMs, request.intervalMs, request.maxPoints);
                if(request.command==='history_binary')result=encodeHistory(result);
                parentPort!.postMessage({id:request.id,result});
            }
            catch (error) { parentPort!.postMessage({ id: request.id, error: String((error as Error).message || error) }); }
        });
        return;
    }
    const config = JSON.parse(process.env.AYPI_FORNO_CONFIG || '{}');
    if (!Number.isInteger(config.intervalMs) || config.intervalMs < 500 || config.intervalMs > 300000) throw new Error('Intervallo forno non valido');
    const archive = new MultiChannelArchive(config.dbPath, { host: config.host, port: config.port, unit: config.unit, address: config.address, scale: 0.1 });
    const reader = new ModbusReader(config.host, config.port, config.unit, config.address);
    archive.core.db.transaction(()=>initializeMessages(archive.core.db))();
    const eventReader=new ModbusReader(config.host,config.port,config.unit,14928);
    const recorder=new EventRecorder(archive.core.db);
    const queries = new Worker(__filename, { workerData: { dbPath: config.dbPath,intervalMs:config.intervalMs } });
    const send = (value: unknown) => { if (process.connected) process.send!(value); };
    queries.on('message', send);
    queries.on('error', error => { state.error = `Archivio storico: ${error.message}`; send({ type: 'fatal', error: state.error }); void stop(); });
    let stopping = false, timer: NodeJS.Timeout | null = null, active: Promise<void> = Promise.resolve();
    let deadline = performance.now();
    const state: any = { running: true, lastSample: null, error: '', intervalMs: config.intervalMs, dbPath: config.dbPath,channelCount:4,migrationBackup:archive.migrationBackup };
    const epoch=randomUUID();let frameSequence=0;
    state.events={running:true,intervalMs:500,lastReadMs:null,error:''};
    let eventTimer:NodeJS.Timeout|null=null,eventActive:Promise<void>=Promise.resolve();
    async function collectEvents(){
        const began=performance.now();
        try{const snapshot=await readProgrammer(eventReader);recorder.accept(Date.now(),snapshot);state.events.lastReadMs=Date.now();state.events.error='';}
        catch(error){if((error as any).code!=='EVENT_TRANSITION'){state.events.error=String((error as Error).message||error);try{recorder.failure(Date.now(),state.events.error);}catch(storageError){state.events.running=false;state.events.error=String(storageError);}}}
        if(!stopping&&state.events.running)eventTimer=setTimeout(()=>{eventActive=collectEvents();},Math.max(0,500-(performance.now()-began)));
    }
    async function collect() {
        try {
            const t = Date.now(), results = await reader.readChannels();
            archive.appendFrame(results.map(result=>({t,...result})));
            send({type:'frame',frame:{timestampMs:t,values:results.map(r=>r.v===null?-2147483648:r.v),qualities:results.map(r=>r.q),epoch,sequence:++frameSequence,intervalMs:config.intervalMs}});
            const channels=results.map((result,index)=>({id:index+1,name:'Canale '+(index+1),address:config.address+index*4,timestampMs:t,temperature:result.v===null?null:result.v/10,quality:qualityLabel(result.q)}));
            state.channels=channels;
            state.lastSample={...channels[0],channels};
        } catch (error) { state.error = String((error as Error).message || error); state.running = false; }
        if (!stopping && state.running) {
            deadline = Math.max(deadline + config.intervalMs, performance.now());
            timer = setTimeout(() => { active = collect(); }, Math.max(0, deadline - performance.now()));
        }
    }
    async function stop(id?: number) {
        if (stopping) return;
        stopping = true; state.running = false;
        if (timer) clearTimeout(timer);
        if(eventTimer)clearTimeout(eventTimer);state.events.running=false;
        await Promise.all([active,eventActive]);
        reader.close();eventReader.close(); await queries.terminate(); archive.close();
        if (id !== undefined) send({ id, result: { stopped: true } });
        if (process.connected) process.disconnect();
    }
    process.on('message', (request: any) => {
        if (stopping) return;
        if (request.command === 'stop') { void stop(request.id).catch(error => { send({ type: 'fatal', error: String(error) }); process.exitCode = 1; }); return; }
        if (request.command === 'history'||request.command === 'history_binary'||request.command === 'analysis'||request.command === 'sample'||request.command==='messages') { queries.postMessage(request); return; }
        if(request.command==='note_save'||request.command==='note_delete'){
            try{send({id:request.id,result:request.command==='note_save'?saveNote(archive.core.db,request.input,request.actor,Math.max(500,config.intervalMs)):deleteNote(archive.core.db,request.input,request.actor)});}
            catch(error){send({id:request.id,error:String((error as Error).message||error),errorCode:(error as any).code});}return;
        }
        if (request.command === 'status') {
            send({ id: request.id, result: { ...state, databaseBytes: fs.statSync(config.dbPath).size, walBytes: fs.existsSync(config.dbPath + '-wal') ? fs.statSync(config.dbPath + '-wal').size : 0 } });
        } else send({ id: request.id, error: 'Comando non valido' });
    });
    process.once('disconnect', () => { void stop(); });
    send({ type: 'ready' });
    active = collect();
    eventActive=collectEvents();
}
void main().catch(error => { if (process.connected) process.send!({ type: 'fatal', error: String(error.message || error) }); process.exitCode = 1; if (process.connected) process.disconnect(); });
