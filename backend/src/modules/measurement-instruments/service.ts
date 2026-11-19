import {validateCalibrationSystem,calibrationCategoryKey,categoryCalibrationSystem} from './calibration-system';
import { randomUUID } from 'crypto';
import { getSqliteDatabase, runSqliteTransaction } from '../../shared/db/sqlite';
import { badRequest, HttpError, notFound } from '../../shared/http/errors';
import { Kind, validateInstrument, validateCalibration, cleanAttachment, cleanImport, schedule, todayInRome } from './model';
import { validatePreferences } from './preferences';
const conflict = (m: string) => new HttpError(409, m);
function schema() { getSqliteDatabase().run(`CREATE TABLE IF NOT EXISTS measurement_entities(kind TEXT NOT NULL,id TEXT NOT NULL,revision INTEGER NOT NULL,payload TEXT NOT NULL,deleted INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(kind,id));CREATE TABLE IF NOT EXISTS measurement_audit(id TEXT PRIMARY KEY,at TEXT NOT NULL,actor TEXT NOT NULL,action TEXT NOT NULL,kind TEXT NOT NULL,entity_id TEXT NOT NULL,before_json TEXT,after_json TEXT);CREATE TABLE IF NOT EXISTS measurement_attachments(id TEXT PRIMARY KEY,owner_kind TEXT NOT NULL,owner_id TEXT NOT NULL,name TEXT NOT NULL,path TEXT,data BLOB);CREATE TABLE IF NOT EXISTS measurement_settings(id TEXT PRIMARY KEY,payload TEXT NOT NULL);`); }
const select = (sql: string, args: any[] = []) => { const s = getSqliteDatabase().prepare(sql); try {
    s.bind(args);
    const rows: any[] = [];
    while (s.step())
        rows.push(s.getAsObject());
    return rows;
}
finally {
    s.free();
} };
function entities(kind: Kind, deleted = false): any[] { return select('SELECT * FROM measurement_entities WHERE kind=?' + (deleted ? '' : ' AND deleted=0'), [kind]).map(r => ({ ...JSON.parse(r.payload), id: r.id, revision: r.revision, deleted: !!r.deleted })); }
function setting(key: string, fallback: any = null) { const r = select('SELECT payload FROM measurement_settings WHERE id=?', [key])[0]; return r ? JSON.parse(r.payload) : fallback; }
function setSetting(key: string, v: any) { getSqliteDatabase().run('INSERT INTO measurement_settings VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload', [key, JSON.stringify(v)]); }
function write(kind: Kind, id: string, value: any, actor: string, before: any = null, deleted = false) {
    const after = { ...value, id, revision: (before?.revision || 0) + 1, createdAt: before?.createdAt || new Date().toISOString(), createdBy: before?.createdBy || value.createdBy || actor, updatedAt: new Date().toISOString(), updatedBy: actor };
    delete after.deleted;
    getSqliteDatabase().run('INSERT INTO measurement_entities VALUES(?,?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload,deleted=excluded.deleted', [kind, id, after.revision, JSON.stringify(after), deleted ? 1 : 0]);
    getSqliteDatabase().run('INSERT INTO measurement_audit VALUES(?,?,?,?,?,?,?,?)', [randomUUID(), after.updatedAt, actor, deleted ? 'delete' : before ? 'update' : 'create', kind, id, before ? JSON.stringify(before) : null, JSON.stringify(after)]);
    return after;
}
export function measurementSnapshot() { schema(); const systems=entities('system'),instruments = entities('instrument').map(i=>{const system=categoryCalibrationSystem(systems,i.category);return {...i,calibrationSystemId:system?.id||'',calibrationSystemName:system?.name||'Nessun sistema per la categoria'}}), calibrations = entities('calibration'), today = todayInRome(); return { instruments, calibrations, systems, schedule: schedule(instruments, calibrations, today), attachments: select('SELECT id,owner_kind AS ownerKind,owner_id AS ownerId,name,path,length(data) AS embeddedBytes FROM measurement_attachments').filter(a => (a.ownerKind === 'instrument' ? instruments : calibrations).some(e => e.id === a.ownerId)), importInfo: setting('import'), lastSync: setting('last-sync'), issues: setting('issues', []), today }; }
export function saveMeasurement(kind: Kind, input: any, actor: string) {
    schema();
    if (!['instrument', 'calibration','system'].includes(kind))
        throw badRequest('Tipo di scheda non valido.');
    const current = input?.id ? entities(kind).find(e => e.id === input.id) : null;
    if (input?.id && !current)
        throw notFound('Scheda eliminata o non trovata.');
    if (!Number.isInteger(input?.revision) || input.revision !== (current?.revision || 0))
        throw conflict('Scheda modificata da un altro operatore: aggiorna prima di salvare.');
    let value: any;
    try {
        if(kind==='system')value=validateCalibrationSystem(input);
        else if(kind==='instrument'){
            value=validateInstrument(input,current,todayInRome(),entities('calibration'));
        }else{
            const owner=entities('instrument').find(i=>i.id===input.instrumentId);
            const historical=!!current&&!input.useCurrentSystem;
            const assigned=categoryCalibrationSystem(entities('system'),owner?.category);
            const id=historical?current.systemId||'':assigned?.id||'';
            if((input.systemId||'')!==id)throw conflict('Il sistema della categoria è cambiato. Ricaricare il sistema della categoria prima di salvare.');
            let context:any=null;
            if(id){
                const frozen=current?.systemId===id&&current.systemSnapshot&&!input.useCurrentSystem;
                const system=frozen?current.systemSnapshot:entities('system').find(s=>s.id===id&&s.active);
                if(!system)throw Error('Sistema non disponibile: sceglierne uno attivo.');
                if(input.systemRevision!==system.revision)throw conflict('Il sistema di taratura è cambiato. Ricaricare il sistema prima di compilare le misure.');
                if(!frozen&&input.instrumentRevision!==owner?.revision)throw conflict('La tolleranza o la scheda strumento sono cambiate. Ricaricare il sistema prima di salvare.');
                context={category:frozen?current.systemCategory||current.systemSnapshot.category||'':owner.category,instrumentRevision:frozen?current.systemInstrumentRevision:owner.revision,snapshot:JSON.parse(JSON.stringify(system)),tolerance:frozen?current.systemTolerance:owner?.calibrationTolerance??null,unit:frozen?current.systemToleranceUnit:owner?.calibrationUnit||''};
            }
            value=validateCalibration(input,entities('instrument'),current,todayInRome(),context);
        }
    }
    catch (e) {
        if(e instanceof HttpError)throw e;throw badRequest((e as Error).message);
    }
    if(kind==='system'&&value.active&&entities('system').some(s=>s.id!==current?.id&&s.active&&calibrationCategoryKey(s.category)===calibrationCategoryKey(value.category)))throw conflict('La categoria ha gi\u00e0 un sistema attivo. Modificare quello esistente o disattivarlo prima di sostituirlo.');
    if (kind === 'instrument' && entities('instrument').some(i => i.id !== current?.id && i.code.toLocaleLowerCase('it') === value.code.toLocaleLowerCase('it')))
        throw conflict('Codice strumento già presente.');
    if (kind === 'instrument')
        value = { ...value, legacy: current?.legacy || null, requalifiedAt: current?.mode === 'nst' && value.mode !== 'nst' ? new Date().toISOString() : current?.requalifiedAt || '' };
    const attachments = input.attachments ?? [];
    if (!Array.isArray(attachments) || attachments.length > 50 || JSON.stringify(attachments).length > 9 * 1024 * 1024)
        throw badRequest('Elenco allegati troppo esteso.');
    return runSqliteTransaction(() => {
        const saved = write(kind, current?.id || randomUUID(), { ...value, documents: attachments.map(a => { const existing = a.id ? select('SELECT name,path FROM measurement_attachments WHERE id=?', [a.id])[0] : a; return { name: existing?.name || '', path: existing?.path || null }; }) }, actor, current), existing = select('SELECT * FROM measurement_attachments WHERE owner_kind=? AND owner_id=?', [kind, saved.id]), keep = new Set<string>();
        for (const a of attachments) {
            if (a.id) {
                if (!existing.some(v => v.id === a.id))
                    throw badRequest('Allegato non appartenente alla scheda.');
                keep.add(a.id);
            }
            else {
                let clean: any;
                try {
                    clean = cleanAttachment(a);
                }
                catch (e) {
                    throw badRequest((e as Error).message);
                }
                const id = randomUUID();
                getSqliteDatabase().run('INSERT INTO measurement_attachments VALUES(?,?,?,?,?,?)', [id, kind, saved.id, clean.name, clean.path, clean.data ? new Uint8Array(Buffer.from(clean.data, 'base64')) : null]);
                keep.add(id);
            }
        }
        for (const a of existing)
            if (!keep.has(a.id))
                getSqliteDatabase().run('DELETE FROM measurement_attachments WHERE id=?', [a.id]);
        return saved;
    });
}
export function deleteMeasurement(kind: Kind, input: any, actor: string) {
    schema();
    if (!['instrument', 'calibration','system'].includes(kind))
        throw badRequest('Tipo non valido.');
    const current = entities(kind).find(e => e.id === input?.id);
    if (!current)
        throw notFound('Scheda non trovata.');
    if (input.revision !== current.revision)
        throw conflict('Scheda modificata: aggiorna prima di eliminarla.');
    if(kind==='system'&&(entities('instrument',true).some(i=>calibrationCategoryKey(i.category)===calibrationCategoryKey(current.category))||entities('calibration',true).some(r=>r.systemId===current.id)))throw badRequest('Il sistema è utilizzato: disattivarlo per conservare i collegamenti e lo storico.');
    if (kind === 'instrument' && entities('calibration', true).some(r => r.instrumentId === current.id))
        throw badRequest('Lo strumento ha uno storico: dismettilo per conservarlo.');
    if (kind === 'calibration') {
        const owner = entities('instrument').find(i => i.id === current.instrumentId);
        if (owner && owner.mode !== 'nst' && !schedule([owner], entities('calibration').filter(r => r.id !== current.id))[0].dueDate)
            throw badRequest('Impostare una scadenza iniziale nella scheda strumento prima di eliminare l’ultima taratura.');
    }
    return runSqliteTransaction(() => write(kind, current.id, current, actor, current, true));
}
export function measurementAudit(instrumentId: string) { schema(); const ids = new Set([instrumentId, ...entities('calibration', true).filter(r => r.instrumentId === instrumentId).map(r => r.id)]); return select('SELECT * FROM measurement_audit ORDER BY at DESC,id').filter(r => ids.has(r.entity_id)).map(r => ({ id: r.id, at: r.at, actor: r.actor, action: r.action, kind: r.kind, entityId: r.entity_id, before: r.before_json ? JSON.parse(r.before_json) : null, after: JSON.parse(r.after_json) })); }
export function measurementAttachment(id: string) { schema(); const a = select('SELECT * FROM measurement_attachments WHERE id=?', [id])[0]; if (!a || !entities(a.owner_kind).some(r => r.id === a.owner_id))
    throw notFound('Allegato non trovato.'); return { name: a.name, path: a.path, data: a.data ? Buffer.from(a.data).toString('base64') : null }; }
export function measurementPreferences(actor: string, v?: any) { schema(); const key = 'preferences:' + actor.toLocaleLowerCase('it'); if (v === undefined)
    return setting(key); let clean: any; try {
    clean = validatePreferences(v);
}
catch (e) {
    throw badRequest((e as Error).message);
} return runSqliteTransaction(() => { setSetting(key, clean); return clean; }); }
const previews = new Map<string, {
    input: any;
    actor: string;
    expires: number;
}>();
function comparison(input: any) {
    const all = entities('instrument', true), records = entities('calibration', true), add: any[] = [], differences: any[] = [], skipped: any[] = [];
    for (const i of input.instruments) {
        const old = all.find(e => e.id === i.id || e.legacy?.sourceId === i.code || e.code.toLocaleLowerCase('it') === i.code.toLocaleLowerCase('it'));
        if (!old) {
            add.push(i);
            continue;
        }
        if (old.deleted) {
            skipped.push({ code: i.code, reason: 'Strumento eliminato in AyPi: non ripristinato.' });
            continue;
        }
        for (const key of ['description', 'serial', 'category', 'location', 'model', 'measurementRange', 'useRange', 'resolution', 'tolerance', 'method', 'mode', 'usage', 'suitability', 'frequencyMonths', 'notes'])
            if (JSON.stringify(old[key] ?? '') !== JSON.stringify(i[key] ?? ''))
                differences.push({ code: i.code, field: key, existing: old[key] ?? '', incoming: i[key] ?? '' });
    }
    // A new baseline is added only with its new instrument. Never rewrite an existing history.
    const baselines = input.calibrations.filter(r => add.some(i => i.id === r.instrumentId) && !records.some(old => old.id === r.id));
    return { add, baselines, report: { instruments: add.length, calibrations: baselines.length, differences, skipped, issues: input.issues } };
}
export function previewMeasurementImport(value: any, actor: string) { schema(); for (const [key, p] of previews)
    if (p.expires < Date.now())
        previews.delete(key); if (previews.size >= 5)
    throw conflict('Chiudere i confronti già aperti.'); let input: any; try {
    input = cleanImport(value);
}
catch (e) {
    throw badRequest((e as Error).message);
} const token = randomUUID(); previews.set(token, { input, actor, expires: Date.now() + 600000 }); return { token, ...comparison(input).report, source: input.source, readAt: input.readAt }; }
export function cancelMeasurementImport(token: string, actor: string) { if (previews.get(token)?.actor === actor)
    previews.delete(token); return { canceled: true }; }
export function applyMeasurementImport(token: string, actor: string) { schema(); const p = previews.get(token); if (!p || p.actor !== actor || p.expires < Date.now())
    throw conflict('Confronto scaduto: ripetere la lettura.'); const report = runSqliteTransaction(() => { const merge = comparison(p.input); for (const i of merge.add)
    write('instrument', i.id, { ...i, createdBy: 'Archivio Access' }, actor); for (const r of merge.baselines)
    write('calibration', r.id, { ...r, createdBy: 'Archivio Access' }, actor); const info = { ...merge.report, source: p.input.source, readAt: p.input.readAt, seedHash: p.input.seedHash, at: new Date().toISOString(), actor }; setSetting('last-sync', info); setSetting('issues', p.input.issues); if (!setting('import'))
    setSetting('import', info); return info; }); previews.delete(token); return report; }
export function importMeasurements(input: any, actor: string) { schema(); if (entities('instrument', true).length || setting('import'))
    throw conflict('Archivio già inizializzato.'); return applyMeasurementImport(previewMeasurementImport(input, actor).token, actor); }
