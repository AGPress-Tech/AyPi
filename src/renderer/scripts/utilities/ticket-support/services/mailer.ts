require("../../../shared/dev-guards");
import { requestBackend } from "../../../shared/backend-client";

type MailPayload = {
    to?: string;
    subject?: string;
    text?: string;
};

function isMailerAvailable() {
    return true;
}

function getMailerError() {
    return null;
}

async function sendMail(payload: MailPayload) {
    const to = String(payload?.to || "").trim();
    const subject = String(payload?.subject || "").trim();
    const text = String(payload?.text || "").trim();
    if (!to || !subject || !text) {
        throw new Error(
            "Email non valida: destinatario, oggetto o testo mancanti.",
        );
    }
    await requestBackend("/api/ticket-support/mail", {
        method: "POST",
        body: { to, subject, text },
    });
}

export { isMailerAvailable, getMailerError, sendMail };

if (
    typeof module !== "undefined" &&
    module.exports &&
    !(globalThis as any).__aypiBundled
) {
    module.exports = { isMailerAvailable, getMailerError, sendMail };
}
