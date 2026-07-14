import type { Router } from "../../shared/http/router";
import { getRequestId, getRequestUser } from "../../shared/http/context";
import { readJsonBody } from "../../shared/http/request";
import { badRequest } from "../../shared/http/errors";
import { sendJson } from "../../shared/http/response";
import { createSchemaValidator } from "../../shared/http/validation";
import {
    getTicketBackups,
    getTicketCategories,
    getTicketStore,
    runTicketBackup,
    runTicketRestore,
    saveCategories,
    saveStore,
    sendTicketMail,
} from "./service";

const validateTicketStorePayload = createSchemaValidator<any>({
    type: "object",
    required: ["version", "tickets"],
    additionalProperties: true,
    properties: {
        version: { type: "number" },
        tickets: {
            type: "array",
            items: {
                type: "object",
                additionalProperties: true,
                properties: {
                    id: { type: "string", nullable: true },
                    issueType: { type: "string", nullable: true },
                    area: { type: "string", nullable: true },
                    priority: { type: "string", nullable: true },
                    description: { type: "string", nullable: true },
                    status: { type: "string", nullable: true },
                    createdAt: { type: "string", nullable: true },
                    updatedAt: { type: "string", nullable: true },
                    resolvedAt: { type: "string", nullable: true },
                    closedAt: { type: "string", nullable: true },
                    lastStatusChangeAt: { type: "string", nullable: true },
                    createdByKey: { type: "string", nullable: true },
                    requester: {
                        type: "object",
                        nullable: true,
                        additionalProperties: true,
                    },
                    history: {
                        type: "array",
                        nullable: true,
                        items: {
                            type: "object",
                            additionalProperties: true,
                        },
                    },
                },
            },
        },
    },
});

const validateTicketCategoriesPayload = createSchemaValidator<any>({
    type: "object",
    required: ["version", "issueTypes", "areas"],
    additionalProperties: false,
    properties: {
        version: { type: "number" },
        issueTypes: { type: "array", items: { type: "string" } },
        areas: { type: "array", items: { type: "string" } },
    },
});

const validateTicketMailPayload = createSchemaValidator<{
    to: string;
    subject: string;
    text: string;
}>({
    type: "object",
    required: ["to", "subject", "text"],
    additionalProperties: false,
    properties: {
        to: { type: "string", minLength: 1 },
        subject: { type: "string", minLength: 1 },
        text: { type: "string", minLength: 1 },
    },
});

export function registerTicketSupportRoutes(router: Router) {
    router.register("POST", "/api/ticket-support/mail", async (req, res) => {
        const payload = validateTicketMailPayload(
            await readJsonBody(req),
            "Invalid ticket mail payload",
        );
        await sendTicketMail(payload, {
            actor: getRequestUser(req),
            requestId: getRequestId(req),
        });
        sendJson(res, 200, { ok: true });
    });

    router.register("GET", "/api/ticket-support/store", async (_req, res) => {
        sendJson(res, 200, getTicketStore());
    });

    router.register("GET", "/api/ticket-support/backups", async (_req, res) => {
        sendJson(res, 200, { items: getTicketBackups() });
    });

    router.register("POST", "/api/ticket-support/backups", async (req, res) => {
        sendJson(res, 201, await runTicketBackup({
            actor: getRequestUser(req),
            requestId: getRequestId(req),
        }));
    });

    router.register(
        "POST",
        "/api/ticket-support/backups/:name/restore",
        async (req, res, params) => {
            if (!String(params.name || "").trim()) {
                throw badRequest("Backup name missing");
            }
            sendJson(res, 200, await runTicketRestore(params.name, {
                actor: getRequestUser(req),
                requestId: getRequestId(req),
            }));
        },
    );

    router.register("PUT", "/api/ticket-support/store", async (req, res) => {
        const payload = validateTicketStorePayload(
            await readJsonBody(req),
            "Invalid ticket store payload",
        );
        sendJson(res, 200, await saveStore(payload, {
            actor: getRequestUser(req),
            requestId: getRequestId(req),
        }));
    });

    router.register("GET", "/api/ticket-support/categories", async (_req, res) => {
        sendJson(res, 200, getTicketCategories());
    });

    router.register("PUT", "/api/ticket-support/categories", async (req, res) => {
        const payload = validateTicketCategoriesPayload(
            await readJsonBody(req),
            "Invalid ticket categories payload",
        );
        sendJson(res, 200, await saveCategories(payload, {
            actor: getRequestUser(req),
            requestId: getRequestId(req),
        }));
    });
}
