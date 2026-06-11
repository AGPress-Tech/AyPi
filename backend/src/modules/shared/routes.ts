import type { Router } from "../../shared/http/router";
import { getRequestId, getRequestUser } from "../../shared/http/context";
import { sendJson } from "../../shared/http/response";
import { readJsonBody } from "../../shared/http/request";
import { unauthorized } from "../../shared/http/errors";
import { createSchemaValidator } from "../../shared/http/validation";
import {
    getAdminNames,
    getAdmins,
    getAssignees,
    saveAdmins,
    saveAssignees,
    verifyAdmin,
} from "./service";

const validateAdminsPayload = createSchemaValidator<{ admins: any[] }>({
    type: "object",
    required: ["admins"],
    additionalProperties: false,
    properties: {
        admins: {
            type: "array",
            items: {
                type: "object",
                required: ["name"],
                additionalProperties: true,
                properties: {
                    name: { type: "string", minLength: 1 },
                    password: { type: "string", nullable: true },
                    passwordHash: { type: "string", nullable: true },
                    email: { type: "string", nullable: true },
                    phone: { type: "string", nullable: true },
                    accessCalendar: { type: "boolean", nullable: true },
                    accessPurchasing: { type: "boolean", nullable: true },
                },
            },
        },
    },
});

const validateVerifyPayload = createSchemaValidator<{
    password: string;
    targetName?: string | null;
}>({
    type: "object",
    required: ["password"],
    additionalProperties: false,
    properties: {
        password: { type: "string", minLength: 1 },
        targetName: { type: "string", nullable: true },
    },
});

const validateAssigneesPayload = createSchemaValidator<{
    groups?: Record<string, string[]>;
    emails?: Record<string, string>;
}>({
    type: "object",
    additionalProperties: false,
    properties: {
        groups: {
            type: "object",
            nullable: true,
            additionalProperties: {
                type: "array",
                items: { type: "string" },
            },
        },
        emails: {
            type: "object",
            nullable: true,
            additionalProperties: { type: "string" },
        },
    },
});

export function registerSharedRoutes(router: Router) {
    router.register("GET", "/api/shared/admins", async (_req, res) => {
        sendJson(res, 200, { admins: getAdmins() });
    });

    router.register("PUT", "/api/shared/admins", async (req, res) => {
        const payload = validateAdminsPayload(
            await readJsonBody(req),
            "Invalid admins payload",
        );
        await saveAdmins(payload.admins, {
            actor: getRequestUser(req),
            requestId: getRequestId(req),
        });
        sendJson(res, 200, { ok: true, admins: getAdmins() });
    });

    router.register("GET", "/api/shared/admins/names", async (_req, res) => {
        sendJson(res, 200, { admins: getAdminNames() });
    });

    router.register("POST", "/api/shared/admins/verify", async (req, res) => {
        const payload = validateVerifyPayload(
            await readJsonBody(req),
            "Invalid admin verify payload",
        );
        const admin = await verifyAdmin(payload.password, payload.targetName || null, {
            actor: getRequestUser(req),
            requestId: getRequestId(req),
        });
        if (!admin) {
            throw unauthorized("Invalid admin credentials");
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
        sendJson(res, 200, getAssignees());
    });

    router.register("PUT", "/api/shared/assignees", async (req, res) => {
        const payload = validateAssigneesPayload(
            await readJsonBody(req),
            "Invalid assignees payload",
        );
        await saveAssignees(payload, {
            actor: getRequestUser(req),
            requestId: getRequestId(req),
        });
        sendJson(res, 200, {
            ok: true,
            data: getAssignees(),
        });
    });
}
