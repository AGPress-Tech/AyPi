import type { Router } from "../../shared/http/router";
import { getRequestId, getRequestUser } from "../../shared/http/context";
import { readJsonBody } from "../../shared/http/request";
import { badRequest, notFound } from "../../shared/http/errors";
import { sendJson } from "../../shared/http/response";
import { createSchemaValidator } from "../../shared/http/validation";
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

const validateBackupPayload = createSchemaValidator<{ mode?: "calendar" | "full" }>({
    type: "object",
    additionalProperties: false,
    properties: {
        mode: { type: "string", enum: ["calendar", "full"], nullable: true },
    },
});

const validateRequestPayload = createSchemaValidator<RequestLike>({
    type: "object",
    additionalProperties: true,
    properties: {
        id: { type: "string", nullable: true },
        department: { type: "string", nullable: true },
        type: { type: "string", nullable: true },
        note: { type: "string", nullable: true },
        status: { type: "string", nullable: true },
        start: { type: "string", nullable: true },
        end: { type: "string", nullable: true },
        allDay: { type: "boolean", nullable: true },
        createdAt: { type: "string", nullable: true },
        updatedAt: { type: "string", nullable: true },
        approvedAt: { type: "string", nullable: true },
        balanceHours: { type: "number", nullable: true },
        balanceAppliedAt: { type: "string", nullable: true },
        approvedBy: { type: "string", nullable: true },
        modifiedAt: { type: "string", nullable: true },
        modifiedBy: { type: "string", nullable: true },
        rejectedAt: { type: "string", nullable: true },
        rejectedBy: { type: "string", nullable: true },
        deletedAt: { type: "string", nullable: true },
        deletedBy: { type: "string", nullable: true },
        employee: {
            anyOf: [
                { type: "string" },
                {
                    type: "object",
                    additionalProperties: true,
                    properties: {
                        name: { type: "string", nullable: true },
                    },
                },
            ],
            nullable: true,
        },
    },
});

const validateActorPayload = createSchemaValidator<{ actor?: string }>({
    type: "object",
    additionalProperties: false,
    properties: {
        actor: { type: "string", nullable: true },
    },
});

const validateFpPayload = createSchemaValidator<FpPayload>({
    type: "object",
    required: ["requests", "balances", "holidays", "closures"],
    additionalProperties: false,
    properties: {
        requests: { type: "array", items: { type: "object", additionalProperties: true } },
        balances: { type: "object", additionalProperties: { type: "object", additionalProperties: true } },
        holidays: { type: "array", items: {} },
        closures: { type: "array", items: {} },
    },
});

const validateHolidaysPayload = createSchemaValidator<{ dates: string[]; name?: string }>({
    type: "object",
    required: ["dates"],
    additionalProperties: false,
    properties: {
        dates: { type: "array", items: { type: "string", minLength: 1 } },
        name: { type: "string", nullable: true },
    },
});

const validateHolidayUpdatePayload = createSchemaValidator<{ nextDate?: string; nextName?: string }>({
    type: "object",
    additionalProperties: false,
    properties: {
        nextDate: { type: "string", nullable: true },
        nextName: { type: "string", nullable: true },
    },
});

const validateClosurePayload = createSchemaValidator<ClosureEntry>({
    type: "object",
    required: ["start"],
    additionalProperties: false,
    properties: {
        start: { type: "string", minLength: 1 },
        end: { type: "string", nullable: true },
        name: { type: "string", nullable: true },
    },
});

const validateClosureUpdatePayload = createSchemaValidator<{ entry: ClosureEntry; next: ClosureEntry }>({
    type: "object",
    required: ["entry", "next"],
    additionalProperties: false,
    properties: {
        entry: {
            type: "object",
            required: ["start"],
            additionalProperties: false,
            properties: {
                start: { type: "string", minLength: 1 },
                end: { type: "string", nullable: true },
                name: { type: "string", nullable: true },
            },
        },
        next: {
            type: "object",
            required: ["start"],
            additionalProperties: false,
            properties: {
                start: { type: "string", minLength: 1 },
                end: { type: "string", nullable: true },
                name: { type: "string", nullable: true },
            },
        },
    },
});

export function registerFeriePermessiRoutes(router: Router) {
    router.register("GET", "/api/ferie-permessi/backups", async (_req, res) => {
        sendJson(res, 200, { items: listFeriePermessiBackups() });
    });

    router.register("POST", "/api/ferie-permessi/backups", async (req, res) => {
        const payload = validateBackupPayload((await readJsonBody(req)) || {});
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
            if (!String(params.name || "").trim()) {
                throw badRequest("Backup name missing");
            }
            const payload = validateBackupPayload((await readJsonBody(req)) || {});
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
        const payload = validateRequestPayload(
            (await readJsonBody(req)) || {},
            "Invalid ferie-permessi request payload",
        );
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
            const payload = validateRequestPayload(
                (await readJsonBody(req)) || {},
                "Invalid ferie-permessi request payload",
            );
            const item = await updateRequest(params.id, payload, {
                actor: getRequestUser(req),
                requestId: getRequestId(req),
            });
            if (!item) {
                throw notFound("Request not found");
            }
            sendJson(res, 200, item);
        },
    );

    router.register(
        "POST",
        "/api/ferie-permessi/requests/:id/approve",
        async (req, res, params) => {
            const payload = validateActorPayload((await readJsonBody(req)) || {});
            const item = await approveRequest(params.id, {
                actor: payload.actor || getRequestUser(req),
                requestId: getRequestId(req),
            });
            if (!item) {
                throw notFound("Request not found");
            }
            sendJson(res, 200, item);
        },
    );

    router.register(
        "POST",
        "/api/ferie-permessi/requests/:id/reject",
        async (req, res, params) => {
            const payload = validateActorPayload((await readJsonBody(req)) || {});
            const item = await rejectRequest(params.id, {
                actor: payload.actor || getRequestUser(req),
                requestId: getRequestId(req),
            });
            if (!item) {
                throw notFound("Request not found");
            }
            sendJson(res, 200, item);
        },
    );

    router.register(
        "DELETE",
        "/api/ferie-permessi/requests/:id",
        async (req, res, params) => {
            const payload = validateActorPayload((await readJsonBody(req)) || {});
            const item = await deleteRequest(params.id, {
                actor: payload.actor || getRequestUser(req),
                requestId: getRequestId(req),
            });
            if (!item) {
                throw notFound("Request not found");
            }
            sendJson(res, 200, item);
        },
    );

    router.register("PUT", "/api/ferie-permessi/payload", async (req, res) => {
        const payload = validateFpPayload(
            await readJsonBody(req),
            "Invalid ferie-permessi payload",
        );
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
        const payload = validateHolidaysPayload(
            (await readJsonBody(req)) || {},
            "Invalid holidays payload",
        );
        const result = await createHolidays(
            payload.dates,
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
            const payload = validateHolidayUpdatePayload((await readJsonBody(req)) || {});
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
        const payload = validateClosurePayload(
            (await readJsonBody(req)) || {},
            "Invalid closure payload",
        );
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
            const payload = validateClosurePayload(
                (await readJsonBody(req)) || {},
                "Invalid closure payload",
            );
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
            const payload = validateClosureUpdatePayload(
                (await readJsonBody(req)) || {},
                "Invalid closure update payload",
            );
            const result = await updateClosure(
                payload.entry,
                payload.next,
                {
                    actor: getRequestUser(req),
                    requestId: getRequestId(req),
                },
            );
            sendJson(res, 200, result);
        },
    );
}
