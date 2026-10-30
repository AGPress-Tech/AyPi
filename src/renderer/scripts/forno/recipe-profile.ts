export type RecipeSegment = { number: number; name: string; type: number; durationSeconds: number; targets: number[]; rampSeconds: number[]; rates: number[]; endType: number; holdback: number[]; goBackTo: number; cycles: number };
export type ProgramRecipe = { name: string; readAtMs: number; channels: number; rampStyle: number; rampUnits: number[]; servoTo: number[]; holdback: number[]; segments: RecipeSegment[] };
export type ProfilePhase = { segment: RecipeSegment; from: number; to: number; start: number[]; end: number[]; index: number; rampTimes: number[] };
export type ProfilePoint = { x: number; y: number; phase: number };

/** Profilo nominale: le attese senza durata non vengono trasformate in soste inventate. */
export function buildRecipeProfile(recipe: ProgramRecipe, startTemperature: number) {
    if (!Number.isFinite(startTemperature) || ![1, 2].includes(recipe.channels) || ![0, 1].includes(recipe.rampStyle) || !Array.isArray(recipe.segments) || !recipe.segments.length || recipe.segments.length > 26) throw new Error('Ricetta non valida.');
    const points: ProfilePoint[][] = Array.from({ length: recipe.channels }, () => [{ x: 0, y: startTemperature, phase: 0 }]);
    const phases: ProfilePhase[] = [], warnings = new Set<string>();
    const counts = new Map<number, number>();
    let current = Array(recipe.channels).fill(startTemperature) as number[], time = 0, complete = true, endType: number | null = null;
    if (recipe.holdback.some(Boolean) || recipe.segments.some(s => s.holdback.some(Boolean))) warnings.add('Il grafico mostra i tempi nominali: le pause Holdback possono prolungare il ciclo.');
    for (let i = 0; i < recipe.segments.length; i++) {
        const s = recipe.segments[i];
        if (s.type === 0) { endType = s.endType; break; }
        if (s.type === 5) {
            if (s.cycles === 0) { complete = false; warnings.add('Ripetizione continua: è visualizzato il primo passaggio del ciclo.'); break; }
            if (!Number.isInteger(s.cycles) || s.cycles < 0 || !Number.isInteger(s.goBackTo) || s.goBackTo < 1 || s.goBackTo > i) throw new Error('Ripetizione del ciclo non valida.');
            const count = counts.get(i) || 0;
            if (count < s.cycles) { counts.set(i, count + 1); i = s.goBackTo - 2; }
            else counts.delete(i);
            continue;
        }
        if (phases.length >= 500) { complete = false; warnings.add('Anteprima limitata a 500 fasi; il ciclo contiene ulteriori ripetizioni.'); break; }
        if (s.type === 4) { complete = false; warnings.add(`Fase ${s.number}: attesa di una condizione esterna. Il grafico si ferma qui perché la durata non è determinabile.`); break; }
        if (![1, 2, 3].includes(s.type)) throw new Error('Tipo di fase non riconosciuto.');
        const next = s.type === 2 ? [...current] : s.targets.slice(0, recipe.channels);
        if (next.length !== recipe.channels || next.some(v => !Number.isFinite(v))) throw new Error('Temperatura di fase non valida.');
        const rampTimes = next.map((target, ch) => {
            if (s.type !== 1) return 0;
            if (recipe.rampStyle === 0) return s.rampSeconds[ch];
            const scale = [1, 60, 3600][recipe.rampUnits[ch]];
            if (!scale || !Number.isFinite(s.rates[ch]) || s.rates[ch] <= 0) throw new Error('Velocità di rampa non valida.');
            return Math.abs(target - current[ch]) / s.rates[ch] * scale;
        });
        const seconds = s.type === 2 ? s.durationSeconds : s.type === 1 ? Math.max(...rampTimes) : 0;
        if (!Number.isFinite(seconds) || seconds < 0 || rampTimes.some(v => !Number.isFinite(v) || v < 0)) throw new Error('Durata di fase non valida.');
        const phase: ProfilePhase = { segment: s, from: time, to: time + seconds, start: [...current], end: next, index: phases.length, rampTimes };
        phases.push(phase);
        next.forEach((temperature, ch) => {
            const targetTime = s.type === 1 ? time + rampTimes[ch] : time + seconds;
            points[ch].push({ x: targetTime / 3600, y: temperature, phase: phase.index });
            if (targetTime < phase.to) points[ch].push({ x: phase.to / 3600, y: temperature, phase: phase.index });
        });
        time = phase.to; current = next;
    }
    if (endType === null && complete) throw new Error('Segmento di fine assente.');
    if (endType === 0) warnings.add('A fine programma il nanodac mantiene il setpoint a tempo indeterminato.');
    return { points, phases, durationSeconds: complete ? time : null, shownSeconds: time, warnings: [...warnings], endType,
        maximum: Math.max(...points.flat().map(p => p.y)), minimum: Math.min(...points.flat().map(p => p.y)) };
}

export function recipeDuration(seconds: number) {
    const hours = Math.floor(seconds / 3600), minutes = Math.floor((seconds % 3600) / 60), rest = Math.round(seconds % 60 * 1000) / 1000;
    return [hours ? `${hours} h` : '', minutes ? `${minutes} min` : '', rest ? `${rest.toLocaleString('it-IT')} s` : ''].filter(Boolean).join(' ') || '0 s';
}
