import type { Router } from "../../shared/http/router";
import { getRequestId, getRequestUser } from "../../shared/http/context";
import { readJsonBody } from "../../shared/http/request";
import { notFound } from "../../shared/http/errors";
import { sendJson } from "../../shared/http/response";
import { createSchemaValidator } from "../../shared/http/validation";
import {
    getTransferItem,
    getTransferItems,
    removeTransfer,
    saveTransfer,
} from "./service";

const validateTransferPayload = createSchemaValidator<any>({
    type: "object",
    additionalProperties: true,
    properties: {
        code: { type: "string", nullable: true },
        codiceArticolo: { type: "string", nullable: true },
        fase: { type: "string", nullable: true },
        codiceMacchina: { type: "string", nullable: true },
        metodoVariante: { type: "string", nullable: true },
        lavorazione: { type: "string", nullable: true },
        cicloLavorazione: { type: "string", nullable: true },
        note: { type: "string", nullable: true },
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
}
