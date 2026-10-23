import { randomUUID } from "crypto";
import { getSqliteDatabase, runSqliteTransaction } from "../../shared/db/sqlite";
import { HttpError } from "../../shared/http/errors";
import { serializeJson } from "../../shared/storage/json-codec";
import { initializeMesSqliteStore } from "./repository";
import type {
    MesActivationPreview,
    MesMachineSession,
    MesSessionMode,
    MesUnassignedChoice,
} from "./types";

function rows(result: any) {
    if (!Array.isArray(result) || !result.length) return [];
    const columns = result[0].columns || [];
    return (result[0].values || []).map((values: unknown[]) =>
        Object.fromEntries(columns.map((column: string, index: number) => [column, values[index]])),
    );
}

const SESSION_SELECT = `
    SELECT sessions.session_id, sessions.phase_id, phases.order_id,
           orders.order_number, phases.phase_code, phases.article_code,
           sessions.machine_id, sessions.mode, sessions.status,
           sessions.started_at, sessions.ended_at, sessions.started_by,
           sessions.ended_by, sessions.notes, sessions.revision,
           phases.target_quantity, phases.standard_cycle_seconds,
           COALESCE((
               SELECT SUM(allocations.piece_quantity)
               FROM mes_event_allocations AS allocations
               WHERE allocations.session_id = sessions.session_id
                 AND allocations.allocation_kind = 'PRODUCTION'
           ), 0) AS automatic_pieces,
           COALESCE((
               SELECT SUM(allocations.piece_quantity)
               FROM mes_event_allocations AS allocations
               WHERE allocations.session_id = sessions.session_id
                 AND allocations.allocation_kind = 'OPENING_CREDIT'
           ), 0) AS opening_pieces,
           COALESCE((
               SELECT SUM(allocations.piece_quantity)
               FROM mes_event_allocations AS allocations
               WHERE allocations.session_id = sessions.session_id
                 AND allocations.allocation_kind = 'SETUP_PENDING'
           ), 0) AS setup_pieces,
           COALESCE((
               SELECT SUM(CASE
                   WHEN allocations.allocation_kind IN ('PRODUCTION', 'OPENING_CREDIT', 'SETUP_GOOD')
                       THEN allocations.piece_quantity ELSE 0 END)
               FROM mes_event_allocations AS allocations
               JOIN mes_machine_sessions AS phase_sessions
                 ON phase_sessions.session_id = allocations.session_id
               WHERE phase_sessions.phase_id = phases.phase_id
           ), 0) + COALESCE((
               SELECT SUM(CASE
                   WHEN adjustments.kind IN ('GOOD_PIECES_ADD', 'SETUP_RECONCILIATION')
                       THEN adjustments.quantity
                   WHEN adjustments.kind = 'GOOD_PIECES_REMOVE'
                       THEN -adjustments.quantity
                   ELSE 0 END)
               FROM mes_production_adjustments AS adjustments
               WHERE adjustments.phase_id = phases.phase_id
           ), 0) AS good_pieces,
           (SELECT MIN(events.occurred_at)
              FROM mes_event_allocations AS allocations
              JOIN mes_machine_events AS events ON events.event_id = allocations.event_id
             WHERE allocations.session_id = sessions.session_id
               AND allocations.allocation_kind = 'PRODUCTION') AS first_production_at,
           (SELECT events.occurred_at
              FROM mes_event_allocations AS allocations
              JOIN mes_machine_events AS events ON events.event_id = allocations.event_id
             WHERE allocations.session_id = sessions.session_id
               AND allocations.allocation_kind = 'PRODUCTION'
             ORDER BY events.occurred_at DESC, events.event_id DESC LIMIT 1) AS last_production_at,
           (SELECT events.occurred_at
              FROM mes_event_allocations AS allocations
              JOIN mes_machine_events AS events ON events.event_id = allocations.event_id
             WHERE allocations.session_id = sessions.session_id
               AND allocations.allocation_kind = 'PRODUCTION'
             ORDER BY events.occurred_at DESC, events.event_id DESC LIMIT 1 OFFSET 1) AS previous_production_at,
           (SELECT allocations.piece_quantity
              FROM mes_event_allocations AS allocations
              JOIN mes_machine_events AS events ON events.event_id = allocations.event_id
             WHERE allocations.session_id = sessions.session_id
               AND allocations.allocation_kind = 'PRODUCTION'
             ORDER BY events.occurred_at DESC, events.event_id DESC LIMIT 1) AS last_event_pieces,
           (SELECT allocations.piece_quantity
              FROM mes_event_allocations AS allocations
              JOIN mes_machine_events AS events ON events.event_id = allocations.event_id
             WHERE allocations.session_id = sessions.session_id
               AND allocations.allocation_kind = 'PRODUCTION'
             ORDER BY events.occurred_at, events.event_id LIMIT 1) AS first_event_pieces,
           (SELECT COUNT(*)
              FROM mes_event_allocations AS allocations
             WHERE allocations.session_id = sessions.session_id
               AND allocations.allocation_kind = 'PRODUCTION') AS production_events,
           (SELECT SUM(allocations.piece_quantity)
              FROM mes_event_allocations AS allocations
             WHERE allocations.session_id = sessions.session_id
               AND allocations.allocation_kind = 'PRODUCTION') AS production_pieces
    FROM mes_machine_sessions AS sessions
    JOIN mes_phases AS phases ON phases.phase_id = sessions.phase_id
    JOIN mes_orders AS orders ON orders.order_id = phases.order_id`;

function sessionFromRow(row: any): MesMachineSession {
    const targetQuantity = Number(row.target_quantity) || 0;
    const goodPieces = Math.max(0, Number(row.good_pieces) || 0);
    const firstProductionAt = Date.parse(row.first_production_at || "");
    const lastProductionAt = Date.parse(row.last_production_at || "");
    const previousProductionAt = Date.parse(row.previous_production_at || "");
    const productionEvents = Number(row.production_events) || 0;
    const productionPieces = Number(row.production_pieces) || 0;
    const lastEventPieces = Math.max(1, Number(row.last_event_pieces) || 1);
    const firstEventPieces = Math.max(1, Number(row.first_event_pieces) || 1);
    const averageDenominator = Math.max(0, productionPieces - firstEventPieces);
    return {
        sessionId: row.session_id,
        phaseId: row.phase_id,
        orderId: row.order_id,
        orderNumber: row.order_number,
        phaseCode: row.phase_code,
        articleCode: row.article_code,
        machineId: row.machine_id,
        mode: row.mode,
        status: row.status,
        startedAt: row.started_at,
        endedAt: row.ended_at,
        startedBy: row.started_by,
        endedBy: row.ended_by,
        notes: row.notes,
        revision: Number(row.revision) || 1,
        automaticPieces: Number(row.automatic_pieces) || 0,
        openingPieces: Number(row.opening_pieces) || 0,
        setupPieces: Number(row.setup_pieces) || 0,
        goodPieces,
        targetQuantity,
        progressPercent: targetQuantity > 0 ? Math.min(100, goodPieces / targetQuantity * 100) : 0,
        standardCycleSeconds: Number(row.standard_cycle_seconds) || 0,
        averageCycleSeconds: productionEvents > 1 && averageDenominator > 0
            && Number.isFinite(firstProductionAt) && Number.isFinite(lastProductionAt)
            ? (lastProductionAt - firstProductionAt) / 1000 / averageDenominator
            : null,
        lastCycleSeconds: productionEvents > 1
            && Number.isFinite(lastProductionAt) && Number.isFinite(previousProductionAt)
            ? (lastProductionAt - previousProductionAt) / 1000 / lastEventPieces
            : null,
    };
}

function loadSession(database: any, clause: string, params: unknown[]) {
    const row = rows(database.exec(`${SESSION_SELECT} WHERE ${clause} LIMIT 1`, params))[0];
    return row ? sessionFromRow(row) : null;
}

function loadPendingEventRows(database: any, machineId: string, until?: string) {
    const untilClause = until ? "AND events.occurred_at <= ?" : "";
    const params = until ? [machineId, until] : [machineId];
    return rows(database.exec(
        `SELECT events.event_id, events.occurred_at,
                events.piece_delta - COALESCE(SUM(allocations.piece_quantity), 0) AS remaining_pieces
         FROM mes_machine_events AS events
         LEFT JOIN mes_event_allocations AS allocations ON allocations.event_id = events.event_id
         WHERE events.machine_id = ? ${untilClause}
         GROUP BY events.event_id
         HAVING remaining_pieces > 0
         ORDER BY events.occurred_at, events.event_id`,
        params,
    )).map((row: any) => ({
        eventId: row.event_id,
        occurredAt: row.occurred_at,
        remainingPieces: Number(row.remaining_pieces) || 0,
    }));
}

function insertAudit(database: any, input: {
    auditId: string;
    entityType: string;
    entityId: string;
    action: string;
    payload: unknown;
    now: string;
    actor: string;
    requestId: string;
}) {
    database.run(
        `INSERT INTO mes_audit_log
         (audit_id, entity_type, entity_id, action, payload_json, occurred_at, actor, request_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [input.auditId, input.entityType, input.entityId, input.action,
            serializeJson(input.payload), input.now, input.actor, input.requestId],
    );
}

export function loadActivationPreview(machineId: string, phaseId: string): MesActivationPreview {
    initializeMesSqliteStore();
    const database = getSqliteDatabase();
    const phaseExists = database.exec("SELECT phase_id FROM mes_phases WHERE phase_id = ?", [phaseId]);
    if (!phaseExists?.[0]?.values?.length) throw new HttpError(404, "Fase MES non trovata.");
    const pending = loadPendingEventRows(database, machineId);
    return {
        machineId,
        phaseId,
        unassignedPieces: pending.reduce((sum, event) => sum + event.remainingPieces, 0),
        unassignedEvents: pending.length,
        firstUnassignedAt: pending[0]?.occurredAt || "",
        lastUnassignedAt: pending[pending.length - 1]?.occurredAt || "",
        activeSession: loadSession(
            database,
            "sessions.machine_id = ? AND sessions.status IN ('ACTIVE', 'PAUSED')",
            [machineId],
        ),
        lastClosedSession: loadSession(
            database,
            "sessions.machine_id = ? AND sessions.status IN ('COMPLETED', 'CANCELLED') ORDER BY sessions.ended_at DESC",
            [machineId],
        ),
    };
}

export function listMachineSessions(machineId?: string) {
    initializeMesSqliteStore();
    const database = getSqliteDatabase();
    const where = machineId ? "WHERE sessions.machine_id = ?" : "";
    return rows(database.exec(
        `${SESSION_SELECT} ${where}
         ORDER BY CASE WHEN sessions.status IN ('ACTIVE', 'PAUSED') THEN 0 ELSE 1 END,
                  sessions.started_at DESC`,
        machineId ? [machineId] : [],
    )).map(sessionFromRow);
}

export function startMachineSession(input: {
    sessionId: string;
    transitionId: string;
    resolutionId: string;
    auditIds: string[];
    machineId: string;
    phaseId: string;
    mode: MesSessionMode;
    choice?: MesUnassignedChoice;
    attributedPieces?: number;
    reasonCode?: string;
    note: string;
    now: string;
    actor: string;
    requestId: string;
}) {
    initializeMesSqliteStore();
    return runSqliteTransaction((database) => {
        const phase = rows(database.exec(
            "SELECT phase_id, unit, execution_status FROM mes_phases WHERE phase_id = ?",
            [input.phaseId],
        ))[0];
        if (!phase) throw new HttpError(404, "Fase MES non trovata.");
        if (phase.unit !== "pz") {
            throw new HttpError(409, "Solo le fasi espresse in pezzi possono ricevere conteggi automatici.", {
                code: "MES_PHASE_UNIT_NOT_COUNTABLE",
            });
        }
        if (["COMPLETED", "CANCELLED"].includes(phase.execution_status)) {
            throw new HttpError(409, "La fase è già chiusa e non può essere attivata.", {
                code: "MES_PHASE_CLOSED",
            });
        }
        const activeMachine = loadSession(
            database,
            "sessions.machine_id = ? AND sessions.status IN ('ACTIVE', 'PAUSED')",
            [input.machineId],
        );
        if (activeMachine) {
            throw new HttpError(409, "La macchina ha già una sessione attiva.", {
                code: "MES_MACHINE_BUSY", details: { sessionId: activeMachine.sessionId },
            });
        }
        const activePhase = loadSession(
            database,
            "sessions.phase_id = ? AND sessions.status IN ('ACTIVE', 'PAUSED')",
            [input.phaseId],
        );
        if (activePhase) {
            throw new HttpError(409, "La fase è già attiva su un'altra macchina.", {
                code: "MES_PHASE_BUSY", details: { sessionId: activePhase.sessionId },
            });
        }

        const pending = loadPendingEventRows(database, input.machineId, input.now);
        const detectedPieces = pending.reduce((sum, event) => sum + event.remainingPieces, 0);
        let attributedPieces = 0;
        if (detectedPieces > 0) {
            if (!input.choice) {
                throw new HttpError(409, "È necessario decidere come trattare i pezzi non attribuiti.", {
                    code: "MES_UNASSIGNED_RESOLUTION_REQUIRED",
                    details: { detectedPieces },
                });
            }
            if (input.choice === "ATTRIBUTE_ALL") attributedPieces = detectedPieces;
            if (input.choice === "PARTIAL") attributedPieces = Number(input.attributedPieces);
            if (!Number.isFinite(attributedPieces) || attributedPieces < 0 || attributedPieces > detectedPieces) {
                throw new HttpError(400, "Quantità da attribuire non valida.");
            }
            if (!String(input.reasonCode || "").trim()) {
                throw new HttpError(400, "La causale della risoluzione è obbligatoria.");
            }
        }
        const excludedPieces = detectedPieces - attributedPieces;

        database.run(
            `INSERT INTO mes_machine_sessions
             (session_id, phase_id, machine_id, mode, status, started_at, ended_at,
              started_by, ended_by, notes, revision)
             VALUES (?, ?, ?, ?, 'ACTIVE', ?, '', ?, '', ?, 1)`,
            [input.sessionId, input.phaseId, input.machineId, input.mode,
                input.now, input.actor, input.note],
        );
        database.run(
            `INSERT INTO mes_session_transitions
             (transition_id, session_id, state, occurred_at, actor, note)
             VALUES (?, ?, 'ACTIVE', ?, ?, ?)`,
            [input.transitionId, input.sessionId, input.now, input.actor, input.note],
        );

        if (detectedPieces > 0) {
            database.run(
                `INSERT INTO mes_unassigned_resolutions
                 (resolution_id, machine_id, phase_id, session_id, detected_pieces,
                  attributed_pieces, excluded_pieces, reason_code, note, resolved_at, actor)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [input.resolutionId, input.machineId, input.phaseId, input.sessionId,
                    detectedPieces, attributedPieces, excludedPieces, input.reasonCode,
                    input.note, input.now, input.actor],
            );
            let creditRemaining = attributedPieces;
            pending.forEach((event) => {
                const credited = Math.min(event.remainingPieces, creditRemaining);
                const excluded = event.remainingPieces - credited;
                if (credited > 0) {
                    database.run(
                        `INSERT INTO mes_event_allocations
                         (allocation_id, event_id, session_id, resolution_id, allocation_kind,
                          piece_quantity, created_at, created_by)
                         VALUES (?, ?, ?, ?, 'OPENING_CREDIT', ?, ?, ?)`,
                        [randomUUID(), event.eventId, input.sessionId,
                            input.resolutionId, credited, input.now, input.actor],
                    );
                    creditRemaining -= credited;
                }
                if (excluded > 0) {
                    database.run(
                        `INSERT INTO mes_event_allocations
                         (allocation_id, event_id, session_id, resolution_id, allocation_kind,
                          piece_quantity, created_at, created_by)
                         VALUES (?, ?, ?, ?, 'UNASSIGNED_EXCLUSION', ?, ?, ?)`,
                        [randomUUID(), event.eventId, input.sessionId,
                            input.resolutionId, excluded, input.now, input.actor],
                    );
                }
            });
            insertAudit(database, {
                auditId: input.auditIds[1], entityType: "UNASSIGNED_RESOLUTION",
                entityId: input.resolutionId, action: "RESOLVE",
                payload: { machineId: input.machineId, detectedPieces, attributedPieces, excludedPieces,
                    choice: input.choice, reasonCode: input.reasonCode, note: input.note },
                now: input.now, actor: input.actor, requestId: input.requestId,
            });
        }

        const executionStatus = input.mode === "SETUP" ? "SETUP" : "RUNNING";
        database.run(
            `UPDATE mes_phases SET execution_status = ?, revision = revision + 1,
             updated_at = ?, updated_by = ? WHERE phase_id = ?`,
            [executionStatus, input.now, input.actor, input.phaseId],
        );
        insertAudit(database, {
            auditId: input.auditIds[0], entityType: "SESSION", entityId: input.sessionId,
            action: "START", payload: { machineId: input.machineId, phaseId: input.phaseId,
                mode: input.mode, detectedPieces, attributedPieces, excludedPieces },
            now: input.now, actor: input.actor, requestId: input.requestId,
        });
        return loadSession(database, "sessions.session_id = ?", [input.sessionId])!;
    });
}

export function changeMachineSessionState(input: {
    sessionId: string;
    action: "PAUSE" | "RESUME" | "COMPLETE" | "CANCEL";
    baseRevision: number;
    transitionId: string;
    auditId: string;
    note: string;
    now: string;
    actor: string;
    requestId: string;
}) {
    initializeMesSqliteStore();
    return runSqliteTransaction((database) => {
        const current = loadSession(database, "sessions.session_id = ?", [input.sessionId]);
        if (!current) throw new HttpError(404, "Sessione MES non trovata.");
        if (current.revision !== input.baseRevision) {
            throw new HttpError(409, "La sessione è stata aggiornata da un altro operatore.", {
                code: "MES_SESSION_REVISION_CONFLICT",
                details: { currentRevision: current.revision },
            });
        }
        if (current.mode === "SETUP" && input.action === "COMPLETE") {
            throw new HttpError(409, "L'attrezzaggio deve essere riconciliato prima della chiusura.", {
                code: "MES_SETUP_RECONCILIATION_REQUIRED",
            });
        }
        const allowed = input.action === "PAUSE"
            ? current.status === "ACTIVE"
            : input.action === "RESUME"
                ? current.status === "PAUSED"
                : ["ACTIVE", "PAUSED"].includes(current.status);
        if (!allowed) throw new HttpError(409, "Transizione di sessione non consentita.");

        const nextStatus = input.action === "PAUSE" ? "PAUSED"
            : input.action === "RESUME" ? "ACTIVE"
                : input.action === "COMPLETE" ? "COMPLETED" : "CANCELLED";
        const closes = ["COMPLETED", "CANCELLED"].includes(nextStatus);
        database.run(
            `UPDATE mes_machine_sessions SET status = ?, ended_at = ?, ended_by = ?,
             notes = CASE WHEN ? = '' THEN notes ELSE ? END, revision = revision + 1
             WHERE session_id = ?`,
            [nextStatus, closes ? input.now : "", closes ? input.actor : "",
                input.note, input.note, input.sessionId],
        );
        database.run(
            `INSERT INTO mes_session_transitions
             (transition_id, session_id, state, occurred_at, actor, note)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [input.transitionId, input.sessionId, nextStatus, input.now, input.actor, input.note],
        );
        const phaseStatus = input.action === "PAUSE" ? "PAUSED"
            : input.action === "RESUME" ? (current.mode === "SETUP" ? "SETUP" : "RUNNING")
                : input.action === "COMPLETE" ? "COMPLETED" : "CANCELLED";
        database.run(
            `UPDATE mes_phases SET execution_status = ?, revision = revision + 1,
             updated_at = ?, updated_by = ? WHERE phase_id = ?`,
            [phaseStatus, input.now, input.actor, current.phaseId],
        );
        if (input.action === "COMPLETE") {
            database.run(
                `UPDATE mes_orders SET status = 'COMPLETED', revision = revision + 1,
                 updated_at = ?, updated_by = ?
                 WHERE order_id = (SELECT order_id FROM mes_phases WHERE phase_id = ?)
                   AND NOT EXISTS (
                       SELECT 1 FROM mes_phases AS pending
                       WHERE pending.order_id = mes_orders.order_id
                         AND pending.execution_status <> 'COMPLETED'
                   )`,
                [input.now, input.actor, current.phaseId],
            );
        }
        insertAudit(database, {
            auditId: input.auditId, entityType: "SESSION", entityId: input.sessionId,
            action: input.action, payload: { before: current.status, after: nextStatus, note: input.note },
            now: input.now, actor: input.actor, requestId: input.requestId,
        });
        return loadSession(database, "sessions.session_id = ?", [input.sessionId])!;
    });
}

export function reconcileSetupSession(input: {
    sessionId: string;
    baseRevision: number;
    goodPieces: number;
    scrapPieces: number;
    excludedPieces: number;
    startProduction: boolean;
    note: string;
    reconciliationId: string;
    adjustmentId: string;
    productionSessionId: string;
    closeTransitionId: string;
    startTransitionId: string;
    auditId: string;
    now: string;
    actor: string;
    requestId: string;
}) {
    initializeMesSqliteStore();
    return runSqliteTransaction((database) => {
        const current = loadSession(database, "sessions.session_id = ?", [input.sessionId]);
        if (!current) throw new HttpError(404, "Sessione MES non trovata.");
        if (current.mode !== "SETUP" || !["ACTIVE", "PAUSED"].includes(current.status)) {
            throw new HttpError(409, "La sessione non è un attrezzaggio aperto.");
        }
        if (current.revision !== input.baseRevision) {
            throw new HttpError(409, "La sessione è stata aggiornata da un altro operatore.", {
                code: "MES_SESSION_REVISION_CONFLICT",
                details: { currentRevision: current.revision },
            });
        }
        const detectedPieces = Number(database.exec(
            `SELECT COALESCE(SUM(piece_quantity), 0)
             FROM mes_event_allocations
             WHERE session_id = ? AND allocation_kind = 'SETUP_PENDING'`,
            [input.sessionId],
        )?.[0]?.values?.[0]?.[0]) || 0;
        const classified = input.goodPieces + input.scrapPieces + input.excludedPieces;
        if ([input.goodPieces, input.scrapPieces, input.excludedPieces].some(
            (value) => !Number.isFinite(value) || value < 0,
        ) || Math.abs(classified - detectedPieces) > 0.000001) {
            throw new HttpError(400, "Buoni, scarti ed esclusi devono coincidere con i pezzi rilevati.", {
                code: "MES_SETUP_RECONCILIATION_MISMATCH",
                details: { detectedPieces, classifiedPieces: classified },
            });
        }
        database.run(
            `INSERT INTO mes_setup_reconciliations
             (reconciliation_id, session_id, phase_id, machine_id, detected_pieces,
              good_pieces, scrap_pieces, excluded_pieces, start_production,
              note, reconciled_at, actor)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [input.reconciliationId, input.sessionId, current.phaseId, current.machineId,
                detectedPieces, input.goodPieces, input.scrapPieces, input.excludedPieces,
                input.startProduction ? 1 : 0, input.note, input.now, input.actor],
        );
        if (input.goodPieces > 0) {
            database.run(
                `INSERT INTO mes_production_adjustments
                 (adjustment_id, machine_id, phase_id, session_id, kind, quantity,
                  reason_code, note, created_at, actor)
                 VALUES (?, ?, ?, ?, 'SETUP_RECONCILIATION', ?, 'CHIUSURA_ATTREZZAGGIO', ?, ?, ?)`,
                [input.adjustmentId, current.machineId, current.phaseId, input.sessionId,
                    input.goodPieces, input.note, input.now, input.actor],
            );
        }
        database.run(
            `UPDATE mes_machine_sessions SET status = 'COMPLETED', ended_at = ?, ended_by = ?,
             revision = revision + 1 WHERE session_id = ?`,
            [input.now, input.actor, input.sessionId],
        );
        database.run(
            `INSERT INTO mes_session_transitions
             (transition_id, session_id, state, occurred_at, actor, note)
             VALUES (?, ?, 'COMPLETED', ?, ?, ?)`,
            [input.closeTransitionId, input.sessionId, input.now, input.actor, input.note],
        );

        let productionSession: MesMachineSession | null = null;
        if (input.startProduction) {
            database.run(
                `INSERT INTO mes_machine_sessions
                 (session_id, phase_id, machine_id, mode, status, started_at, ended_at,
                  started_by, ended_by, notes, revision)
                 VALUES (?, ?, ?, 'PRODUCTION', 'ACTIVE', ?, '', ?, '', ?, 1)`,
                [input.productionSessionId, current.phaseId, current.machineId,
                    input.now, input.actor, input.note],
            );
            database.run(
                `INSERT INTO mes_session_transitions
                 (transition_id, session_id, state, occurred_at, actor, note)
                 VALUES (?, ?, 'ACTIVE', ?, ?, ?)`,
                [input.startTransitionId, input.productionSessionId, input.now, input.actor, input.note],
            );
            productionSession = loadSession(
                database, "sessions.session_id = ?", [input.productionSessionId],
            );
        }
        database.run(
            `UPDATE mes_phases SET execution_status = ?, revision = revision + 1,
             updated_at = ?, updated_by = ? WHERE phase_id = ?`,
            [input.startProduction ? "RUNNING" : "NOT_STARTED", input.now, input.actor, current.phaseId],
        );
        insertAudit(database, {
            auditId: input.auditId, entityType: "SETUP_RECONCILIATION",
            entityId: input.reconciliationId, action: "RECONCILE",
            payload: { sessionId: input.sessionId, machineId: current.machineId,
                detectedPieces, goodPieces: input.goodPieces, scrapPieces: input.scrapPieces,
                excludedPieces: input.excludedPieces, startProduction: input.startProduction },
            now: input.now, actor: input.actor, requestId: input.requestId,
        });
        return {
            setupSession: loadSession(database, "sessions.session_id = ?", [input.sessionId])!,
            productionSession,
            reconciliation: {
                reconciliationId: input.reconciliationId,
                detectedPieces,
                goodPieces: input.goodPieces,
                scrapPieces: input.scrapPieces,
                excludedPieces: input.excludedPieces,
                startProduction: input.startProduction,
            },
        };
    });
}
