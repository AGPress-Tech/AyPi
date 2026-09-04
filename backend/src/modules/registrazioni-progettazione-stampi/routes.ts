import fs from "fs";
import path from "path";
import type { Router } from "../../shared/http/router";
import { getRequestId, getRequestUser } from "../../shared/http/context";
import { notFound } from "../../shared/http/errors";
import { readJsonBody } from "../../shared/http/request";
import { sendJson } from "../../shared/http/response";
import {
    getRegistrazioneStampi,
    getRegistrazioniStampi,
    getRegistrazioneStampiAttachmentPath,
    removeRegistrazioneStampiItem,
    saveRegistrazioneStampiItem,
} from "./service";

function contentType(filePath: string) {
    const extension = path.extname(filePath).toLowerCase();
    const types: Record<string, string> = {
        ".pdf": "application/pdf",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".doc": "application/msword",
        ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".xls": "application/vnd.ms-excel",
        ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    };
    return types[extension] || "application/octet-stream";
}

export function registerRegistrazioniProgettazioneStampiRoutes(router: Router) {
    const base = "/api/registrazioni-progettazione-stampi";
    router.register("GET", `${base}/items`, async (_req, res) => {
        sendJson(res, 200, { items: getRegistrazioniStampi() });
    });
    router.register("GET", `${base}/items/:code`, async (_req, res, params) => {
        const item = getRegistrazioneStampi(params.code);
        if (!item) throw notFound("Registrazione progettazione stampi non trovata");
        sendJson(res, 200, { item });
    });
    router.register("PUT", `${base}/items/:code`, async (req, res, params) => {
        const payload = await readJsonBody(req);
        const item = await saveRegistrazioneStampiItem(params.code, payload, {
            actor: getRequestUser(req),
            requestId: getRequestId(req),
        });
        sendJson(res, 200, { item });
    });
    router.register("DELETE", `${base}/items/:code`, async (req, res, params) => {
        const removed = await removeRegistrazioneStampiItem(params.code, {
            actor: getRequestUser(req),
            requestId: getRequestId(req),
        });
        if (!removed) throw notFound("Registrazione progettazione stampi non trovata");
        sendJson(res, 200, { ok: true });
    });
    router.register("GET", `${base}/attachments/:storedName`, async (_req, res, params) => {
        const filePath = getRegistrazioneStampiAttachmentPath(params.storedName);
        if (!fs.existsSync(filePath)) throw notFound("Allegato non trovato");
        res.writeHead(200, {
            "Content-Type": contentType(filePath),
            "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(path.basename(filePath))}`,
            "Cache-Control": "private, max-age=60",
        });
        fs.createReadStream(filePath).pipe(res);
    });
}
