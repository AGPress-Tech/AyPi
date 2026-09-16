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
const UNLOAD_ZONE_TABLE = "warehouse_unload_zone";
const STORE_KEY = "main";

export type WarehouseInventoryItem = {
    id: string;
    location: string;
    article: string;
    customer: string;
    orderReference: string;
    weighingCode: string;
    pieceCount: number;
    maxPieceCapacity: number;
    tags: string[];
    inMovement: boolean;
    type: "crate" | "pallet";
    pairedLocation: string | null;
    receivedAt: string;
};

export type WarehouseMovement = {
    id: string;
    timestamp: string;
    type: "load" | "unload";
    manual?: boolean;
    optimization?: boolean;
    optimizationOptions?: Record<string, unknown>;
    lines: Array<{ article: string; locations: string[]; kind?: "loaded" | "unloaded" | "relocated" | "pieces"; weighingCode?: string; pieceCount?: number; maxPieceCapacity?: number }>;
    operationalSteps?: Array<{
        order: number;
        kind: "corridor" | "unload" | "reinsert" | "piece-pick";
        from: string[];
        to: string[];
        wholeStack?: boolean;
        units: Array<{
            id: string;
            article: string;
            customer: string;
            orderReference: string;
            weighingCode?: string;
            pieceCount?: number;
            maxPieceCapacity?: number;
            type: "crate" | "pallet";
            from: string;
            to: string;
        }>;
    }>;
    actor?: Record<string, unknown> | null;
    beforeState?: WarehouseInventoryItem[];
    afterState?: WarehouseInventoryItem[];
    changes?: {
        loaded: Array<Record<string, unknown>>;
        unloaded: Array<Record<string, unknown>>;
        shifted: Array<Record<string, unknown>>;
        adjusted?: Array<Record<string, unknown>>;
    } | null;
};

export type WarehouseUnloadZoneItem = Omit<WarehouseInventoryItem, "location"> & {
    location: null;
    originalLocations: string[];
    stagedAt: string;
    requiresWarehouseReturn?: boolean;
    withdrawnPieceCount?: number;
};

export type WarehouseSnapshot = {
    inventory: WarehouseInventoryItem[];
    movements: WarehouseMovement[];
    unloadZone: WarehouseUnloadZoneItem[];
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
            weighing_code TEXT NOT NULL DEFAULT '',
            piece_count INTEGER NOT NULL DEFAULT 1 CHECK (piece_count > 0),
            max_piece_capacity INTEGER NOT NULL DEFAULT 1 CHECK (max_piece_capacity > 0),
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
            occurred_at TEXT NOT NULL,
            details_json TEXT NOT NULL DEFAULT '{}'
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

        CREATE TABLE IF NOT EXISTS ${UNLOAD_ZONE_TABLE} (
            unit_id TEXT PRIMARY KEY,
            payload_json TEXT NOT NULL
        );
    `);
    const movementColumns = database.exec(`PRAGMA table_info(${MOVEMENTS_TABLE})`);
    const hasDetails = (movementColumns?.[0]?.values || []).some((row: unknown[]) => String(row[1]) === "details_json");
    if (!hasDetails) database.run(`ALTER TABLE ${MOVEMENTS_TABLE} ADD COLUMN details_json TEXT NOT NULL DEFAULT '{}'`);
    const unitColumns = new Set((database.exec(`PRAGMA table_info(${UNITS_TABLE})`)?.[0]?.values || []).map((row: unknown[]) => String(row[1])));
    if (!unitColumns.has("weighing_code")) database.run(`ALTER TABLE ${UNITS_TABLE} ADD COLUMN weighing_code TEXT NOT NULL DEFAULT ''`);
    if (!unitColumns.has("piece_count")) database.run(`ALTER TABLE ${UNITS_TABLE} ADD COLUMN piece_count INTEGER NOT NULL DEFAULT 1`);
    if (!unitColumns.has("max_piece_capacity")) database.run(`ALTER TABLE ${UNITS_TABLE} ADD COLUMN max_piece_capacity INTEGER NOT NULL DEFAULT 1`);
    database.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_${UNITS_TABLE}_weighing ON ${UNITS_TABLE}(weighing_code) WHERE weighing_code <> ''`);
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
            u.weighing_code, u.piece_count, u.max_piece_capacity,
            u.tags_json, u.is_in_movement, u.unit_type,
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
        weighingCode: String(row[5] || ""),
        pieceCount: Math.max(1, Number(row[6]) || 1),
        maxPieceCapacity: Math.max(1, Number(row[7]) || Number(row[6]) || 1),
        tags: parseJson<string[]>(row[8], []),
        inMovement: Boolean(row[9]),
        type: row[10] === "pallet" ? "pallet" as const : "crate" as const,
        pairedLocation: row[11] ? String(row[11]) : null,
        receivedAt: String(row[12] || ""),
    }));

    const movementRows = database.exec(`
        SELECT movement_id, movement_type, occurred_at, details_json
        FROM ${MOVEMENTS_TABLE}
        ORDER BY occurred_at DESC, movement_id DESC
    `);
    const lineRows = database.exec(`
        SELECT movement_id, line_order, article, locations_json
        FROM ${MOVEMENT_LINES_TABLE}
        ORDER BY movement_id ASC, line_order ASC
    `);
    const linesByMovement = new Map<string, Array<{ article: string; locations: string[]; kind?: "loaded" | "unloaded" | "relocated" | "pieces"; weighingCode?: string; pieceCount?: number; maxPieceCapacity?: number }>>();
    (lineRows?.[0]?.values || []).forEach((row: unknown[]) => {
        const movementId = String(row[0] || "");
        if (!linesByMovement.has(movementId)) linesByMovement.set(movementId, []);
        linesByMovement.get(movementId)?.push({
            article: String(row[2] || ""),
            locations: parseJson<string[]>(row[3], []),
        });
    });
    const movements = (movementRows?.[0]?.values || []).map((row: unknown[]) => {
        const details = parseJson<Record<string, unknown>>(row[3], {});
        const lineDetails = Array.isArray(details.lineDetails) ? details.lineDetails as Array<{ kind?: "loaded" | "unloaded" | "relocated" | "pieces"; weighingCode?: string; pieceCount?: number; maxPieceCapacity?: number }> : [];
        const lines = (linesByMovement.get(String(row[0] || "")) || []).map((line, index) => ({
            ...line,
            ...lineDetails[index],
        }));
        delete details.lineDetails;
        return {
            ...details,
            id: String(row[0] || ""),
            type: row[1] === "unload" ? "unload" as const : "load" as const,
            timestamp: String(row[2] || ""),
            lines,
        } as WarehouseMovement;
    });
    const unloadRows = database.exec(`
        SELECT payload_json
        FROM ${UNLOAD_ZONE_TABLE}
        ORDER BY rowid ASC
    `);
    const unloadZone = (unloadRows?.[0]?.values || [])
        .map((row: unknown[]) => parseJson<WarehouseUnloadZoneItem | null>(row[0], null))
        .filter((item): item is WarehouseUnloadZoneItem => Boolean(item?.id));
    return { inventory, movements, unloadZone, ...meta };
}

export function saveWarehouseSnapshot(
    inventory: WarehouseInventoryItem[],
    movements: WarehouseMovement[],
    unloadZone: WarehouseUnloadZoneItem[],
    baseRevision: number,
    updatedBy: string,
): WarehouseSnapshot {
    initializeWarehouseInventorySqliteStore();
    const weighingOwners = new Map<string, string>();
    inventory.forEach((item) => {
        const pieces = Math.max(1, Number(item.pieceCount) || 1);
        const capacity = Math.max(1, Number(item.maxPieceCapacity) || pieces);
        if (!Number.isInteger(pieces) || !Number.isInteger(capacity) || pieces > capacity) {
            throw new HttpError(400, `Quantità pezzi non valida per il cassone ${item.id}.`, {
                code: "WAREHOUSE_INVALID_PIECE_COUNT",
                details: { unitId: item.id, pieceCount: item.pieceCount, maxPieceCapacity: item.maxPieceCapacity },
            });
        }
        const weighingCode = String(item.weighingCode || "").trim().toUpperCase();
        const owner = weighingOwners.get(weighingCode);
        if (weighingCode && owner && owner !== item.id) {
            throw new HttpError(400, `Il codice pesata ${weighingCode} è già assegnato a un altro cassone.`, {
                code: "WAREHOUSE_DUPLICATE_WEIGHING_CODE",
                details: { weighingCode, unitIds: [owner, item.id] },
            });
        }
        if (weighingCode) weighingOwners.set(weighingCode, item.id);
    });
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
        database.run(`DELETE FROM ${UNLOAD_ZONE_TABLE}`);

        const unitStatement = database.prepare(`
            INSERT INTO ${UNITS_TABLE} (
                unit_id, unit_type, article, customer, order_reference,
                weighing_code, piece_count, max_piece_capacity,
                is_in_movement, received_at, tags_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                    String(item.weighingCode || "").trim(),
                    Math.max(1, Number(item.pieceCount) || 1),
                    Math.max(1, Number(item.maxPieceCapacity) || Number(item.pieceCount) || 1),
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
            INSERT INTO ${MOVEMENTS_TABLE} (movement_id, movement_type, occurred_at, details_json)
            VALUES (?, ?, ?, ?)
        `);
        const lineStatement = database.prepare(`
            INSERT INTO ${MOVEMENT_LINES_TABLE} (movement_id, line_order, article, locations_json)
            VALUES (?, ?, ?, ?)
        `);
        movements.forEach((movement) => {
            movementStatement.run([
                movement.id,
                movement.type,
                movement.timestamp,
                serializeJson({
                    actor: movement.actor || null,
                    beforeState: movement.beforeState || [],
                    afterState: movement.afterState || [],
                    changes: movement.changes || null,
                    manual: Boolean(movement.manual),
                    optimization: Boolean(movement.optimization),
                    optimizationOptions: movement.optimizationOptions || null,
                    operationalSteps: movement.operationalSteps || [],
                    lineDetails: movement.lines.map((line) => ({
                        kind: line.kind || null,
                        weighingCode: line.weighingCode || "",
                        pieceCount: line.pieceCount || null,
                        maxPieceCapacity: line.maxPieceCapacity || null,
                    })),
                    reconstructed: Boolean((movement as WarehouseMovement & { reconstructed?: boolean }).reconstructed),
                }),
            ]);
            movement.lines.forEach((line, index) => {
                lineStatement.run([movement.id, index, line.article, serializeJson(line.locations || [])]);
            });
        });
        movementStatement.free();
        lineStatement.free();

        const unloadStatement = database.prepare(`
            INSERT INTO ${UNLOAD_ZONE_TABLE} (unit_id, payload_json)
            VALUES (?, ?)
        `);
        unloadZone.forEach((item) => unloadStatement.run([item.id, serializeJson(item)]));
        unloadStatement.free();

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
