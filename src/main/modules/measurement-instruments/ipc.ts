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
const execute = promisify(execFile);
export function registerMeasurementIpc(mainWindow: BrowserWindow, icon: () => string) {
    let window: BrowserWindow | null = null, actor = '', groups: Record<string, string[]> = {}, importing = false, exporting = false;
    const owns = (e: any) => !!window && !window.isDestroyed() && e.sender === window.webContents;
    const request = (url: string, options: any = {}) => { if (!actor)
        throw Error('Seleziona un dipendente per accedere.'); return requestAypiBackend('/api/measurement-instruments/' + url, { ...options, headers: { 'x-aypi-actor': actor, 'x-aypi-user': actor, 'x-aypi-role': 'employee' } }); };
    const result = async (fn: () => Promise<any>) => { try {
        return { ok: true, ...await fn() };
    }
    catch (e) {
        return { ok: false, error: (e as Error).message.includes('(404)') ? 'Aggiornare il backend AyPi per abilitare Strumenti di misura.' : (e as Error).message };
    } };
    const open = async () => {
        if (window && !window.isDestroyed()) {
            window.maximize();
            window.show();
            window.focus();
            return window;
        }
        actor = '';
        const win = new BrowserWindow({ width: 1520, height: 960, minWidth: 1000, minHeight: 680, title: 'AyPi · Strumenti di misura', icon: icon(), show: false, backgroundColor: '#f2f8fc', webPreferences: { nodeIntegration: true, contextIsolation: false } });
        window = win;
        win.setMenu(null);
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
        void win.loadFile(path.join(__dirname, '..', '..', 'pages', 'measurement-instruments.html'), { query: { theme } }).catch(() => { if (!win.isDestroyed())
            win.close(); });
        return win;
    };
    ipcMain.handle('measurement-employees', e => !owns(e) ? { ok: false } : result(async () => { const data = await requestAypiBackend('/api/measurement-instruments/employees'); groups = data.groups; return data; }));
    ipcMain.handle('measurement-login', (e, name) => !owns(e) ? { ok: false } : result(async () => { const found = Object.values(groups).flat().find(v => typeof name === 'string' && v.toLocaleLowerCase('it') === name.trim().toLocaleLowerCase('it')); if (!found)
        throw Error('Seleziona un dipendente dall’elenco.'); actor = found; return { actor, ...await request('snapshot') }; }));
    ipcMain.on('measurement-logout', e => { if (owns(e))
        actor = ''; });
    ipcMain.on('measurement-close', e => { if (owns(e))
        window?.close(); });
    ipcMain.handle('measurement-api', (e, p) => !owns(e) ? { ok: false } : result(async () => {
        if (p?.op === 'snapshot')
            return request('snapshot');
        if (['save', 'delete'].includes(p?.op) && ['instrument', 'calibration','system'].includes(p.kind))
            return request((p.op === 'save' ? 'entities/' : 'delete/') + p.kind, { method: 'POST', body: p.entity });
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
            return request('preferences', { method: 'PUT', body: p.value });
        }
        throw Error('Operazione non consentita.');
    }));
    ipcMain.handle('measurement-import', async (e, p) => {
        if (!owns(e) || !actor)
            return { ok: false };
        if (['apply', 'cancel'].includes(p?.phase))
            return result(() => request('import-' + p.phase, { method: 'POST', body: { token: p.token } }));
        if (importing)
            return { ok: false, error: 'Un confronto è già in corso.' };
        importing = true;
        return result(async () => {
            const output = path.join(app.getPath('temp'), 'aypi-measurement-' + randomUUID() + '.json'), temporaryScript = output + '.ps1', localSource = output + '.accdb', user = actor;
            try {
                const source = getAddressEntry('moduli.openTarature')?.path;
                if (!source || !source.toLowerCase().endsWith('.accdb'))
                    throw Error('Percorso Access degli strumenti non configurato.');
                await fs.promises.writeFile(temporaryScript, await fs.promises.readFile(path.join(__dirname, '..', '..', 'scripts', 'measurement-instruments-access.ps1')));
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
    ipcMain.handle('measurement-pick-attachments', e => !owns(e) || !actor ? { ok: false } : result(async () => {
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
    ipcMain.handle('measurement-open-attachment', (e, id) => !owns(e) || !actor || typeof id !== 'string' ? { ok: false } : result(async () => {
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
    ipcMain.handle('measurement-row-menu', (e, p) => !owns(e) || !actor ? { ok: false } : result(async () => {
        if (!['instrument', 'calibration','system'].includes(p?.kind))
            throw Error('Scheda non valida.');
        const snapshot = await request('snapshot'), entity = snapshot[p.kind === 'instrument' ? 'instruments' : p.kind==='system'?'systems':'calibrations'].find(v => v.id === p.id);
        if (!entity)
            throw Error('Scheda non trovata.');
        const send = (action: string) => { if (!e.sender.isDestroyed())
            e.sender.send('measurement-row-action', { kind: p.kind, id: entity.id, action }); };
        const items: any[] = [{ label: 'Apri dettaglio', click: () => send('detail') }, { label: 'Modifica', click: () => send('edit') }, { label: 'Elimina', click: () => send('delete') }];
        if (p.kind === 'instrument')
            items.splice(1, 0, { label: 'Registra taratura', enabled: entity.mode !== 'nst' && entity.usage !== 'retired', click: () => send('calibrate') }, { label: entity.mode === 'nst' ? 'Rivedi classificazione NST' : 'Classifica NST', click: () => send('nst') });
        Menu.buildFromTemplate(items).popup({ window: window! });
        return {};
    }));
    ipcMain.handle('measurement-export', (e, p) => !owns(e) || !actor || exporting ? { ok: false } : result(async () => {
        exporting = true;
        try {
            const data = await request('snapshot'), allowed = ['instruments', 'nst', 'due', 'calibrations', 'analysis', 'dashboard','systems'];
            if (!allowed.includes(p?.view) || !Array.isArray(p.ids) || p.ids.length > 100000)
                throw Error('Vista non valida.');
            const ids = new Set(p.ids), recordView = p.view === 'calibrations', rows = recordView ? data.calibrations.filter(r => ids.has(r.id)) : data.schedule.filter(i => ids.has(i.id)), instrument = (id: string) => data.instruments.find(i => i.id === id);
            const book = XLSX.utils.book_new();
            const sheet = (name: string, head: string[], body: any[][]) => { const s = XLSX.utils.aoa_to_sheet([head, ...body]); formatExcelNumbers(s); s['!cols'] = head.map(h => ({ wch: /Note|Descrizione|Motivazione|Metodo/.test(h) ? 48 : 22 })); s['!autofilter'] = { ref: s['!ref'] || 'A1' }; XLSX.utils.book_append_sheet(book, s, name); };
            if(p.view==='systems'){
                const systems=data.systems.filter(s=>ids.has(s.id));
                sheet('Sistemi',['Nome','Revisione','Attivo','Criterio','Ripetizioni predefinite','Unità','Tolleranza ±','k','Costante A','Coefficiente B','Scala limiti','Scala margine','Limiti esclusi','Procedura','Categoria strumenti'],systems.map(s=>[s.name,s.revision,s.active?'Sì':'No',s.ruleLabel||s.rule,s.repetitions,s.unit,s.tolerance,s.coverage,s.limitConstant,s.limitSlope,s.limitScale,s.marginScale,s.strict?'Sì':'No',s.description,s.category]));
                sheet('Punti',['Sistema','Revisione','Gruppo','Punto','Tipo','Nominale','Unità','Tolleranza ± specifica','Rilevazioni','Categoria strumenti'],systems.flatMap(s=>s.points.map(point=>[s.name,s.revision,point.group,point.label,point.kind,point.nominal,point.unit,point.tolerance,point.repetitions,s.category])));
                const save=await dialog.showSaveDialog(window!,{title:'Esporta sistemi di taratura',defaultPath:'Sistemi di taratura.xlsx',filters:[{name:'Excel',extensions:['xlsx']}]});if(save.canceled||!save.filePath)return {canceled:true};await fs.promises.writeFile(save.filePath,XLSX.write(book,{type:'buffer',bookType:'xlsx'}));return {count:systems.length};
            }
            const selectedInstruments = recordView ? data.schedule.filter(i => rows.some(r => r.instrumentId === i.id)) : rows, selectedIds = new Set(selectedInstruments.map(i => i.id)), recordIds = new Set(Array.isArray(p.recordIds) ? p.recordIds : []), records = recordView ? rows : data.calibrations.filter(r => selectedIds.has(r.instrumentId) && recordIds.has(r.id));
            sheet('Strumenti', ['Codice', 'Descrizione', 'Categoria', 'Ubicazione', 'Matricola', 'Modello', 'Campo strumento', 'Campo in uso', 'Sensibilità', 'Tolleranza richiesta', 'Regime', 'Utilizzo', 'Idoneità dichiarata', 'Frequenza mesi', 'Ultima taratura', 'Scadenza', 'Stato', 'Responsabile', 'Metodo', 'Motivazione NST', 'Data NST', 'Revisione NST mesi', 'Prossima revisione NST', 'Note'], selectedInstruments.map(i => [i.code, i.description, i.category, i.location, i.serial, i.model, i.measurementRange, i.useRange, i.resolution, i.tolerance, i.modeLabel, i.usageLabel, i.suitabilityLabel, i.frequencyMonths, excelDateCell(i.lastDate), excelDateCell(i.dueDate), i.stateLabel, i.responsible, i.method, i.nstReason, excelDateCell(i.nstDate), i.nstReviewMonths, excelDateCell(i.reviewDate), i.notes]));
            sheet('Tarature', ['Codice', 'Data', 'Regime', 'Esito', 'Laboratorio / operatore', 'Certificato', 'Metodo', 'Campioni / riferimenti', 'Costo', 'Valuta', 'Fonte', 'Note', 'Inserito da', 'Modificato da','Sistema','Revisione sistema','Tolleranza strumento archiviata','Unità tolleranza','Categoria del sistema'], records.map(r => [instrument(r.instrumentId)?.code, excelDateCell(r.date), r.mode, r.outcome, r.provider, r.certificate, r.method, r.reference, r.cost, r.currency, r.baseline ? 'Ultima data Access' : 'Registrazione AyPi', r.notes, r.createdBy, r.updatedBy,r.systemSnapshot?.name||'',r.systemSnapshot?.revision??null,r.systemTolerance??null,r.systemToleranceUnit||'',r.systemCategory||'']));
            sheet('Misure', ['Codice', 'Data', 'Certificato', 'Punto', 'Unità', 'Nominale', 'Misurato', 'Tolleranza ±', 'Incertezza', 'Scostamento', 'In tolleranza'], records.flatMap(r => (r.measurements || []).map(m => [instrument(r.instrumentId)?.code, excelDateCell(r.date), r.certificate, m.label, m.unit, m.nominal, m.measured, m.tolerance, m.uncertainty, m.deviation, m.pass == null ? 'Non determinabile' : m.pass ? 'Sì' : 'No'])));
            const rids = new Set(records.map(r => r.id));
            sheet('Documenti', ['Scheda', 'Codice', 'Documento', 'Percorso', 'Archiviato in AyPi'], data.attachments.filter(a => a.ownerKind === 'instrument' ? selectedIds.has(a.ownerId) : rids.has(a.ownerId)).map(a => [a.ownerKind, a.ownerKind === 'instrument' ? instrument(a.ownerId)?.code : instrument(data.calibrations.find(r => r.id === a.ownerId)?.instrumentId)?.code, a.name, a.path, a.embeddedBytes ? 'Sì' : 'No']));
            const actual = records.filter(r => !r.baseline), analytics: any[][] = [];
            for (const field of ['category', 'location', 'mode'])
                for (const key of [...new Set(selectedInstruments.map(i => i[field]))]) {
                    const sample = selectedInstruments.filter(i => i[field] === key), groupIds = new Set(sample.map(i => i.id)), events = actual.filter(r => groupIds.has(r.instrumentId)), known = events.filter(r => ['fit', 'unfit'].includes(r.outcome)), fit = known.filter(r => r.outcome === 'fit');
                    analytics.push([field, key, sample.length, sample.filter(i => i.usage === 'in_use').length, sample.filter(i => i.mode === 'nst').length, sample.filter(i => i.state === 'overdue').length, events.length, fit.length, known.length ? fit.length / known.length * 100 : null]);
                }
            sheet('Analisi', ['Dimensione', 'Gruppo', 'Strumenti', 'In uso', 'NST', 'Scaduti', 'Tarature registrate', 'Tarature idonee', 'Idoneità % su esiti noti'], analytics);
            sheet('Gestione NST', ['Codice', 'Ubicazione', 'Utilizzo', 'Motivazione e limitazioni', 'Data classificazione / revisione', 'Frequenza revisione mesi', 'Prossima revisione', 'Verifica'], selectedInstruments.filter(i => i.mode === 'nst').map(i => [i.code, i.location, i.usageLabel, i.nstReason, excelDateCell(i.nstDate), i.nstReviewMonths, excelDateCell(i.reviewDate), i.nstReviewLabel]));
            sheet('Costi per valuta', ['Valuta', 'Tarature con costo', 'Costo totale', 'Costo medio'], [...new Set(actual.filter(r => r.cost != null).map(r => r.currency))].map(currency => { const sample = actual.filter(r => r.currency === currency && r.cost != null), total = sample.reduce((sum, r) => sum + r.cost, 0); return [currency, sample.length, total, total / sample.length]; }));
            const systemRecords=records.filter(r=>r.systemSnapshot);
            if(systemRecords.length){
                sheet('Rilevazioni',['Codice','Data','Certificato','Sistema','Revisione sistema','Gruppo','Punto','Unità','Nominale','Ripetizione','Rilevazione','Categoria del sistema'],systemRecords.flatMap(r=>r.measurements.flatMap(m=>m.readings.map((value,index)=>[instrument(r.instrumentId)?.code,excelDateCell(r.date),r.certificate,r.systemSnapshot.name,r.systemSnapshot.revision,m.group,m.pointLabel||m.label,m.unit,m.nominal,index+1,value,r.systemCategory||'']))));
                sheet('Risultati statistici',['Codice','Data','Sistema','Revisione','Criterio','Punto','Unità','Nominale','Media','Delta','s su tutte le letture','Media - k·s','Media + k·s','Limite ammesso inf.','Limite ammesso sup.','Tolleranza ±','Complete','Esito','Categoria del sistema'],systemRecords.flatMap(r=>r.measurements.map(m=>[instrument(r.instrumentId)?.code,excelDateCell(r.date),r.systemSnapshot.name,r.systemSnapshot.revision,r.systemSnapshot.ruleLabel||r.systemSnapshot.rule,m.label,m.unit,m.nominal,m.mean,m.deviation,m.standardDeviation,m.lower,m.upper,m.acceptanceLower,m.acceptanceUpper,m.tolerance,m.complete?'Sì':'No',m.pass==null?'Da completare':m.pass?'ID':'NID',r.systemCategory||''])));
                sheet('Sistemi utilizzati',['Codice','Data','Certificato','Sistema','Revisione','Procedura','Criterio','k','A','B','Scala limiti','Scala margine','Limiti esclusi','Tolleranza strumento archiviata','Unità tolleranza','Categoria del sistema'],systemRecords.map(r=>[instrument(r.instrumentId)?.code,excelDateCell(r.date),r.certificate,r.systemSnapshot.name,r.systemSnapshot.revision,r.systemSnapshot.description,r.systemSnapshot.ruleLabel||r.systemSnapshot.rule,r.systemSnapshot.coverage,r.systemSnapshot.limitConstant,r.systemSnapshot.limitSlope,r.systemSnapshot.limitScale,r.systemSnapshot.marginScale,r.systemSnapshot.strict?'Sì':'No',r.systemTolerance,r.systemToleranceUnit,r.systemCategory||'']));
            }
            sheet('Metodo', ['Voce', 'Descrizione'], [['Ambito', 'Tutte le righe filtrate della vista ' + p.view], ['Scadenze', 'Ultima taratura osservata + frequenza attuale in mesi di calendario; senza storico, scadenza iniziale dichiarata o prossima data Access valida. Ogni non NST richiede una scadenza. Gli esiti negativi / da valutare bloccano la regolarità.'], ['NST', 'Esclusi dalle scadenze di taratura; revisioni della classificazione separate.'], ['Dati storici', 'Access conserva soltanto l’ultima data: nessun esito o storico inventato. La prossima data Access valida viene usata solo come ripiego se manca uno storico sufficiente; le scadenze sconosciute restano da completare.'], ['Misure', 'Esito per punto: valore assoluto dello scostamento ≤ tolleranza. Per i sistemi configurati, media e s campionaria usano tutte le letture; criteri, tolleranze e parametri sono archiviati nel rapporto. Le misure libere conservano il confronto semplice con la tolleranza. Incertezza registrata, non applicata automaticamente come regola decisionale.'], ['Esportato il', new Date().toISOString()]]);
            const save = await dialog.showSaveDialog(window!, { title: 'Esporta strumenti di misura', defaultPath: 'Strumenti di misura.xlsx', filters: [{ name: 'Excel', extensions: ['xlsx'] }] });
            if (save.canceled || !save.filePath)
                return { canceled: true };
            await fs.promises.writeFile(save.filePath, XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }));
            return { count: rows.length };
        }
        finally {
            exporting = false;
        }
    }));
    return { open };
}
