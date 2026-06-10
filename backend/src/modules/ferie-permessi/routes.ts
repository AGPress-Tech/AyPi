import type { Router } from "../../shared/http/router";
import { getRequestId, getRequestUser } from "../../shared/http/context";
import { readJsonBody } from "../../shared/http/request";
import { sendJson } from "../../shared/http/response";
import {
    approveRequest,
    createFeriePermessiBackup,
    createClosure,
    createHolidays,
    createRequest,
    deleteClosure,
    deleteHoliday,
    deleteRequest,
    getPayload,
    listFeriePermessiBackups,
    rejectRequest,
    replacePayload,
    restoreFeriePermessiBackup,
    updateClosure,
    updateHoliday,
    updateRequest,
} from "./service";
import type { ClosureEntry, FpPayload, RequestLike } from "./types";

export function registerFeriePermessiRoutes(router: Router) {
    router.register("GET", "/api/ferie-permessi/backups", async (_req, res) => {
        sendJson(res, 200, { items: listFeriePermessiBackups() });
    });

    router.register("POST", "/api/ferie-permessi/backups", async (req, res) => {
        const payload =
            (await readJsonBody<{ mode?: "calendar" | "full" }>(req)) || {};
        sendJson(
            res,
            201,
            createFeriePermessiBackup(payload.mode === "calendar" ? "calendar" : "full"),
        );
    });

    router.register(
        "POST",
        "/api/ferie-permessi/backups/:name/restore",
        async (req, res, params) => {
            const payload =
                (await readJsonBody<{ mode?: "calendar" | "full" }>(req)) || {};
            sendJson(
                res,
                200,
                restoreFeriePermessiBackup(
                    params.name,
                    payload.mode === "full" ? "full" : "calendar",
                ),
            );
        },
    );

    router.register("GET", "/api/ferie-permessi/payload", async (req, res) => {
        sendJson(
            res,
            200,
            await getPayload({
                actor: getRequestUser(req),
                requestId: getRequestId(req),
            }),
        );
    });

    router.register("POST", "/api/ferie-permessi/requests", async (req, res) => {
        const payload = (await readJsonBody<RequestLike>(req)) || {};
        sendJson(
            res,
            201,
            await createRequest(payload, {
                actor: getRequestUser(req),
                requestId: getRequestId(req),
            }),
        );
    });

    router.register(
        "PUT",
        "/api/ferie-permessi/requests/:id",
        async (req, res, params) => {
            const payload = (await readJsonBody<RequestLike>(req)) || {};
            const item = await updateRequest(params.id, payload, {
                actor: getRequestUser(req),
                requestId: getRequestId(req),
            });
            if (!item) {
                sendJson(res, 404, { error: "Request not found" });
                return;
            }
            sendJson(res, 200, item);
        },
    );

    router.register(
        "POST",
        "/api/ferie-permessi/requests/:id/approve",
        async (req, res, params) => {
            const payload =
                (await readJsonBody<{ actor?: string }>(req)) || {};
            const item = await approveRequest(params.id, {
                actor: payload.actor || getRequestUser(req),
                requestId: getRequestId(req),
            });
            if (!item) {
                sendJson(res, 404, { error: "Request not found" });
                return;
            }
            sendJson(res, 200, item);
        },
    );

    router.register(
        "POST",
        "/api/ferie-permessi/requests/:id/reject",
        async (req, res, params) => {
            const payload =
                (await readJsonBody<{ actor?: string }>(req)) || {};
            const item = await rejectRequest(params.id, {
                actor: payload.actor || getRequestUser(req),
                requestId: getRequestId(req),
            });
            if (!item) {
                sendJson(res, 404, { error: "Request not found" });
                return;
            }
            sendJson(res, 200, item);
        },
    );

    router.register(
        "DELETE",
        "/api/ferie-permessi/requests/:id",
        async (req, res, params) => {
            const payload =
                (await readJsonBody<{ actor?: string }>(req)) || {};
            const item = await deleteRequest(params.id, {
                actor: payload.actor || getRequestUser(req),
                requestId: getRequestId(req),
            });
            if (!item) {
                sendJson(res, 404, { error: "Request not found" });
                return;
            }
            sendJson(res, 200, item);
        },
    );

    router.register("PUT", "/api/ferie-permessi/payload", async (req, res) => {
        const payload = await readJsonBody<FpPayload>(req);
        if (!payload) {
            sendJson(res, 400, { error: "Missing payload" });
            return;
        }
        sendJson(
            res,
            200,
            await replacePayload(payload, {
                actor: getRequestUser(req),
                requestId: getRequestId(req),
            }),
        );
    });

    router.register("POST", "/api/ferie-permessi/holidays", async (req, res) => {
        const payload =
            (await readJsonBody<{ dates?: string[]; name?: string }>(req)) || {};
        const result = await createHolidays(
            Array.isArray(payload.dates) ? payload.dates : [],
            payload.name || "",
            {
                actor: getRequestUser(req),
                requestId: getRequestId(req),
            },
        );
        sendJson(res, 200, result);
    });

    router.register(
        "DELETE",
        "/api/ferie-permessi/holidays/:date",
        async (req, res, params) => {
            const result = await deleteHoliday(params.date, {
                actor: getRequestUser(req),
                requestId: getRequestId(req),
            });
            sendJson(res, 200, result);
        },
    );

    router.register(
        "PUT",
        "/api/ferie-permessi/holidays/:date",
        async (req, res, params) => {
            const payload =
                (await readJsonBody<{ nextDate?: string; nextName?: string }>(req)) ||
                {};
            const result = await updateHoliday(
                params.date,
                payload.nextDate || "",
                payload.nextName || "",
                {
                    actor: getRequestUser(req),
                    requestId: getRequestId(req),
                },
            );
            sendJson(res, 200, result);
        },
    );

    router.register("POST", "/api/ferie-permessi/closures", async (req, res) => {
        const payload = (await readJsonBody<ClosureEntry>(req)) || ({} as ClosureEntry);
        const result = await createClosure(payload, {
            actor: getRequestUser(req),
            requestId: getRequestId(req),
        });
        sendJson(res, 200, result);
    });

    router.register(
        "DELETE",
        "/api/ferie-permessi/closures",
        async (req, res) => {
            const payload = (await readJsonBody<ClosureEntry>(req)) || ({} as ClosureEntry);
            const result = await deleteClosure(payload, {
                actor: getRequestUser(req),
                requestId: getRequestId(req),
            });
            sendJson(res, 200, result);
        },
    );

    router.register(
        "PUT",
        "/api/ferie-permessi/closures",
        async (req, res) => {
            const payload =
                (await readJsonBody<{ entry?: ClosureEntry; next?: ClosureEntry }>(req)) ||
                {};
            const result = await updateClosure(
                payload.entry || ({} as ClosureEntry),
                payload.next || ({} as ClosureEntry),
                {
                    actor: getRequestUser(req),
                    requestId: getRequestId(req),
                },
            );
            sendJson(res, 200, result);
        },
    );
}
