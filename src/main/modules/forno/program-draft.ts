type DraftRecipeSource = { name: string; readAtMs: number; channels: number; rampStyle: number; maxEvents: number;
    features: { holdback: boolean; pvEvents: boolean }; holdback: number[];
    segments: { type: number; endType: number; name: string; targets: number[]; durationSeconds: number; rampSeconds: number[]; events: boolean[]; holdback: number[]; pvEvents?: number[]; userValues: number[] }[] };

export type DraftStep = { kind: 'ramp' | 'dwell'; label: string; targetDeciC: number; durationMs: number; events: [boolean, boolean, boolean]; userValueDeci: number };
export type ProgramDraft = { format: 'aypi-forno-draft'; version: 1; name: string; startDeciC: number; endType: 'reset' | 'dwell'; endLabel?: string; steps: DraftStep[]; source?: { name: string; readAtMs: number } };
export const MAX_STEPS = 25, MAX_DURATION_MS = 500 * 3600000;
const fail = (message: string): never => { throw new Error(message); };
const keys = (value: object, allowed: string[]) => { if (Object.keys(value).some(k => !allowed.includes(k))) fail('La bozza contiene campi non riconosciuti: nessun dato è stato scartato.'); };
const temp = (value: unknown) => Number.isSafeInteger(value) && Math.abs(value as number) <= 100000;
export const cloneDraft = (draft: ProgramDraft): ProgramDraft => JSON.parse(JSON.stringify(draft));
export function newProgramDraft(): ProgramDraft { return { format: 'aypi-forno-draft', version: 1, name: 'Nuovo_ciclo', startDeciC: 200, endType: 'reset', steps: [] }; }

/** Interi canonici: decimi di °C e millisecondi. Nessun arrotondamento implicito. */
export function validateDraft(input: unknown): ProgramDraft {
    const d = input as ProgramDraft;
    if (!d || typeof d !== 'object' || d.format !== 'aypi-forno-draft' || d.version !== 1) fail('Formato bozza non riconosciuto.');
    keys(d, ['format', 'version', 'name', 'startDeciC', 'endType', 'endLabel', 'steps', 'source']);
    if (typeof d.name !== 'string' || !d.name.trim() || d.name !== d.name.trim() || d.name.length > 20 || /[\x00-\x1f\x7f<>:"/\\|?*]/.test(d.name)) fail('Nome ciclo: da 1 a 20 caratteri, senza caratteri riservati.');
    if (!temp(d.startDeciC)) fail('Temperatura iniziale non valida.');
    if (!['reset', 'dwell'].includes(d.endType)) fail('Azione finale non valida.');
    if (d.endLabel !== undefined && (typeof d.endLabel !== 'string' || d.endLabel.length > 20 || /[\x00-\x1f\x7f]/.test(d.endLabel))) fail('Nome del segmento di fine non valido.');
    if (!Array.isArray(d.steps) || d.steps.length > MAX_STEPS) fail('Sono consentite al massimo 25 fasi, oltre alla fine programma.');
    if (d.source) { if (typeof d.source !== 'object') fail('Origine bozza non valida.'); keys(d.source, ['name', 'readAtMs']); if (typeof d.source.name !== 'string' || !Number.isSafeInteger(d.source.readAtMs)) fail('Origine bozza non valida.'); }
    let total = 0, current = d.startDeciC;
    for (const [i, s] of d.steps.entries()) {
        if (!s || typeof s !== 'object') fail(`Fase ${i + 1} non valida.`);
        keys(s, ['kind', 'label', 'targetDeciC', 'durationMs', 'events', 'userValueDeci']);
        if (!['ramp', 'dwell'].includes(s.kind) || typeof s.label !== 'string' || s.label.length > 20 || /[\x00-\x1f\x7f]/.test(s.label)) fail(`Tipo o nome della fase ${i + 1} non valido.`);
        if (!temp(s.targetDeciC) || !Number.isSafeInteger(s.durationMs) || s.durationMs < 1 || s.durationMs > MAX_DURATION_MS) fail(`Fase ${i + 1}: temperatura o durata non valida (1 ms–500 h).`);
        if (s.kind === 'dwell' && s.targetDeciC !== current) fail(`Fase ${i + 1}: una sosta mantiene la temperatura precedente. Inserire una rampa per cambiarla.`);
        if (!Array.isArray(s.events) || s.events.length !== 3 || s.events.some(e => typeof e !== 'boolean')) fail(`Fase ${i + 1}: specificare ON/OFF per tutti e tre gli eventi.`);
        if (!Number.isSafeInteger(s.userValueDeci) || s.userValueDeci < 0 || s.userValueDeci > 100000) fail(`Fase ${i + 1}: valore utente non valido.`);
        total += s.durationMs; if (!Number.isSafeInteger(total)) fail('Durata totale non rappresentabile.'); current = s.targetDeciC;
    }
    return cloneDraft(d);
}

export function parseDeci(value: string): number {
    if (!/^-?\d+(?:[.,]\d)?$/.test(value.trim())) fail('Inserire un numero con al massimo un decimale.');
    const n = Number(value.trim().replace(',', '.')) * 10;
    const rounded = Math.round(n); if (!temp(rounded)) fail('Valore fuori dal campo dell’editor (−10000…10000).'); return rounded;
}
export function parseDuration(value: string): number {
    const match = value.trim().match(/^(\d{1,5}):([0-5]\d):([0-5]\d)(?:[.,](\d{1,3}))?$/);
    if (!match) fail('Durata richiesta: ore:minuti:secondi, con millisecondi facoltativi (es. 02:30:00.250).');
    const ms = Number(match[1]) * 3600000 + Number(match[2]) * 60000 + Number(match[3]) * 1000 + Number((match[4] || '').padEnd(3, '0'));
    if (ms < 1 || ms > MAX_DURATION_MS) fail('La durata di una fase deve essere compresa tra 1 ms e 500 ore.'); return ms;
}
export function formatDuration(ms: number): string {
    return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
}
export function draftTimeline(draft: ProgramDraft) {
    const d = validateDraft(draft); let timeMs = 0, current = d.startDeciC;
    return d.steps.map((s, i) => { const row = { ...s, index: i, startMs: timeMs, endMs: timeMs + s.durationMs, startDeciC: current }; timeMs = row.endMs; current = s.targetDeciC; return row; });
}
function propagateDwells(d: ProgramDraft) { let current = d.startDeciC; for (const s of d.steps) { if (s.kind === 'dwell') s.targetDeciC = current; current = s.targetDeciC; } }
export function changeStep(draft: ProgramDraft, index: number, patch: Partial<DraftStep>): ProgramDraft {
    const d = cloneDraft(draft); if (!d.steps[index]) fail('Fase inesistente.'); Object.assign(d.steps[index], patch); propagateDwells(d); return validateDraft(d);
}
export function changeStart(draft: ProgramDraft, startDeciC: number): ProgramDraft {
    const d = cloneDraft(draft); d.startDeciC = startDeciC; propagateDwells(d); return validateDraft(d);
}
export function addStep(draft: ProgramDraft, kind: DraftStep['kind'], after = draft.steps.length - 1): ProgramDraft {
    const d = cloneDraft(draft); const previous = after < 0 ? d.startDeciC : d.steps[after]?.targetDeciC;
    if (previous === undefined) fail('Posizione non valida.');
    d.steps.splice(after + 1, 0, { kind, label: '', targetDeciC: kind === 'dwell' ? previous : Math.min(100000, previous + 1000), durationMs: 3600000, events: [false, false, false], userValueDeci: kind === 'dwell' ? 50 : 0 });
    propagateDwells(d); return validateDraft(d);
}
export function removeStep(draft: ProgramDraft, index: number): ProgramDraft {
    const d = cloneDraft(draft); if (!d.steps[index]) fail('Fase inesistente.'); d.steps.splice(index, 1); propagateDwells(d); return validateDraft(d);
}
/** Il trascinamento sposta il termine di una fase; le fasi successive mantengono la propria durata. */
export function moveDraftPoint(draft: ProgramDraft, index: number, endMs: number, targetDeciC: number): ProgramDraft {
    const row = draftTimeline(draft)[index]; if (!row) fail('Punto inesistente.');
    return changeStep(draft, index, { durationMs: endMs - row.startMs, ...(row.kind === 'ramp' ? { targetDeciC } : {}) });
}
/** Un click nel tratto di rampa lo divide, mantenendo il punto finale e il tempo totale. */
export function insertDraftPoint(draft: ProgramDraft, timeMs: number, targetDeciC: number, kind: DraftStep['kind']): ProgramDraft {
    const rows = draftTimeline(draft), end = rows[rows.length - 1]?.endMs || 0;
    if (timeMs > end) {
        const d = addStep(draft, kind); return moveDraftPoint(d, d.steps.length - 1, timeMs, targetDeciC);
    }
    const row = rows.find(r => timeMs > r.startMs && timeMs < r.endMs);
    if (!row || row.kind !== 'ramp' || kind !== 'ramp') fail('Per inserire un punto intermedio scegliere un tratto di rampa. Le soste si aggiungono dalla tabella o dopo l’ultimo punto.');
    const d = cloneDraft(draft), original = d.steps[row.index];
    d.steps.splice(row.index, 1, { ...original, events: [...original.events], durationMs: timeMs - row.startMs, targetDeciC }, { ...original, events: [...original.events], durationMs: row.endMs - timeMs });
    propagateDwells(d); return validateDraft(d);
}

/** Importazione conservativa: i tipi/funzioni non gestiti vengono rifiutati, mai appiattiti. */
export function draftFromRecipe(recipe: DraftRecipeSource): ProgramDraft {
    if (recipe.channels !== 1 || recipe.rampStyle !== 0 || recipe.maxEvents !== 3 || !recipe.features || recipe.features.holdback || recipe.features.pvEvents || recipe.holdback.some(Boolean)) fail('Questo programma usa configurazioni non ancora gestite dall’editor. Consultarlo nella vista di lettura.');
    const end = recipe.segments[recipe.segments.length - 1];
    if (!end || end.type !== 0 || ![0, 1].includes(end.endType) || recipe.segments.slice(0, -1).some(s => ![1, 2].includes(s.type))) fail('Il programma contiene Step, Wait, GoBack o una fine non gestita. Nessuna fase è stata convertita.');
    if (end.endType === 0 && (!end.events || end.events.some(Boolean) || !end.userValues || end.userValues.some(Boolean))) fail('Il mantenimento finale usa eventi o valori utente non gestiti dall’editor. Importazione interrotta.');
    const exactDeci = (v: number) => { const n = Math.round(v * 10); if (!Number.isFinite(v) || Math.abs(v - n / 10) > 0.0001) fail('Il programma contiene valori non rappresentabili a 0,1 °C: importazione interrotta.'); return n; };
    if (recipe.segments[0]?.type !== 1) fail('Il primo segmento deve essere una rampa: la temperatura iniziale di una sosta non è determinabile dalla ricetta.');
    const initial = 200; // 20 °C solo per l'anteprima: il forno parte da PV/SP.
    let current = initial;
    const steps = recipe.segments.slice(0, -1).map(s => {
        if (!s.events || s.events.length !== 8 || s.events.slice(3).some(Boolean) || s.holdback.some(Boolean) || s.pvEvents?.some(Boolean) || !s.userValues) fail('Parametri ausiliari incompleti o non gestiti: importazione interrotta.');
        const targetDeciC = s.type === 2 ? current : exactDeci(s.targets[0]); current = targetDeciC;
        return { kind: s.type === 1 ? 'ramp' : 'dwell', label: s.name === String(recipe.segments.indexOf(s) + 1) ? '' : s.name, targetDeciC, durationMs: Math.round((s.type === 1 ? s.rampSeconds[0] : s.durationSeconds) * 1000), events: s.events.slice(0, 3), userValueDeci: exactDeci(s.userValues[0]) } as DraftStep;
    });
    return validateDraft({ format: 'aypi-forno-draft', version: 1, name: recipe.name, startDeciC: initial, endType: end.endType === 1 ? 'reset' : 'dwell', ...(end.name && end.name !== String(recipe.segments.length) ? { endLabel: end.name } : {}), steps, source: { name: recipe.name, readAtMs: recipe.readAtMs } });
}

export function reviewDraft(draft: ProgramDraft) {
    const timeline = draftTimeline(draft);
    if (!timeline.length) fail('Aggiungere almeno una fase prima della verifica.');
    return { name: draft.name, durationMs: timeline[timeline.length - 1].endMs, maxDeciC: Math.max(draft.startDeciC, ...timeline.map(s => s.targetDeciC)),
        instructions: timeline.map(s => ({ phase: s.index + 1, label: s.label || String(s.index + 1), type: s.kind === 'ramp' ? 'Ramp (1)' : 'Dwell (2)', fromMs: s.startMs, toMs: s.endMs, durationMs: s.durationMs, targetC: s.targetDeciC / 10, targetFloat32C: Math.fround(s.targetDeciC / 10), events: [...s.events], userValue: s.userValueDeci / 10 })),
        end: draft.endType === 'reset' ? 'End (0) → Reset (1); stati eventi e valori utente determinati dalla configurazione globale del forno' : 'End (0) → Dwell (0); mantenimento indefinito; E1=OFF E2=OFF E3=OFF UserVal=0',
        status: 'Bozza locale. Limiti del forno, cablaggio e scrittura non ancora collaudati.' };
}
