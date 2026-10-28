import { randomUUID } from "crypto";
import { getMesSqliteDatabase, runMesSqliteTransaction, persistMesSqliteDatabase } from "../../shared/db/mes-sqlite";
import { parseJson, serializeJson } from "../../shared/storage/json-codec";
import type {
    MachineCounterEvent,
    MesCollectorBatch,
    MesCollectorIngestResult,
    MesImportResult,
} from "./types";

const EVENTS_TABLE = "mes_machine_events";
const IMPORTS_TABLE = "mes_import_runs";
let mesStoreInitialized = false;

export function initializeMesSqliteStore() {
    if (mesStoreInitialized) return;
    const database = getMesSqliteDatabase();
    database.exec(`
        CREATE TABLE IF NOT EXISTS ${EVENTS_TABLE} (
            event_id TEXT PRIMARY KEY,
            source TEXT NOT NULL,
            source_session_id TEXT NOT NULL,
            source_position TEXT NOT NULL,
            machine_id TEXT NOT NULL,
            occurred_at TEXT NOT NULL,
            received_at TEXT NOT NULL,
            pulse_delta INTEGER NOT NULL,
            piece_delta INTEGER NOT NULL,
            multiplier INTEGER NOT NULL,
            signal_mac TEXT NOT NULL DEFAULT '',
            signal_frame_id TEXT NOT NULL DEFAULT '',
            signal_byte INTEGER,
            signal_bit INTEGER,
            raw_json TEXT NOT NULL,
            imported_at TEXT NOT NULL,
            imported_by TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mes_events_machine_time
            ON ${EVENTS_TABLE} (machine_id, occurred_at);
        CREATE INDEX IF NOT EXISTS idx_mes_events_source_session
            ON ${EVENTS_TABLE} (source, source_session_id);

        CREATE TABLE IF NOT EXISTS ${IMPORTS_TABLE} (
            import_id TEXT PRIMARY KEY,
            source TEXT NOT NULL,
            source_session_id TEXT NOT NULL,
            source_file TEXT NOT NULL,
            total_rows INTEGER NOT NULL,
            valid_rows INTEGER NOT NULL,
            inserted_events INTEGER NOT NULL,
            duplicate_events INTEGER NOT NULL,
            rejected_rows INTEGER NOT NULL,
            issues_json TEXT NOT NULL,
            imported_at TEXT NOT NULL,
            imported_by TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mes_imports_time
            ON ${IMPORTS_TABLE} (imported_at DESC);

        CREATE TABLE IF NOT EXISTS mes_collector_sessions (
            collector_id TEXT NOT NULL,
            source_session_id TEXT NOT NULL,
            mode TEXT NOT NULL,
            status TEXT NOT NULL,
            started_at TEXT NOT NULL,
            last_seen_at TEXT NOT NULL,
            ended_at TEXT NOT NULL DEFAULT '',
            first_received_at TEXT NOT NULL,
            last_received_at TEXT NOT NULL,
            batch_count INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (collector_id, source_session_id)
        );
        CREATE INDEX IF NOT EXISTS idx_mes_collector_sessions_seen
            ON mes_collector_sessions (last_seen_at DESC);

        CREATE TABLE IF NOT EXISTS mes_ingest_batches (
            collector_id TEXT NOT NULL,
            source_session_id TEXT NOT NULL,
            batch_id TEXT NOT NULL,
            sent_at TEXT NOT NULL,
            received_at TEXT NOT NULL,
            machine_count INTEGER NOT NULL,
            PRIMARY KEY (collector_id, source_session_id, batch_id)
        );
        CREATE INDEX IF NOT EXISTS idx_mes_ingest_batches_received
            ON mes_ingest_batches (received_at DESC);

        CREATE TABLE IF NOT EXISTS mes_machine_current (
            machine_id TEXT PRIMARY KEY,
            machine_name TEXT NOT NULL DEFAULT '',
            collector_id TEXT NOT NULL,
            source_session_id TEXT NOT NULL,
            acquisition_status TEXT NOT NULL,
            operating_state TEXT NOT NULL DEFAULT 'UNMONITORED',
            detected INTEGER NOT NULL,
            pulses INTEGER NOT NULL,
            pieces REAL NOT NULL,
            pieces_last_hour REAL NOT NULL,
            last_piece_at TEXT NOT NULL DEFAULT '',
            last_cycle_seconds REAL,
            multiplier INTEGER NOT NULL,
            frame_count INTEGER NOT NULL,
            invalid_frames INTEGER NOT NULL,
            frame_at TEXT NOT NULL DEFAULT '',
            observed_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mes_machine_current_collector
            ON mes_machine_current (collector_id, source_session_id);

        CREATE TABLE IF NOT EXISTS mes_machine_state_intervals (
            interval_id TEXT PRIMARY KEY,
            machine_id TEXT NOT NULL,
            collector_id TEXT NOT NULL,
            source_session_id TEXT NOT NULL,
            state TEXT NOT NULL,
            started_at TEXT NOT NULL,
            ended_at TEXT NOT NULL DEFAULT ''
        );
        CREATE INDEX IF NOT EXISTS idx_mes_machine_intervals_machine_time
            ON mes_machine_state_intervals (machine_id, started_at DESC);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_mes_machine_interval_open
            ON mes_machine_state_intervals (machine_id) WHERE ended_at = '';

        CREATE TABLE IF NOT EXISTS mes_machine_operating_intervals (
            interval_id TEXT PRIMARY KEY,
            machine_id TEXT NOT NULL,
            session_id TEXT NOT NULL DEFAULT '',
            state TEXT NOT NULL,
            started_at TEXT NOT NULL,
            ended_at TEXT NOT NULL DEFAULT '',
            source_session_id TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mes_operating_intervals_machine_time
            ON mes_machine_operating_intervals (machine_id, started_at DESC);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_mes_operating_interval_open
            ON mes_machine_operating_intervals (machine_id) WHERE ended_at = '';

        CREATE TABLE IF NOT EXISTS mes_orders (
            order_id TEXT PRIMARY KEY,
            order_number TEXT NOT NULL UNIQUE,
            customer TEXT NOT NULL DEFAULT '',
            article_code TEXT NOT NULL,
            target_quantity REAL NOT NULL,
            unit TEXT NOT NULL,
            order_type TEXT NOT NULL DEFAULT 'MACHINING',
            material_alloy TEXT NOT NULL DEFAULT '',
            gross_weight REAL NOT NULL DEFAULT 0,
            net_weight REAL NOT NULL DEFAULT 0,
            kilograms_to_stamp REAL NOT NULL DEFAULT 0,
            bar_bundles TEXT NOT NULL DEFAULT '',
            material_owner TEXT NOT NULL DEFAULT '',
            bar_size TEXT NOT NULL DEFAULT '',
            first_delivery_at TEXT NOT NULL DEFAULT '',
            due_at TEXT NOT NULL DEFAULT '',
            priority TEXT NOT NULL,
            notes TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL,
            revision INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            created_by TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            updated_by TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mes_orders_article ON mes_orders (article_code);
        CREATE INDEX IF NOT EXISTS idx_mes_orders_status ON mes_orders (status, updated_at DESC);

        CREATE TABLE IF NOT EXISTS mes_phases (
            phase_id TEXT PRIMARY KEY,
            order_id TEXT NOT NULL REFERENCES mes_orders(order_id) ON DELETE RESTRICT,
            phase_code TEXT NOT NULL,
            sequence INTEGER NOT NULL,
            article_code TEXT NOT NULL,
            target_quantity REAL NOT NULL,
            unit TEXT NOT NULL,
            standard_cycle_seconds REAL NOT NULL,
            planned_setup_seconds INTEGER NOT NULL,
            planned_machine_id TEXT NOT NULL DEFAULT '',
            scheduled_start TEXT NOT NULL DEFAULT '',
            scheduled_end TEXT NOT NULL DEFAULT '',
            planning_status TEXT NOT NULL,
            execution_status TEXT NOT NULL,
            revision INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            created_by TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            updated_by TEXT NOT NULL,
            UNIQUE (order_id, phase_code),
            UNIQUE (order_id, sequence)
        );
        CREATE INDEX IF NOT EXISTS idx_mes_phases_machine ON mes_phases (planned_machine_id, planning_status);
        CREATE INDEX IF NOT EXISTS idx_mes_phases_execution ON mes_phases (execution_status, updated_at DESC);

        CREATE TABLE IF NOT EXISTS mes_machine_sessions (
            session_id TEXT PRIMARY KEY,
            phase_id TEXT NOT NULL REFERENCES mes_phases(phase_id) ON DELETE RESTRICT,
            machine_id TEXT NOT NULL,
            mode TEXT NOT NULL,
            status TEXT NOT NULL,
            started_at TEXT NOT NULL,
            ended_at TEXT NOT NULL DEFAULT '',
            started_by TEXT NOT NULL,
            ended_by TEXT NOT NULL DEFAULT '',
            notes TEXT NOT NULL DEFAULT '',
            revision INTEGER NOT NULL DEFAULT 1
        );
        DROP INDEX IF EXISTS idx_mes_active_session_machine;
        DROP INDEX IF EXISTS idx_mes_active_session_phase;
        CREATE UNIQUE INDEX idx_mes_active_session_machine
            ON mes_machine_sessions (machine_id) WHERE status = 'ACTIVE';
        CREATE UNIQUE INDEX idx_mes_active_session_phase
            ON mes_machine_sessions (phase_id) WHERE status = 'ACTIVE';
        CREATE INDEX IF NOT EXISTS idx_mes_sessions_phase_time
            ON mes_machine_sessions (phase_id, started_at);

        CREATE TABLE IF NOT EXISTS mes_session_operator_intervals (
            interval_id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL REFERENCES mes_machine_sessions(session_id) ON DELETE RESTRICT,
            operator_name TEXT NOT NULL,
            started_at TEXT NOT NULL,
            ended_at TEXT NOT NULL DEFAULT '',
            actor TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mes_operator_intervals_active
            ON mes_session_operator_intervals (session_id, ended_at);
        CREATE INDEX IF NOT EXISTS idx_mes_operator_intervals_name_time
            ON mes_session_operator_intervals (operator_name, started_at DESC);

        CREATE TABLE IF NOT EXISTS mes_session_transitions (
            transition_id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL REFERENCES mes_machine_sessions(session_id) ON DELETE RESTRICT,
            state TEXT NOT NULL,
            occurred_at TEXT NOT NULL,
            actor TEXT NOT NULL,
            note TEXT NOT NULL DEFAULT ''
        );
        CREATE INDEX IF NOT EXISTS idx_mes_session_transitions_time
            ON mes_session_transitions (session_id, occurred_at);

        CREATE TABLE IF NOT EXISTS mes_event_allocations (
            allocation_id TEXT PRIMARY KEY,
            event_id TEXT NOT NULL REFERENCES mes_machine_events(event_id) ON DELETE RESTRICT,
            session_id TEXT REFERENCES mes_machine_sessions(session_id) ON DELETE RESTRICT,
            resolution_id TEXT,
            allocation_kind TEXT NOT NULL,
            piece_quantity REAL NOT NULL,
            created_at TEXT NOT NULL,
            created_by TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mes_allocations_event ON mes_event_allocations (event_id);
        CREATE INDEX IF NOT EXISTS idx_mes_allocations_session ON mes_event_allocations (session_id);

        CREATE TABLE IF NOT EXISTS mes_unassigned_resolutions (
            resolution_id TEXT PRIMARY KEY,
            machine_id TEXT NOT NULL,
            phase_id TEXT NOT NULL REFERENCES mes_phases(phase_id) ON DELETE RESTRICT,
            session_id TEXT NOT NULL REFERENCES mes_machine_sessions(session_id) ON DELETE RESTRICT,
            detected_pieces REAL NOT NULL,
            attributed_pieces REAL NOT NULL,
            excluded_pieces REAL NOT NULL,
            reason_code TEXT NOT NULL,
            note TEXT NOT NULL DEFAULT '',
            resolved_at TEXT NOT NULL,
            actor TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mes_resolutions_machine_time
            ON mes_unassigned_resolutions (machine_id, resolved_at DESC);

        CREATE TABLE IF NOT EXISTS mes_production_adjustments (
            adjustment_id TEXT PRIMARY KEY,
            machine_id TEXT NOT NULL,
            phase_id TEXT NOT NULL REFERENCES mes_phases(phase_id) ON DELETE RESTRICT,
            session_id TEXT REFERENCES mes_machine_sessions(session_id) ON DELETE RESTRICT,
            kind TEXT NOT NULL,
            quantity REAL NOT NULL,
            reason_code TEXT NOT NULL,
            note TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            actor TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mes_adjustments_phase_time
            ON mes_production_adjustments (phase_id, created_at DESC);

        CREATE TABLE IF NOT EXISTS mes_setup_reconciliations (
            reconciliation_id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL UNIQUE REFERENCES mes_machine_sessions(session_id) ON DELETE RESTRICT,
            phase_id TEXT NOT NULL REFERENCES mes_phases(phase_id) ON DELETE RESTRICT,
            machine_id TEXT NOT NULL,
            detected_pieces REAL NOT NULL,
            good_pieces REAL NOT NULL,
            scrap_pieces REAL NOT NULL,
            excluded_pieces REAL NOT NULL,
            start_production INTEGER NOT NULL,
            note TEXT NOT NULL DEFAULT '',
            reconciled_at TEXT NOT NULL,
            actor TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS mes_audit_log (
            audit_id TEXT PRIMARY KEY,
            entity_type TEXT NOT NULL,
            entity_id TEXT NOT NULL,
            action TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            occurred_at TEXT NOT NULL,
            actor TEXT NOT NULL,
            request_id TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mes_audit_entity_time
            ON mes_audit_log (entity_type, entity_id, occurred_at DESC);

        UPDATE mes_machine_sessions
           SET status = 'PAUSED',
               ended_at = CASE WHEN ended_at = '' THEN started_at ELSE ended_at END
         WHERE status = 'CANCELLED';
        UPDATE mes_machine_sessions
           SET ended_at = CASE WHEN ended_at = '' THEN started_at ELSE ended_at END
         WHERE status = 'PAUSED';
        UPDATE mes_phases SET execution_status = 'PAUSED'
         WHERE execution_status = 'CANCELLED';
        UPDATE mes_phases SET execution_status = 'NOT_STARTED'
         WHERE execution_status = 'COMPLETED'
           AND NOT EXISTS (
               SELECT 1 FROM mes_machine_sessions AS sessions
               WHERE sessions.phase_id = mes_phases.phase_id
           );
        UPDATE mes_orders
           SET status = CASE
               WHEN EXISTS (
                   SELECT 1 FROM mes_phases AS phases
                   WHERE phases.order_id = mes_orders.order_id
               ) AND NOT EXISTS (
                   SELECT 1 FROM mes_phases AS phases
                   WHERE phases.order_id = mes_orders.order_id
                     AND phases.execution_status <> 'COMPLETED'
               ) THEN 'COMPLETED'
               ELSE 'OPEN'
           END;
    `);

    const existingOrderColumns = new Set(
        (database.exec("PRAGMA table_info(mes_orders)")?.[0]?.values || [])
            .map((row: unknown[]) => String(row[1])),
    );
    const orderColumnMigrations: Array<[string, string]> = [
        ["order_type", "TEXT NOT NULL DEFAULT 'MACHINING'"],
        ["material_alloy", "TEXT NOT NULL DEFAULT ''"],
        ["gross_weight", "REAL NOT NULL DEFAULT 0"],
        ["net_weight", "REAL NOT NULL DEFAULT 0"],
        ["kilograms_to_stamp", "REAL NOT NULL DEFAULT 0"],
        ["bar_bundles", "TEXT NOT NULL DEFAULT ''"],
        ["material_owner", "TEXT NOT NULL DEFAULT ''"],
        ["bar_size", "TEXT NOT NULL DEFAULT ''"],
    ];
    orderColumnMigrations.forEach(([column, definition]) => {
        if (!existingOrderColumns.has(column)) {
            database.exec(`ALTER TABLE mes_orders ADD COLUMN ${column} ${definition}`);
        }
    });
    const existingMachineColumns = new Set(
        (database.exec("PRAGMA table_info(mes_machine_current)")?.[0]?.values || [])
            .map((row: unknown[]) => String(row[1])),
    );
    if (!existingMachineColumns.has("operating_state")) {
        database.exec("ALTER TABLE mes_machine_current ADD COLUMN operating_state TEXT NOT NULL DEFAULT 'UNMONITORED'");
    }
    const sessionColumns = database.exec("PRAGMA table_info(mes_machine_sessions)")?.[0]?.values || [];
    if (!sessionColumns.some((row: unknown[]) => row[1] === "activation_id")) {
        database.exec("ALTER TABLE mes_machine_sessions ADD COLUMN activation_id TEXT NOT NULL DEFAULT ''");
        backfillMesActivationIds(database);
    }
    if (!sessionColumns.some((row: unknown[]) => row[1] === "pieces_per_pulse")) {
        database.exec("ALTER TABLE mes_machine_sessions ADD COLUMN pieces_per_pulse INTEGER");
    }
    for (const [column, definition] of [
        ["collection_mode", "TEXT NOT NULL DEFAULT 'PLC'"],
        ["manual_state", "TEXT NOT NULL DEFAULT 'STOPPED'"],
        ["standard_cycle_snapshot", "REAL"],
    ]) {
        if (!sessionColumns.some((row: unknown[]) => row[1] === column)) database.exec(`ALTER TABLE mes_machine_sessions ADD COLUMN ${column} ${definition}`);
    }
    database.exec(`UPDATE mes_machine_sessions SET standard_cycle_snapshot =
        (SELECT standard_cycle_seconds FROM mes_phases WHERE mes_phases.phase_id = mes_machine_sessions.phase_id)
        WHERE standard_cycle_snapshot IS NULL;
        CREATE TABLE IF NOT EXISTS mes_manual_declarations (
            declaration_id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES mes_machine_sessions(session_id),
            machine_id TEXT NOT NULL, kind TEXT NOT NULL, quantity INTEGER NOT NULL DEFAULT 0,
            occurred_at TEXT NOT NULL, actor TEXT NOT NULL, reason_code TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT ''
        );
        CREATE INDEX IF NOT EXISTS idx_mes_manual_session_time ON mes_manual_declarations(session_id, occurred_at);
        CREATE TABLE IF NOT EXISTS mes_setup_sheet_links (
            link_id TEXT PRIMARY KEY, phase_id TEXT NOT NULL REFERENCES mes_phases(phase_id),
            sheet_type TEXT NOT NULL, record_id TEXT NOT NULL, label TEXT NOT NULL,
            snapshot_json TEXT NOT NULL, linked_at TEXT NOT NULL, linked_by TEXT NOT NULL,
            removed_at TEXT NOT NULL DEFAULT ''
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_mes_setup_sheet_active ON mes_setup_sheet_links(phase_id, sheet_type, record_id) WHERE removed_at = '';
    `);
    const allocationColumns = database.exec("PRAGMA table_info(mes_event_allocations)")?.[0]?.values || [];
    if (!allocationColumns.some((row: unknown[]) => row[1] === "source_piece_quantity")) {
        database.exec("ALTER TABLE mes_event_allocations ADD COLUMN source_piece_quantity REAL");
    }
    const phaseColumns = database.exec("PRAGMA table_info(mes_phases)")?.[0]?.values || [];
    if (!phaseColumns.some((row: unknown[]) => row[1] === "archived_at")) {
        database.exec("ALTER TABLE mes_phases ADD COLUMN archived_at TEXT NOT NULL DEFAULT ''");
    }
    database.exec("CREATE INDEX IF NOT EXISTS idx_mes_sessions_activation ON mes_machine_sessions (activation_id)");
    persistMesSqliteDatabase();
    mesStoreInitialized = true;
}

export function backfillMesActivationIds(database: any) {
    const entries = resultRows(database.exec(`SELECT session_id, phase_id, machine_id, started_at, ended_at,
        status, activation_id FROM mes_machine_sessions ORDER BY started_at, rowid`));
    const predecessors = new Map<string, string>();
    for (const entry of entries) {
        const key = `${entry.machine_id}\u001f${entry.phase_id}\u001f`;
        const activationId = entry.activation_id || predecessors.get(key + entry.started_at) || entry.session_id;
        if (!entry.activation_id) database.run("UPDATE mes_machine_sessions SET activation_id = ? WHERE session_id = ?",
            [activationId, entry.session_id]);
        if (entry.status === "COMPLETED" && entry.ended_at) predecessors.set(key + entry.ended_at, activationId);
    }
}

function updateMachineAcquisitionInterval(
    database: any,
    input: {
        machineId: string;
        collectorId: string;
        sourceSessionId: string;
        state: string;
        occurredAt: string;
    },
) {
    const current = resultRows(database.exec(
        `SELECT interval_id, state
         FROM mes_machine_state_intervals
         WHERE machine_id = ? AND ended_at = ''
         LIMIT 1`,
        [input.machineId],
    ))[0];
    if (current?.state === input.state) return;
    if (current) {
        database.run(
            `UPDATE mes_machine_state_intervals SET ended_at = ? WHERE interval_id = ?`,
            [input.occurredAt, current.interval_id],
        );
    }
    database.run(
        `INSERT INTO mes_machine_state_intervals
         (interval_id, machine_id, collector_id, source_session_id, state, started_at, ended_at)
         VALUES (?, ?, ?, ?, ?, ?, '')`,
        [randomUUID(), input.machineId, input.collectorId, input.sourceSessionId,
            input.state, input.occurredAt],
    );
}

function resolveMachineOperatingState(database: any, batch: MesCollectorBatch, machine: MesCollectorBatch["machines"][number]) {
    if (batch.stoppedAt || !machine.detected) {
        return { state: "UNMONITORED", sessionId: "", occurredAt: machine.observedAt || batch.sentAt };
    }
    const session = resultRows(database.exec(
        `SELECT sessions.session_id, sessions.mode, sessions.started_at, sessions.pieces_per_pulse,
                COALESCE(sessions.standard_cycle_snapshot, phases.standard_cycle_seconds) AS standard_cycle_seconds
         FROM mes_machine_sessions AS sessions
         JOIN mes_phases AS phases ON phases.phase_id = sessions.phase_id
         WHERE sessions.machine_id = ? AND sessions.status = 'ACTIVE'
         ORDER BY sessions.started_at DESC
         LIMIT 1`,
        [machine.machineId],
    ))[0];
    if (!session) return { state: "IDLE", sessionId: "", occurredAt: machine.observedAt || batch.sentAt };
    if (session.mode === "SETUP") {
        return { state: "SETUP", sessionId: String(session.session_id), occurredAt: machine.observedAt || batch.sentAt };
    }
    const standardCycleSeconds = (Number(session.standard_cycle_seconds) || 0) * (Number(session.pieces_per_pulse) || 1);
    const startedAtMs = Date.parse(String(session.started_at || ""));
    const lastPieceAtMs = Date.parse(machine.lastPieceAt || "");
    const observedAtMs = Date.parse(machine.observedAt || batch.sentAt);
    const hasPieceInSession = standardCycleSeconds > 0
        && Number.isFinite(lastPieceAtMs)
        && Number.isFinite(startedAtMs)
        && lastPieceAtMs >= startedAtMs;
    const productionUntilMs = hasPieceInSession
        ? lastPieceAtMs + standardCycleSeconds * 2000
        : 0;
    if (hasPieceInSession && Number.isFinite(observedAtMs) && observedAtMs <= productionUntilMs) {
        return {
            state: "PRODUCTION",
            sessionId: String(session.session_id),
            occurredAt: new Date(lastPieceAtMs).toISOString(),
        };
    }
    return {
        state: "STOPPED",
        sessionId: String(session.session_id),
        occurredAt: productionUntilMs > 0 && productionUntilMs <= observedAtMs
            ? new Date(productionUntilMs).toISOString()
            : machine.observedAt || batch.sentAt,
    };
}

function updateMachineOperatingInterval(
    database: any,
    input: {
        machineId: string;
        sessionId: string;
        sourceSessionId: string;
        state: string;
        occurredAt: string;
    },
) {
    const current = resultRows(database.exec(
        `SELECT interval_id, session_id, state, started_at
         FROM mes_machine_operating_intervals
         WHERE machine_id = ? AND ended_at = ''
         LIMIT 1`,
        [input.machineId],
    ))[0];
    if (current && input.occurredAt < current.started_at) input.occurredAt = current.started_at;
    if (current?.state === input.state && String(current?.session_id || "") === input.sessionId) return;
    if (current) {
        database.run(
            `UPDATE mes_machine_operating_intervals SET ended_at = ? WHERE interval_id = ?`,
            [input.occurredAt, current.interval_id],
        );
    }
    database.run(
        `INSERT INTO mes_machine_operating_intervals
         (interval_id, machine_id, session_id, state, started_at, ended_at, source_session_id)
         VALUES (?, ?, ?, ?, ?, '', ?)`,
        [randomUUID(), input.machineId, input.sessionId, input.state,
            input.occurredAt, input.sourceSessionId],
    );
}

// Rebuild only the affected tail. Pulse windows, rather than sampling frequency,
// determine production time, including events delivered after a network outage.
export function rebuildOperatingTail(database: any, machineId: string, from: string, until: string) {
    const start = Date.parse(from), end = Date.parse(until);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return;
    const sessions = resultRows(database.exec(`SELECT s.*, COALESCE(s.standard_cycle_snapshot,p.standard_cycle_seconds) AS standard_cycle_seconds FROM mes_machine_sessions s
        JOIN mes_phases p ON p.phase_id = s.phase_id
        WHERE s.machine_id = ? AND s.started_at <= ? AND (s.ended_at = '' OR s.ended_at >= ?)
        ORDER BY s.started_at`, [machineId, until, from]));
    const maxWindow = Math.max(0, ...sessions.map((s: any) => Number(s.standard_cycle_seconds) * (Number(s.pieces_per_pulse) || 1) * 2000));
    const pulses = resultRows(database.exec(`SELECT occurred_at FROM mes_machine_events
        WHERE machine_id = ? AND occurred_at >= ? AND occurred_at <= ? ORDER BY occurred_at`,
        [machineId, new Date(start - maxWindow).toISOString(), until])).map((r: any) => Date.parse(r.occurred_at));
    const snapshot = resultRows(database.exec("SELECT last_piece_at, source_session_id FROM mes_machine_current WHERE machine_id = ?", [machineId]))[0];
    const snapshotPulse = Date.parse(snapshot?.last_piece_at || "");
    if (Number.isFinite(snapshotPulse) && snapshotPulse <= end) pulses.push(snapshotPulse);
    pulses.sort((a: number, b: number) => a - b);
    const acquisition = resultRows(database.exec(`SELECT * FROM mes_machine_state_intervals
        WHERE machine_id = ? AND started_at <= ? AND (ended_at = '' OR ended_at >= ?)
        ORDER BY started_at`, [machineId, until, from]));
    const points = new Set<number>([start, end]);
    const manual = resultRows(database.exec(`SELECT * FROM mes_manual_declarations WHERE machine_id = ?
        AND occurred_at <= ? AND kind IN ('START', 'STOP') ORDER BY occurred_at, rowid`, [machineId, until]));
    const add = (time: number) => { if (Number.isFinite(time) && time >= start && time <= end) points.add(time); };
    for (const s of sessions) {
        add(Date.parse(s.started_at)); add(Date.parse(s.ended_at));
        for (const pulse of pulses) {
            if (pulse >= Date.parse(s.started_at) && (!s.ended_at || pulse < Date.parse(s.ended_at))) {
                add(pulse); add(pulse + Number(s.standard_cycle_seconds) * (Number(s.pieces_per_pulse) || 1) * 2000);
            }
        }
    }
    for (const a of acquisition) { add(Date.parse(a.started_at)); add(Date.parse(a.ended_at)); }
    for (const declaration of manual) add(Date.parse(declaration.occurred_at));
    database.run("DELETE FROM mes_machine_operating_intervals WHERE machine_id = ? AND started_at >= ?", [machineId, from]);
    database.run("UPDATE mes_machine_operating_intervals SET ended_at = '' WHERE machine_id = ? AND started_at < ? AND (ended_at = '' OR ended_at > ?)",
        [machineId, from, from]);
    const ordered = [...points].sort((a, b) => a - b);
    let lastState = "UNMONITORED";
    for (let i = 0; i < ordered.length; i++) {
        const at = ordered[i];
        const iso = new Date(at).toISOString();
        const monitored = acquisition.find((a: any) => a.started_at <= iso && (!a.ended_at || a.ended_at > iso));
        const session = sessions.find((s: any) => s.started_at <= iso && (!s.ended_at || s.ended_at > iso));
        let state = "UNMONITORED";
        if (session?.collection_mode === "MANUAL") {
            const declarations = manual.filter((d: any) => d.session_id === session.session_id && d.occurred_at <= iso);
            state = session.mode === 'SETUP' ? 'SETUP' : declarations[declarations.length - 1]?.kind === 'START' ? 'PRODUCTION' : 'STOPPED';
        } else if (monitored?.state === "ONLINE") {
            if (!session) state = "IDLE";
            else if (session.mode === "SETUP") state = "SETUP";
            else {
                let left = 0, right = pulses.length;
                while (left < right) {
                    const middle = (left + right) >>> 1;
                    if (pulses[middle] <= at) left = middle + 1; else right = middle;
                }
                const candidate = left > 0 ? pulses[left - 1] : undefined;
                const lastPulse = candidate !== undefined && candidate >= Date.parse(session.started_at) ? candidate : undefined;
                state = lastPulse !== undefined && Number(session.standard_cycle_seconds) > 0
                    && at < lastPulse + Number(session.standard_cycle_seconds) * (Number(session.pieces_per_pulse) || 1) * 2000 ? "PRODUCTION" : "STOPPED";
            }
        }
        updateMachineOperatingInterval(database, { machineId, sessionId: session?.session_id || "",
            sourceSessionId: session?.collection_mode === 'MANUAL' ? 'MANUAL' : monitored?.source_session_id || snapshot?.source_session_id || "",
            state, occurredAt: iso });
        lastState = state;
    }
    database.run("UPDATE mes_machine_current SET operating_state = ? WHERE machine_id = ?", [lastState, machineId]);
}

export function storeCollectorBatch(
    batch: MesCollectorBatch,
    receivedAt: string,
): MesCollectorIngestResult {
    initializeMesSqliteStore();
    return runMesSqliteTransaction((database) => {
        const duplicate = !!resultRows(database.exec(
            `SELECT batch_id FROM mes_ingest_batches
             WHERE collector_id = ? AND source_session_id = ? AND batch_id = ?`,
            [batch.collectorId, batch.sourceSessionId, batch.batchId],
        ))[0];
        if (duplicate) {
            return {
                collectorId: batch.collectorId,
                sourceSessionId: batch.sourceSessionId,
                batchId: batch.batchId,
                duplicate: true,
                machinesUpdated: 0,
                receivedAt,
            };
        }

        const status = batch.stoppedAt ? "STOPPED" : "ACTIVE";
        const latestSentAt = database.exec(`SELECT MAX(sent_at) FROM mes_ingest_batches
            WHERE collector_id = ? AND source_session_id = ?`, [batch.collectorId, batch.sourceSessionId])?.[0]?.values?.[0]?.[0];
        if (!latestSentAt || batch.sentAt >= String(latestSentAt)) database.run(
            `INSERT INTO mes_collector_sessions
             (collector_id, source_session_id, mode, status, started_at,
              last_seen_at, ended_at, first_received_at, last_received_at, batch_count)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
             ON CONFLICT(collector_id, source_session_id) DO UPDATE SET
                mode = excluded.mode,
                status = excluded.status,
                last_seen_at = excluded.last_seen_at,
                ended_at = excluded.ended_at,
                last_received_at = excluded.last_received_at,
                batch_count = mes_collector_sessions.batch_count + 1`,
            [batch.collectorId, batch.sourceSessionId, batch.mode, status,
                batch.startedAt, receivedAt, batch.stoppedAt,
                receivedAt, receivedAt],
        );
        database.run(
            `INSERT INTO mes_ingest_batches
             (collector_id, source_session_id, batch_id, sent_at, received_at, machine_count)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [batch.collectorId, batch.sourceSessionId, batch.batchId,
                batch.sentAt, receivedAt, batch.machines.length],
        );

        let machinesUpdated = 0;
        batch.machines.forEach((machine) => {
            const previous = resultRows(database.exec("SELECT * FROM mes_machine_current WHERE machine_id = ?", [machine.machineId]))[0];
            const observedAt = machine.observedAt || batch.sentAt;
            if (previous && observedAt <= previous.observed_at) return;
            machinesUpdated++;
            if (previous?.acquisition_status === "ACTIVE"
                && Date.parse(observedAt) - Date.parse(previous.observed_at) > 15000) {
                updateMachineAcquisitionInterval(database, { machineId: machine.machineId,
                    collectorId: previous.collector_id, sourceSessionId: previous.source_session_id,
                    state: "UNMONITORED", occurredAt: new Date(Date.parse(previous.observed_at) + 15000).toISOString() });
            }
            const acquisitionState = batch.stoppedAt
                ? "ACQUISITION_STOPPED"
                : machine.detected ? "ONLINE" : "NOT_DETECTED";
            updateMachineAcquisitionInterval(database, {
                machineId: machine.machineId,
                collectorId: batch.collectorId,
                sourceSessionId: batch.sourceSessionId,
                state: acquisitionState,
                occurredAt: machine.observedAt || batch.sentAt,
            });
            const operating = resolveMachineOperatingState(database, batch, machine);
            updateMachineOperatingInterval(database, {
                machineId: machine.machineId,
                sessionId: operating.sessionId,
                sourceSessionId: batch.sourceSessionId,
                state: operating.state,
                occurredAt: operating.occurredAt,
            });
            database.run(
                `INSERT INTO mes_machine_current
                 (machine_id, machine_name, collector_id, source_session_id,
                  acquisition_status, operating_state, detected, pulses, pieces, pieces_last_hour,
                  last_piece_at, last_cycle_seconds, multiplier, frame_count,
                  invalid_frames, frame_at, observed_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(machine_id) DO UPDATE SET
                    machine_name = excluded.machine_name,
                    collector_id = excluded.collector_id,
                    source_session_id = excluded.source_session_id,
                    acquisition_status = excluded.acquisition_status,
                    operating_state = excluded.operating_state,
                    detected = excluded.detected,
                    pulses = excluded.pulses,
                    pieces = excluded.pieces,
                    pieces_last_hour = excluded.pieces_last_hour,
                    last_piece_at = excluded.last_piece_at,
                    last_cycle_seconds = excluded.last_cycle_seconds,
                    multiplier = excluded.multiplier,
                    frame_count = excluded.frame_count,
                    invalid_frames = excluded.invalid_frames,
                    frame_at = excluded.frame_at,
                    observed_at = excluded.observed_at,
                    updated_at = excluded.updated_at`,
                [machine.machineId, machine.machineName, batch.collectorId,
                    batch.sourceSessionId, status, operating.state, machine.detected ? 1 : 0,
                    machine.pulses, machine.pieces, machine.piecesLastHour,
                    machine.lastPieceAt, machine.lastCycleSeconds, machine.multiplier,
                    machine.frameCount, machine.invalidFrames, machine.frameAt,
                    machine.observedAt, receivedAt],
            );
            rebuildOperatingTail(database, machine.machineId, previous?.observed_at || observedAt, observedAt);
        });

        // The batch ledger is only needed for retry deduplication. Historical
        // production data lives in the event and interval tables.
        const batchRetentionBoundary = new Date(Date.parse(receivedAt) - 7 * 86400000).toISOString();
        database.run(
            `DELETE FROM mes_ingest_batches WHERE received_at < ?`,
            [batchRetentionBoundary],
        );
        return {
            collectorId: batch.collectorId,
            sourceSessionId: batch.sourceSessionId,
            batchId: batch.batchId,
            duplicate: false,
            machinesUpdated,
            receivedAt,
        };
    });
}

export function loadAcquisitionStatus(staleAfterSeconds = 15) {
    initializeMesSqliteStore();
    const now = Date.now();
    const database = getMesSqliteDatabase();
    const staleMachines = resultRows(database.exec(`SELECT * FROM mes_machine_current
        WHERE acquisition_status = 'ACTIVE' AND updated_at < ?`, [new Date(now - staleAfterSeconds * 1000).toISOString()]));
    if (staleMachines.length) runMesSqliteTransaction(() => {
        for (const machine of staleMachines) {
            const expiredAt = new Date(Date.parse(machine.observed_at) + staleAfterSeconds * 1000).toISOString();
            updateMachineAcquisitionInterval(database, { machineId: machine.machine_id,
                collectorId: machine.collector_id, sourceSessionId: machine.source_session_id,
                state: "UNMONITORED", occurredAt: expiredAt });
            database.run("UPDATE mes_machine_current SET acquisition_status = 'STALE', detected = 0 WHERE machine_id = ?", [machine.machine_id]);
            rebuildOperatingTail(database, machine.machine_id, machine.observed_at, new Date(now).toISOString());
        }
    });
    const sessions = resultRows(database.exec(
        `SELECT collector_id, source_session_id, mode, status, started_at,
                last_seen_at, ended_at, first_received_at, last_received_at, batch_count
         FROM mes_collector_sessions
         ORDER BY last_seen_at DESC
         LIMIT 50`,
    )).map((row: any) => ({
        collectorId: row.collector_id,
        sourceSessionId: row.source_session_id,
        mode: row.mode,
        status: row.status === "ACTIVE" && now - Date.parse(row.last_seen_at) > staleAfterSeconds * 1000
            ? "STALE"
            : row.status,
        startedAt: row.started_at,
        lastSeenAt: row.last_seen_at,
        endedAt: row.ended_at,
        firstReceivedAt: row.first_received_at,
        lastReceivedAt: row.last_received_at,
        batchCount: Number(row.batch_count) || 0,
    }));
    const machines = resultRows(database.exec(
        `SELECT machine_id, machine_name, collector_id, source_session_id,
                acquisition_status, operating_state, detected, pulses, pieces, pieces_last_hour,
                last_piece_at, last_cycle_seconds, multiplier, frame_count,
                invalid_frames, frame_at, observed_at, updated_at
         FROM mes_machine_current
         ORDER BY machine_id`,
    )).map((row: any) => {
        const stale = row.acquisition_status === "ACTIVE"
            && now - Date.parse(row.updated_at) > staleAfterSeconds * 1000;
        return {
            machineId: row.machine_id,
            machineName: row.machine_name,
            collectorId: row.collector_id,
            sourceSessionId: row.source_session_id,
            acquisitionStatus: stale ? "STALE" : row.acquisition_status,
            operatingState: stale ? "UNMONITORED" : row.operating_state,
            detected: !stale && !!row.detected,
            pulses: Number(row.pulses) || 0,
            pieces: Number(row.pieces) || 0,
            piecesLastHour: Number(row.pieces_last_hour) || 0,
            lastPieceAt: row.last_piece_at,
            lastCycleSeconds: row.last_cycle_seconds === null ? null : Number(row.last_cycle_seconds),
            multiplier: Number(row.multiplier) || 1,
            frameCount: Number(row.frame_count) || 0,
            invalidFrames: Number(row.invalid_frames) || 0,
            frameAt: row.frame_at,
            observedAt: row.observed_at,
            updatedAt: row.updated_at,
        };
    });
    return { staleAfterSeconds, sessions, machines };
}

export function storeMachineEvents(
    events: MachineCounterEvent[],
    importResult: MesImportResult,
    actor: string,
) {
    initializeMesSqliteStore();
    return runMesSqliteTransaction((database) => {
        let insertedEvents = 0;
        const affectedMachines = new Map<string, string>();
        events.forEach((event) => {
            database.run(
                `INSERT OR IGNORE INTO ${EVENTS_TABLE} (
                    event_id, source, source_session_id, source_position,
                    machine_id, occurred_at, received_at, pulse_delta,
                    piece_delta, multiplier, signal_mac, signal_frame_id,
                    signal_byte, signal_bit, raw_json, imported_at, imported_by
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    event.eventId,
                    event.source,
                    event.sourceSessionId,
                    event.sourcePosition,
                    event.machineId,
                    event.occurredAt,
                    event.receivedAt,
                    event.pulseDelta,
                    event.pieceDelta,
                    event.multiplier,
                    event.signal?.mac || "",
                    event.signal?.frameId || "",
                    event.signal?.byte ?? null,
                    event.signal?.bit ?? null,
                    serializeJson(event.raw || {}),
                    importResult.importedAt,
                    actor,
                ],
            );
            const inserted = database.getRowsModified();
            insertedEvents += inserted;
            if (inserted) {
                allocateEventToSession(database, event, importResult.importedAt, actor);
                const earliest = affectedMachines.get(event.machineId);
                if (!earliest || event.occurredAt < earliest) affectedMachines.set(event.machineId, event.occurredAt);
            }
        });
        affectedMachines.forEach((from, machineId) => {
            const current = resultRows(database.exec("SELECT observed_at FROM mes_machine_current WHERE machine_id = ?", [machineId]))[0];
            if (current?.observed_at) rebuildOperatingTail(database, machineId, from,
                [current.observed_at, from, importResult.importedAt].sort().pop()!);
        });

        const completed: MesImportResult = {
            ...importResult,
            insertedEvents,
            duplicateEvents: events.length - insertedEvents,
        };
        database.run(
            `INSERT INTO ${IMPORTS_TABLE} (
                import_id, source, source_session_id, source_file, total_rows,
                valid_rows, inserted_events, duplicate_events, rejected_rows,
                issues_json, imported_at, imported_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                completed.importId,
                completed.source,
                completed.sourceSessionId,
                completed.sourceFile,
                completed.totalRows,
                completed.validRows,
                completed.insertedEvents,
                completed.duplicateEvents,
                completed.rejectedRows,
                serializeJson(completed.issues),
                completed.importedAt,
                actor,
            ],
        );
        return completed;
    });
}

function allocateEventToSession(database: any, event: MachineCounterEvent, createdAt: string, actor: string) {
    const session = resultRows(database.exec(
        `SELECT sessions.session_id, sessions.mode, sessions.status, sessions.pieces_per_pulse, sessions.collection_mode,
                COALESCE((
                    SELECT transitions.state
                    FROM mes_session_transitions AS transitions
                    WHERE transitions.session_id = sessions.session_id
                      AND transitions.occurred_at <= ?
                    ORDER BY transitions.occurred_at DESC, transitions.rowid DESC
                    LIMIT 1
                ), sessions.status) AS state_at_event
         FROM mes_machine_sessions AS sessions
         JOIN mes_phases AS phases ON phases.phase_id = sessions.phase_id
         WHERE sessions.machine_id = ?
           AND sessions.started_at <= ?
           AND (sessions.ended_at = '' OR sessions.ended_at >= ?)
           AND phases.unit = 'pz'
         ORDER BY sessions.started_at DESC
         LIMIT 1`,
        [event.occurredAt, event.machineId, event.occurredAt, event.occurredAt],
    ))[0];
    if (!session) return;
    const state = String(session.state_at_event || "");
    const ignoredPlc = session.collection_mode === 'MANUAL' && event.source !== 'MANUAL';
    const allocationKind = ignoredPlc ? 'MANUAL_MODE_EXCLUSION' : state === "ACTIVE"
        ? (session.mode === "SETUP" ? "SETUP_PENDING" : "PRODUCTION")
        : state === "PAUSED"
            ? "PAUSED_EXCLUSION"
            : "";
    if (!allocationKind) return;
    database.run(
        `INSERT INTO mes_event_allocations
         (allocation_id, event_id, session_id, resolution_id, allocation_kind,
          piece_quantity, source_piece_quantity, created_at, created_by)
         VALUES (?, ?, ?, '', ?, ?, ?, ?, ?)`,
        [randomUUID(), event.eventId, session.session_id, allocationKind,
            ignoredPlc ? 0 : event.source === 'MANUAL' || session.pieces_per_pulse == null ? event.pieceDelta : event.pulseDelta * Number(session.pieces_per_pulse),
            event.pieceDelta, createdAt, actor],
    );
}

function resultRows(result: any) {
    if (!Array.isArray(result) || !result.length) return [];
    const columns = result[0].columns || [];
    return (result[0].values || []).map((values: unknown[]) =>
        Object.fromEntries(columns.map((column: string, index: number) => [column, values[index]])),
    );
}

export function loadMachineEvents(options: {
    machineId?: string;
    from?: string;
    to?: string;
    limit: number;
    offset: number;
}) {
    initializeMesSqliteStore();
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (options.machineId) {
        conditions.push("machine_id = ?");
        params.push(options.machineId);
    }
    if (options.from) {
        conditions.push("occurred_at >= ?");
        params.push(options.from);
    }
    if (options.to) {
        conditions.push("occurred_at <= ?");
        params.push(options.to);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const database = getMesSqliteDatabase();
    const countResult = database.exec(
        `SELECT COUNT(*) AS total FROM ${EVENTS_TABLE} ${where}`,
        params,
    );
    const total = Number(countResult?.[0]?.values?.[0]?.[0]) || 0;
    const rows = resultRows(database.exec(
        `SELECT event_id, source, source_session_id, source_position,
                machine_id, occurred_at, received_at, pulse_delta, piece_delta,
                multiplier, signal_mac, signal_frame_id, signal_byte, signal_bit,
                raw_json, imported_at, imported_by
         FROM ${EVENTS_TABLE}
         ${where}
         ORDER BY occurred_at DESC, event_id DESC
         LIMIT ? OFFSET ?`,
        [...params, options.limit, options.offset],
    )).map((row: any) => ({
        eventId: row.event_id,
        source: row.source,
        sourceSessionId: row.source_session_id,
        sourcePosition: row.source_position,
        machineId: row.machine_id,
        occurredAt: row.occurred_at,
        receivedAt: row.received_at,
        pulseDelta: Number(row.pulse_delta) || 0,
        pieceDelta: Number(row.piece_delta) || 0,
        multiplier: Number(row.multiplier) || 0,
        signal: {
            mac: row.signal_mac,
            frameId: row.signal_frame_id,
            byte: row.signal_byte === null ? undefined : Number(row.signal_byte),
            bit: row.signal_bit === null ? undefined : Number(row.signal_bit),
        },
        raw: parseJson(row.raw_json, {}),
        importedAt: row.imported_at,
        importedBy: row.imported_by,
    }));
    return { total, limit: options.limit, offset: options.offset, rows };
}

export function loadMesEventSummary() {
    initializeMesSqliteStore();
    const database = getMesSqliteDatabase();
    const totals = database.exec(`
        SELECT COUNT(*) AS events,
               COALESCE(SUM(piece_delta), 0) AS pieces,
               COUNT(DISTINCT machine_id) AS machines,
               MIN(occurred_at) AS first_event_at,
               MAX(occurred_at) AS last_event_at
        FROM ${EVENTS_TABLE}
    `)?.[0]?.values?.[0] || [];
    const machines = resultRows(database.exec(`
        SELECT machine_id, COUNT(*) AS events, COALESCE(SUM(piece_delta), 0) AS pieces,
               MAX(occurred_at) AS last_event_at
        FROM ${EVENTS_TABLE}
        GROUP BY machine_id
        ORDER BY machine_id
    `)).map((row: any) => ({
        machineId: row.machine_id,
        events: Number(row.events) || 0,
        pieces: Number(row.pieces) || 0,
        lastEventAt: row.last_event_at || "",
    }));
    return {
        events: Number(totals[0]) || 0,
        pieces: Number(totals[1]) || 0,
        machines: Number(totals[2]) || 0,
        firstEventAt: totals[3] || "",
        lastEventAt: totals[4] || "",
        byMachine: machines,
    };
}

export function loadMesImports(limit = 50) {
    initializeMesSqliteStore();
    return resultRows(getMesSqliteDatabase().exec(
        `SELECT import_id, source, source_session_id, source_file, total_rows,
                valid_rows, inserted_events, duplicate_events, rejected_rows,
                issues_json, imported_at, imported_by
         FROM ${IMPORTS_TABLE}
         ORDER BY imported_at DESC
         LIMIT ?`,
        [limit],
    )).map((row: any) => ({
        importId: row.import_id,
        source: row.source,
        sourceSessionId: row.source_session_id,
        sourceFile: row.source_file,
        totalRows: Number(row.total_rows) || 0,
        validRows: Number(row.valid_rows) || 0,
        insertedEvents: Number(row.inserted_events) || 0,
        duplicateEvents: Number(row.duplicate_events) || 0,
        rejectedRows: Number(row.rejected_rows) || 0,
        issues: parseJson(row.issues_json, []),
        importedAt: row.imported_at,
        importedBy: row.imported_by,
    }));
}

export function loadUnassignedPieces() {
    initializeMesSqliteStore();
    return resultRows(getMesSqliteDatabase().exec(`
        SELECT pending.machine_id,
               SUM(pending.remaining_pieces) AS pieces,
               COUNT(*) AS events,
               MIN(pending.occurred_at) AS first_event_at,
               MAX(pending.occurred_at) AS last_event_at
        FROM (
            SELECT events.event_id, events.machine_id, events.occurred_at,
                   events.piece_delta - COALESCE(SUM(COALESCE(allocations.source_piece_quantity, allocations.piece_quantity)), 0) AS remaining_pieces
            FROM mes_machine_events AS events
            LEFT JOIN mes_event_allocations AS allocations ON allocations.event_id = events.event_id
            GROUP BY events.event_id
        ) AS pending
        WHERE pending.remaining_pieces > 0.000001
        GROUP BY pending.machine_id
        ORDER BY pending.machine_id
    `)).map((row: any) => ({
        machineId: row.machine_id,
        pieces: Number(row.pieces) || 0,
        events: Number(row.events) || 0,
        firstEventAt: row.first_event_at || "",
        lastEventAt: row.last_event_at || "",
    }));
}

