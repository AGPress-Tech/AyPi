import {
    getSqliteDatabase,
    runSqliteTransaction,
} from "../../shared/db/sqlite";
import { HttpError } from "../../shared/http/errors";
import {
    parseJson,
    serializeJson,
} from "../../shared/storage/json-codec";

const META_TABLE = "warehouse_meta";
const UNITS_TABLE = "warehouse_units";
const OCCUPANCIES_TABLE = "warehouse_occupancies";
const MOVEMENTS_TABLE = "warehouse_movements";
const MOVEMENT_LINES_TABLE = "warehouse_movement_lines";
const STORE_KEY = "main";

export type WarehouseInventoryItem = {
    id: string;
    location: string;
    article: string;
    customer: string;
    orderReference: string;
    tags: string[];
    inMovement: boolean;
    partial: boolean;
    type: "crate" | "pallet";
    pairedLocation: string | null;
    receivedAt: string;
};

export type WarehouseMovement = {
    id: string;
    timestamp: string;
    type: "load" | "unload";
    lines: Array<{ article: string; locations: string[] }>;
};

export type WarehouseSnapshot = {
    inventory: WarehouseInventoryItem[];
    movements: WarehouseMovement[];
    revision: number;
    updatedAt: string;
    updatedBy: string;
};

export function initializeWarehouseInventorySqliteStore() {
    const database = getSqliteDatabase();
    database.exec(`
        CREATE TABLE IF NOT EXISTS ${META_TABLE} (
            store_key TEXT PRIMARY KEY,
            revision INTEGER NOT NULL,
            updated_at TEXT NOT NULL,
            updated_by TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS ${UNITS_TABLE} (
            unit_id TEXT PRIMARY KEY,
            unit_type TEXT NOT NULL CHECK (unit_type IN ('crate', 'pallet')),
            article TEXT NOT NULL,
            customer TEXT NOT NULL,
            order_reference TEXT NOT NULL,
            is_partial INTEGER NOT NULL DEFAULT 0,
            is_in_movement INTEGER NOT NULL DEFAULT 0,
            received_at TEXT NOT NULL,
            tags_json TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_${UNITS_TABLE}_article
            ON ${UNITS_TABLE}(article);
        CREATE INDEX IF NOT EXISTS idx_${UNITS_TABLE}_customer
            ON ${UNITS_TABLE}(customer);
        CREATE INDEX IF NOT EXISTS idx_${UNITS_TABLE}_order
            ON ${UNITS_TABLE}(order_reference);
        CREATE INDEX IF NOT EXISTS idx_${UNITS_TABLE}_received
            ON ${UNITS_TABLE}(received_at);

        CREATE TABLE IF NOT EXISTS ${OCCUPANCIES_TABLE} (
            location TEXT PRIMARY KEY,
            unit_id TEXT NOT NULL,
            paired_location TEXT,
            FOREIGN KEY (unit_id) REFERENCES ${UNITS_TABLE}(unit_id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_${OCCUPANCIES_TABLE}_unit
            ON ${OCCUPANCIES_TABLE}(unit_id);

        CREATE TABLE IF NOT EXISTS ${MOVEMENTS_TABLE} (
            movement_id TEXT PRIMARY KEY,
            movement_type TEXT NOT NULL CHECK (movement_type IN ('load', 'unload')),
            occurred_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_${MOVEMENTS_TABLE}_occurred
            ON ${MOVEMENTS_TABLE}(occurred_at);

        CREATE TABLE IF NOT EXISTS ${MOVEMENT_LINES_TABLE} (
            movement_id TEXT NOT NULL,
            line_order INTEGER NOT NULL,
            article TEXT NOT NULL,
            locations_json TEXT NOT NULL,
            PRIMARY KEY (movement_id, line_order),
            FOREIGN KEY (movement_id) REFERENCES ${MOVEMENTS_TABLE}(movement_id) ON DELETE CASCADE
        );
    `);
}

function loadRevision() {
    const database = getSqliteDatabase();
    const rows = database.exec(
        `SELECT revision, updated_at, updated_by FROM ${META_TABLE} WHERE store_key = ?`,
        [STORE_KEY],
    );
    const row = rows?.[0]?.values?.[0];
    return {
        revision: Number(row?.[0]) || 0,
        updatedAt: String(row?.[1] || ""),
        updatedBy: String(row?.[2] || ""),
    };
}

export function loadWarehouseSnapshot(): WarehouseSnapshot {
    initializeWarehouseInventorySqliteStore();
    const database = getSqliteDatabase();
    const meta = loadRevision();
    const inventoryRows = database.exec(`
        SELECT
            o.location, u.unit_id, u.article, u.customer, u.order_reference,
            u.tags_json, u.is_in_movement, u.is_partial, u.unit_type,
            o.paired_location, u.received_at
        FROM ${OCCUPANCIES_TABLE} o
        INNER JOIN ${UNITS_TABLE} u ON u.unit_id = o.unit_id
        ORDER BY o.location COLLATE NOCASE ASC
    `);
    const inventory = (inventoryRows?.[0]?.values || []).map((row: unknown[]) => ({
        location: String(row[0] || ""),
        id: String(row[1] || ""),
        article: String(row[2] || ""),
        customer: String(row[3] || ""),
        orderReference: String(row[4] || ""),
        tags: parseJson<string[]>(row[5], []),
        inMovement: Boolean(row[6]),
        partial: Boolean(row[7]),
        type: row[8] === "pallet" ? "pallet" as const : "crate" as const,
        pairedLocation: row[9] ? String(row[9]) : null,
        receivedAt: String(row[10] || ""),
    }));

    const movementRows = database.exec(`
        SELECT movement_id, movement_type, occurred_at
        FROM ${MOVEMENTS_TABLE}
        ORDER BY occurred_at DESC, movement_id DESC
    `);
    const lineRows = database.exec(`
        SELECT movement_id, line_order, article, locations_json
        FROM ${MOVEMENT_LINES_TABLE}
        ORDER BY movement_id ASC, line_order ASC
    `);
    const linesByMovement = new Map<string, Array<{ article: string; locations: string[] }>>();
    (lineRows?.[0]?.values || []).forEach((row: unknown[]) => {
        const movementId = String(row[0] || "");
        if (!linesByMovement.has(movementId)) linesByMovement.set(movementId, []);
        linesByMovement.get(movementId)?.push({
            article: String(row[2] || ""),
            locations: parseJson<string[]>(row[3], []),
        });
    });
    const movements = (movementRows?.[0]?.values || []).map((row: unknown[]) => ({
        id: String(row[0] || ""),
        type: row[1] === "unload" ? "unload" as const : "load" as const,
        timestamp: String(row[2] || ""),
        lines: linesByMovement.get(String(row[0] || "")) || [],
    }));
    return { inventory, movements, ...meta };
}

export function saveWarehouseSnapshot(
    inventory: WarehouseInventoryItem[],
    movements: WarehouseMovement[],
    baseRevision: number,
    updatedBy: string,
): WarehouseSnapshot {
    initializeWarehouseInventorySqliteStore();
    runSqliteTransaction((database) => {
        const currentRevision = loadRevision().revision;
        if (baseRevision !== currentRevision) {
            throw new HttpError(409, "Il magazzino è stato aggiornato da un'altra postazione.", {
                code: "WAREHOUSE_REVISION_CONFLICT",
                details: { currentRevision },
            });
        }

        database.run(`DELETE FROM ${MOVEMENT_LINES_TABLE}`);
        database.run(`DELETE FROM ${MOVEMENTS_TABLE}`);
        database.run(`DELETE FROM ${OCCUPANCIES_TABLE}`);
        database.run(`DELETE FROM ${UNITS_TABLE}`);

        const unitStatement = database.prepare(`
            INSERT INTO ${UNITS_TABLE} (
                unit_id, unit_type, article, customer, order_reference,
                is_partial, is_in_movement, received_at, tags_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const occupancyStatement = database.prepare(`
            INSERT INTO ${OCCUPANCIES_TABLE} (location, unit_id, paired_location)
            VALUES (?, ?, ?)
        `);
        const insertedUnits = new Set<string>();
        inventory.forEach((item) => {
            if (!insertedUnits.has(item.id)) {
                unitStatement.run([
                    item.id,
                    item.type,
                    item.article,
                    item.customer,
                    item.orderReference,
                    item.partial ? 1 : 0,
                    item.inMovement ? 1 : 0,
                    item.receivedAt,
                    serializeJson(item.tags || []),
                ]);
                insertedUnits.add(item.id);
            }
            occupancyStatement.run([item.location, item.id, item.pairedLocation || null]);
        });
        unitStatement.free();
        occupancyStatement.free();

        const movementStatement = database.prepare(`
            INSERT INTO ${MOVEMENTS_TABLE} (movement_id, movement_type, occurred_at)
            VALUES (?, ?, ?)
        `);
        const lineStatement = database.prepare(`
            INSERT INTO ${MOVEMENT_LINES_TABLE} (movement_id, line_order, article, locations_json)
            VALUES (?, ?, ?, ?)
        `);
        movements.forEach((movement) => {
            movementStatement.run([movement.id, movement.type, movement.timestamp]);
            movement.lines.forEach((line, index) => {
                lineStatement.run([movement.id, index, line.article, serializeJson(line.locations || [])]);
            });
        });
        movementStatement.free();
        lineStatement.free();

        const revision = currentRevision + 1;
        const updatedAt = new Date().toISOString();
        const actor = String(updatedBy || "").trim() || "Operatore AyPi";
        database.run(`
            INSERT INTO ${META_TABLE} (store_key, revision, updated_at, updated_by)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(store_key) DO UPDATE SET
                revision = excluded.revision,
                updated_at = excluded.updated_at,
                updated_by = excluded.updated_by
        `, [STORE_KEY, revision, updatedAt, actor]);
    });
    return loadWarehouseSnapshot();
}
