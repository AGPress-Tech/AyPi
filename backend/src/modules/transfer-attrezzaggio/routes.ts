import type { Router } from "../../shared/http/router";
import { readJsonBody } from "../../shared/http/request";
import { sendJson } from "../../shared/http/response";
import {
    deleteTransferItem,
    listTransferItems,
    loadTransferItem,
    saveTransferItem,
} from "./repository";

export function registerTransferAttrezzaggioRoutes(router: Router) {
    router.register("GET", "/api/transfer-attrezzaggio/items", async (_req, res) => {
        sendJson(res, 200, { items: listTransferItems() });
    });

    router.register("GET", "/api/transfer-attrezzaggio/items/:code", async (_req, res, params) => {
        const item = loadTransferItem(params.code);
        if (!item) {
            sendJson(res, 404, { error: "Not found" });
            return;
        }
        sendJson(res, 200, { item });
    });

    router.register("PUT", "/api/transfer-attrezzaggio/items/:code", async (req, res, params) => {
        const payload = (await readJsonBody<any>(req)) || {};
        sendJson(
            res,
            200,
            {
                item: saveTransferItem({
                    ...payload,
                    code: params.code,
                }),
            },
        );
    });

    router.register("DELETE", "/api/transfer-attrezzaggio/items/:code", async (_req, res, params) => {
        const ok = deleteTransferItem(params.code);
        sendJson(res, ok ? 200 : 404, { ok });
    });
}
