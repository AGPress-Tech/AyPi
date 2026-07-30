import type { IncomingMessage } from "http";
import { loadAdminCredentials } from "../shared/repository";
import {
    findMobileAdminSession,
    type MobileAdminSession,
} from "./session-repository";

export type AuthorizedMobileSession = MobileAdminSession & {
    token: string;
};

export function readBearerToken(request: IncomingMessage) {
    const header = request.headers.authorization;
    const value = Array.isArray(header) ? header[0] : header;
    const match = String(value || "").match(/^Bearer\s+([A-Za-z0-9_-]+)$/i);
    return match?.[1] || "";
}

export function resolveMobileAdminSession(
    request: IncomingMessage,
): AuthorizedMobileSession | null {
    const token = readBearerToken(request);
    const session = findMobileAdminSession(token);
    if (!session) return null;
    const admin = loadAdminCredentials().find(
        (entry) =>
            String(entry.name || "").trim().toLowerCase() ===
            session.adminName.trim().toLowerCase(),
    );
    if (!admin || admin.accessCalendar === false) return null;
    return {
        ...session,
        token,
    };
}

