export const MAX_FORNO_RANGE_MS = 366 * 86400000;

/** Arrotonda gli estremi e applica il limite dopo gli arrotondamenti.
 * Privilegia la fine (anche nel live), conservando tutti i timestamp interi
 * della vista. Margini di precaricamento e allineamento possono essere ridotti.
 */
export function boundedQueryRange(start: number, end: number) {
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || end < 0) throw new Error('Intervallo forno non valido.');
    const toMs = Math.ceil(end);
    const fromMs = Math.max(0, Math.floor(start), toMs - MAX_FORNO_RANGE_MS);
    if (!Number.isSafeInteger(fromMs) || !Number.isSafeInteger(toMs)) throw new Error('Intervallo forno non valido.');
    return { fromMs, toMs };
}
