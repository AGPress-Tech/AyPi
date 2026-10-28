import { HttpError } from "../../shared/http/errors";

export function activeScheduleLocks(database: any): Array<{ phaseId: string; machineId: string; startedAt: string }> {
    const result = database.exec(`SELECT active.phase_id, active.machine_id,
        COALESCE((SELECT MIN(parts.started_at) FROM mes_machine_sessions parts
            WHERE parts.phase_id = active.phase_id AND parts.machine_id = active.machine_id
              AND COALESCE(NULLIF(parts.activation_id, ''), parts.session_id)
                = COALESCE(NULLIF(active.activation_id, ''), active.session_id)), active.started_at)
        FROM mes_machine_sessions active WHERE active.status = 'ACTIVE'`);
    return (result?.[0]?.values || []).map((row: any[]) => ({
        phaseId: String(row[0]), machineId: String(row[1]), startedAt: String(row[2]),
    }));
}

export function activeScheduleLocked(phaseId: string): never {
    throw new HttpError(409,
        "Ordine attivo nel MES: non puoi rimuoverlo dal pianificatore o modificarne macchina e inizio effettivo. Sospendilo o chiudilo dalla pagina Produzione.",
        { code: "MES_ACTIVE_SCHEDULE_LOCKED", details: { phaseId } });
}

function productionDay(instant: string) {
    const parts = new Intl.DateTimeFormat("en", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit" })
        .formatToParts(new Date(instant));
    return ["year", "month", "day"].map((type) => parts.find((part) => part.type === type)?.value).join("-");
}

export function validateActivePlannerSchedules(database: any, nextState: any, previousState: any) {
    const jobs = Array.isArray(nextState?.jobs) ? nextState.jobs : [];
    const previousJobs = Array.isArray(previousState?.jobs) ? previousState.jobs : [];
    const machines = Array.isArray(nextState?.machines) ? nextState.machines : [];
    const normalize = (value: unknown) => String(value || "").trim().toUpperCase();
    for (const lock of activeScheduleLocks(database)) {
        const previous = previousJobs.find((job: any) => job.mesPhaseId === lock.phaseId && job.machineId && job.start);
        const matches = jobs.filter((job: any) => job.mesPhaseId === lock.phaseId);
        const job = matches[0];
        const scheduled = !!job?.machineId && !!job?.start;
        if (previous && !scheduled) activeScheduleLocked(lock.phaseId);
        if (!scheduled) continue;
        const day = productionDay(lock.startedAt);
        if (matches.length !== 1 || normalize(job.machineId) !== normalize(lock.machineId)
            || job.start !== day || (job.plannedStartAt && Date.parse(job.plannedStartAt) !== Date.parse(lock.startedAt))
            || (job.end && job.end < day)
            || !machines.some((machine: any) => normalize(machine.id) === normalize(lock.machineId))) {
            activeScheduleLocked(lock.phaseId);
        }
    }
}
