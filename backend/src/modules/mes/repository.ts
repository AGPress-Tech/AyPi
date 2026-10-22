import { getSqliteDatabase, runSqliteTransaction } from "../../shared/db/sqlite";
import { parseJson, serializeJson } from "../../shared/storage/json-codec";
import type { MachineCounterEvent, MesImportResult } from "./types";

const EVENTS_TABLE = "mes_machine_events";
const IMPORTS_TABLE = "mes_import_runs";

export function initializeMesSqliteStore() {
    getSqliteDatabase().exec(`
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
    `);
}

export function storeMachineEvents(
    events: MachineCounterEvent[],
    importResult: MesImportResult,
    actor: string,
) {
    initializeMesSqliteStore();
    return runSqliteTransaction((database) => {
        let insertedEvents = 0;
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
            insertedEvents += database.getRowsModified();
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
    const database = getSqliteDatabase();
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
    const database = getSqliteDatabase();
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
    return resultRows(getSqliteDatabase().exec(
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

