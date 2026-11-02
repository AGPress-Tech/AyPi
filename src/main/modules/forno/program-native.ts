import { gunzipSync, gzipSync } from 'zlib';
import { createHash } from 'crypto';
import { changeStart, createDraftStep, newProgramDraft, reviewDraft, STEP_TYPES, validateDraft, type ProgramDraft, type StepKind } from './program-draft';

export type NativeFile = { filename: string; base64: string; sha256: string };
export const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');
const fail = (message: string): never => { throw new Error(message); };
const safeFilename = (name: string) => /^[^<>:"/\\|?*\x00-\x1f]{1,80}\.uipz$/i.test(name) && name.trim() === name;
export function nativeFile(filename: string, data: Buffer): NativeFile {
    if (!safeFilename(filename) || data.length > 1000000) fail('Nome o dimensione del programma nativo non validi.');
    return { filename, base64: data.toString('base64'), sha256: sha256(data) };
}
export function nativeBytes(file: NativeFile): Buffer {
    if (!file || typeof file.base64 !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.base64) || !safeFilename(file.filename) || file.base64.length > 1400000) fail('File nativo non valido.');
    const data = Buffer.from(file.base64, 'base64'); if (sha256(data) !== file.sha256) fail('Integrità SHA-256 del programma non valida.'); return data;
}
const escape = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
function unescape(v: string): string {
    if (/&(?!(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);)/i.test(v)) fail('Entità XML non gestita.');
    return v.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/gi, (_, entity: string) => {
        const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
        if (entity[0] !== '#') return named[entity.toLowerCase()];
        const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
        if (!Number.isInteger(code) || code < 32 || code > 0x10ffff || code >= 0xd800 && code <= 0xdfff) fail('Carattere XML non valido.'); return String.fromCodePoint(code);
    });
}
/** Parser del sottoinsieme XML osservato nei file nanodac 811. Formati diversi restano originali non editabili. */
export function decodeNative(file: NativeFile): ProgramDraft {
    const xml = gunzipSync(nativeBytes(file), { maxOutputLength: 2000000 }).toString('utf8');
    if (/<!|<\?[^x]/i.test(xml)) fail('Dichiarazioni XML non ammesse.');
    const document = xml.trim().replace(/^<\?xml\s+version="1\.0"\s+encoding="UTF-8"\s*\?>\s*/i, '');
    const root = document.match(/^<Programs>\s*<EditorVersion>0\.0<\/EditorVersion>\s*<Device class="nanodac" version="811"\s*\/>\s*<Program name="([^"<]*)">([\s\S]*)<\/Program>\s*<\/Programs>$/);
    if (!root) fail('Versione o struttura nativa non gestita: originale conservato senza conversione.');
    const name = unescape(root[1]); if (file.filename !== name + '.uipz') fail('Nome XML e nome del file nativo non coincidono.');
    const lists: { type: string; index: number; values: Map<number, string> }[] = [];
    let remaining = root[2].trim();
    while (remaining) {
        const m = remaining.match(/^<List type="(config|program|segment)" C="(\d+)" I="(\d+)" S="(\d+)">([\s\S]*?)<\/List>/);
        if (!m || lists.length > 28) fail('Blocco XML non gestito.');
        const expected = m[1] === 'config' ? ['244', '3'] : m[1] === 'program' ? ['245', '0'] : ['246', '0'];
        if (m[2] !== expected[0] || m[4] !== expected[1]) fail('Identificatori XML non gestiti.');
        const values = new Map<number, string>(); let members = m[5].trim();
        while (members) {
            const entry = members.match(/^<M>\s*<P>(\d+)<\/P>\s*<V>([^<]*)<\/V>\s*<\/M>/);
            if (!entry || values.has(Number(entry[1]))) fail('Parametro XML duplicato o non gestito.');
            values.set(Number(entry[1]), unescape(entry[2])); members = members.slice(entry[0].length).trim();
        }
        if (lists.some(l => l.type === m[1] && l.index === Number(m[3]))) fail('Blocco XML duplicato.');
        lists.push({ type: m[1], index: Number(m[3]), values }); remaining = remaining.slice(m[0].length).trim();
    }
    const config = lists.filter(l => l.type === 'config'), program = lists.filter(l => l.type === 'program'), segments = lists.filter(l => l.type === 'segment');
    if (config.length !== 1 || config[0].index !== 0 || config[0].values.size !== 1 || config[0].values.get(0) !== '1' || program.length !== 1 || program[0].index !== 0) fail('Configurazione nativa non gestita.');
    for (const [id, v] of program[0].values) if (![0, 6, 7, 9].includes(id) || [6, 7].includes(id) && v !== '0' || [0, 9].includes(id) && v !== name) fail('Il programma usa impostazioni non gestite.');
    if (program[0].values.get(6) !== '0' || !segments.length || segments.length > 26) fail('Stile rampa o numero fasi non gestiti.');
    const d = newProgramDraft(); d.name = name; let current = d.startDeciC;
    const number = (values: Map<number, string>, id: number) => { const text = values.get(id); if (text === undefined || !/^-?\d+(?:\.\d+)?$/.test(text)) fail(`Parametro nativo ${id} mancante o non numerico.`); const n = Number(text); if (!Number.isFinite(n)) fail('Numero nativo non valido.'); return n; };
    const deci = (v: number) => { if (Math.abs(v * 10 - Math.round(v * 10)) > .00001) fail('Precisione nativa non gestita dall’editor.'); return Math.round(v * 10); };
    for (let i = 0; i < segments.length; i++) {
        const { values: v, index } = segments[i]; if (index !== i) fail('Ordine segmenti non valido.');
        const type = number(v, 1);
        const kind = (['end', 'ramp', 'dwell', 'step', 'wait', 'goback'] as StepKind[])[type]; if (!kind) fail('Tipo segmento non riconosciuto.');
        const extra: Record<StepKind, number[]> = { end: [9], ramp: [3, 5], dwell: [2], step: [3], wait: [14, 15, 17], goback: [19, 20] };
        const allowed = [0, 1, 25, 27, 28, 29, ...extra[kind]];
        if (Array.from(v.keys()).some(k => !allowed.includes(k))) fail('Parametri segmento aggiuntivi: originale conservato senza conversione.');
        const events = [27, 28, 29].map(k => { const n = kind === 'end' && !v.has(k) ? 0 : number(v, k); if (![0, 1].includes(n)) fail('Stato evento nativo non valido.'); return n === 1; }) as [boolean, boolean, boolean];
        if (kind === 'ramp' || kind === 'step') current = deci(number(v, 3));
        const label = v.get(0); if (label === undefined) fail('Nome segmento mancante.');
        const next = createDraftStep(kind, current, i); next.label = label === String(i + 1) ? '' : label; next.targetDeciC = current; next.events = events;
        next.userValueDeci = kind === 'end' && !v.has(25) ? 0 : deci(number(v, 25));
        if (kind === 'ramp' || kind === 'dwell') next.durationMs = number(v, kind === 'ramp' ? 5 : 2);
        if (kind === 'wait') { next.waitFor = number(v, 14) as 0 | 1; next.waitCondition = v.has(15) ? number(v, 15) : 1; next.waitValueDeci = v.has(17) ? deci(number(v, 17)) : 0; }
        if (kind === 'goback') { next.goBackTo = number(v, 19); next.cycles = number(v, 20); }
        if (kind === 'end') { const end = number(v, 9); if (![0, 1].includes(end)) fail('Azione finale non gestita.'); next.endAction = end === 1 ? 'reset' : 'dwell'; if (end === 1) { next.events = [false, false, false]; next.userValueDeci = 0; } }
        d.steps.push(next);
    }
    reviewDraft(d); return validateDraft(d);
}

/** Esportazione per collaudo offline in iTools; non attesta ripristino su hardware. */
export function encodeNative(input: ProgramDraft): NativeFile {
    const d = validateDraft(input); reviewDraft(d);
    const member = (id: number, value: string | number) => `    <M><P>${id}</P><V>${escape(String(value))}</V></M>`;
    const list = (type: string, c: number, index: number, s: number, values: [number, string | number][]) => `  <List type="${type}" C="${c}" I="${index}" S="${s}">\n${values.map(([id, v]) => member(id, v)).join('\n')}\n  </List>`;
    const blocks = [list('config', 244, 0, 3, [[0, 1]]), list('program', 245, 0, 0, [[0, d.name], [6, 0], [7, 0], [9, d.name]])];
    d.steps.forEach((s, i) => {
        const values: [number, string | number][] = [[0, s.label || String(i + 1)], [1, STEP_TYPES[s.kind]]];
        if (s.kind === 'ramp') values.push([3, s.targetDeciC / 10], [5, s.durationMs]);
        if (s.kind === 'dwell') values.push([2, s.durationMs]);
        if (s.kind === 'step') values.push([3, s.targetDeciC / 10]);
        if (s.kind === 'wait') values.push([14, s.waitFor!], [15, s.waitCondition!], [17, s.waitValueDeci! / 10]);
        if (s.kind === 'goback') values.push([19, s.goBackTo!], [20, s.cycles!]);
        if (s.kind === 'end') values.push([9, s.endAction === 'reset' ? 1 : 0]);
        if (s.kind !== 'end' || s.endAction !== 'reset') values.push([25, s.userValueDeci / 10], [27, Number(s.events[0])], [28, Number(s.events[1])], [29, Number(s.events[2])]);
        blocks.push(list('segment', 246, i, 0, values));
    });
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<Programs>\n<EditorVersion>0.0</EditorVersion>\n<Device class="nanodac" version="811"/>\n<Program name="${escape(d.name)}">\n${blocks.join('\n')}\n</Program></Programs>\n`;
    const file = nativeFile(d.name + '.uipz', gzipSync(Buffer.from(xml, 'utf8')));
    const decoded = changeStart(decodeNative(file), d.startDeciC);
    // Lo zero-length label è il nome automatico, equivalente al numero del segmento.
    const comparable = (p: ProgramDraft) => JSON.stringify({ name: p.name, steps: p.steps.map((s, i) => ({ ...s, label: s.label || String(i + 1) })) });
    if (comparable(decoded) !== comparable(d)) fail('La rilettura del file nativo generato non coincide con il programma.');
    return file;
}

export function extractClonePrograms(bytes: Buffer): NativeFile[] {
    if (bytes.length > 16000000) fail('Clone troppo grande.');
    const text = bytes.toString('utf8').replace(/^\uFEFF/, ''); if (!/^;\$SERVER-PROGID\r?\nEurothermIDM\.Serialize\.4/m.test(text) || !/EurothermIDM\.nanodac\./.test(text)) fail('Clone iTools nanodac non riconosciuto.');
    const rows = Array.from(text.matchAll(/^Program(\d+),\s*\d+,\s*"([a-fA-F0-9]+)",[^\r\n]*$/gm));
    const countRow = rows.find(r => r[1] === '0'); if (!countRow || countRow[2].length !== 2) fail('Conteggio programmi del clone non riconosciuto.');
    const count = parseInt(countRow[2], 16); if (count < 1 || count > 100 || rows.length !== count + 1) fail('Il clone non contiene tutti i programmi dichiarati.');
    const files = rows.filter(r => r[1] !== '0').map((r, index) => {
        if (Number(r[1]) !== index + 1 || r[2].length % 2) fail('Indice programma nel clone non valido.');
        const data = Buffer.from(r[2], 'hex'); if (data.length < 5) fail('Programma nel clone troncato.');
        const length = data.readUInt16BE(2); if (length < 6 || length > 80 || 4 + length >= data.length) fail('Nome programma nel clone non valido.');
        const filename = data.subarray(4, 4 + length).toString('utf8'), gzip = data.subarray(4 + length);
        // Verifica CRC32 e dimensione decompressa tramite gunzip. I byte originali non vengono ricompressi.
        gunzipSync(gzip, { maxOutputLength: 2000000 }); return nativeFile(filename, gzip);
    });
    if (new Set(files.map(f => f.filename.toLowerCase())).size !== files.length) fail('Nomi programma duplicati nel clone.'); return files;
}
