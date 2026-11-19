import { app, BrowserWindow, dialog, ipcMain, shell, Menu } from 'electron';
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { randomUUID, createHash } from 'crypto';
import * as XLSX from 'xlsx';
import { requestAypiBackend } from '../file-manager/backend-client';
import { getAddressEntry } from '../file-manager/address-book';
import { excelDateCell, formatExcelNumbers } from '../analysis-excel';
import { validateWorkspace } from '../analysis-ui-model';
import {registerAnalysisSource} from '../analysis-navigation';
const execute = promisify(execFile);
export function registerToolingIpc(mainWindow: BrowserWindow, icon: () => string) {
    let window: BrowserWindow | null = null, actor = '', groups: Record<string, string[]> = {}, importing = false, exporting = false;
    const owns = (e: any) => !!window && !window.isDestroyed() && e.sender === window.webContents;
    registerAnalysisSource(e=>owns(e)&&!!actor);
    const request = (url: string, options: any = {}) => { if (!actor)
        throw Error('Seleziona un dipendente per accedere.'); return requestAypiBackend('/api/tooling/' + url, { ...options, headers: { 'x-aypi-actor': actor, 'x-aypi-user': actor, 'x-aypi-role': 'employee' } }); };
    const result = async (fn: () => Promise<any>) => { try {
        return { ok: true, ...await fn() };
    }
    catch (e) {
        return { ok: false, error: (e as Error).message.includes('(404)') ? 'Aggiornare il backend AyPi per abilitare Utensili e Attrezzature.' : (e as Error).message };
    } };
    const open = async () => {
        if (window && !window.isDestroyed()) {
            window.maximize();
            window.show();
            window.focus();
            return window;
        }
        actor = '';
        const win = new BrowserWindow({ width: 1520, height: 960, minWidth: 1000, minHeight: 680, title: 'AyPi · Utensili e Attrezzature', icon: icon(), show: false, backgroundColor: '#f2f8fc', webPreferences: { nodeIntegration: true, contextIsolation: false } });
        window = win;
        win.setMenu(null);
        win.webContents.on('will-prevent-unload',event=>{if(dialog.showMessageBoxSync(win,{type:'question',buttons:['Scarta modifiche','Annulla'],defaultId:1,cancelId:1,title:'Modifiche non salvate',message:'Chiudere e scartare le modifiche della scheda?'})===0)event.preventDefault();});
        win.maximize();
        win.once('ready-to-show', () => { if (!win.isDestroyed())
            win.show(); });
        win.on('closed', () => { if (window === win) {
            window = null;
            actor = '';
        } });
        win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        win.webContents.on('will-navigate', e => e.preventDefault());
        const theme = /[?&]theme=bluearchive(?:&|$)/.test(mainWindow.webContents.getURL()) ? 'bluearchive' : 'standard';
        void win.loadFile(path.join(__dirname, '..', '..', 'pages', 'tooling.html'), { query: { theme } }).catch(() => { if (!win.isDestroyed())
            win.close(); });
        return win;
    };
    ipcMain.handle('tooling-employees', e => !owns(e) ? { ok: false } : result(async () => { const data = await requestAypiBackend('/api/tooling/employees'); groups = data.groups; return data; }));
    ipcMain.handle('tooling-login', (e, name) => !owns(e) ? { ok: false } : result(async () => { const found = Object.values(groups).flat().find(v => typeof name === 'string' && v.toLocaleLowerCase('it') === name.trim().toLocaleLowerCase('it')); if (!found)
        throw Error('Seleziona un dipendente dall’elenco.'); actor = found; return { actor, ...await request('snapshot') }; }));
    ipcMain.on('tooling-logout', e => { if (owns(e))
        actor = ''; });
    ipcMain.on('tooling-close', e => { if (owns(e))
        window?.close(); });
    ipcMain.handle('tooling-api', (e, p) => !owns(e) ? { ok: false } : result(async () => {
        if (p?.op === 'snapshot')
            return request('snapshot');
        if (['save', 'delete'].includes(p?.op) && ['tool', 'article','link','issue'].includes(p.kind))
            return request((p.op === 'save' ? 'save/' : 'delete/') + p.kind, { method: 'POST', body: p.entity });
        if(p?.op==='movement'||p?.op==='void')return request(p.op,{method:'POST',body:p.entity});
        if(p?.op==='article-search')return request('articles/search',{method:'POST',body:{search:p.search,exact:p.exact}});
        if (p?.op === 'audit' && typeof p.id === 'string')
            return request('audit/' + encodeURIComponent(p.id));
        if (p?.op === 'preferences-get')
            return request('preferences');
        if (p?.op === 'preferences-save') {
            if (!p.value || JSON.stringify(p.value).length > 500000)
                throw Error('Preferenze non valide.');
            if (p.value.workspace)
                p.value.workspace = validateWorkspace(p.value.workspace);
            if (p.value.analysisWorkspace)
                p.value.analysisWorkspace = validateWorkspace(p.value.analysisWorkspace);
            return request('preferences', { method: 'POST', body: p.value });
        }
        throw Error('Operazione non consentita.');
    }));
    ipcMain.handle('tooling-import', async (e, p) => {
        if (!owns(e) || !actor)
            return { ok: false };
        if (['apply', 'cancel'].includes(p?.phase))
            return result(() => request('import-' + p.phase, { method: 'POST', body: { token: p.token } }));
        if (importing)
            return { ok: false, error: 'Un confronto è già in corso.' };
        importing = true;
        return result(async () => {
            const output = path.join(app.getPath('temp'), 'aypi-tooling-' + randomUUID() + '.json'), temporaryScript = output + '.ps1', localSource = output + '.accdb', user = actor;
            try {
                const source = getAddressEntry('moduli.openUtensili')?.path;
                if (!source || !source.toLowerCase().endsWith('.accdb'))
                    throw Error('Percorso Access degli strumenti non configurato.');
                await fs.promises.writeFile(temporaryScript, await fs.promises.readFile(path.join(__dirname, '..', '..', 'scripts', 'tooling-access.ps1')));
                const digest = (b: Buffer) => createHash('sha256').update(b).digest('hex');
                let stable = false;
                for (let n = 0; n < 3; n++) {
                    const bytes = await fs.promises.readFile(source);
                    await fs.promises.writeFile(localSource, bytes);
                    if (digest(bytes) === digest(await fs.promises.readFile(source))) {
                        stable = true;
                        break;
                    }
                }
                if (!stable)
                    throw Error('Access sta cambiando: ripetere la lettura.');
                await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', temporaryScript, '-Source', localSource, '-Output', output], { windowsHide: true, timeout: 180000, maxBuffer: 1024 * 1024 });
                if (actor !== user || !owns(e))
                    throw Error('La sessione operatore è cambiata.');
                return request('import-preview', { method: 'POST', body: { ...JSON.parse(await fs.promises.readFile(output, 'utf8')), source } });
            }
            finally {
                for (const file of [output, temporaryScript, localSource])
                    await fs.promises.unlink(file).catch(() => { });
                importing = false;
            }
        });
    });
    ipcMain.handle('tooling-pick-attachments', e => !owns(e) || !actor ? { ok: false } : result(async () => {
        const picked = await dialog.showOpenDialog(window!, { title: 'Certificati e documenti', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Documenti', extensions: ['pdf', 'jpg', 'jpeg', 'png', 'txt', 'csv', 'xls', 'xlsx', 'doc', 'docx'] }] });
        if (picked.canceled)
            return { attachments: [] };
        let total = 0;
        const attachments: any[] = [];
        for (const file of picked.filePaths) {
            const name = path.basename(file);
            if (!/\.(pdf|jpe?g|png|txt|csv|xlsx?|docx?)$/i.test(name))
                throw Error('Tipo di file non supportato.');
            if (file.startsWith('\\\\'))
                attachments.push({ name, path: file });
            else {
                const stat = await fs.promises.stat(file);
                total += stat.size;
                if (total > 6 * 1024 * 1024)
                    throw Error('Selezionare al massimo 6 MB di documenti locali per volta; per file più grandi usare un percorso di rete.');
                attachments.push({ name, path: null, data: (await fs.promises.readFile(file)).toString('base64') });
            }
        }
        return { attachments };
    }));
    ipcMain.handle('tooling-open-attachment', (e, id) => !owns(e) || !actor || typeof id !== 'string' ? { ok: false } : result(async () => {
        const a = await request('attachments/' + encodeURIComponent(id));
        if (!/\.(pdf|jpe?g|png|txt|csv|xlsx?|docx?)$/i.test(a.name))
            throw Error('Tipo non supportato.');
        let target = a.path;
        if (target) {
            if (!target.startsWith('\\\\') || target.split(/[\\/]/).includes('..'))
                throw Error('Percorso non valido.');
        }
        else {
            const dir = path.join(app.getPath('temp'), 'aypi-measurement', randomUUID());
            await fs.promises.mkdir(dir, { recursive: true });
            target = path.join(dir, path.basename(a.name));
            await fs.promises.writeFile(target, Buffer.from(a.data, 'base64'));
        }
        const error = await shell.openPath(target);
        if (error)
            throw Error(error);
        return {};
    }));
    const esc=(v:any)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]!);
    ipcMain.handle('tooling-export',(e,p)=>!owns(e)||!actor||exporting?{ok:false}:result(async()=>{exporting=true;try{
        const data=await request('snapshot'),ids=new Set(Array.isArray(p?.ids)?p.ids:[]),tools=data.tools.filter(t=>ids.has(t.id)),toolIds=new Set(tools.map(t=>t.id)),from=typeof p?.from==='string'?p.from:'',to=typeof p?.to==='string'?p.to:'',events=data.movements.filter(m=>toolIds.has(m.toolId)&&(!from||m.date>=from)&&(!to||m.date<=to)&&(!p?.articleId||m.articleId===p.articleId)&&(!Array.isArray(p?.movementIds)||p.movementIds.includes(m.id))),name=(id:string)=>data.tools.find(t=>t.id===id)?.code||id,article=(id:string)=>{const a=data.articles.find(a=>a.id===id);return a?.erpCode||a?.code||'';};
        const monthYears=[...new Set<string>([data.today.slice(0,4),...events.filter(m=>m.type==='breakage'&&!m.voided).map(m=>m.date.slice(0,4))])].sort(),monthly=monthYears.flatMap(year=>Array.from({length:12},(_,i)=>{const month=year+'-'+String(i+1).padStart(2,'0'),ruptures=events.filter(m=>m.type==='breakage'&&!m.voided&&m.date.startsWith(month));return [month,ruptures.length,ruptures.reduce((sum,m)=>sum+m.quantity,0)];}));
        if(p?.format==='pdf'){
            const save=await dialog.showSaveDialog(window!,{title:'Report utensili',defaultPath:'Report utensili.pdf',filters:[{name:'PDF',extensions:['pdf']}]});if(save.canceled||!save.filePath)return {canceled:true};
            const report=new BrowserWindow({show:false,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}});
            try{const usable=tools.reduce((s,t)=>s+t.usable,0),damaged=tools.reduce((s,t)=>s+t.damaged,0);await report.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(`<html lang="it"><meta charset="utf-8"><style>body{font:11px Arial;color:#332f2b}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:5px}thead{display:table-header-group}tr{break-inside:avoid}h1{font-size:20px}</style><h1>AyPi · Report utensili e attrezzature</h1><p>${esc(new Date().toLocaleDateString('it-IT'))} · ${tools.length} codici · Utilizzabili ${usable} · Danneggiati ${damaged} · Quota danneggiata ${usable+damaged?(damaged/(usable+damaged)*100).toFixed(1)+'%':'—'}</p><p>Situazione attuale. Quota danneggiata = danneggiati / (utilizzabili + danneggiati). I saldi iniziali Access non sono eventi datati. Gli articoli indicano impiego previsto, senza prenotazione di magazzino.</p><table><thead><tr>${['Codice','Descrizione','Ubicazione','Quantitativo Iniziale','Quantitativo Rimanente','Utensili/Attrezzature Danneggiate','Quantitativo attualmente presente','% danneggiata','Minimo','Da reintegrare','Articoli'].map(x=>`<th>${x}</th>`).join('')}</tr></thead><tbody>${tools.map(t=>`<tr>${[t.code,t.description,t.location,t.initialUsable+t.initialDamaged,t.usable,t.damaged,t.total,t.damagePercent==null?'—':t.damagePercent.toFixed(1)+'%',t.minimum,t.reorder,data.links.filter(l=>l.toolId===t.id).map(l=>article(l.articleId)).join(', ')].map(v=>`<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table><h2>Rotture mensili nel periodo filtrato</h2><table><thead><tr><th>Mese</th><th>Registrazioni di rottura</th><th>Pezzi danneggiati</th></tr></thead><tbody>${monthly.map(row=>`<tr>${row.map(v=>`<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></html>`));await fs.promises.writeFile(save.filePath,await report.webContents.printToPDF({landscape:true,printBackground:true,pageSize:'A4'}));}finally{report.destroy();}return {count:tools.length};
        }
        const book=XLSX.utils.book_new(),sheet=(title:string,headers:string[],rows:any[][])=>{const ws=XLSX.utils.aoa_to_sheet([headers,...rows]);formatExcelNumbers(ws);ws['!autofilter']={ref:ws['!ref']||'A1'};XLSX.utils.book_append_sheet(book,ws,title);};
        sheet('Utensili',['Codice','Descrizione','Tipo','Categoria','Misure','Ubicazione','Creatore / fornitore','Cliente','Quantitativo Iniziale','Danneggiate iniziali','Quantitativo Rimanente','Utensili/Attrezzature Danneggiate','Quantitativo attualmente presente','Danneggiati %','Scorta minima','Da reintegrare','Stato','Note'],tools.map(t=>[t.code,t.description,t.kind,t.category,t.dimensions,t.location,t.supplier,t.customer,t.initialUsable+t.initialDamaged,t.initialDamaged,t.usable,t.damaged,t.total,t.damagePercent,t.minimum,t.reorder,t.status,t.notes]));
        const links=data.links.filter(l=>toolIds.has(l.toolId)&&(!p?.articleId||l.articleId===p.articleId)&&(!Array.isArray(p?.linkIds)||p.linkIds.includes(l.id))),articleIds=new Set([...links.map(l=>l.articleId),...(Array.isArray(p?.articleIds)?p.articleIds:[])]);
        sheet('Articoli', ['Codice storico','Codice ERP','Descrizione','Ubicazione attrezzatura','Note'],data.articles.filter(a=>articleIds.has(a.id)).map(a=>[a.code,a.erpCode,a.description,a.location,a.notes]));
        sheet('Dotazioni articolo',['Articolo','Utensile','Fase','Macchina','Richiesti','Disponibili','Mancanti','Disponibilità','Note'],links.map(l=>[article(l.articleId),name(l.toolId),l.operation,l.machine,l.required,l.usable,l.shortage,l.ready?'Disponibile':'Da verificare',l.notes]));
        sheet('Rotture mensili',['Mese','Registrazioni di rottura','Pezzi danneggiati'],monthly);
        sheet('Movimenti',['Utensile','Data','Tipo','Quantità','Motivo','Documento','Articolo','Operatore','Annullato','Motivo annullamento','Note'],events.map(m=>[name(m.toolId),excelDateCell(m.date),m.type,m.quantity,m.reason,m.reference,article(m.articleId),m.createdBy,m.voided?'Sì':'No',m.voidReason,m.notes]));
        sheet('Segnalazioni',['Utensile','Data','Quantità','Motivo','Articolo','Stato','Priorità','Assegnatario','Risoluzione','Note'],data.issues.filter(i=>toolIds.has(i.toolId)&&(!from||i.date>=from)&&(!to||i.date<=to)&&(!p?.articleId||i.articleId===p.articleId)&&(!Array.isArray(p?.issueIds)||p.issueIds.includes(i.id))).map(i=>[name(i.toolId),excelDateCell(i.date),i.quantity,i.reason,article(i.articleId),i.status,i.priority,i.assignee,i.resolution,i.notes]));
        sheet('Documenti',['Scheda','Codice','Nome','Percorso'],data.attachments.filter(a=>toolIds.has(a.ownerId)||events.some(m=>m.id===a.ownerId)||data.issues.some(i=>i.id===a.ownerId&&toolIds.has(i.toolId))).map(a=>[a.kind,name(a.ownerId),a.name,a.path]));
        sheet('Metodo',['Voce','Descrizione'],[['Situazione attuale','Giacenze attuali su tutti i movimenti; le date filtrano soltanto movimenti e segnalazioni, non ricostruiscono un saldo storico.'],['Quota danneggiata','Danneggiati / (utilizzabili + danneggiati) × 100, mancante senza quantità.'],['Rotture nel periodo','Somma delle quantità nei soli movimenti Rottura non annullati. I saldi Access non hanno data evento e non entrano nel trend.'],['Dotazioni','Disponibilità per singolo impiego previsto; non prenota quantità e non certifica produzioni simultanee.'],['Annullamenti','Movimenti conservati e marcati annullati; esclusi dalle giacenze.'],['Periodo eventi',from+' — '+to]]);
        const save=await dialog.showSaveDialog(window!,{title:'Esporta utensili',defaultPath:'Utensili e attrezzature.xlsx',filters:[{name:'Excel',extensions:['xlsx']}]});if(save.canceled||!save.filePath)return {canceled:true};await fs.promises.writeFile(save.filePath,XLSX.write(book,{type:'buffer',bookType:'xlsx'}));return {count:tools.length};
    }finally{exporting=false;}}));
    return {open};
}
