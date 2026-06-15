import type { Router } from "../../shared/http/router";
import { getRequestId, getRequestUser } from "../../shared/http/context";
import { readJsonBody } from "../../shared/http/request";
import { notFound } from "../../shared/http/errors";
import { sendJson } from "../../shared/http/response";
import { createSchemaValidator } from "../../shared/http/validation";
import fs from "fs";
import path from "path";
import {
    getTransferItem,
    getTransferItems,
    getTransferAttachmentPath,
    removeTransfer,
    saveTransfer,
} from "./service";

function getImageContentType(filePath: string) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
    if (ext === ".webp") return "image/webp";
    if (ext === ".gif") return "image/gif";
    return "image/png";
}

const validateTransferPayload = createSchemaValidator<any>({
    type: "object",
    additionalProperties: true,
    properties: {
        code: { type: "string", nullable: true },
        previousCode: { type: "string", nullable: true },
        codiceArticolo: { type: "string", nullable: true },
        fase: { type: "string", nullable: true },
        codiceMacchina: { type: "string", nullable: true },
        metodoVariante: { type: "string", nullable: true },
        lavorazione: { type: "string", nullable: true },
        cicloLavorazione: { type: "string", nullable: true },
        spessori: { type: "string", nullable: true },
        vitiRondelle: { type: "string", nullable: true },
        spine: { type: "string", nullable: true },
        programmaRobot: { type: "string", nullable: true },
        mani: { type: "string", nullable: true },
        morsetti: { type: "string", nullable: true },
        note: { type: "string", nullable: true },
        attachments: {
            type: "array",
            nullable: true,
            items: {
                type: "object",
                additionalProperties: true,
                properties: {
                    id: { type: "string", nullable: true },
                    originalName: { type: "string", nullable: true },
                    storedName: { type: "string", nullable: true },
                    mimeType: { type: "string", nullable: true },
                    size: { type: "number", nullable: true },
                    createdAt: { type: "string", nullable: true },
                },
            },
        },
        newAttachments: {
            type: "array",
            nullable: true,
            items: {
                type: "object",
                additionalProperties: true,
                properties: {
                    fileName: { type: "string", nullable: true },
                    dataBase64: { type: "string", nullable: true },
                    mimeType: { type: "string", nullable: true },
                    size: { type: "number", nullable: true },
                },
            },
        },
        utensili: {
            type: "array",
            nullable: true,
            items: {
                type: "object",
                additionalProperties: true,
            },
        },
    },
});

export function registerTransferAttrezzaggioRoutes(router: Router) {
    router.register("GET", "/api/transfer-attrezzaggio/items", async (_req, res) => {
        sendJson(res, 200, { items: getTransferItems() });
    });

    router.register("GET", "/api/transfer-attrezzaggio/items/:code", async (_req, res, params) => {
        const item = getTransferItem(params.code);
        if (!item) {
            throw notFound("Transfer item not found");
        }
        sendJson(res, 200, { item });
    });

    router.register("PUT", "/api/transfer-attrezzaggio/items/:code", async (req, res, params) => {
        const payload = validateTransferPayload(
            await readJsonBody(req),
            "Invalid transfer item payload",
        );
        sendJson(
            res,
            200,
            {
                item: await saveTransfer(params.code, payload, {
                    actor: getRequestUser(req),
                    requestId: getRequestId(req),
                }),
            },
        );
    });

    router.register("DELETE", "/api/transfer-attrezzaggio/items/:code", async (req, res, params) => {
        const ok = await removeTransfer(params.code, {
            actor: getRequestUser(req),
            requestId: getRequestId(req),
        });
        if (!ok) {
            throw notFound("Transfer item not found");
        }
        sendJson(res, 200, { ok: true });
    });

    router.register(
        "GET",
        "/api/transfer-attrezzaggio/attachments/:storedName",
        async (_req, res, params) => {
            const filePath = getTransferAttachmentPath(params.storedName);
            if (!fs.existsSync(filePath)) {
                throw notFound("Transfer attachment not found");
            }
            res.writeHead(200, {
                "Content-Type": getImageContentType(filePath),
                "Cache-Control": "public, max-age=60",
            });
            fs.createReadStream(filePath).pipe(res);
        },
    );
}
