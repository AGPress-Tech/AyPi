import { createHash, timingSafeEqual } from "crypto";
import type { Router } from "../../shared/http/router";
import { readJsonBody } from "../../shared/http/request";
import { sendJson } from "../../shared/http/response";
import { unauthorized } from "../../shared/http/errors";
import { getRequestUser } from "../../shared/http/context";
import { backupCatalog, previewRestore, executeRestore, createManualBackup } from "./service";

export function registerBackupRoutes(router: Router) {
    const auth = (req: import("http").IncomingMessage) => {
        const hash = (value: string) => createHash("sha256").update(value).digest();
        const password = req.headers["x-aypi-backup-password"];
        if (typeof password !== "string" || !timingSafeEqual(hash(password), hash(process.env.AYPI_BACKUP_ADMIN_PASSWORD || "AGPress"))) throw unauthorized("Backups riservati alla modalità F2 + password amministratore.");
    };
    router.register("GET", "/api/backups", async (req, res) => { auth(req); sendJson(res, 200, backupCatalog()); });
    router.register("POST", "/api/backups", async (req, res) => { auth(req); sendJson(res, 201, await createManualBackup()); });
    router.register("POST", "/api/backups/preview", async (req, res) => { auth(req); sendJson(res, 200, previewRestore(await readJsonBody(req))); });
    router.register("POST", "/api/backups/restore", async (req, res) => { auth(req); sendJson(res, 200, await executeRestore(await readJsonBody(req), getRequestUser(req))); });
}
