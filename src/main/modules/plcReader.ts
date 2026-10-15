import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'path';
import fs from 'fs';
import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { createInterface } from 'readline';
import { getRobotStatus } from './robotManager';

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

function config() {
    return JSON.parse(fs.readFileSync(path.join(resources(), 'macchine.json'), 'utf8'));
}

function emptySnapshot() {
    const cfg = config();
    return { mode: 'IDLE', now: Date.now()/1000, since: Date.now()/1000, bits: [],
        machines: cfg.macchine.map((m: any) => ({asset_type:'machine', code:m.codice,
            name:m.nome, mapping:m.stato, signal:m.segnale, multiplier:m.pezzi_per_impulso,
            pulses:0, pieces:0, hour:0, siren:0, frame_time:null})),
        flows: cfg.flussi_et200sp.map((f: any) => ({node:f.nodo, ip:f.ip,
            mac:f.mac.toUpperCase(), fid:f.frame_id, machine:'Da identificare', frames:0, last:null})) };
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
        path.join(app.getAppPath(), '..', 'AyPiPLCReader', 'AyPiPLCReader_APP_v3_6_5', '.venv', 'Scripts', 'python.exe'),
    ];
    const found = candidates.find(p => fs.existsSync(p));
    return found ? {command:found, prefix:[]} : {command:process.platform==='win32'?'py':'python3', prefix:process.platform==='win32'?['-3']:[]};
}

function stopWorker() {
    const child = processWorker;
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
        processWorker = null; running = false;
        if (code) error = stderr.includes('scapy') ? 'Scapy non installato nel Python selezionato. Installa scapy e Npcap per la lettura LIVE.' : stderr || `Lettore terminato (codice ${code}).`;
    });
}

export function setupPlcReader(mainWindow: BrowserWindow) {
    try { const saved=JSON.parse(fs.readFileSync(path.join(dataFolder(),'settings.json'),'utf8')); python=saved.python||''; adapter=saved.adapter||defaultInterface; } catch {}
    const authorized = (event: Electron.IpcMainInvokeEvent) => window && !window.isDestroyed() && event.sender === window.webContents;
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
            session:{running,error,python,adapter,folder:dataFolder()},warnings:[]};
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
    app.on('before-quit',stopWorker);
}
