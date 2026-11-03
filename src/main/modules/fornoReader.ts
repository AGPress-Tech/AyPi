import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'path';
import fs from 'fs';
import { readViewSettings, writeViewSettings } from './forno/preferences-store';
import { requestAypiBackend } from './file-manager/backend-client';
import { requestFornoHistory,openFornoLive } from './forno/network';
import { draftFromRecipe } from './forno/program-draft';
import { readProgramDraft, writeProgramDraft } from './forno/program-draft-store';
import { archiveDraft, exportBackupFile, importProgramFiles, libraryView, prepareRestoreFiles, readLibrary, setLocalDeletion } from './forno/program-library';

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
    const draftPath = () => path.join(app.getPath('userData'), 'forno', 'program-draft.json');
    const libraryPath = () => path.join(app.getPath('userData'), 'forno', 'program-library.json');
    ipcMain.handle('forno-library-list', () => libraryView(readLibrary(libraryPath())));
    ipcMain.handle('forno-library-save', (_event, input) => archiveDraft(libraryPath(), input?.draft, input?.sourceId));
    ipcMain.handle('forno-library-delete', (_event, input) => {
        if (typeof input?.deleted !== 'boolean') throw new Error('Operazione locale non valida.');
        return setLocalDeletion(libraryPath(), input.ids, input.revision, input.deleted);
    });
    ipcMain.handle('forno-library-import', async () => {
        const result = await dialog.showOpenDialog({ title: 'Importa nell’archivio locale · nessun invio al forno', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Backup AyPi, clone iTools o programmi nanodac', extensions: ['json', 'uic', 'uipz'] }] });
        return result.canceled ? null : importProgramFiles(libraryPath(), result.filePaths);
    });
    ipcMain.handle('forno-library-backup', async (_event, input) => {
        if (!readLibrary(libraryPath()).entries.length) {
            const source = await dialog.showOpenDialog({ title: 'Primo backup: seleziona il clone iTools o i programmi originali · nessun contatto con il forno', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Clone iTools, programmi nativi o backup', extensions: ['uic', 'uipz', 'json'] }] });
            if (source.canceled) return null;
            importProgramFiles(libraryPath(), source.filePaths);
        }
        const result = await dialog.showSaveDialog({ title: 'Salva backup verificato dei programmi locali', defaultPath: 'Programmi_forno.aypi-forno-backup.json', filters: [{ name: 'Backup programmi AyPi', extensions: ['json'] }] });
        return result.canceled || !result.filePath ? null : exportBackupFile(libraryPath(), result.filePath, input?.ids);
    });
    ipcMain.handle('forno-library-restore-files', async (_event, input) => {
        if (typeof input?.originalsOnly !== 'boolean') throw new Error('Tipo esportazione non valido.');
        const result = await dialog.showOpenDialog({ title: 'Scegli dove preparare i file nativi · nessun invio al forno', properties: ['openDirectory', 'createDirectory'] });
        return result.canceled || !result.filePaths[0] ? null : prepareRestoreFiles(libraryPath(), result.filePaths[0], input.ids, input.originalsOnly);
    });
    ipcMain.handle('forno-draft-load', () => readProgramDraft(draftPath()));
    ipcMain.handle('forno-draft-save', (_event, input) => writeProgramDraft(draftPath(), input));
    ipcMain.handle('forno-draft-export', async (_event, input) => {
        const { validateDraft } = await import('./forno/program-draft');
        const draft = validateDraft(input);
        const result = await dialog.showSaveDialog({ title: 'Esporta bozza programma forno', defaultPath: draft.name + '.aypi-forno.json', filters: [{ name: 'Bozza AyPi forno', extensions: ['json'] }] });
        if (result.canceled || !result.filePath) return null;
        writeProgramDraft(result.filePath, draft); return { path: result.filePath };
    });
    ipcMain.handle('forno-draft-import', async () => {
        const result = await dialog.showOpenDialog({ title: 'Apri bozza AyPi forno', properties: ['openFile'], filters: [{ name: 'Bozza AyPi forno', extensions: ['json'] }] });
        if (result.canceled || !result.filePaths[0]) return null;
        const draft = readProgramDraft(result.filePaths[0]); if (!draft) throw new Error('Bozza non trovata.'); return draft;
    });
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
    ipcMain.handle('forno-program-transfer', async (event, input) => {
        const url = event.sender.getURL();
        if (!url.startsWith('file:') || !/\/forno\.html$/i.test(new URL(url).pathname) || !['context', 'prepare', 'execute', 'reconcile', 'inspect'].includes(input?.operation)) throw new Error('Richiesta trasferimento non valida.');
        const result = await requestAypiBackend('/api/forno/programs/transfer/' + input.operation, { method: 'POST', body: input.payload || {}, timeoutMs: 240000 });
        if (input.operation === 'execute' && result?.verified && /^[a-f0-9-]{36}$/.test(result.id)) {
            try {
                const folder = path.join(app.getPath('userData'), 'forno', 'transfers'); fs.mkdirSync(folder, { recursive: true });
                const file = path.join(folder, result.id + '.json'), bytes = JSON.stringify({ format: 'aypi-forno-transfer-receipt', version: 1, ...result }, null, 2);
                const fd = fs.openSync(file, 'wx'); try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
                if (fs.readFileSync(file, 'utf8') !== bytes) throw Error('Rilettura locale diversa.');
                if(result.backupData?.recipeBefore&&(result.action==='delete'||result.action==='upload'&&result.backupData.targetExisted)){
                    try{const previous=draftFromRecipe(result.backupData.recipeBefore);writeProgramDraft(path.join(folder,result.id+'.before.aypi-forno.json'),previous);archiveDraft(libraryPath(),previous);result.message+=' Versione precedente conservata anche come bozza e nell’archivio locale.';}
                    catch(error){result.message+=' Backup completo precedente conservato nella ricevuta; bozza precedente non archiviata: '+(error as Error).message;}
                }
                if (result.draft) { writeProgramDraft(path.join(folder, result.id + '.aypi-forno.json'), result.draft); if (result.action === 'upload') archiveDraft(libraryPath(), result.draft); }
                result.localBackupPath = file;
            } catch (error) { result.message += ' Copia locale del backup non completata: ' + (error as Error).message + '. Conservato il backup sul server: ' + result.backup; }
        }
        return result;
    });
    ipcMain.handle('forno-program-preview', (_event, input: { name: string; allowTemporaryLoad?: boolean; expectedCurrentProgram?: string }) => {
        if (input?.allowTemporaryLoad) throw new Error('Caricamento temporaneo sospeso. Usare il clone o il backup locale: nessun programma viene caricato sul forno.');
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
