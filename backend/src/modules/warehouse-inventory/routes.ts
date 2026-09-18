import type { Router } from "../../shared/http/router";
import { getRequestId, getRequestUser } from "../../shared/http/context";
import { badRequest } from "../../shared/http/errors";
import { readJsonBody } from "../../shared/http/request";
import { sendJson } from "../../shared/http/response";
import {
    getWarehouseSnapshot,
    getWarehouseViewPreferences,
    saveWarehouseState,
    saveWarehouseUserViewPreferences,
} from "./service";

function validatePreferenceOwner(value: unknown) {
    const ownerKey = String(value || "").trim();
    if (!ownerKey || ownerKey.length > 240 || !/^(admin|employee|test):/i.test(ownerKey)) {
        throw badRequest("Account delle preferenze 3D non valido.");
    }
    return ownerKey;
}

function validateViewPreferencesPayload(value: any) {
    const ownerKey = validatePreferenceOwner(value?.ownerKey);
    const ownerLabel = String(value?.ownerLabel || "").trim().slice(0, 120);
    if (!Array.isArray(value?.cameraViews) || !Array.isArray(value?.viewPresets)
        || value.cameraViews.length > 30 || value.viewPresets.length > 20) {
        throw badRequest("Preferenze della visualizzazione 3D non valide.");
    }
    return { ownerKey, ownerLabel, cameraViews: value.cameraViews, viewPresets: value.viewPresets };
}

function validateStatePayload(value: any) {
    if (!value || !Array.isArray(value.inventory) || !Array.isArray(value.movements) || !Array.isArray(value.unloadZone)) {
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
    value.unloadZone.forEach((item: any) => {
        if (!item || !item.id || !item.article || !["crate", "pallet"].includes(item.type)
            || !Array.isArray(item.originalLocations)) {
            throw badRequest("Unità in zona scarico non valida.");
        }
    });
    return {
        inventory: value.inventory,
        movements: value.movements,
        unloadZone: value.unloadZone,
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

    router.register("GET", "/api/warehouse-inventory/view-preferences", async (req, res) => {
        const requestUrl = new URL(req.url || "/", "http://localhost");
        sendJson(res, 200, getWarehouseViewPreferences(validatePreferenceOwner(requestUrl.searchParams.get("owner"))));
    });

    router.register("PUT", "/api/warehouse-inventory/view-preferences", async (req, res) => {
        const payload = validateViewPreferencesPayload(await readJsonBody(req));
        sendJson(res, 200, await saveWarehouseUserViewPreferences(payload, {
            actor: getRequestUser(req),
            requestId: getRequestId(req),
        }));
    });
}
