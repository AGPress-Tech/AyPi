import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { readViewSettings, writeViewSettings } from './forno/preferences-store';
import { requestAypiBackend } from './file-manager/backend-client';
import { requestFornoHistory,openFornoLive } from './forno/network';

let registered = false;
let fornoWindow: BrowserWindow | null = null;

export function setupFornoReader() {
    if (registered) return;
    registered = true;
    const preferencesPath = () => path.join(app.getPath('userData'), 'forno', 'view-settings.json');
    const streams=new Map<number,()=>void>();
    ipcMain.handle('forno-live-start',event=>{
        const sender=event.sender;
        if(!sender.getURL().startsWith('file:')||!/\/forno\.html$/i.test(new URL(sender.getURL()).pathname))throw new Error('Richiesta live non valida');
        if(!streams.has(sender.id)){
            const stop=openFornoLive((channel,value)=>{if(!sender.isDestroyed())sender.send(channel,value);});streams.set(sender.id,stop);
            sender.once('destroyed',()=>{streams.get(sender.id)?.();streams.delete(sender.id);});
        }
        return {started:true};
    });
    ipcMain.on('forno-live-stop',event=>{streams.get(event.sender.id)?.();streams.delete(event.sender.id);});
    ipcMain.handle('forno-view-settings-load', () => readViewSettings(preferencesPath()));
    ipcMain.handle('forno-view-settings-save', (_event, input) => writeViewSettings(preferencesPath(), input));
    ipcMain.on('open-forno-window', (event,payload) => {
        const senderUrl = event.sender.getURL();
        if (!senderUrl.startsWith('file:') || !/\/(bluearchive-preview|robot|mes-scada|forge)\.html$/i.test(new URL(senderUrl).pathname)) return;
        const requested=payload?.theme||new URL(senderUrl).searchParams.get('theme');
        const theme=requested==='bluearchive'?'bluearchive':'standard';
        const backgroundColor=theme==='bluearchive'?'#edf9ff':'#f7f4ed';
        if (fornoWindow && !fornoWindow.isDestroyed()) {
            if (fornoWindow.isMinimized()) fornoWindow.restore();
            fornoWindow.setBackgroundColor(backgroundColor);
            fornoWindow.maximize();
            fornoWindow.webContents.send('forno-interface-theme',{theme});
            fornoWindow.show(); fornoWindow.focus(); return;
        }
        fornoWindow = new BrowserWindow({
            width: 1250, height: 820, minWidth: 900, minHeight: 650,
            icon: path.join(__dirname, '..', 'assets', 'app-icon.png'),
            show: false, autoHideMenuBar: true, title: 'AyPi — Scada Forno', backgroundColor,
            parent: /\/forge\.html$/i.test(new URL(senderUrl).pathname)?undefined:BrowserWindow.fromWebContents(event.sender) || undefined,
            webPreferences: { nodeIntegration: true, contextIsolation: false },
        });
        fornoWindow.setMenu(null);
        fornoWindow.maximize();
        fornoWindow.once('ready-to-show', () => { fornoWindow?.maximize(); fornoWindow?.show(); });
        fornoWindow.on('closed', () => { fornoWindow = null; });
        void fornoWindow.loadFile(path.join(__dirname, '..', 'pages', 'forno.html'), { query: { standalone: '1',theme } });
    });
    ipcMain.handle('forno-status', () => requestAypiBackend('/api/forno/status', { timeoutMs: 18000 }));
    ipcMain.handle('forno-programs-list', () => requestAypiBackend('/api/forno/programs/list', { method: 'POST', timeoutMs: 18000 }));
    ipcMain.handle('forno-program-preview', (_event, input: { name: string; allowTemporaryLoad?: boolean; expectedCurrentProgram?: string }) => {
        if (typeof input?.name !== 'string' || !input.name || input.name.length > 20 || /[\x00-\x1f\x7f/\\]/.test(input.name) || (input.allowTemporaryLoad !== undefined && typeof input.allowTemporaryLoad !== 'boolean')) throw new Error('Richiesta ciclo non valida.');
        if (input.expectedCurrentProgram !== undefined && (typeof input.expectedCurrentProgram !== 'string' || input.expectedCurrentProgram.length > 20)) throw new Error('Programma iniziale non valido.');
        return requestAypiBackend('/api/forno/programs/preview', { method: 'POST', body: { name: input.name, allowTemporaryLoad: input.allowTemporaryLoad === true, expectedCurrentProgram: input.expectedCurrentProgram }, timeoutMs: 55000 });
    });
    ipcMain.handle('forno-messages',(_event,input:any)=>{
        if(!Number.isSafeInteger(input?.fromMs)||!Number.isSafeInteger(input?.toMs)||!Array.isArray(input?.eventTypes))throw new Error('Intervallo messaggi non valido');
        const query=new URLSearchParams({fromMs:String(input.fromMs),toMs:String(input.toMs),showNotes:input.showNotes?'1':'0',eventTypes:input.eventTypes.join(',')});
        if(Number.isSafeInteger(input.revision))query.set('revision',String(input.revision));
        return requestAypiBackend(`/api/forno/messages?${query}`,{timeoutMs:18000});
    });
    ipcMain.handle('forno-note-save',(_event,input:any)=>{
        if(typeof input?.text!=='string'||input.text.length>4000)throw new Error('Testo nota non valido');
        if(input.id&&typeof input.id!=='string')throw new Error('Nota non valida');
        return requestAypiBackend(input.id?`/api/forno/notes/${encodeURIComponent(input.id)}`:'/api/forno/notes',{method:input.id?'PUT':'POST',body:input,timeoutMs:18000});
    });
    ipcMain.handle('forno-note-delete',(_event,input:any)=>{
        if(typeof input?.id!=='string'||!Number.isInteger(input.revision))throw new Error('Nota non valida');
        return requestAypiBackend(`/api/forno/notes/${encodeURIComponent(input.id)}`,{method:'DELETE',body:{revision:input.revision},timeoutMs:18000});
    });
    ipcMain.handle('forno-sample',(_event,input:{timestampMs:number})=>{
        if(!Number.isSafeInteger(input?.timestampMs)||input.timestampMs<0)throw new Error('Istante campione non valido');
        return requestAypiBackend(`/api/forno/sample?timestampMs=${input.timestampMs}`,{timeoutMs:10000});
    });
    ipcMain.handle('forno-analysis',(_event,input:Record<string,number>)=>{
        if(!Number.isSafeInteger(input?.fromMs)||!Number.isSafeInteger(input?.toMs)||!Number.isFinite(input?.windowSeconds)||input.windowSeconds<0.5||input.windowSeconds>86400)throw new Error('Parametri analisi non validi');
        const query=new URLSearchParams({fromMs:String(input.fromMs),toMs:String(input.toMs),windowSeconds:String(input.windowSeconds)});
        return requestAypiBackend(`/api/forno/analysis?${query}`,{timeoutMs:18000});
    });
    ipcMain.handle('forno-history', (_event, input: Record<string, number>) => {
        const query = new URLSearchParams();
        for (const key of ['fromMs', 'toMs', 'intervalMs', 'maxPoints']) {
            if (!Number.isSafeInteger(input?.[key])) throw new Error('Parametri forno non validi');
            query.set(key, String(input[key]));
        }
        return requestFornoHistory(query);
    });
}
