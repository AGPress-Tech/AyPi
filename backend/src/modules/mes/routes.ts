import type { Router } from "../../shared/http/router";
import { getRequestId, getRequestUser } from "../../shared/http/context";
import { badRequest } from "../../shared/http/errors";
import { readJsonBody } from "../../shared/http/request";
import { sendJson } from "../../shared/http/response";
import {
    getMesEventSummary,
    getMesImports,
    getMesMachineEvents,
    importPlcCsv,
} from "./service";

function requiredText(value: unknown, label: string, maxLength: number) {
    const normalized = String(value || "").trim();
    if (!normalized || normalized.length > maxLength) {
        throw badRequest(`${label} non valido.`);
    }
    return normalized;
}

function optionalIsoDate(value: string | null, label: string) {
    if (!value) return undefined;
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) throw badRequest(`${label} non valida.`);
    return new Date(timestamp).toISOString();
}

export function registerMesRoutes(router: Router) {
    router.register("POST", "/api/mes/imports/plc-csv", async (req, res) => {
        const body: any = (await readJsonBody(req)) || {};
        const csv = typeof body.csv === "string" ? body.csv : "";
        if (!csv || Buffer.byteLength(csv, "utf8") > 8 * 1024 * 1024) {
            throw badRequest("Contenuto CSV mancante o superiore a 8 MB.");
        }
        const result = await importPlcCsv({
            sourceSessionId: requiredText(body.sourceSessionId, "Sessione sorgente", 240),
            sourceFile: requiredText(body.sourceFile, "Nome file sorgente", 500),
            csv,
            firstDataRow: Number.isInteger(Number(body.firstDataRow))
                ? Math.max(2, Number(body.firstDataRow))
                : 2,
        }, {
            actor: getRequestUser(req),
            requestId: getRequestId(req),
        });
        sendJson(res, 200, result);
    });

    router.register("GET", "/api/mes/events", async (req, res) => {
        const url = new URL(req.url || "/", "http://localhost");
        const limit = Math.max(1, Math.min(1000, Number(url.searchParams.get("limit")) || 100));
        const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
        sendJson(res, 200, getMesMachineEvents({
            machineId: String(url.searchParams.get("machineId") || "").trim() || undefined,
            from: optionalIsoDate(url.searchParams.get("from"), "Data iniziale"),
            to: optionalIsoDate(url.searchParams.get("to"), "Data finale"),
            limit,
            offset,
        }));
    });

    router.register("GET", "/api/mes/events/summary", async (_req, res) => {
        sendJson(res, 200, getMesEventSummary());
    });

    router.register("GET", "/api/mes/imports", async (req, res) => {
        const url = new URL(req.url || "/", "http://localhost");
        const limit = Math.max(1, Math.min(200, Number(url.searchParams.get("limit")) || 50));
        sendJson(res, 200, getMesImports(limit));
    });
}

