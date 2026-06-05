import type { Router } from "../../shared/http/router";
import { sendJson } from "../../shared/http/response";
import { readJsonBody } from "../../shared/http/request";
import {
    listAdminNames,
    loadAdminCredentials,
    loadAssigneeOptions,
    saveAdminCredentials,
    saveAssigneeOptions,
    verifyAdminPassword,
} from "./repository";

export function registerSharedRoutes(router: Router) {
    router.register("GET", "/api/shared/admins", async (_req, res) => {
        sendJson(res, 200, { admins: loadAdminCredentials() });
    });

    router.register("PUT", "/api/shared/admins", async (req, res) => {
        const payload =
            (await readJsonBody<{ admins?: any[] }>(req)) || {};
        await saveAdminCredentials(Array.isArray(payload.admins) ? payload.admins : []);
        sendJson(res, 200, { ok: true, admins: loadAdminCredentials() });
    });

    router.register("GET", "/api/shared/admins/names", async (_req, res) => {
        sendJson(res, 200, { admins: listAdminNames() });
    });

    router.register("POST", "/api/shared/admins/verify", async (req, res) => {
        const payload =
            (await readJsonBody<{ password?: string; targetName?: string | null }>(req)) ||
            {};
        const admin = await verifyAdminPassword(
            String(payload.password || ""),
            payload.targetName || null,
        );
        if (!admin) {
            sendJson(res, 401, { ok: false });
            return;
        }
        sendJson(res, 200, {
            ok: true,
            admin: {
                name: admin.name,
                email: admin.email || "",
                phone: admin.phone || "",
                accessCalendar:
                    typeof admin.accessCalendar === "boolean"
                        ? admin.accessCalendar
                        : true,
                accessPurchasing:
                    typeof admin.accessPurchasing === "boolean"
                        ? admin.accessPurchasing
                        : true,
            },
        });
    });

    router.register("GET", "/api/shared/assignees", async (_req, res) => {
        sendJson(res, 200, loadAssigneeOptions());
    });

    router.register("PUT", "/api/shared/assignees", async (req, res) => {
        const payload =
            (await readJsonBody<{ groups?: Record<string, string[]>; emails?: Record<string, string> }>(req)) ||
            {};
        await saveAssigneeOptions(payload);
        sendJson(res, 200, {
            ok: true,
            data: loadAssigneeOptions(),
        });
    });
}
