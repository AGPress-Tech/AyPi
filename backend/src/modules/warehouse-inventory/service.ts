import type { ActionContext } from "../../shared/logging/audit";
import { buildContext } from "../../shared/logging/audit";
import { logger } from "../../shared/logging/logger";
import { createOperationQueue } from "../../shared/ops/queue";
import {
    loadWarehouseSnapshot,
    loadWarehouseViewPreferences,
    saveWarehouseSnapshot,
    saveWarehouseViewPreferences,
    type WarehouseInventoryItem,
    type WarehouseMovement,
    type WarehouseUnloadZoneItem,
} from "./repository";

const enqueue = createOperationQueue("warehouse-inventory");

export function getWarehouseSnapshot() {
    return loadWarehouseSnapshot();
}

export function saveWarehouseState(
    payload: {
        inventory: WarehouseInventoryItem[];
        movements: WarehouseMovement[];
        unloadZone: WarehouseUnloadZoneItem[];
        baseRevision: number;
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
        );
        logger.info("Warehouse inventory saved", {
            ...meta,
            event: "warehouse_inventory_saved",
            module: "warehouse",
            category: "data",
            revision: snapshot.revision,
            occupiedSlots: snapshot.inventory.length,
            movements: snapshot.movements.length,
            unloadZoneUnits: snapshot.unloadZone.length,
        });
        return snapshot;
    });
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
