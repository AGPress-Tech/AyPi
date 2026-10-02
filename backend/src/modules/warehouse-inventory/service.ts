import type { ActionContext } from "../../shared/logging/audit";
import { buildContext } from "../../shared/logging/audit";
import { logger } from "../../shared/logging/logger";
import { createOperationQueue } from "../../shared/ops/queue";
import { WAREHOUSE_FUTURE_CAPABILITIES } from "./future-capabilities";
import {
    loadWarehouseSnapshot,
    loadWarehouseMovements,
    loadWarehouseMovement,
    loadWarehouseConfiguration,
    saveWarehouseConfiguration,
    loadWarehouseDatabasePreferences,
    saveWarehouseDatabasePreferences,
    loadWarehouseViewPreferences,
    saveWarehouseSnapshot,
    saveWarehouseViewPreferences,
    type WarehouseInventoryItem,
    type WarehouseMovement,
    type WarehouseUnloadZoneItem,
} from "./repository";

const enqueue = createOperationQueue("warehouse-inventory");

export function getWarehouseCapabilities() {
    return WAREHOUSE_FUTURE_CAPABILITIES;
}

export function getWarehouseSnapshot() {
    return { ...loadWarehouseSnapshot(), configuration: loadWarehouseConfiguration() };
}

export function getWarehouseMovements(options: { limit: number; offset: number; from?: string }) {
    return loadWarehouseMovements(options);
}

export function getWarehouseMovement(movementId: string) {
    return loadWarehouseMovement(movementId);
}

export function saveWarehouseState(
    payload: {
        inventory: WarehouseInventoryItem[];
        movements: WarehouseMovement[];
        unloadZone: WarehouseUnloadZoneItem[];
        baseRevision: number;
        replaceMovements?: boolean;
    },
    context?: ActionContext,
) {
    const meta = buildContext(context);
    return enqueue("saveState", () => {
        const snapshot = saveWarehouseSnapshot(
            payload.inventory,
            payload.movements,
            payload.unloadZone,
            payload.baseRevision,
            meta.actor || "Operatore AyPi",
            Boolean(payload.replaceMovements),
        );
        logger.info("Warehouse inventory saved", {
            ...meta,
            event: "warehouse_inventory_saved",
            module: "warehouse",
            category: "data",
            revision: snapshot.revision,
            occupiedSlots: snapshot.occupiedSlots,
            movements: snapshot.movementsTotal,
            unloadZoneUnits: snapshot.unloadZoneUnits,
        });
        return snapshot;
    });
}

export function getWarehouseConfiguration() {
    return loadWarehouseConfiguration();
}

export function saveWarehouseServerConfiguration(payload: Parameters<typeof saveWarehouseConfiguration>[0], context?: ActionContext) {
    const meta = buildContext(context);
    return enqueue("saveConfiguration", () => {
        const result = saveWarehouseConfiguration(payload, meta.actor || "Amministratore AyPi");
        logger.info("Warehouse configuration saved", { ...meta, event: "warehouse_configuration_saved", module: "warehouse", category: "settings", rows: result.rows.length });
        return result;
    });
}

export function getWarehouseDatabasePreferences(ownerKey: string) {
    return loadWarehouseDatabasePreferences(ownerKey);
}

export function saveWarehouseUserDatabasePreferences(payload: { ownerKey: string; ownerLabel: string; visibleColumns: string[]; presets: unknown[] }, context?: ActionContext) {
    const meta = buildContext(context);
    return enqueue("saveDatabasePreferences", () => saveWarehouseDatabasePreferences(payload.ownerKey, payload.ownerLabel, payload.visibleColumns, payload.presets));
}

export function getWarehouseViewPreferences(ownerKey: string) {
    return loadWarehouseViewPreferences(ownerKey);
}

export function saveWarehouseUserViewPreferences(payload: {
    ownerKey: string;
    ownerLabel: string;
    cameraViews: unknown[];
    viewPresets: unknown[];
}, context?: ActionContext) {
    const meta = buildContext(context);
    return enqueue("saveViewPreferences", () => {
        const preferences = saveWarehouseViewPreferences(
            payload.ownerKey,
            payload.ownerLabel,
            payload.cameraViews,
            payload.viewPresets,
        );
        logger.info("Warehouse 3D preferences saved", {
            ...meta,
            event: "warehouse_view_preferences_saved",
            module: "warehouse",
            category: "settings",
            ownerKey: payload.ownerKey,
            cameraViews: payload.cameraViews.length,
            viewPresets: payload.viewPresets.length,
        });
        return preferences;
    });
}
