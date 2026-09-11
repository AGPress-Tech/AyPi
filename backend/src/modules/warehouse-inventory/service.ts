import type { ActionContext } from "../../shared/logging/audit";
import { buildContext } from "../../shared/logging/audit";
import { logger } from "../../shared/logging/logger";
import { createOperationQueue } from "../../shared/ops/queue";
import {
    loadWarehouseSnapshot,
    saveWarehouseSnapshot,
    type WarehouseInventoryItem,
    type WarehouseMovement,
} from "./repository";

const enqueue = createOperationQueue("warehouse-inventory");

export function getWarehouseSnapshot() {
    return loadWarehouseSnapshot();
}

export function saveWarehouseState(
    payload: {
        inventory: WarehouseInventoryItem[];
        movements: WarehouseMovement[];
        baseRevision: number;
    },
    context?: ActionContext,
) {
    const meta = buildContext(context);
    return enqueue("saveState", () => {
        const snapshot = saveWarehouseSnapshot(
            payload.inventory,
            payload.movements,
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
        });
        return snapshot;
    });
}
