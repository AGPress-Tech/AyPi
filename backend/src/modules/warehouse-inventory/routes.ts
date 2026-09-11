import type { Router } from "../../shared/http/router";
import { getRequestId, getRequestUser } from "../../shared/http/context";
import { badRequest } from "../../shared/http/errors";
import { readJsonBody } from "../../shared/http/request";
import { sendJson } from "../../shared/http/response";
import { getWarehouseSnapshot, saveWarehouseState } from "./service";

function validateStatePayload(value: any) {
    if (!value || !Array.isArray(value.inventory) || !Array.isArray(value.movements)) {
        throw badRequest("Stato magazzino non valido.");
    }
    const baseRevision = Number(value.baseRevision);
    if (!Number.isInteger(baseRevision) || baseRevision < 0) {
        throw badRequest("Revisione magazzino non valida.");
    }
    value.inventory.forEach((item: any) => {
        if (!item || !item.id || !item.location || !item.article || !["crate", "pallet"].includes(item.type)) {
            throw badRequest("Unità di magazzino non valida.");
        }
    });
    value.movements.forEach((movement: any) => {
        if (!movement || !movement.id || !movement.timestamp || !["load", "unload"].includes(movement.type) || !Array.isArray(movement.lines)) {
            throw badRequest("Movimento di magazzino non valido.");
        }
    });
    return {
        inventory: value.inventory,
        movements: value.movements,
        baseRevision,
    };
}

export function registerWarehouseInventoryRoutes(router: Router) {
    router.register("GET", "/api/warehouse-inventory/state", async (_req, res) => {
        sendJson(res, 200, getWarehouseSnapshot());
    });

    router.register("PUT", "/api/warehouse-inventory/state", async (req, res) => {
        const payload = validateStatePayload(await readJsonBody(req));
        sendJson(res, 200, await saveWarehouseState(payload, {
            actor: getRequestUser(req),
            requestId: getRequestId(req),
        }));
    });
}
