import { sampleAt } from "./sample";

/** Bounded archive reads for a single hovered/selected phase; no PLC access. */
export function phaseInfo(db: any, eventId: number, toleranceMs = 1000) {
    if (!Number.isSafeInteger(eventId) || eventId < 1)
        throw new Error("Evento fase non valido");
    db.exec("BEGIN");
    try {
        const event = db.prepare("SELECT * FROM forno_events WHERE id=?").get(eventId);
        if (!event || !["segment_start", "program_reset"].includes(event.type))
            throw new Error("Inizio fase non trovato");
        const detail = JSON.parse(event.detail);
        if (event.type === "program_reset") return { kind: "Reset ciclo" };
        // The runtime SegmentType has the same enum as Segment.N.Type (HA030554).
        const kind = ["Fine ciclo", "Rampa", "Stasi", "Gradino", "Attesa", "Ripetizione"][detail.segmentType] || "Fase";
        const next = db.prepare(`SELECT t,type FROM forno_events
            WHERE t>=? AND (t>? OR id>?) AND type IN
            ('segment_end','segment_start','program_reset','program_complete','communication_lost','collector_started')
            ORDER BY t,id LIMIT 1`).get(event.t, event.t, event.id);
        const interrupted = next && ["communication_lost", "collector_started"].includes(next.type);
        const complete = !!next && !interrupted;
        const durationMs = complete ? next.t - event.t : null;
        const bounds = { fromMs: event.t, toMs: next ? next.t - 1 : Number.MAX_SAFE_INTEGER };
        const start = sampleAt(db, event.t, toleranceMs, false, bounds);
        // Stay inside the phase when picking the final sample.
        const end = complete && durationMs > 0
            ? sampleAt(db, next.t - 1, toleranceMs, false, bounds) : null;
        const inPhase = (sample: ReturnType<typeof sampleAt> | null) =>
            sample?.timestampMs !== null && sample?.timestampMs !== undefined &&
            sample.timestampMs >= event.t && (!next || sample.timestampMs < next.t)
                ? sample.mean : null;
        return {
            kind,
            durationMs,
            fromTemperature: inPhase(start),
            toTemperature: inPhase(end),
            status: complete ? "complete" : interrupted ? "interrupted" : "open",
        };
    } finally {
        db.exec("ROLLBACK");
    }
}
