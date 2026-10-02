import {
    getSqliteDatabase,
    runSqliteTransaction,
} from "../../shared/db/sqlite";
import { HttpError } from "../../shared/http/errors";
import {
    parseJson,
    serializeJson,
} from "../../shared/storage/json-codec";
import {
    isValidWarehouseTrackingCode,
    normalizeWarehouseTrackingCode,
} from "./future-capabilities";

const META_TABLE = "warehouse_meta";
const UNITS_TABLE = "warehouse_units";
const OCCUPANCIES_TABLE = "warehouse_occupancies";
const MOVEMENTS_TABLE = "warehouse_movements";
const MOVEMENT_LINES_TABLE = "warehouse_movement_lines";
const UNLOAD_ZONE_TABLE = "warehouse_unload_zone";
const VIEW_PREFERENCES_TABLE = "warehouse_view_preferences";
const CONFIGURATION_TABLE = "warehouse_configuration";
const DATABASE_PREFERENCES_TABLE = "warehouse_database_preferences";
const PHYSICAL_INVENTORY_SESSIONS_TABLE = "warehouse_physical_inventory_sessions";
const PHYSICAL_INVENTORY_SCANS_TABLE = "warehouse_physical_inventory_scans";
const INVENTORY_ADJUSTMENTS_TABLE = "warehouse_inventory_adjustments";
const LABEL_PRINT_JOBS_TABLE = "warehouse_label_print_jobs";
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
    /** Identificativo futuro per barcode/QR. Vuoto finché la funzione è disattivata. */
    trackingCode?: string;
};

export type WarehouseMovement = {
    id: string;
    timestamp: string;
    type: "load" | "unload" | "exit";
    sourceArea?: string;
    destinationArea?: string;
    stagingUnitsBefore?: WarehouseUnloadZoneItem[];
    manual?: boolean;
    optimization?: boolean;
    reversal?: boolean;
    reversalOf?: string;
    reversalMode?: "exact" | "automatic";
    metadataEdit?: boolean;
    editedUnitId?: string;
    optimizationOptions?: Record<string, unknown>;
    requests?: Array<{
        article?: string;
        customer?: string;
        order?: string;
        weighingCode?: string;
        pieceCount?: number;
        requestedPieces?: number;
        quantity?: number;
        type?: "crate" | "pallet";
        sourceIds?: string[];
    }>;
    lines: Array<{ article: string; locations: string[]; kind?: "loaded" | "unloaded" | "relocated" | "pieces"; weighingCode?: string; pieceCount?: number; maxPieceCapacity?: number }>;
    operationalSteps?: Array<{
        order: number;
        kind: "corridor" | "unload" | "reinsert" | "piece-pick" | "load" | "staging-exit" | "optimization-corridor" | "optimization-stage" | "optimization-place";
        sourceArea?: string;
        destinationArea?: string;
        from: string[];
        to: string[];
        wholeStack?: boolean;
        units: Array<{
            id: string;
            article: string;
            customer: string;
            orderReference: string;
            weighingCode?: string;
            trackingCode?: string;
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
    movementsTotal: number;
    unloadZone: WarehouseUnloadZoneItem[];
    revision: number;
    updatedAt: string;
    updatedBy: string;
};

export type WarehouseSaveResult = {
    revision: number;
    updatedAt: string;
    updatedBy: string;
    occupiedSlots: number;
    movementsTotal: number;
    unloadZoneUnits: number;
};

export type WarehouseConfiguration = {
    rows: Array<{ code: string; capacity: number; invertedSides: boolean }>;
    rowRestrictions: Array<{ key: string; whitelist: string[]; blacklist: string[] }>;
    slotRestrictions: Array<{ key: string; whitelist: string[]; blacklist: string[] }>;
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
            tracking_code TEXT NOT NULL DEFAULT '',
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
            movement_type TEXT NOT NULL CHECK (movement_type IN ('load', 'unload', 'exit')),
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

        CREATE TABLE IF NOT EXISTS ${VIEW_PREFERENCES_TABLE} (
            owner_key TEXT PRIMARY KEY,
            owner_label TEXT NOT NULL,
            camera_views_json TEXT NOT NULL DEFAULT '[]',
            view_presets_json TEXT NOT NULL DEFAULT '[]',
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS ${CONFIGURATION_TABLE} (
            store_key TEXT PRIMARY KEY,
            rows_json TEXT NOT NULL DEFAULT '[]',
            row_restrictions_json TEXT NOT NULL DEFAULT '[]',
            slot_restrictions_json TEXT NOT NULL DEFAULT '[]',
            updated_at TEXT NOT NULL,
            updated_by TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS ${DATABASE_PREFERENCES_TABLE} (
            owner_key TEXT PRIMARY KEY,
            owner_label TEXT NOT NULL,
            visible_columns_json TEXT NOT NULL DEFAULT '[]',
            presets_json TEXT NOT NULL DEFAULT '[]',
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS ${PHYSICAL_INVENTORY_SESSIONS_TABLE} (
            session_id TEXT PRIMARY KEY,
            status TEXT NOT NULL CHECK (status IN ('draft', 'counting', 'review', 'reconciled', 'cancelled')),
            scope_json TEXT NOT NULL DEFAULT '{}',
            summary_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL,
            created_by TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            updated_by TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS ${PHYSICAL_INVENTORY_SCANS_TABLE} (
            scan_id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            tracking_code TEXT NOT NULL,
            expected_unit_id TEXT,
            expected_location TEXT,
            observed_location TEXT,
            outcome TEXT NOT NULL CHECK (outcome IN ('matched', 'unexpected-unit', 'unexpected-location', 'unknown-code', 'duplicate-scan')),
            scanned_at TEXT NOT NULL,
            scanned_by TEXT NOT NULL,
            payload_json TEXT NOT NULL DEFAULT '{}',
            FOREIGN KEY (session_id) REFERENCES ${PHYSICAL_INVENTORY_SESSIONS_TABLE}(session_id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_${PHYSICAL_INVENTORY_SCANS_TABLE}_session
            ON ${PHYSICAL_INVENTORY_SCANS_TABLE}(session_id, scanned_at);
        CREATE INDEX IF NOT EXISTS idx_${PHYSICAL_INVENTORY_SCANS_TABLE}_tracking
            ON ${PHYSICAL_INVENTORY_SCANS_TABLE}(tracking_code);

        CREATE TABLE IF NOT EXISTS ${INVENTORY_ADJUSTMENTS_TABLE} (
            adjustment_id TEXT PRIMARY KEY,
            session_id TEXT,
            status TEXT NOT NULL CHECK (status IN ('draft', 'approved', 'applied', 'cancelled')),
            reason TEXT NOT NULL,
            differences_json TEXT NOT NULL DEFAULT '[]',
            created_at TEXT NOT NULL,
            created_by TEXT NOT NULL,
            approved_at TEXT,
            approved_by TEXT,
            applied_at TEXT,
            applied_by TEXT,
            FOREIGN KEY (session_id) REFERENCES ${PHYSICAL_INVENTORY_SESSIONS_TABLE}(session_id) ON DELETE SET NULL
        );
        CREATE INDEX IF NOT EXISTS idx_${INVENTORY_ADJUSTMENTS_TABLE}_session
            ON ${INVENTORY_ADJUSTMENTS_TABLE}(session_id, status);

        CREATE TABLE IF NOT EXISTS ${LABEL_PRINT_JOBS_TABLE} (
            job_id TEXT PRIMARY KEY,
            unit_id TEXT NOT NULL,
            tracking_code TEXT NOT NULL,
            template_key TEXT NOT NULL,
            status TEXT NOT NULL CHECK (status IN ('pending', 'printing', 'printed', 'failed', 'cancelled')),
            copies INTEGER NOT NULL DEFAULT 1 CHECK (copies > 0),
            payload_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL,
            created_by TEXT NOT NULL,
            printed_at TEXT,
            printer_name TEXT,
            error_message TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_${LABEL_PRINT_JOBS_TABLE}_status
            ON ${LABEL_PRINT_JOBS_TABLE}(status, created_at);
        CREATE INDEX IF NOT EXISTS idx_${LABEL_PRINT_JOBS_TABLE}_unit
            ON ${LABEL_PRINT_JOBS_TABLE}(unit_id);
    `);
    const movementColumns = database.exec(`PRAGMA table_info(${MOVEMENTS_TABLE})`);
    const hasDetails = (movementColumns?.[0]?.values || []).some((row: unknown[]) => String(row[1]) === "details_json");
    if (!hasDetails) database.run(`ALTER TABLE ${MOVEMENTS_TABLE} ADD COLUMN details_json TEXT NOT NULL DEFAULT '{}'`);
    const movementSchema = String(database.exec(`
        SELECT sql FROM sqlite_master WHERE type = 'table' AND name = '${MOVEMENTS_TABLE}'
    `)?.[0]?.values?.[0]?.[0] || "");
    if (movementSchema && !movementSchema.includes("'exit'")) {
        database.exec(`PRAGMA foreign_keys = OFF`);
        try {
            database.exec(`
                BEGIN IMMEDIATE TRANSACTION;
                ALTER TABLE ${MOVEMENT_LINES_TABLE} RENAME TO warehouse_movement_lines_before_exit;
                ALTER TABLE ${MOVEMENTS_TABLE} RENAME TO warehouse_movements_before_exit;
                CREATE TABLE ${MOVEMENTS_TABLE} (
                    movement_id TEXT PRIMARY KEY,
                    movement_type TEXT NOT NULL CHECK (movement_type IN ('load', 'unload', 'exit')),
                    occurred_at TEXT NOT NULL,
                    details_json TEXT NOT NULL DEFAULT '{}'
                );
                CREATE TABLE ${MOVEMENT_LINES_TABLE} (
                    movement_id TEXT NOT NULL,
                    line_order INTEGER NOT NULL,
                    article TEXT NOT NULL,
                    locations_json TEXT NOT NULL,
                    PRIMARY KEY (movement_id, line_order),
                    FOREIGN KEY (movement_id) REFERENCES ${MOVEMENTS_TABLE}(movement_id) ON DELETE CASCADE
                );
                INSERT INTO ${MOVEMENTS_TABLE} (movement_id, movement_type, occurred_at, details_json)
                    SELECT movement_id, movement_type, occurred_at, details_json FROM warehouse_movements_before_exit;
                INSERT INTO ${MOVEMENT_LINES_TABLE} (movement_id, line_order, article, locations_json)
                    SELECT movement_id, line_order, article, locations_json FROM warehouse_movement_lines_before_exit;
                DROP TABLE warehouse_movement_lines_before_exit;
                DROP TABLE warehouse_movements_before_exit;
                COMMIT;
            `);
        } catch (error) {
            try { database.exec(`ROLLBACK`); } catch { /* keep original error */ }
            throw error;
        } finally {
            database.exec(`PRAGMA foreign_keys = ON`);
        }
        database.exec(`CREATE INDEX IF NOT EXISTS idx_${MOVEMENTS_TABLE}_occurred ON ${MOVEMENTS_TABLE}(occurred_at)`);
    }
    const unitColumns = new Set((database.exec(`PRAGMA table_info(${UNITS_TABLE})`)?.[0]?.values || []).map((row: unknown[]) => String(row[1])));
    if (!unitColumns.has("weighing_code")) database.run(`ALTER TABLE ${UNITS_TABLE} ADD COLUMN weighing_code TEXT NOT NULL DEFAULT ''`);
    if (!unitColumns.has("tracking_code")) database.run(`ALTER TABLE ${UNITS_TABLE} ADD COLUMN tracking_code TEXT NOT NULL DEFAULT ''`);
    if (!unitColumns.has("piece_count")) database.run(`ALTER TABLE ${UNITS_TABLE} ADD COLUMN piece_count INTEGER NOT NULL DEFAULT 1`);
    if (!unitColumns.has("max_piece_capacity")) database.run(`ALTER TABLE ${UNITS_TABLE} ADD COLUMN max_piece_capacity INTEGER NOT NULL DEFAULT 1`);
    database.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_${UNITS_TABLE}_weighing ON ${UNITS_TABLE}(weighing_code) WHERE weighing_code <> ''`);
    database.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_${UNITS_TABLE}_tracking ON ${UNITS_TABLE}(tracking_code) WHERE tracking_code <> ''`);
}

const DEFAULT_WAREHOUSE_ROWS = ["A", "B", "C", "D", "E"].map((code, index) => ({
    code,
    capacity: 96,
    invertedSides: index % 2 === 1,
}));

export function loadWarehouseConfiguration(): WarehouseConfiguration {
    initializeWarehouseInventorySqliteStore();
    const database = getSqliteDatabase();
    const rows = database.exec(`
        SELECT rows_json, row_restrictions_json, slot_restrictions_json, updated_at, updated_by
        FROM ${CONFIGURATION_TABLE} WHERE store_key = ?
    `, [STORE_KEY]);
    const row = rows?.[0]?.values?.[0];
    return {
        rows: parseJson(row?.[0], DEFAULT_WAREHOUSE_ROWS),
        rowRestrictions: parseJson(row?.[1], []),
        slotRestrictions: parseJson(row?.[2], []),
        updatedAt: String(row?.[3] || ""),
        updatedBy: String(row?.[4] || ""),
    };
}

export function saveWarehouseConfiguration(configuration: Omit<WarehouseConfiguration, "updatedAt" | "updatedBy">, updatedBy: string) {
    initializeWarehouseInventorySqliteStore();
    const updatedAt = new Date().toISOString();
    runSqliteTransaction((database) => database.run(`
        INSERT INTO ${CONFIGURATION_TABLE} (
            store_key, rows_json, row_restrictions_json, slot_restrictions_json, updated_at, updated_by
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(store_key) DO UPDATE SET
            rows_json = excluded.rows_json,
            row_restrictions_json = excluded.row_restrictions_json,
            slot_restrictions_json = excluded.slot_restrictions_json,
            updated_at = excluded.updated_at,
            updated_by = excluded.updated_by
    `, [STORE_KEY, serializeJson(configuration.rows), serializeJson(configuration.rowRestrictions), serializeJson(configuration.slotRestrictions), updatedAt, updatedBy]));
    return loadWarehouseConfiguration();
}

export function loadWarehouseDatabasePreferences(ownerKey: string) {
    initializeWarehouseInventorySqliteStore();
    const rows = getSqliteDatabase().exec(`
        SELECT owner_label, visible_columns_json, presets_json, updated_at
        FROM ${DATABASE_PREFERENCES_TABLE} WHERE owner_key = ?
    `, [ownerKey]);
    const row = rows?.[0]?.values?.[0];
    return { ownerKey, ownerLabel: String(row?.[0] || ""), visibleColumns: parseJson<string[]>(row?.[1], []), presets: parseJson<unknown[]>(row?.[2], []), updatedAt: String(row?.[3] || "") };
}

export function saveWarehouseDatabasePreferences(ownerKey: string, ownerLabel: string, visibleColumns: string[], presets: unknown[]) {
    initializeWarehouseInventorySqliteStore();
    const updatedAt = new Date().toISOString();
    runSqliteTransaction((database) => database.run(`
        INSERT INTO ${DATABASE_PREFERENCES_TABLE} (owner_key, owner_label, visible_columns_json, presets_json, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(owner_key) DO UPDATE SET owner_label = excluded.owner_label,
            visible_columns_json = excluded.visible_columns_json, presets_json = excluded.presets_json,
            updated_at = excluded.updated_at
    `, [ownerKey, ownerLabel, serializeJson(visibleColumns), serializeJson(presets), updatedAt]));
    return loadWarehouseDatabasePreferences(ownerKey);
}

export function loadWarehouseViewPreferences(ownerKey: string) {
    initializeWarehouseInventorySqliteStore();
    const database = getSqliteDatabase();
    const rows = database.exec(`
        SELECT owner_label, camera_views_json, view_presets_json, updated_at
        FROM ${VIEW_PREFERENCES_TABLE}
        WHERE owner_key = ?
    `, [ownerKey]);
    const row = rows?.[0]?.values?.[0];
    return {
        ownerKey,
        ownerLabel: String(row?.[0] || ""),
        cameraViews: parseJson<unknown[]>(row?.[1], []),
        viewPresets: parseJson<unknown[]>(row?.[2], []),
        updatedAt: String(row?.[3] || ""),
    };
}

export function saveWarehouseViewPreferences(
    ownerKey: string,
    ownerLabel: string,
    cameraViews: unknown[],
    viewPresets: unknown[],
) {
    const updatedAt = new Date().toISOString();
    initializeWarehouseInventorySqliteStore();
    runSqliteTransaction((database) => {
        database.run(`
            INSERT INTO ${VIEW_PREFERENCES_TABLE} (
                owner_key, owner_label, camera_views_json, view_presets_json, updated_at
            ) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(owner_key) DO UPDATE SET
                owner_label = excluded.owner_label,
                camera_views_json = excluded.camera_views_json,
                view_presets_json = excluded.view_presets_json,
                updated_at = excluded.updated_at
        `, [ownerKey, ownerLabel, serializeJson(cameraViews), serializeJson(viewPresets), updatedAt]);
    });
    return loadWarehouseViewPreferences(ownerKey);
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
            u.weighing_code, u.tracking_code, u.piece_count, u.max_piece_capacity,
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
        trackingCode: String(row[6] || ""),
        pieceCount: Math.max(1, Number(row[7]) || 1),
        maxPieceCapacity: Math.max(1, Number(row[8]) || Number(row[7]) || 1),
        tags: parseJson<string[]>(row[9], []),
        inMovement: Boolean(row[10]),
        type: row[11] === "pallet" ? "pallet" as const : "crate" as const,
        pairedLocation: row[12] ? String(row[12]) : null,
        receivedAt: String(row[13] || ""),
    }));

    const movements = loadWarehouseMovements({ limit: 100, offset: 0 }).movements;
    const movementsTotal = Number(database.exec(`SELECT COUNT(*) FROM ${MOVEMENTS_TABLE}`)?.[0]?.values?.[0]?.[0]) || 0;
    const unloadRows = database.exec(`
        SELECT payload_json
        FROM ${UNLOAD_ZONE_TABLE}
        ORDER BY rowid ASC
    `);
    const unloadZone = (unloadRows?.[0]?.values || [])
        .map((row: unknown[]) => parseJson<WarehouseUnloadZoneItem | null>(row[0], null))
        .filter((item): item is WarehouseUnloadZoneItem => Boolean(item?.id));
    return { inventory, movements, movementsTotal, unloadZone, ...meta };
}

export function loadWarehouseMovements(options: { limit: number; offset: number; from?: string }) {
    initializeWarehouseInventorySqliteStore();
    const database = getSqliteDatabase();
    const limit = Math.min(500, Math.max(1, Math.trunc(options.limit || 100)));
    const offset = Math.max(0, Math.trunc(options.offset || 0));
    const from = String(options.from || "").trim();
    const where = from ? "WHERE occurred_at >= ?" : "";
    const parameters: Array<string | number> = from ? [from, limit, offset] : [limit, offset];
    const movementRows = database.exec(`
        SELECT movement_id, movement_type, occurred_at, details_json
        FROM ${MOVEMENTS_TABLE}
        ${where}
        ORDER BY occurred_at DESC, movement_id DESC
        LIMIT ? OFFSET ?
    `, parameters);
    const movementIds = (movementRows?.[0]?.values || []).map((row: unknown[]) => String(row[0] || ""));
    if (!movementIds.length) {
        const countParams = from ? [from] : [];
        const total = Number(database.exec(`SELECT COUNT(*) FROM ${MOVEMENTS_TABLE} ${where}`, countParams)?.[0]?.values?.[0]?.[0]) || 0;
        return { movements: [] as WarehouseMovement[], total, limit, offset };
    }
    const placeholders = movementIds.map(() => "?").join(",");
    const lineRows = database.exec(`
        SELECT movement_id, line_order, article, locations_json
        FROM ${MOVEMENT_LINES_TABLE}
        WHERE movement_id IN (${placeholders})
        ORDER BY movement_id ASC, line_order ASC
    `, movementIds);
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
            type: row[1] === "exit" ? "exit" as const : row[1] === "unload" ? "unload" as const : "load" as const,
            timestamp: String(row[2] || ""),
            lines,
        } as WarehouseMovement;
    });
    const countParams = from ? [from] : [];
    const total = Number(database.exec(`SELECT COUNT(*) FROM ${MOVEMENTS_TABLE} ${where}`, countParams)?.[0]?.values?.[0]?.[0]) || 0;
    return { movements, total, limit, offset };
}

export function loadWarehouseMovement(movementId: string) {
    initializeWarehouseInventorySqliteStore();
    const database = getSqliteDatabase();
    const rows = database.exec(`SELECT movement_type, occurred_at, details_json FROM ${MOVEMENTS_TABLE} WHERE movement_id = ?`, [movementId]);
    const row = rows?.[0]?.values?.[0];
    if (!row) return null;
    const details = parseJson<Record<string, unknown>>(row[2], {});
    const lineDetails = Array.isArray(details.lineDetails) ? details.lineDetails as WarehouseMovement["lines"] : [];
    const lineRows = database.exec(`SELECT article, locations_json FROM ${MOVEMENT_LINES_TABLE} WHERE movement_id = ? ORDER BY line_order ASC`, [movementId]);
    const lines = (lineRows?.[0]?.values || []).map((line: unknown[], index: number) => ({ article: String(line[0] || ""), locations: parseJson<string[]>(line[1], []), ...(lineDetails[index] || {}) }));
    delete details.lineDetails;
    return { ...details, id: movementId, type: row[0] === "exit" ? "exit" : row[0] === "unload" ? "unload" : "load", timestamp: String(row[1] || ""), lines } as WarehouseMovement;
}

export function saveWarehouseSnapshot(
    inventory: WarehouseInventoryItem[],
    movements: WarehouseMovement[],
    unloadZone: WarehouseUnloadZoneItem[],
    baseRevision: number,
    updatedBy: string,
    replaceMovements = false,
): WarehouseSaveResult {
    initializeWarehouseInventorySqliteStore();
    const weighingOwners = new Map<string, string>();
    const trackingOwners = new Map<string, string>();
    [...inventory, ...unloadZone].forEach((item) => {
        const trackingCode = normalizeWarehouseTrackingCode(item.trackingCode);
        if (!isValidWarehouseTrackingCode(trackingCode)) {
            throw new HttpError(400, `Codice univoco non valido per il cassone ${item.id}.`, {
                code: "WAREHOUSE_INVALID_TRACKING_CODE",
                details: { unitId: item.id, trackingCode },
            });
        }
        const owner = trackingOwners.get(trackingCode);
        if (trackingCode && owner && owner !== item.id) {
            throw new HttpError(400, `Il codice univoco ${trackingCode} è già assegnato a un altro cassone.`, {
                code: "WAREHOUSE_DUPLICATE_TRACKING_CODE",
                details: { trackingCode, unitIds: [owner, item.id] },
            });
        }
        if (trackingCode) trackingOwners.set(trackingCode, item.id);
    });
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

        if (replaceMovements) {
            database.run(`DELETE FROM ${MOVEMENT_LINES_TABLE}`);
            database.run(`DELETE FROM ${MOVEMENTS_TABLE}`);
        }
        database.run(`DELETE FROM ${OCCUPANCIES_TABLE}`);
        database.run(`DELETE FROM ${UNITS_TABLE}`);
        database.run(`DELETE FROM ${UNLOAD_ZONE_TABLE}`);

        const unitStatement = database.prepare(`
            INSERT INTO ${UNITS_TABLE} (
                unit_id, unit_type, article, customer, order_reference,
                weighing_code, tracking_code, piece_count, max_piece_capacity,
                is_in_movement, received_at, tags_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                    normalizeWarehouseTrackingCode(item.trackingCode),
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
            ON CONFLICT(movement_id) DO UPDATE SET movement_type = excluded.movement_type,
                occurred_at = excluded.occurred_at, details_json = excluded.details_json
        `);
        const lineStatement = database.prepare(`
            INSERT INTO ${MOVEMENT_LINES_TABLE} (movement_id, line_order, article, locations_json)
            VALUES (?, ?, ?, ?)
        `);
        movements.forEach((movement) => {
            database.run(`DELETE FROM ${MOVEMENT_LINES_TABLE} WHERE movement_id = ?`, [movement.id]);
            movementStatement.run([
                movement.id,
                movement.type,
                movement.timestamp,
                serializeJson({
                    actor: movement.actor || null,
                    sourceArea: movement.sourceArea || null,
                    destinationArea: movement.destinationArea || null,
                    stagingUnitsBefore: movement.stagingUnitsBefore || [],
                    beforeState: movement.beforeState || [],
                    afterState: movement.afterState || [],
                    changes: movement.changes || null,
                    manual: Boolean(movement.manual),
                    optimization: Boolean(movement.optimization),
                    optimizationOptions: movement.optimizationOptions || null,
                    requests: movement.requests || [],
                    reversal: Boolean(movement.reversal),
                    reversalOf: movement.reversalOf || null,
                    reversalMode: movement.reversalMode || null,
                    metadataEdit: Boolean(movement.metadataEdit),
                    editedUnitId: movement.editedUnitId || null,
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
    const meta = loadRevision();
    const database = getSqliteDatabase();
    return {
        ...meta,
        occupiedSlots: Number(database.exec(`SELECT COUNT(*) FROM ${OCCUPANCIES_TABLE}`)?.[0]?.values?.[0]?.[0]) || 0,
        movementsTotal: Number(database.exec(`SELECT COUNT(*) FROM ${MOVEMENTS_TABLE}`)?.[0]?.values?.[0]?.[0]) || 0,
        unloadZoneUnits: Number(database.exec(`SELECT COUNT(*) FROM ${UNLOAD_ZONE_TABLE}`)?.[0]?.values?.[0]?.[0]) || 0,
    };
}
