import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { createInterface } from 'readline';
import { getRobotStatus } from './robotManager';
import { requestAypiBackend } from './file-manager/backend-client';

const resources = () => path.join(__dirname, '..', 'templates', 'plc-reader').replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
const dataFolder = () => path.join(app.getPath('userData'), 'plc-reader');
const defaultInterface = '\\Device\\NPF_{71BC7015-44BB-42D0-A6EA-6DE32C878BAE}';
let window: BrowserWindow | null = null;
let processWorker: ChildProcessWithoutNullStreams | null = null;
let state: any = null;
let events: any[] = [];
let error = '';
let running = false;
let mode = 'IDLE';
let python = '';
let adapter = defaultInterface;
let robotRows: any[] = [];
let robotPending = false;
let robotTimer: ReturnType<typeof setInterval> | null = null;
type CsvImportState = {
    filePath: string;
    sourceSessionId: string;
    header: string;
    offset: number;
    dataRows: number;
    importedRows: number;
    importedEvents: number;
    duplicateEvents: number;
    rejectedRows: number;
    lastImportedAt: string;
    error: string;
    busy: boolean;
    nextRetryAt: number;
};
const csvImportStates = new Map<string,CsvImportState>();
let activeCsvImportPath = '';
let csvImportTimer: ReturnType<typeof setInterval> | null = null;
const CSV_IMPORT_CHUNK_BYTES = 512 * 1024;
const MES_SYNC_INTERVAL_MS = 5000;
let persistedCsvOffsets: Record<string,{offset:number;dataRows:number;header:string}> = {};
let collectorSessionId = '';
let collectorStartedAt = '';
let collectorBatchSequence = 0;
let collectorSyncBusy = false;
let collectorSyncTimer: ReturnType<typeof setInterval> | null = null;
let collectorNextRetryAt = 0;
let collectorSyncError = '';
let collectorLastSentAt = '';
let collectorLastAckAt = '';

const collectorId = () => `aypi-plc-${os.hostname()}`.toLowerCase().replace(/[^a-z0-9._-]+/g,'-').slice(0,120);
const csvOffsetFile = () => path.join(dataFolder(),'mes-upload-state.json');

function loadCsvOffsets() {
    try { persistedCsvOffsets=JSON.parse(fs.readFileSync(csvOffsetFile(),'utf8'))||{}; }
    catch { persistedCsvOffsets={}; }
}

function persistCsvOffsets() {
    fs.mkdirSync(dataFolder(),{recursive:true});
    fs.writeFileSync(csvOffsetFile(),JSON.stringify(persistedCsvOffsets,null,2),'utf8');
}

function config() {
    return JSON.parse(fs.readFileSync(path.join(resources(), 'macchine.json'), 'utf8'));
}

function emptySnapshot() {
    const cfg = config();
    const mappings = new Map<string,string>();
    for (const machine of cfg.macchine) {
        const signals = [...(machine.segnale ? [machine.segnale] : []), ...(machine.segnali_stato || [])];
        if (machine.dispositivo_profinet) signals.push(machine.dispositivo_profinet);
        for (const signal of signals) mappings.set(`${signal.mac.toLowerCase()}|${signal.frame_id}`, machine.codice);
    }
    const configuredFlows = [...cfg.flussi_et200sp, ...(cfg.dispositivi_profinet_aggiuntivi || [])];
    return { mode: 'IDLE', now: Date.now()/1000, since: Date.now()/1000, bits: [],
        machines: cfg.macchine.map((m: any) => ({asset_type:'machine', code:m.codice,
            name:m.nome, mapping:m.stato, signal:m.segnale, device:m.dispositivo_profinet,
            multiplier:m.pezzi_per_impulso,
            pulses:0, pieces:0, hour:0, siren:0, frame_time:null})),
        flows: configuredFlows.map((f: any) => ({node:f.nodo, ip:f.ip,
            mac:f.mac.toUpperCase(), fid:f.frame_id || '—',
            machine:f.frame_id ? mappings.get(`${f.mac.toLowerCase()}|${f.frame_id}`) || 'Da identificare' : 'Da identificare',
            frames:0, last:null})) };
}

async function refreshRobots() {
    if (robotPending) return;
    robotPending = true;
    try {
        robotRows = await Promise.all(config().robots.map(async (r: any) => {
            const result = await getRobotStatus(r.codice, r.url, r.chiave_stato);
            const previous = robotRows.find(row => row.code === r.codice);
            return { ...previous, asset_type:'robot', code:r.codice, name:r.nome, island:r.isola,
                ip:r.ip, online:result.ok, program:result.ok?result.program:previous?.program,
                robot_state:result.ok?result.state:previous?.robot_state,
                counter:result.ok?result.counter:previous?.counter,
                cycle_time:result.ok?result.cycleTime:previous?.cycle_time,
                details:result.ok?result.details:previous?.details,
                last_seen:result.ok?Date.now()/1000:previous?.last_seen, error:result.error };
        }));
    } finally { robotPending = false; }
}

function pythonCommand() {
    const configured = python.trim().replace(/^"(.*)"$/, '$1');
    const isPath = path.isAbsolute(configured) || /[\\/]/.test(configured);
    if (configured && (!isPath || fs.existsSync(configured))) return {command:configured, prefix:[]};
    const candidates = [
        path.join(dataFolder(), 'runtime', process.platform === 'win32' ? 'Scripts' : 'bin', process.platform === 'win32' ? 'python.exe' : 'python'),
        path.join(app.getAppPath(), '.venv', 'Scripts', 'python.exe'),
        path.join(app.getAppPath(), '..', 'AyPiPLCReader', 'AyPiPLCReader_APP_v3_7_3', '.venv', 'Scripts', 'python.exe'),
    ];
    const found = candidates.find(p => fs.existsSync(p));
    return found ? {command:found, prefix:[]} : {command:process.platform==='win32'?'py':'python3', prefix:process.platform==='win32'?['-3']:[]};
}

function registerCsvAutoImport(folder: string) {
    const filePath = path.join(folder,'impulsi.csv');
    const persisted=persistedCsvOffsets[filePath];
    if(!csvImportStates.has(filePath))csvImportStates.set(filePath,{
        filePath,
        sourceSessionId:path.basename(folder),
        header:persisted?.header||'',offset:Number(persisted?.offset)||0,dataRows:Number(persisted?.dataRows)||0,importedRows:0,importedEvents:0,
        duplicateEvents:0,rejectedRows:0,lastImportedAt:'',error:'',busy:false,nextRetryAt:0,
    });
    activeCsvImportPath=filePath;
    if(!csvImportTimer){
        csvImportTimer=setInterval(()=>{
            csvImportStates.forEach(item=>void flushCsvAutoImport(item));
        },MES_SYNC_INTERVAL_MS);
        csvImportTimer.unref?.();
    }
    void flushCsvAutoImport(csvImportStates.get(filePath)!);
}

async function flushCsvAutoImport(item: CsvImportState) {
    if(item.busy||Date.now()<item.nextRetryAt||!fs.existsSync(item.filePath))return;
    item.busy=true;
    try{
        const size=fs.statSync(item.filePath).size;
        if(size<item.offset){item.header='';item.offset=0;item.dataRows=0;}
        if(!item.header){
            if(!size)return;
            const headerSize=Math.min(size,64*1024);
            const headerBuffer=Buffer.alloc(headerSize);
            const descriptor=fs.openSync(item.filePath,'r');
            try{fs.readSync(descriptor,headerBuffer,0,headerSize,0);}finally{fs.closeSync(descriptor);}
            const newline=headerBuffer.indexOf(10);
            if(newline<0)return;
            item.header=headerBuffer.subarray(0,newline).toString('utf8').replace(/^\uFEFF/,'').replace(/\r$/,'');
            item.offset=newline+1;
        }
        if(size<=item.offset)return;
        const readSize=Math.min(size-item.offset,CSV_IMPORT_CHUNK_BYTES);
        const buffer=Buffer.alloc(readSize);
        const descriptor=fs.openSync(item.filePath,'r');
        let bytesRead=0;
        try{bytesRead=fs.readSync(descriptor,buffer,0,readSize,item.offset);}finally{fs.closeSync(descriptor);}
        const chunk=buffer.subarray(0,bytesRead);
        const lastNewline=chunk.lastIndexOf(10);
        if(lastNewline<0)return;
        const complete=chunk.subarray(0,lastNewline+1);
        let physicalRows=0;
        for(const byte of complete)if(byte===10)physicalRows+=1;
        const csv=`${item.header}\n${complete.toString('utf8')}`;
        const result=await requestAypiBackend('/api/mes/imports/plc-csv',{
            method:'POST',
            body:{
                sourceSessionId:item.sourceSessionId,
                sourceFile:path.basename(item.filePath),
                firstDataRow:item.dataRows+2,
                csv,
            },
            headers:{'x-aypi-client':'plc-reader-csv-auto-import'},
        });
        item.offset+=complete.length;
        item.dataRows+=physicalRows;
        item.importedRows+=Number(result.totalRows||0);
        item.importedEvents+=Number(result.insertedEvents||0);
        item.duplicateEvents+=Number(result.duplicateEvents||0);
        item.rejectedRows+=Number(result.rejectedRows||0);
        item.lastImportedAt=new Date().toISOString();
        item.error='';
        item.nextRetryAt=0;
        persistedCsvOffsets[item.filePath]={offset:item.offset,dataRows:item.dataRows,header:item.header};
        persistCsvOffsets();
    }catch(importError){
        item.error=importError instanceof Error?importError.message:String(importError);
        item.nextRetryAt=Date.now()+30000;
    }finally{item.busy=false;}
}

function registerExistingCsvImports() {
    const root=path.join(dataFolder(),'registrazioni');
    if(!fs.existsSync(root))return;
    fs.readdirSync(root,{withFileTypes:true})
        .filter(entry=>entry.isDirectory())
        .map(entry=>path.join(root,entry.name))
        .filter(folder=>fs.existsSync(path.join(folder,'impulsi.csv')))
        .sort()
        .forEach(registerCsvAutoImport);
}

function isoFromEpochSeconds(value: unknown) {
    const seconds=Number(value);
    return Number.isFinite(seconds)&&seconds>0?new Date(seconds*1000).toISOString():'';
}

async function flushCollectorSnapshot(stoppedAt='') {
    if(collectorSyncBusy||!collectorSessionId||(!stoppedAt&&(!running||Date.now()<collectorNextRetryAt)))return;
    collectorSyncBusy=true;
    const sentAt=new Date().toISOString();
    const snapshot=state||emptySnapshot();
    const nowSeconds=Date.now()/1000;
    const batchId=`${collectorSessionId}:${++collectorBatchSequence}`;
    try{
        await requestAypiBackend('/api/mes/ingest/batches',{
            method:'POST',
            body:{
                collectorId:collectorId(),sourceSessionId:collectorSessionId,batchId,
                mode:mode==='DEMO'?'DEMO':'LIVE',startedAt:collectorStartedAt,sentAt,stoppedAt,
                machines:(snapshot.machines||[]).filter((machine:any)=>machine.asset_type!=='robot').map((machine:any)=>{
                    const frameAt=isoFromEpochSeconds(machine.frame_time);
                    const detected=!stoppedAt&&!!frameAt&&nowSeconds-Number(machine.frame_time)<=10;
                    return {machineId:String(machine.code||''),machineName:String(machine.name||''),
                        observedAt:sentAt,frameAt,detected,pulses:Math.max(0,Number(machine.pulses)||0),
                        pieces:Math.max(0,Number(machine.pieces)||0),piecesLastHour:Math.max(0,Number(machine.hour)||0),
                        lastPieceAt:isoFromEpochSeconds(machine.last),
                        lastCycleSeconds:Number.isFinite(Number(machine.cycle))?Math.max(0,Number(machine.cycle)):null,
                        multiplier:Math.max(1,Number(machine.multiplier)||1),frameCount:Math.max(0,Number(machine.frames)||0),
                        invalidFrames:Math.max(0,Number(machine.invalid)||0)};
                }),
            },
            headers:{'x-aypi-client':'plc-reader-edge-collector'},
        });
        collectorLastSentAt=sentAt;collectorLastAckAt=new Date().toISOString();collectorSyncError='';collectorNextRetryAt=0;
    }catch(syncError){
        collectorSyncError=syncError instanceof Error?syncError.message:String(syncError);
        collectorNextRetryAt=Date.now()+15000;
    }finally{collectorSyncBusy=false;}
}

function activeCsvImportSnapshot() {
    const item=csvImportStates.get(activeCsvImportPath);
    if(!item)return null;
    return {
        sourceSessionId:item.sourceSessionId,
        importedRows:item.importedRows,
        importedEvents:item.importedEvents,
        duplicateEvents:item.duplicateEvents,
        rejectedRows:item.rejectedRows,
        lastImportedAt:item.lastImportedAt,
        error:item.error,
        pending:item.busy,
        localFile:item.filePath,
        nextRetryAt:item.nextRetryAt ? new Date(item.nextRetryAt).toISOString() : '',
    };
}

function stopWorker() {
    const child = processWorker;
    const stoppedAt=collectorSessionId?new Date().toISOString():'';
    if(stoppedAt)void flushCollectorSnapshot(stoppedAt);
    processWorker = null;
    running = false;
    if (child) {
        child.stdin.write(JSON.stringify({kind:'stop'})+'\n', () => {});
        const fallback = setTimeout(() => { if (child.exitCode === null) child.kill(); }, 3500);
        fallback.unref();
    }
}

function startWorker(nextMode: string) {
    if (processWorker) throw new Error('Arresta la sessione corrente prima di avviarne una nuova.');
    const cmd = pythonCommand();
    if (!cmd.prefix.length) python = cmd.command;
    fs.mkdirSync(dataFolder(), {recursive:true});
    fs.writeFileSync(path.join(dataFolder(), 'settings.json'), JSON.stringify({python, adapter}));
    error = ''; mode = nextMode; state = null; events = [];
    const folder = path.join(dataFolder(), 'registrazioni', new Date().toISOString().replace(/[:.]/g,'-'));
    collectorSessionId=path.basename(folder);
    collectorStartedAt=new Date().toISOString();
    collectorBatchSequence=0;
    collectorNextRetryAt=0;
    collectorSyncError='';
    registerCsvAutoImport(folder);
    const child = spawn(cmd.command, [...cmd.prefix, path.join(resources(),'worker.py'),
        '--folder',folder, '--mode',nextMode, '--iface',adapter], {windowsHide:true, env:{...process.env, PYTHONIOENCODING:'utf-8', PYTHONUNBUFFERED:'1'}});
    processWorker = child; running = true;
    child.stdin.on('error', () => {});
    let stderr = '';
    const lines = createInterface({input:child.stdout});
    lines.on('line', line => {
        if (processWorker !== child) return;
        try {
            const value = JSON.parse(line);
            if (value.error) { error = value.error; stopWorker(); return; }
            state = value;
            events = [...(value.events || []).reverse(), ...events].slice(0,500);
        } catch { /* Ignore non-protocol diagnostic lines. */ }
    });
    child.stderr.on('data', data => { stderr = (stderr + data.toString()).slice(-4000); });
    child.on('error', () => {
        if (processWorker !== child) return;
        error = 'Python non disponibile. Indica il percorso di Python nelle impostazioni della sessione.';
        processWorker = null; running = false;
    });
    child.on('close', code => {
        if (processWorker !== child) return;
        void flushCollectorSnapshot(new Date().toISOString());
        processWorker = null; running = false;
        if (code) error = stderr.includes('scapy') ? 'Scapy non installato nel Python selezionato. Installa scapy e Npcap per la lettura LIVE.' : stderr || `Lettore terminato (codice ${code}).`;
    });
}

export function setupPlcReader(mainWindow: BrowserWindow) {
    loadCsvOffsets();
    registerExistingCsvImports();
    if(!collectorSyncTimer){
        collectorSyncTimer=setInterval(()=>void flushCollectorSnapshot(),MES_SYNC_INTERVAL_MS);
        collectorSyncTimer.unref?.();
    }
    try { const saved=JSON.parse(fs.readFileSync(path.join(dataFolder(),'settings.json'),'utf8')); python=saved.python||''; adapter=saved.adapter||defaultInterface; } catch {}
    const authorized = (event: Electron.IpcMainInvokeEvent) => {
        if (window && !window.isDestroyed() && event.sender === window.webContents) return true;
        try {
            return /\/production-planner\.html(?:\?|$)/i.test(new URL(event.sender.getURL()).pathname);
        } catch {
            return false;
        }
    };
    ipcMain.on('open-plc-reader-window', (event) => {
        if (event.sender !== mainWindow.webContents) return;
        if (window && !window.isDestroyed()) { if(window.isMinimized())window.restore(); window.show(); window.focus(); return; }
        window = new BrowserWindow({width:1440,height:920,minWidth:1000,minHeight:680,show:false,
            backgroundColor:'#edf8ff',autoHideMenuBar:true,webPreferences:{nodeIntegration:true,contextIsolation:false}});
        window.setMenu(null);
        window.loadFile(path.join(__dirname,'..','pages','utilities','plc-reader.html'));
        window.maximize();
        window.once('ready-to-show',()=>window?.show());
        void refreshRobots();
        robotTimer = setInterval(()=>void refreshRobots(),3000);
        window.on('closed',()=>{window=null;stopWorker();if(robotTimer)clearInterval(robotTimer);robotTimer=null;if(!mainWindow.isDestroyed()){mainWindow.show();mainWindow.focus();}});
    });
    ipcMain.handle('plc-reader-snapshot', event => {
        if(!authorized(event))throw new Error('Finestra non autorizzata');
        const snapshot=state||emptySnapshot();
        return {...snapshot,now:Date.now()/1000,mode,machines:[...snapshot.machines,...robotRows],
            session:{running,error,python,adapter,folder:dataFolder(),mesImport:activeCsvImportSnapshot(),
                mesCollector:{collectorId:collectorId(),sourceSessionId:collectorSessionId,lastSentAt:collectorLastSentAt,
                    lastAckAt:collectorLastAckAt,error:collectorSyncError,pending:collectorSyncBusy,
                    nextRetryAt:collectorNextRetryAt?new Date(collectorNextRetryAt).toISOString():''}},warnings:[]};
    });
    ipcMain.handle('plc-reader-events', event => { if(!authorized(event))return [];return events.slice(0,100); });
    ipcMain.handle('plc-reader-interfaces', (event,payload) => {
        if(!authorized(event))throw new Error('Finestra non autorizzata');
        const previousPython=python;
        if(typeof payload?.python==='string')python=payload.python.trim().slice(0,1000);
        const cmd=pythonCommand();python=previousPython;
        return new Promise((resolve,reject)=>{
            const child=spawn(cmd.command,[...cmd.prefix,path.join(resources(),'worker.py'),'--folder',dataFolder(),'--interfaces'],{windowsHide:true,env:{...process.env,PYTHONIOENCODING:'utf-8'}});
            let stdout='',stderr='';
            const timeout=setTimeout(()=>{child.kill();reject(new Error('Rilevamento schede scaduto. Verifica Python, Scapy e Npcap.'));},8000);
            child.stdout.on('data',data=>stdout+=data.toString());
            child.stderr.on('data',data=>stderr+=data.toString());
            child.on('error',()=>{clearTimeout(timeout);reject(new Error('Python non disponibile. Indica il percorso dell’interprete.'));});
            child.on('close',code=>{
                clearTimeout(timeout);
                if(code){reject(new Error(stderr||'Impossibile rilevare le schede. Verifica Scapy e Npcap.'));return;}
                try{resolve(JSON.parse(stdout.trim()).interfaces);}catch{reject(new Error('Nessuna scheda rilevata.'));}
            });
        });
    });
    ipcMain.handle('plc-reader-control', (event,payload) => {
        if(!authorized(event))throw new Error('Finestra non autorizzata');
        if(payload?.action==='stop'){stopWorker();return {ok:true};}
        if(payload?.action==='folder'){fs.mkdirSync(dataFolder(),{recursive:true});void shell.openPath(dataFolder());return {ok:true};}
        if(payload?.action==='start') {
            if(payload.mode!=='LIVE'&&payload.mode!=='DEMO')throw new Error('Modalità non valida');
            if(typeof payload.adapter==='string')adapter=payload.adapter.trim().slice(0,500);
            if(typeof payload.python==='string')python=payload.python.trim().slice(0,1000);
            if(payload.mode==='LIVE'&&!adapter)throw new Error('Indica la scheda di acquisizione Npcap.');
            startWorker(payload.mode);return {ok:true};
        }
        throw new Error('Comando non valido');
    });
    ipcMain.handle('plc-reader-marker',(event,payload)=>{
        if(!authorized(event))throw new Error('Finestra non autorizzata');
        const cfg=config(),valid=[...cfg.macchine,...cfg.robots].some(m=>m.codice===payload?.machine);
        const note=typeof payload?.note==='string'?payload.note.trim():'';
        if(!valid||!note||note.length>250)throw new Error('Marcatore non valido');
        if(!processWorker)throw new Error('Avvia una sessione prima di registrare un marcatore.');
        processWorker.stdin.write(JSON.stringify({kind:'marker',machine:payload.machine,note})+'\n');
        return {ok:true};
    });
    app.on('before-quit',()=>{
        if(collectorSyncTimer)clearInterval(collectorSyncTimer);
        collectorSyncTimer=null;
        stopWorker();
    });
}
