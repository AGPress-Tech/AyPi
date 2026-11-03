export type StepKind = 'ramp' | 'dwell' | 'step' | 'wait' | 'goback' | 'end';
export type DraftStep = {
    kind: StepKind; label: string; targetDeciC: number; durationMs: number; events: [boolean, boolean, boolean]; userValueDeci: number;
    waitFor?: 0 | 1; waitCondition?: number; waitValueDeci?: number;
    goBackTo?: number; cycles?: number; endAction?: 'reset' | 'dwell';
};
export type ProgramDraft = { format: 'aypi-forno-draft'; version: 2; name: string; startDeciC: number; steps: DraftStep[]; source?: { name: string; readAtMs: number; deviceToken?: string } };
export const MAX_STEPS = 25, MAX_DURATION_MS = 500 * 3600000;
export const STEP_LABELS: Record<StepKind, string> = { ramp: 'Rampa', dwell: 'Stasi', step: 'Salto (Step)', wait: 'Attesa (Wait)', goback: 'Ripetizione (GoBack)', end: 'Fine / Reset' };
export const STEP_TYPES: Record<StepKind, number> = { end: 0, ramp: 1, dwell: 2, step: 3, wait: 4, goback: 5 };
const fail = (message: string): never => { throw new Error(message); };
const keys = (v: object, allowed: string[]) => { if (!v || typeof v !== 'object' || Object.keys(v).some(k => !allowed.includes(k))) fail('La bozza contiene campi non riconosciuti: nessun dato è stato scartato.'); };
const temp = (v: unknown) => Number.isSafeInteger(v) && Math.abs(v as number) <= 100000;
export const cloneDraft = (d: ProgramDraft): ProgramDraft => JSON.parse(JSON.stringify(d));
export function newProgramDraft(): ProgramDraft { return { format: 'aypi-forno-draft', version: 2, name: 'Nuovo_ciclo', startDeciC: 200, steps: [] }; }
export function createDraftStep(kind: StepKind, previous: number, index: number): DraftStep {
    return { kind, label: '', targetDeciC: kind === 'ramp' ? Math.min(100000, previous + 1000) : previous,
        durationMs: ['ramp', 'dwell'].includes(kind) ? 3600000 : 0, events: [false, false, false], userValueDeci: kind === 'dwell' ? 50 : 0,
        ...(kind === 'wait' ? { waitFor: 0, waitCondition: 1, waitValueDeci: 0 } : {}),
        ...(kind === 'goback' ? { goBackTo: Math.max(1, index), cycles: 1 } : {}), ...(kind === 'end' ? { endAction: 'reset' } : {}) };
}
/** Le bozze v1 mantengono la Fine già prevista; le nuove v2 nascono SENZA Fine. */
function migrate(input: any): any {
    if (input?.version !== 1 || input.format !== 'aypi-forno-draft') return input;
    keys(input, ['format', 'version', 'name', 'startDeciC', 'endType', 'endLabel', 'steps', 'source']);
    if (!Array.isArray(input.steps) || input.steps.length > 25 || !['reset', 'dwell'].includes(input.endType)) fail('Bozza precedente non valida.');
    const d = JSON.parse(JSON.stringify(input));
    for (const s of d.steps) { keys(s, ['kind', 'label', 'targetDeciC', 'durationMs', 'events', 'userValueDeci']); if (!['ramp', 'dwell'].includes(s.kind)) fail('Tipo della bozza precedente non valido.'); }
    const end = createDraftStep('end', d.steps[d.steps.length - 1]?.targetDeciC ?? d.startDeciC, d.steps.length);
    end.endAction = d.endType; end.label = d.endLabel || ''; d.steps.push(end); d.version = 2; delete d.endType; delete d.endLabel; return d;
}
export function validateDraft(input: unknown): ProgramDraft {
    const d = migrate(input) as ProgramDraft;
    if (!d || d.format !== 'aypi-forno-draft' || d.version !== 2) fail('Formato bozza non riconosciuto.');
    keys(d, ['format', 'version', 'name', 'startDeciC', 'steps', 'source']);
    if (typeof d.name !== 'string' || !d.name.trim() || d.name !== d.name.trim() || d.name.length > 20 || /[\x00-\x1f\x7f<>:"/\\|?*]/.test(d.name)) fail('Nome ciclo: da 1 a 20 caratteri, senza caratteri riservati.');
    if (!temp(d.startDeciC)) fail('Temperatura iniziale non valida.');
    if (!Array.isArray(d.steps) || d.steps.length > 26 || d.steps.filter(s => s?.kind !== 'end').length > MAX_STEPS) fail('Sono consentite al massimo 25 fasi più una Fine esplicita.');
    if (d.source) { keys(d.source, ['name', 'readAtMs', 'deviceToken']); if(d.source.deviceToken!==undefined&&!/^[a-f0-9-]{36}$/.test(d.source.deviceToken))fail('Riferimento lettura forno non valido.'); if (typeof d.source.name !== 'string' || !Number.isSafeInteger(d.source.readAtMs)) fail('Origine bozza non valida.'); }
    let current = d.startDeciC;
    for (const [i, s] of d.steps.entries()) {
        if (!s || !Object.prototype.hasOwnProperty.call(STEP_TYPES, s.kind)) fail(`Tipo della fase ${i + 1} non valido.`);
        const extra = s.kind === 'wait' ? ['waitFor', 'waitCondition', 'waitValueDeci'] : s.kind === 'goback' ? ['goBackTo', 'cycles'] : s.kind === 'end' ? ['endAction'] : [];
        keys(s, ['kind', 'label', 'targetDeciC', 'durationMs', 'events', 'userValueDeci', ...extra]);
        if (typeof s.label !== 'string' || s.label.length > 20 || /[\x00-\x1f\x7f]/.test(s.label)) fail(`Nome fase ${i + 1} non valido.`);
        if (!temp(s.targetDeciC) || !Number.isSafeInteger(s.durationMs) || (['ramp', 'dwell'].includes(s.kind) ? s.durationMs < 1 || s.durationMs > MAX_DURATION_MS : s.durationMs !== 0)) fail(`Fase ${i + 1}: temperatura o durata non valida. Rampe/stasi: 1 ms–500 h; gli altri tipi non hanno durata prefissata.`);
        if (!['ramp', 'step'].includes(s.kind) && s.targetDeciC !== current) fail(`Fase ${i + 1}: stasi/attesa/ripetizione/fine mantengono il setpoint precedente.`);
        if (!Array.isArray(s.events) || s.events.length !== 3 || s.events.some(e => typeof e !== 'boolean')) fail(`Fase ${i + 1}: specificare tutti e tre gli eventi.`);
        if (!Number.isSafeInteger(s.userValueDeci) || s.userValueDeci < 0 || s.userValueDeci > 100000) fail(`Fase ${i + 1}: valore utente non valido.`);
        if (s.kind === 'wait' && (![0, 1].includes(s.waitFor!) || ![1, 2, 3, 4].includes(s.waitCondition!) || !temp(s.waitValueDeci))) fail(`Fase ${i + 1}: condizione di attesa non valida per il programmatore CH1.`);
        if (s.kind === 'goback') {
            if (!Number.isInteger(s.goBackTo) || s.goBackTo! < 1 || s.goBackTo! > i || !Number.isInteger(s.cycles) || s.cycles! < 0 || s.cycles! > 32767) fail(`Fase ${i + 1}: GoBack deve riferirsi a una fase precedente; cicli 0–32767 (0 = continuo).`);
            if (d.steps.slice(s.goBackTo! - 1, i).some(p => p.kind === 'goback' || p.kind === 'end')) fail('GoBack annidati o sovrapposti non sono consentiti dal nanodac.');
        }
        if (s.kind === 'end') {
            if (i !== d.steps.length - 1 || !['reset', 'dwell'].includes(s.endAction!)) fail('La fase Fine deve essere unica e ultima.');
            if (s.endAction === 'reset' && (s.events.some(Boolean) || s.userValueDeci)) fail('Fine → Reset usa gli stati globali del forno: non impostare eventi o valori utente sul segmento.');
        }
        current = s.targetDeciC;
    }
    return cloneDraft(d);
}
export function parseDeci(value: string): number {
    if (!/^-?\d+(?:[.,]\d)?$/.test(value.trim())) fail('Inserire un numero con al massimo un decimale.');
    const n = Math.round(Number(value.trim().replace(',', '.')) * 10); if (!temp(n)) fail('Valore fuori dal campo dell’editor (−10000…10000).'); return n;
}
export function parseDuration(value: string): number {
    const m = value.trim().match(/^(\d{1,5}):([0-5]\d):([0-5]\d)(?:[.,](\d{1,3}))?$/);
    if (!m) fail('Durata richiesta: ore:minuti:secondi, con millisecondi facoltativi (es. 02:30:00.250).');
    const ms = Number(m[1]) * 3600000 + Number(m[2]) * 60000 + Number(m[3]) * 1000 + Number((m[4] || '').padEnd(3, '0'));
    if (ms < 1 || ms > MAX_DURATION_MS) fail('La durata di una fase deve essere compresa tra 1 ms e 500 ore.'); return ms;
}
export function formatDuration(ms: number): string { return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`; }
export function draftTimeline(input: ProgramDraft) {
    const d = validateDraft(input); let time = 0, current = d.startDeciC, known = true;
    const rows: (DraftStep & { index: number; startMs: number; endMs: number; startDeciC: number; timeKnown: boolean })[] = [];
    d.steps.forEach((s, index) => {
        const startMs = time, timeKnown = known;
        time += s.durationMs;
        if (s.kind === 'goback' && known) { const start = rows[s.goBackTo! - 1]; if (!s.cycles || !start.timeKnown) known = false; else time += (startMs - start.startMs) * s.cycles; }
        if (s.kind === 'wait' || s.kind === 'end' && s.endAction === 'dwell') known = false;
        rows.push({ ...s, index, startMs, endMs: time, startDeciC: current, timeKnown: timeKnown && known }); current = s.targetDeciC;
    }); return rows;
}
function propagate(d: ProgramDraft) { let current = d.startDeciC; for (const s of d.steps) { if (!['ramp', 'step'].includes(s.kind)) s.targetDeciC = current; current = s.targetDeciC; } }
export function changeStep(input: ProgramDraft, index: number, patch: Partial<DraftStep>): ProgramDraft {
    const d = validateDraft(input), old = d.steps[index]; if (!old) fail('Fase inesistente.');
    d.steps[index] = patch.kind && patch.kind !== old.kind ? { ...createDraftStep(patch.kind, index ? d.steps[index - 1].targetDeciC : d.startDeciC, index), label: old.label, events: [...old.events], ...patch } : { ...old, ...patch };
    if (d.steps[index].kind === 'end' && d.steps[index].endAction === 'reset' && (patch.kind === 'end' || patch.endAction === 'reset')) { d.steps[index].events = [false, false, false]; d.steps[index].userValueDeci = 0; }
    propagate(d); return validateDraft(d);
}
export function changeStart(input: ProgramDraft, startDeciC: number): ProgramDraft { const d = validateDraft(input); d.startDeciC = startDeciC; propagate(d); return validateDraft(d); }
export function addStep(input: ProgramDraft, kind: StepKind, after = input.steps.length - 1): ProgramDraft {
    const d = validateDraft(input); if (!Object.prototype.hasOwnProperty.call(STEP_TYPES, kind)) fail('Tipo fase non valido.');
    if (kind === 'end' && d.steps.some(s => s.kind === 'end')) fail('È già presente una fase Fine.');
    let position = kind === 'end' ? d.steps.length : after + 1;
    if (kind !== 'end' && d.steps[d.steps.length - 1]?.kind === 'end') position = Math.min(position, d.steps.length - 1);
    if (position < 0 || position > d.steps.length) fail('Posizione non valida.');
    for (const s of d.steps) if (s.kind === 'goback' && s.goBackTo! > position) s.goBackTo!++;
    d.steps.splice(position, 0, createDraftStep(kind, position ? d.steps[position - 1].targetDeciC : d.startDeciC, position)); propagate(d); return validateDraft(d);
}
export function removeStep(input: ProgramDraft, index: number): ProgramDraft {
    const d = validateDraft(input); if (!d.steps[index]) fail('Fase inesistente.');
    if (d.steps.some((s, i) => i !== index && s.kind === 'goback' && s.goBackTo === index + 1)) fail('La fase è destinazione di un GoBack: cambiare prima la destinazione.');
    d.steps.splice(index, 1); for (const s of d.steps) if (s.kind === 'goback' && s.goBackTo! > index + 1) s.goBackTo!--;
    propagate(d); return validateDraft(d);
}
/** Riordina preservando l'identità delle destinazioni GoBack; nessuna modifica parziale. */
export function reorderStep(input: ProgramDraft, from: number, to: number): ProgramDraft {
    const d = validateDraft(input);
    if (!Number.isInteger(from) || !Number.isInteger(to) || !d.steps[from] || !d.steps[to]) fail('Posizione fase non valida.');
    if (d.steps[from].kind === 'end' || d.steps[to].kind === 'end') fail('La fase Fine deve rimanere ultima.');
    const order = d.steps.map((_, i) => i); order.splice(to, 0, order.splice(from, 1)[0]);
    const original = d.steps; d.steps = order.map(i => original[i]);
    for (const step of d.steps) if (step.kind === 'goback') step.goBackTo = order.indexOf(step.goBackTo! - 1) + 1;
    propagate(d); return validateDraft(d);
}
export function moveDraftPoint(d: ProgramDraft, index: number, endMs: number, targetDeciC: number): ProgramDraft {
    const row = draftTimeline(d)[index]; if (!row || !row.timeKnown || !['ramp', 'dwell', 'step'].includes(row.kind)) fail('Questa fase si configura dalla tabella: il suo tempo non è trascinabile.');
    if (row.kind === 'step') return changeStep(d, index, { targetDeciC });
    return changeStep(d, index, { durationMs: endMs - row.startMs, ...(row.kind === 'ramp' ? { targetDeciC } : {}) });
}
export function insertDraftPoint(input: ProgramDraft, timeMs: number, targetDeciC: number, kind: StepKind): ProgramDraft {
    if (!['ramp', 'dwell'].includes(kind)) fail('Disegnare rampe/stasi; gli altri tipi si aggiungono dalla tabella.');
    const d = validateDraft(input), rows = draftTimeline(d);
    if (rows.some(r => !r.timeKnown || r.kind === 'goback')) fail('Con attese o ripetizioni inserire le fasi dalla tabella.');
    const end = rows[rows.length - 1]?.endMs || 0;
    if (timeMs > end) { const next = addStep(d, kind); const index = next.steps.length - (next.steps[next.steps.length - 1].kind === 'end' ? 2 : 1); return moveDraftPoint(next, index, timeMs, targetDeciC); }
    const r = rows.find(r => timeMs > r.startMs && timeMs < r.endMs);
    if (!r || r.kind !== 'ramp' || kind !== 'ramp') fail('Per inserire un punto intermedio scegliere un tratto di rampa.');
    const s = d.steps[r.index]; d.steps.splice(r.index, 1, { ...s, events: [...s.events], durationMs: timeMs - r.startMs, targetDeciC }, { ...s, events: [...s.events], durationMs: r.endMs - timeMs }); propagate(d); return validateDraft(d);
}
/** Profilo eseguito: ripetizioni finite espanse; attese e cicli continui non inventano una durata. */
export function buildDraftProfile(input: ProgramDraft) {
    const d = validateDraft(input), points = [{ x: 0, y: d.startDeciC / 10, phase: -1 }], warnings: string[] = [];
    const counts = new Map<number, number>(); let timeMs = 0, current = d.startDeciC, complete = false, variable = false, visits = 0;
    for (let i = 0; i < d.steps.length; i++) {
        const s = d.steps[i]; if (++visits > 500) { warnings.push('Anteprima limitata a 500 passaggi; ulteriori ripetizioni non mostrate.'); variable = true; break; }
        if (s.kind === 'end') { complete = true; if (s.endAction === 'dwell') { warnings.push('Fine con mantenimento indefinito del setpoint.'); variable = true; } break; }
        if (s.kind === 'wait') { warnings.push(`Fase ${i + 1}: attesa esterna. Il grafico si ferma qui; le fasi successive restano configurate.`); variable = true; break; }
        if (s.kind === 'goback') { if (s.cycles === 0) { warnings.push(`Fase ${i + 1}: ripetizione continua; mostrato il primo passaggio.`); variable = true; break; } const count = counts.get(i) || 0; if (count < s.cycles!) { counts.set(i, count + 1); i = s.goBackTo! - 2; } else counts.delete(i); continue; }
        points.push({ x: timeMs / 3600000, y: current / 10, phase: i }); timeMs += s.durationMs;
        if (s.kind === 'ramp' || s.kind === 'step') current = s.targetDeciC;
        points.push({ x: timeMs / 3600000, y: current / 10, phase: i });
    }
    if (!d.steps.some(s => s.kind === 'end')) warnings.push('Programma incompleto: aggiungere manualmente una fase Fine prima della verifica/esportazione nativa.');
    return { points, shownMs: timeMs, durationMs: variable ? null : timeMs, complete, warnings };
}
export function reviewDraft(input: ProgramDraft) {
    const d = validateDraft(input); if (!d.steps.length) fail('Aggiungere almeno una fase e la fase Fine.');
    if (d.steps[d.steps.length - 1].kind !== 'end') fail('Manca la fase Fine: aggiungerla manualmente. Nessuna chiusura viene generata automaticamente.');
    const timeline = draftTimeline(d), profile = buildDraftProfile(d);
    return { name: d.name, durationMs: timeline.some(r => !r.timeKnown) ? null : timeline[timeline.length - 1].endMs, maxDeciC: Math.max(d.startDeciC, ...d.steps.map(s => s.targetDeciC)), warnings: profile.warnings,
        instructions: timeline.map(s => ({ phase: s.index + 1, label: s.label || String(s.index + 1), type: `${STEP_LABELS[s.kind]} (${STEP_TYPES[s.kind]})`, kind: s.kind, fromMs: s.timeKnown ? s.startMs : null, toMs: s.timeKnown ? s.endMs : null, durationMs: s.durationMs, targetC: s.targetDeciC / 10, targetFloat32C: Math.fround(s.targetDeciC / 10), events: [...s.events], userValue: s.userValueDeci / 10, ...(s.kind === 'wait' ? { waitFor: s.waitFor, waitCondition: s.waitCondition, waitValue: s.waitValueDeci! / 10 } : {}), ...(s.kind === 'goback' ? { goBackTo: s.goBackTo, cycles: s.cycles } : {}), ...(s.kind === 'end' ? { endAction: s.endAction } : {}) })),
        end: d.steps[d.steps.length - 1].endAction === 'reset' ? 'Fine esplicita → Reset; eventi e valori utente dagli stati globali del forno' : 'Fine esplicita → mantenimento indefinito con gli eventi configurati', status: 'Bozza locale. Nessun invio al forno; ripristino hardware non collaudato.' };
}
export function draftFromRecipe(recipe: any): ProgramDraft {
    if (recipe.channels !== 1 || recipe.rampStyle !== 0 || recipe.maxEvents !== 3 || !recipe.features || recipe.features.holdback || recipe.features.pvEvents || recipe.holdback.some(Boolean)) fail('Configurazione non gestita: sono supportati i sei tipi nativi per il profilo CH1 con rampe a tempo.');
    const deci = (v: number) => { const n = Math.round(v * 10); if (!Number.isFinite(v) || Math.abs(v - n / 10) > .0001) fail('Valori non rappresentabili a 0,1 °C.'); return n; };
    const d = newProgramDraft(); d.name = recipe.name; d.source = { name: recipe.name, readAtMs: recipe.readAtMs, ...(recipe.editToken?{deviceToken:recipe.editToken}:{}) }; let current = d.startDeciC;
    for (const [i, s] of recipe.segments.entries()) {
        const kind = (['end', 'ramp', 'dwell', 'step', 'wait', 'goback'] as StepKind[])[s.type]; if (!kind || !s.events || s.events.length !== 8 || s.events.slice(3).some(Boolean) || s.holdback.some(Boolean) || s.pvEvents?.some(Boolean)) fail('Parametri ausiliari non gestiti.');
        const next = createDraftStep(kind, current, i); next.label = s.name === String(i + 1) ? '' : s.name; next.events = s.events.slice(0, 3); next.userValueDeci = deci(s.userValues[0]);
        if (kind === 'ramp' || kind === 'step') current = deci(s.targets[0]); next.targetDeciC = current;
        if (kind === 'ramp' || kind === 'dwell') next.durationMs = Math.round((kind === 'ramp' ? s.rampSeconds[0] : s.durationSeconds) * 1000);
        if (kind === 'wait') { next.waitFor = s.waitFor; next.waitCondition = s.waitFor===0?1:s.wait[0]; next.waitValueDeci = s.waitFor===0?0:deci(s.waitValues[0]); }
        if (kind === 'goback') { next.goBackTo = s.goBackTo; next.cycles = s.cycles; }
        if (kind === 'end') { if (![0, 1].includes(s.endType)) fail('Azione finale non riconosciuta.'); next.endAction = s.endType === 1 ? 'reset' : 'dwell'; if (s.endType === 1) { next.events = [false, false, false]; next.userValueDeci = 0; } }
        d.steps.push(next);
    }
    return validateDraft(d);
}
