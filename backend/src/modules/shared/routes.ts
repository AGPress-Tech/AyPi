import type { Router } from "../../shared/http/router";
import { getRequestId, getRequestUser } from "../../shared/http/context";
import { sendJson } from "../../shared/http/response";
import { readJsonBody } from "../../shared/http/request";
import { unauthorized } from "../../shared/http/errors";
import { createSchemaValidator } from "../../shared/http/validation";
import {
    getCalendarAccessConfig,
    getAdminNames,
    getAdmins,
    getAssignees,
    getOtpMailConfig,
    saveAdmins,
    saveAssignees,
    saveCalendarConfig,
    saveSharedOtpMailConfig,
    sendAdminOtpMail,
    sendOtpTestMail,
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

const validateCalendarAccessConfigPayload = createSchemaValidator<any>({
    type: "object",
    required: ["version", "operations"],
    additionalProperties: true,
    properties: {
        version: { type: "number" },
        operations: { type: "object" },
    },
});

const validateOtpMailPayload = createSchemaValidator<any>({
    type: "object",
    required: ["host", "user", "pass"],
    additionalProperties: true,
    properties: {
        host: { type: "string", minLength: 1 },
        user: { type: "string", minLength: 1 },
        pass: { type: "string", minLength: 1 },
        port: { type: "number", nullable: true },
        secure: { type: "boolean", nullable: true },
        from: { type: "string", nullable: true },
    },
});

const validateOtpMailTestPayload = createSchemaValidator<{
    config: any;
    to: string;
}>({
    type: "object",
    required: ["config", "to"],
    additionalProperties: false,
    properties: {
        config: { type: "object" },
        to: { type: "string", minLength: 1 },
    },
});

const validateOtpSendPayload = createSchemaValidator<{
    email: string;
    code: string;
}>({
    type: "object",
    required: ["email", "code"],
    additionalProperties: false,
    properties: {
        email: { type: "string", minLength: 1 },
        code: { type: "string", minLength: 1 },
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

    router.register(
        "GET",
        "/api/shared/calendar-access-config",
        async (_req, res) => {
            sendJson(res, 200, getCalendarAccessConfig());
        },
    );

    router.register(
        "PUT",
        "/api/shared/calendar-access-config",
        async (req, res) => {
            const payload = validateCalendarAccessConfigPayload(
                await readJsonBody(req),
                "Invalid calendar access config payload",
            );
            const data = await saveCalendarConfig(payload, {
                actor: getRequestUser(req),
                requestId: getRequestId(req),
            });
            sendJson(res, 200, { ok: true, data });
        },
    );

    router.register("GET", "/api/shared/otp-mail-config", async (_req, res) => {
        sendJson(res, 200, {
            configured: !!getOtpMailConfig(),
            config: getOtpMailConfig(),
        });
    });

    router.register("PUT", "/api/shared/otp-mail-config", async (req, res) => {
        const payload = validateOtpMailPayload(
            await readJsonBody(req),
            "Invalid otp mail config payload",
        );
        const data = await saveSharedOtpMailConfig(payload, {
            actor: getRequestUser(req),
            requestId: getRequestId(req),
        });
        sendJson(res, 200, { ok: true, data });
    });

    router.register(
        "POST",
        "/api/shared/otp-mail-config/test",
        async (req, res) => {
            const payload = validateOtpMailTestPayload(
                await readJsonBody(req),
                "Invalid otp mail test payload",
            );
            await sendOtpTestMail(payload.config, payload.to, {
                actor: getRequestUser(req),
                requestId: getRequestId(req),
            });
            sendJson(res, 200, { ok: true });
        },
    );

    router.register("POST", "/api/shared/otp/send", async (req, res) => {
        const payload = validateOtpSendPayload(
            await readJsonBody(req),
            "Invalid otp send payload",
        );
        await sendAdminOtpMail(payload.email, payload.code, {
            actor: getRequestUser(req),
            requestId: getRequestId(req),
        });
        sendJson(res, 200, { ok: true });
    });
}
