import type { Router } from "./router";
import { readJsonBody } from "./request";
import { sendJson } from "./response";
import { appendUpload, cleanExpiredUploads, createUpload, finishUpload, removeUpload } from "../storage/upload-store";

export function registerUploadRoutes(router: Router) {
    cleanExpiredUploads();
    router.register("POST", "/api/uploads", async (_req, res) => {
        cleanExpiredUploads();
        sendJson(res, 200, { token: createUpload() });
    });
    router.register("PUT", "/api/uploads/:token", async (req, res, params) => {
        const body = await readJsonBody<any>(req);
        sendJson(res, 200, { size: appendUpload(params.token, body?.offset, body?.data) });
    });
    router.register("POST", "/api/uploads/:token/complete", async (req, res, params) => {
        const body = await readJsonBody<any>(req);
        sendJson(res, 200, { reference: finishUpload(params.token, body?.size) });
    });
    router.register("DELETE", "/api/uploads/:token", async (_req, res, params) => {
        removeUpload(params.token);
        sendJson(res, 200, { ok: true });
    });
}
