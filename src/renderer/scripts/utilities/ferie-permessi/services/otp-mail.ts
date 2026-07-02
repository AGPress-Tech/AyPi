require("../../../shared/dev-guards");
import { requestBackend } from "../../../shared/backend-client";

type MailConfig = {
    host: string;
    user: string;
    pass: string;
    port?: number;
    secure?: boolean;
    from?: string;
};

type AdminLike = {
    email?: string;
};

function isMailerAvailable() {
    return true;
}

function getMailerError() {
    return null;
}

async function loadMailConfig(): Promise<MailConfig | null> {
    const payload = await requestBackend("/api/shared/otp-mail-config");
    return payload?.config || null;
}

async function saveMailConfig(payload: unknown) {
    const result = await requestBackend("/api/shared/otp-mail-config", {
        method: "PUT",
        body: payload,
    });
    return result?.data || null;
}

async function sendTestEmail(payload: unknown, to: string) {
    await requestBackend("/api/shared/otp-mail-config/test", {
        method: "POST",
        body: {
            config: payload,
            to,
        },
    });
}

async function sendOtpEmail(admin: AdminLike, code: string) {
    await requestBackend("/api/shared/otp/send", {
        method: "POST",
        body: {
            email: String(admin?.email || "").trim(),
            code: String(code || ""),
        },
    });
}

export {
    isMailerAvailable,
    getMailerError,
    loadMailConfig,
    saveMailConfig,
    sendTestEmail,
    sendOtpEmail,
};

if (
    typeof module !== "undefined" &&
    module.exports &&
    !(globalThis as any).__aypiBundled
) {
    module.exports = {
        isMailerAvailable,
        getMailerError,
        loadMailConfig,
        saveMailConfig,
        sendTestEmail,
        sendOtpEmail,
    };
}
