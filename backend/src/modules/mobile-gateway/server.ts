import http from "http";
import { backendConfig } from "../../config";
import { registerFeriePermessiRoutes } from "../ferie-permessi/routes";
import { registerProductManagerRoutes } from "../product-manager/routes";
import { registerProductionPlannerRoutes } from "../production-planner/routes";
import { registerTicketSupportRoutes } from "../ticket-support/routes";
import {
    getPayload,
    updateBalanceEntries,
} from "../ferie-permessi/service";
import {
    getAdminNames,
    getAdmins,
    getAssignees,
    getCalendarAccessConfig,
    saveAssignees,
    verifyAdmin,
} from "../shared/service";
import { Router } from "../../shared/http/router";
import {
    sendError,
    sendJson,
    sendNoContent,
} from "../../shared/http/response";
import { readJsonBody } from "../../shared/http/request";
import {
    badRequest,
    forbidden,
    isHttpError,
    tooManyRequests,
    unauthorized,
} from "../../shared/http/errors";
import {
    getRequestId,
    getRequestUser,
    setRequestId,
} from "../../shared/http/context";
import { logger } from "../../shared/logging/logger";
import { publishRealtimeChange } from "../../shared/realtime/websocket-hub";
import {
    createMobileAdminSession,
    initializeMobileSessionStore,
    revokeMobileAdminSession,
} from "./session-repository";
import {
    readBearerToken,
    resolveMobileAdminSession,
} from "./security";
import { MobileRealtimeHub } from "./realtime";

type LoginAttempt = {
    failures: number[];
};

type MobileModulePermissions = {
    calendar: boolean;
    purchasing: boolean;
    ticketSupport: boolean;
    productionPlanner: boolean;
};

export type MobileGatewayHandle = {
    host: string;
    port: number;
    server: http.Server;
    stop: () => Promise<void>;
};

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_FAILURES = 5;
const loginAttempts = new Map<string, LoginAttempt>();

function loginKey(request: http.IncomingMessage, adminName: string) {
    return `${request.socket.remoteAddress || "unknown"}|${adminName
        .trim()
        .toLowerCase()}`;
}

function recentFailures(key: string) {
    const now = Date.now();
    const attempt = loginAttempts.get(key) || { failures: [] };
    attempt.failures = attempt.failures.filter(
        (timestamp) => now - timestamp < LOGIN_WINDOW_MS,
    );
    if (attempt.failures.length) loginAttempts.set(key, attempt);
    else loginAttempts.delete(key);
    return attempt;
}

function registerLoginFailure(key: string) {
    const attempt = recentFailures(key);
    attempt.failures.push(Date.now());
    loginAttempts.set(key, attempt);
}

function resetLoginFailures(key: string) {
    loginAttempts.delete(key);
}

function setSecurityHeaders(response: http.ServerResponse) {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader(
        "Strict-Transport-Security",
        "max-age=31536000; includeSubDomains",
    );
}

function isPublicPath(pathname: string) {
    return (
        pathname === "/health" ||
        pathname === "/api/mobile/auth/login"
    );
}

function inferMobileModule(pathname: string) {
    if (
        pathname.startsWith("/api/ferie-permessi/") ||
        pathname.startsWith("/api/mobile/calendar/")
    ) return "calendar" as const;
    if (pathname.startsWith("/api/product-manager/")) return "purchasing" as const;
    if (pathname.startsWith("/api/ticket-support/")) return "ticket" as const;
    if (pathname.startsWith("/api/production-planner/")) {
        return "production-planner" as const;
    }
    return "shared" as const;
}

function getMobileModulePermissions(adminName: string): MobileModulePermissions {
    const target = getAdmins().find(
        (entry) =>
            String(entry.name || "").trim().toLowerCase() ===
            String(adminName || "").trim().toLowerCase(),
    );
    return {
        calendar: target?.accessCalendar !== false,
        purchasing: target?.accessPurchasing !== false,
        ticketSupport: true,
        productionPlanner: true,
    };
}

function canAccessMobilePath(
    pathname: string,
    permissions: MobileModulePermissions,
) {
    if (
        pathname.startsWith("/api/ferie-permessi/") ||
        pathname.startsWith("/api/mobile/calendar/")
    ) return permissions.calendar;
    if (pathname.startsWith("/api/product-manager/")) {
        return permissions.purchasing;
    }
    if (pathname.startsWith("/api/ticket-support/")) {
        return permissions.ticketSupport;
    }
    if (pathname.startsWith("/api/production-planner/")) {
        return permissions.productionPlanner;
    }
    return true;
}

function registerMobileRoutes(router: Router) {
    router.register("GET", "/health", async (_request, response) => {
        sendJson(response, 200, {
            ok: true,
            service: "aypi-mobile-gateway",
            scope: "aypi-mobile-admin",
            authentication: "bearer-session",
            modules: [
                "calendar",
                "purchasing",
                "ticket-support",
                "production-planner",
            ],
            realtime: {
                transport: "websocket",
                path: "/ws",
            },
        });
    });

    router.register("POST", "/api/mobile/auth/login", async (request, response) => {
        const body = (await readJsonBody<{
            adminName?: string;
            password?: string;
        }>(request)) || {};
        const adminName = String(body.adminName || "").trim();
        const password = String(body.password || "");
        const key = loginKey(request, adminName);
        const attempt = recentFailures(key);
        if (attempt.failures.length >= MAX_LOGIN_FAILURES) {
            throw tooManyRequests(
                "Troppi tentativi. Riprova tra qualche minuto.",
            );
        }
        if (!adminName || !password) {
            registerLoginFailure(key);
            throw unauthorized("Credenziali non valide");
        }

        const admin = await verifyAdmin(password, adminName, {
            actor: adminName,
            requestId: getRequestId(request),
        });
        if (!admin) {
            registerLoginFailure(key);
            logger.warn("Mobile admin login failed", {
                event: "mobile_admin_login_failed",
                category: "security",
                module: "calendar",
                user: adminName || "unknown",
                remoteAddress: request.socket.remoteAddress || "",
            });
            throw unauthorized("Credenziali non valide");
        }
        resetLoginFailures(key);
        const created = createMobileAdminSession(admin.name);
        const modules = getMobileModulePermissions(admin.name);
        logger.info("Mobile admin login completed", {
            event: "mobile_admin_login_completed",
            category: "security",
            module: "calendar",
            user: admin.name,
            remoteAddress: request.socket.remoteAddress || "",
            expiresAt: created.session.expiresAt,
        });
        sendJson(response, 200, {
            tokenType: "Bearer",
            accessToken: created.token,
            expiresAt: created.session.expiresAt,
            admin: {
                name: admin.name,
                email: admin.email || "",
                modules,
            },
        });
    });

    router.register("GET", "/api/mobile/auth/me", async (request, response) => {
        const session = resolveMobileAdminSession(request);
        if (!session) throw unauthorized("Sessione non valida o scaduta");
        const modules = getMobileModulePermissions(session.adminName);
        sendJson(response, 200, {
            admin: {
                name: session.adminName,
                modules,
            },
            createdAt: session.createdAt,
            expiresAt: session.expiresAt,
        });
    });

    router.register("POST", "/api/mobile/auth/logout", async (request, response) => {
        revokeMobileAdminSession(readBearerToken(request));
        sendNoContent(response);
    });

    router.register(
        "GET",
        "/api/mobile/calendar/bootstrap",
        async (request, response) => {
            const actor = getRequestUser(request);
            const payload = await getPayload({
                actor,
                requestId: getRequestId(request),
            });
            sendJson(response, 200, {
                payload,
                assignees: getAssignees(),
                accessConfig: getCalendarAccessConfig(),
                admins: getAdminNames(),
                capabilities: {
                    requests: {
                        create: true,
                        update: true,
                        approve: true,
                        reject: true,
                        delete: true,
                    },
                    holidays: true,
                    closures: true,
                    backups: true,
                },
            });
        },
    );

    router.register(
        "PUT",
        "/api/mobile/calendar/assignees",
        async (request, response) => {
            const body = (await readJsonBody<{
                groups?: Record<string, unknown>;
                emails?: Record<string, unknown>;
            }>(request)) || {};
            if (
                !body.groups ||
                typeof body.groups !== "object" ||
                Array.isArray(body.groups)
            ) {
                throw badRequest("Elenco reparti non valido");
            }
            const groups: Record<string, string[]> = {};
            Object.entries(body.groups).forEach(([rawDepartment, rawEmployees]) => {
                const department = rawDepartment.trim();
                if (!department || !Array.isArray(rawEmployees)) return;
                groups[department] = Array.from(
                    new Set(
                        rawEmployees
                            .map((value) => String(value || "").trim())
                            .filter(Boolean),
                    ),
                ).sort((left, right) => left.localeCompare(right, "it"));
            });
            const emails: Record<string, string> = {};
            if (
                body.emails &&
                typeof body.emails === "object" &&
                !Array.isArray(body.emails)
            ) {
                Object.entries(body.emails).forEach(([rawKey, rawEmail]) => {
                    const key = rawKey.trim();
                    const email = String(rawEmail || "").trim();
                    if (key && email) emails[key] = email;
                });
            }
            const saved = await saveAssignees(
                { groups, emails },
                {
                    actor: getRequestUser(request),
                    requestId: getRequestId(request),
                },
            );
            sendJson(response, 200, saved);
        },
    );

    router.register(
        "PUT",
        "/api/mobile/calendar/balances",
        async (request, response) => {
            const body = (await readJsonBody<{
                entries?: Array<{
                    key?: string;
                    hoursAvailable?: number;
                    monthlyAccrualHours?: number;
                }>;
            }>(request)) || {};
            if (!Array.isArray(body.entries)) {
                throw badRequest("Elenco ore non valido");
            }
            const entries = body.entries
                .map((entry) => ({
                    key: String(entry?.key || "").trim(),
                    hoursAvailable: Number(entry?.hoursAvailable),
                    monthlyAccrualHours: Number(entry?.monthlyAccrualHours),
                }))
                .filter(
                    (entry) =>
                        entry.key &&
                        Number.isFinite(entry.hoursAvailable) &&
                        Number.isFinite(entry.monthlyAccrualHours) &&
                        entry.monthlyAccrualHours >= 0,
                );
            if (entries.length !== body.entries.length) {
                throw badRequest("Una o più righe ore non sono valide");
            }
            const balances = await updateBalanceEntries(entries, {
                actor: getRequestUser(request),
                requestId: getRequestId(request),
            });
            sendJson(response, 200, { balances });
        },
    );

    registerFeriePermessiRoutes(router);
    registerProductManagerRoutes(router);
    registerTicketSupportRoutes(router);
    registerProductionPlannerRoutes(router);
}

export function startMobileGatewayServer(): Promise<MobileGatewayHandle | null> {
    if (!backendConfig.mobileGateway.enabled) {
        logger.info("Mobile gateway disabled", {
            event: "mobile_gateway_disabled",
            category: "lifecycle",
            module: "calendar",
        });
        return Promise.resolve(null);
    }

    initializeMobileSessionStore();
    const router = new Router();
    registerMobileRoutes(router);
    let requestCounter = 0;

    return new Promise((resolve, reject) => {
        const server = http.createServer(async (request, response) => {
            const method = String(request.method || "GET").toUpperCase();
            const requestUrl = new URL(
                request.url || "/",
                "http://localhost",
            );
            const pathname = requestUrl.pathname;
            const requestId = `mobile_${Date.now()}_${++requestCounter}`;
            setRequestId(request, requestId);
            response.setHeader("x-aypi-request-id", requestId);
            setSecurityHeaders(response);

            try {
                if (method === "OPTIONS") {
                    sendNoContent(response);
                    return;
                }
                if (!isPublicPath(pathname)) {
                    const session = resolveMobileAdminSession(request);
                    if (!session) {
                        throw unauthorized("Sessione non valida o scaduta");
                    }
                    if (
                        !canAccessMobilePath(
                            pathname,
                            getMobileModulePermissions(session.adminName),
                        )
                    ) {
                        throw forbidden("Modulo non autorizzato");
                    }
                    request.headers["x-aypi-user"] = session.adminName;
                    request.headers["x-aypi-client"] = "aypi-mobile";
                }

                if (
                    ["POST", "PUT", "PATCH", "DELETE"].includes(method) &&
                    pathname !== "/api/mobile/auth/login" &&
                    pathname !== "/api/mobile/auth/logout"
                ) {
                    response.once("finish", () => {
                        if (response.statusCode < 200 || response.statusCode >= 300) {
                            return;
                        }
                        publishRealtimeChange({
                            module: inferMobileModule(pathname),
                            method,
                            path: pathname,
                            requestId,
                            actor: getRequestUser(request),
                            source: "aypi-mobile",
                        });
                    });
                }
                await router.handle(request, response);
            } catch (error) {
                // Invalid/expired sessions and the other 4xx responses are normal
                // client outcomes (especially while Funnel is public).  The
                // endpoint that validates the login already records its own
                // concise audit event, so logging every rejected HTTP request
                // here would only duplicate it and flood the backend viewer.
                const isExpectedClientOutcome =
                    isHttpError(error) && error.statusCode < 500;
                if (!isExpectedClientOutcome) {
                    logger.warn("Mobile gateway request failed", {
                        event: "mobile_gateway_request_failed",
                        category: "security",
                        module: "calendar",
                        requestId,
                        method,
                        path: pathname,
                        user: getRequestUser(request),
                        remoteAddress: request.socket.remoteAddress || "",
                        detail:
                            error instanceof Error
                                ? error.message
                                : String(error),
                    });
                }
                sendError(response, error);
            }
        });
        const realtime = new MobileRealtimeHub(server);
        let listening = false;
        const onError = (error: Error) => {
            if (!listening) {
                realtime.close();
                reject(error);
                return;
            }
            logger.error("Mobile gateway runtime error", {
                event: "mobile_gateway_runtime_error",
                category: "lifecycle",
                module: "calendar",
                host: backendConfig.mobileGateway.host,
                port: backendConfig.mobileGateway.port,
                detail: error.message,
            });
        };
        server.on("error", onError);
        server.listen(
            backendConfig.mobileGateway.port,
            backendConfig.mobileGateway.host,
            () => {
                listening = true;
                logger.info("Mobile gateway listening", {
                    event: "mobile_gateway_listening",
                    category: "lifecycle",
                    module: "calendar",
                    host: backendConfig.mobileGateway.host,
                    port: backendConfig.mobileGateway.port,
                    scope: "calendar-admin",
                });
                resolve({
                    host: backendConfig.mobileGateway.host,
                    port: backendConfig.mobileGateway.port,
                    server,
                    stop: () =>
                        new Promise<void>((stopResolve, stopReject) => {
                            realtime.close();
                            server.close((error) => {
                                if (error) {
                                    stopReject(error);
                                    return;
                                }
                                stopResolve();
                            });
                        }),
                });
            },
        );
    });
}
