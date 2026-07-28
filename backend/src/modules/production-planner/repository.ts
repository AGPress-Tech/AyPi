import {
    getSqliteDatabase,
    runSqliteTransaction,
} from "../../shared/db/sqlite";
import {
    parseJson,
    serializeJson,
} from "../../shared/storage/json-codec";
import { HttpError } from "../../shared/http/errors";

const TABLE = "production_planner_state";
const STORE_KEY = "main";

export type ProductionPlannerSnapshot = {
    state: unknown | null;
    revision: number;
    updatedAt: string;
    updatedBy: string;
};

export function initializeProductionPlannerSqliteStore() {
    const database = getSqliteDatabase();
    database.exec(`
        CREATE TABLE IF NOT EXISTS ${TABLE} (
            store_key TEXT PRIMARY KEY,
            revision INTEGER NOT NULL,
            updated_at TEXT NOT NULL,
            updated_by TEXT NOT NULL,
            payload_json TEXT NOT NULL
        );
    `);
}

export function loadProductionPlannerSnapshot(): ProductionPlannerSnapshot {
    initializeProductionPlannerSqliteStore();
    const database = getSqliteDatabase();
    const rows = database.exec(
        `SELECT revision, updated_at, updated_by, payload_json
         FROM ${TABLE}
         WHERE store_key = ?`,
        [STORE_KEY],
    );
    const row = rows?.[0]?.values?.[0];
    if (!row) {
        return {
            state: null,
            revision: 0,
            updatedAt: "",
            updatedBy: "",
        };
    }
    return {
        revision: Number(row[0]) || 0,
        updatedAt: String(row[1] || ""),
        updatedBy: String(row[2] || ""),
        state: parseJson(row[3], null),
    };
}

export function loadProductionPlannerRevision() {
    initializeProductionPlannerSqliteStore();
    const database = getSqliteDatabase();
    const rows = database.exec(
        `SELECT revision, updated_at, updated_by
         FROM ${TABLE}
         WHERE store_key = ?`,
        [STORE_KEY],
    );
    const row = rows?.[0]?.values?.[0];
    return {
        revision: Number(row?.[0]) || 0,
        updatedAt: String(row?.[1] || ""),
        updatedBy: String(row?.[2] || ""),
    };
}

export function saveProductionPlannerSnapshot(
    state: unknown,
    baseRevision: number,
    updatedBy: string,
): ProductionPlannerSnapshot {
    initializeProductionPlannerSqliteStore();
    return runSqliteTransaction((database) => {
        const rows = database.exec(
            `SELECT revision FROM ${TABLE} WHERE store_key = ?`,
            [STORE_KEY],
        );
        const currentRevision = Number(rows?.[0]?.values?.[0]?.[0]) || 0;
        if (baseRevision !== currentRevision) {
            throw new HttpError(409, "Il pianificatore è stato aggiornato da un altro operatore.", {
                code: "PLANNER_REVISION_CONFLICT",
                details: { currentRevision },
            });
        }
        const revision = currentRevision + 1;
        const updatedAt = new Date().toISOString();
        const actor = String(updatedBy || "").trim() || "Operatore AyPi";
        database.run(
            `INSERT INTO ${TABLE} (store_key, revision, updated_at, updated_by, payload_json)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(store_key) DO UPDATE SET
                revision = excluded.revision,
                updated_at = excluded.updated_at,
                updated_by = excluded.updated_by,
                payload_json = excluded.payload_json`,
            [STORE_KEY, revision, updatedAt, actor, serializeJson(state)],
        );
        return {
            state,
            revision,
            updatedAt,
            updatedBy: actor,
        };
    });
}
