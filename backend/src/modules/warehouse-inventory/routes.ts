import type { Router } from "../../shared/http/router";
import { backendConfig } from "../../config";
import { getRequestActor, getRequestId, getRequestRole, getRequestUser } from "../../shared/http/context";
import { badRequest, forbidden, notFound, unauthorized } from "../../shared/http/errors";
import { getAdminNames, getAssignees } from "../shared/service";
import { readJsonBody } from "../../shared/http/request";
import { sendJson } from "../../shared/http/response";
import {
    getWarehouseSnapshot,
    getWarehouseCapabilities,
    getWarehouseMovements,
    getWarehouseMovement,
    getWarehouseConfiguration,
    saveWarehouseServerConfiguration,
    getWarehouseDatabasePreferences,
    saveWarehouseUserDatabasePreferences,
    getWarehouseViewPreferences,
    saveWarehouseState,
    saveWarehouseUserViewPreferences,
} from "./service";

type WarehousePrincipal = { role: "admin" | "employee" | "test"; actor: string; ownerKey: string };

function normalizeIdentity(value: unknown) {
    return String(value || "").trim().toLocaleLowerCase("it");
}

function getWarehousePrincipal(req: any, allowGuest = false): WarehousePrincipal | null {
    const role = getRequestRole(req);
    const actor = getRequestActor(req);
    const normalizedActor = normalizeIdentity(actor);
    if (role === "admin" && getAdminNames().some((name) => normalizeIdentity(name) === normalizedActor)) {
        return { role: "admin", actor, ownerKey: `admin:${normalizedActor}` };
    }
    if (role === "employee") {
        const assignees = getAssignees() as any;
        const names = Object.values(assignees?.groups || {}).flat().map(normalizeIdentity);
        if (names.includes(normalizedActor)) return { role: "employee", actor, ownerKey: `employee:${normalizedActor}` };
    }
    if (role === "test" && backendConfig.profile === "dev") {
        return { role: "test", actor: actor || "Operatore test", ownerKey: "test:operatore-test" };
    }
    if (allowGuest) return null;
    throw unauthorized("Sessione magazzino non valida o scaduta.");
}

function requireWarehouseAdmin(req: any) {
    const principal = getWarehousePrincipal(req);
    if (principal?.role !== "admin" && principal?.role !== "test") throw forbidden("Operazione riservata agli amministratori.");
    return principal;
}

function requireWarehouseTestAdmin(req: any) {
    const principal = requireWarehouseAdmin(req);
    if (principal.role !== "test" && normalizeIdentity(principal.actor) !== "ayrton pizzi") throw forbidden("Strumenti test riservati ad Ayrton Pizzi.");
    return principal;
}

function assertPreferenceOwner(principal: WarehousePrincipal, ownerKey: string) {
    const normalized = normalizeIdentity(ownerKey);
    const actor = normalizeIdentity(principal.actor);
    const valid = principal.role === "test"
        ? normalized === "test:operatore-test"
        : normalized.startsWith(`${principal.role}:`) && normalized.endsWith(`:${actor}`);
    if (!valid) throw forbidden("Non puoi accedere alle preferenze di un altro operatore.");
}

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
        if (!movement || !movement.id || !movement.timestamp || !["load", "unload", "exit"].includes(movement.type) || !Array.isArray(movement.lines)) {
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
        replaceMovements: Boolean(value.replaceMovements),
    };
}

function validateConfigurationPayload(value: any) {
    if (!value || !Array.isArray(value.rows) || !Array.isArray(value.rowRestrictions) || !Array.isArray(value.slotRestrictions)) throw badRequest("Configurazione magazzino non valida.");
    const rows = value.rows.map((row: any) => ({ code: String(row?.code || "").trim().toUpperCase(), capacity: Number(row?.capacity), invertedSides: Boolean(row?.invertedSides) }));
    if (!rows.length || rows.length > 26 || rows.some((row: any) => !/^[A-Z]$/.test(row.code) || !Number.isInteger(row.capacity) || row.capacity < 6 || row.capacity > 600 || row.capacity % 6)) throw badRequest("File o capacità del magazzino non valide.");
    const normalizeRules = (rules: any[]): Array<{ key: string; whitelist: string[]; blacklist: string[] }> => rules.map((rule) => ({ key: String(rule?.key || "").trim().toUpperCase(), whitelist: Array.from(new Set<string>((rule?.whitelist || []).map((item: any) => String(item).trim().toUpperCase()).filter(Boolean))), blacklist: Array.from(new Set<string>((rule?.blacklist || []).map((item: any) => String(item).trim().toUpperCase()).filter(Boolean))) }));
    return { rows, rowRestrictions: normalizeRules(value.rowRestrictions), slotRestrictions: normalizeRules(value.slotRestrictions) };
}

export function registerWarehouseInventoryRoutes(router: Router) {
    router.register("GET", "/api/warehouse-inventory/capabilities", async (req, res) => {
        getWarehousePrincipal(req);
        sendJson(res, 200, getWarehouseCapabilities());
    });

    router.register("GET", "/api/warehouse-inventory/state", async (_req, res) => {
        sendJson(res, 200, getWarehouseSnapshot());
    });

    router.register("GET", "/api/warehouse-inventory/movements", async (req, res) => {
        getWarehousePrincipal(req);
        const url = new URL(req.url || "/", "http://localhost");
        sendJson(res, 200, getWarehouseMovements({ limit: Number(url.searchParams.get("limit")) || 100, offset: Number(url.searchParams.get("offset")) || 0, from: url.searchParams.get("from") || undefined }));
    });

    router.register("GET", "/api/warehouse-inventory/movements/:id", async (req, res, params) => {
        getWarehousePrincipal(req);
        const movement = getWarehouseMovement(params.id);
        if (!movement) throw notFound("Movimento non trovato.");
        sendJson(res, 200, movement);
    });

    router.register("PUT", "/api/warehouse-inventory/state", async (req, res) => {
        const principal = getWarehousePrincipal(req);
        const payload = validateStatePayload(await readJsonBody(req));
        if (payload.replaceMovements) requireWarehouseTestAdmin(req);
        sendJson(res, 200, await saveWarehouseState(payload, {
            actor: principal?.actor || getRequestUser(req),
            requestId: getRequestId(req),
        }));
    });

    router.register("GET", "/api/warehouse-inventory/view-preferences", async (req, res) => {
        const requestUrl = new URL(req.url || "/", "http://localhost");
        const owner = validatePreferenceOwner(requestUrl.searchParams.get("owner"));
        assertPreferenceOwner(getWarehousePrincipal(req)!, owner);
        sendJson(res, 200, getWarehouseViewPreferences(owner));
    });

    router.register("PUT", "/api/warehouse-inventory/view-preferences", async (req, res) => {
        const payload = validateViewPreferencesPayload(await readJsonBody(req));
        assertPreferenceOwner(getWarehousePrincipal(req)!, payload.ownerKey);
        sendJson(res, 200, await saveWarehouseUserViewPreferences(payload, {
            actor: getRequestUser(req),
            requestId: getRequestId(req),
        }));
    });

    router.register("GET", "/api/warehouse-inventory/configuration", async (req, res) => {
        getWarehousePrincipal(req);
        sendJson(res, 200, getWarehouseConfiguration());
    });

    router.register("PUT", "/api/warehouse-inventory/configuration", async (req, res) => {
        const principal = requireWarehouseAdmin(req);
        sendJson(res, 200, await saveWarehouseServerConfiguration(validateConfigurationPayload(await readJsonBody(req)), { actor: principal.actor, requestId: getRequestId(req) }));
    });

    router.register("GET", "/api/warehouse-inventory/database-preferences", async (req, res) => {
        const principal = getWarehousePrincipal(req)!;
        const owner = validatePreferenceOwner(new URL(req.url || "/", "http://localhost").searchParams.get("owner"));
        assertPreferenceOwner(principal, owner);
        sendJson(res, 200, getWarehouseDatabasePreferences(owner));
    });

    router.register("PUT", "/api/warehouse-inventory/database-preferences", async (req, res) => {
        const principal = getWarehousePrincipal(req)!;
        const value: any = await readJsonBody(req);
        const ownerKey = validatePreferenceOwner(value?.ownerKey);
        assertPreferenceOwner(principal, ownerKey);
        if (!Array.isArray(value.visibleColumns) || !Array.isArray(value.presets) || value.visibleColumns.length > 30 || value.presets.length > 20) throw badRequest("Preferenze colonne non valide.");
        sendJson(res, 200, await saveWarehouseUserDatabasePreferences({ ownerKey, ownerLabel: String(value.ownerLabel || "").slice(0, 120), visibleColumns: value.visibleColumns.map(String), presets: value.presets }, { actor: principal.actor, requestId: getRequestId(req) }));
    });
}
