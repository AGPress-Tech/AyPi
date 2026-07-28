import http from "http";
import { backendConfig } from "./config";
import { registerRoutes } from "./routes";
import { logger } from "./shared/logging/logger";
import { Router } from "./shared/http/router";
import { sendError } from "./shared/http/response";
import { initializeSqliteDatabase, closeSqliteDatabase } from "./shared/db/sqlite";
import { initializeFeriePermessiSqliteStore } from "./modules/ferie-permessi/repository";
import { initializeSharedSqliteStore } from "./modules/shared/repository";
import { initializeProductManagerSqliteStore } from "./modules/product-manager/repository";
import { initializeTicketSupportSqliteStore } from "./modules/ticket-support/repository";
import { initializeTransferSqliteStore } from "./modules/transfer-attrezzaggio/repository";
import { initializeHaasSqliteStore } from "./modules/haas-attrezzaggio/repository";
import { initializeProductionPlannerSqliteStore } from "./modules/production-planner/repository";
import { releaseProductionPlannerWaiters } from "./modules/production-planner/service";
import { normalizeAgpressLayout } from "./shared/storage/agpress-layout";
import {
    getRequestClient,
    getRequestId,
    getRequestUser,
    setRequestId,
} from "./shared/http/context";
import {
    attachRealtimeHub,
    closeRealtimeHub,
    type RealtimeModule,
} from "./shared/realtime/websocket-hub";

export type BackendServerHandle = {
    host: string;
    port: number;
    url: string;
    server: http.Server;
    stop: () => Promise<void>;
};

function buildRequestIdFactory() {
    let requestCounter = 0;
    return () => {
        requestCounter += 1;
        return `req_${Date.now()}_${requestCounter}`;
    };
}

export function buildBackendUrl() {
    return `http://${backendConfig.advertisedHost}:${backendConfig.port}`;
}

function inferRequestModule(requestUrl: string): RealtimeModule {
    const normalizedUrl = String(requestUrl || "").toLowerCase();
    if (normalizedUrl.includes("/api/ferie-permessi/")) return "calendar";
    if (normalizedUrl.includes("/api/product-manager/")) return "purchasing";
    if (normalizedUrl.includes("/api/ticket-support/")) return "ticket";
    if (normalizedUrl.includes("/api/transfer-attrezzaggio/")) return "transfer";
    if (normalizedUrl.includes("/api/haas-attrezzaggio/")) return "attrezzaggio";
    if (normalizedUrl.includes("/api/production-planner/")) return "production-planner";
    if (normalizedUrl.includes("/api/shared/")) return "shared";
    return "core";
}

function shouldSkipHttpAccessLog(method: string, requestUrl: string) {
    const normalizedMethod = String(method || "").toUpperCase();
    const normalizedUrl = String(requestUrl || "").toLowerCase();
    return (
        normalizedMethod === "GET" &&
        (normalizedUrl === "/api/ferie-permessi/payload" ||
            normalizedUrl === "/api/production-planner/revision" ||
            normalizedUrl.startsWith("/api/production-planner/changes/"))
    );
}

export function createBackendServer(
    ready: Promise<void> = Promise.resolve(),
) {
    const router = new Router();
    registerRoutes(router);
    const nextRequestId = buildRequestIdFactory();

    let realtimeHub: ReturnType<typeof attachRealtimeHub>;
    const server = http.createServer(async (request, response) => {
        const startedAt = Date.now();
        const method = (request.method || "GET").toUpperCase();
        const requestUrl = request.url || "/";
        const remoteAddress = request.socket?.remoteAddress || "";
        const module = inferRequestModule(requestUrl);
        const skipHttpAccessLog = shouldSkipHttpAccessLog(method, requestUrl);
        const requestId = nextRequestId();
        setRequestId(request, requestId);
        response.setHeader("x-aypi-request-id", requestId);
        if (
            ["POST", "PUT", "PATCH", "DELETE"].includes(method) &&
            requestUrl.toLowerCase().startsWith("/api/")
        ) {
            response.once("finish", () => {
                if (response.statusCode < 200 || response.statusCode >= 300) {
                    return;
                }
                realtimeHub.publish({
                    module,
                    method,
                    path: requestUrl.split("?")[0],
                    requestId,
                    actor: getRequestUser(request),
                    source: getRequestClient(request),
                });
            });
        }

        response.setHeader("Access-Control-Allow-Origin", "*");
        response.setHeader(
            "Access-Control-Allow-Methods",
            "GET,POST,PUT,DELETE,OPTIONS",
        );
        response.setHeader(
            "Access-Control-Allow-Headers",
            "Content-Type,x-aypi-user,x-aypi-client",
        );

        try {
            await ready;
            if (method === "OPTIONS") {
                response.writeHead(204);
                response.end();
                return;
            }
            if (!skipHttpAccessLog) {
                logger.info("HTTP request started", {
                    event: "http_request_started",
                    category: "http",
                    module,
                    requestId,
                    method,
                    url: requestUrl,
                    user: getRequestUser(request),
                    client: getRequestClient(request),
                    remoteAddress,
                });
            }
            await router.handle(request, response);
            if (!skipHttpAccessLog) {
                logger.info("HTTP request completed", {
                    event: "http_request_completed",
                    category: "http",
                    module,
                    outcome: response.statusCode >= 400 ? "warning" : "success",
                    requestId,
                    method,
                    url: requestUrl,
                    user: getRequestUser(request),
                    client: getRequestClient(request),
                    remoteAddress,
                    statusCode: response.statusCode,
                    durationMs: Date.now() - startedAt,
                });
            }
        } catch (error) {
            const httpErrorDetails =
                error &&
                typeof error === "object" &&
                "details" in error
                    ? (error as { details?: unknown }).details
                    : undefined;
            logger.error("HTTP request failed", {
                event: "http_request_failed",
                category: "error",
                module,
                outcome: "error",
                requestId: getRequestId(request),
                method,
                url: requestUrl,
                user: getRequestUser(request),
                client: getRequestClient(request),
                remoteAddress,
                durationMs: Date.now() - startedAt,
                detail: error instanceof Error ? error.message : String(error),
                issues: httpErrorDetails,
            });
            sendError(response, error);
        }
    });
    realtimeHub = attachRealtimeHub(server);
    return server;
}

export async function startBackendServer(): Promise<BackendServerHandle> {
    let resolveReady!: () => void;
    let rejectReady!: (reason: unknown) => void;
    const ready = new Promise<void>((resolve, reject) => {
        resolveReady = resolve;
        rejectReady = reject;
    });
    // Requests waiting during startup must observe initialization failures, while
    // this catch prevents an unhandled rejection when no request has arrived yet.
    void ready.catch(() => {});

    return new Promise((resolve, reject) => {
        const server = createBackendServer(ready);
        const host = backendConfig.host;
        const port = backendConfig.port;
        const url = buildBackendUrl();

        const onError = (error: Error) => {
            server.off("listening", onListening);
            rejectReady(error);
            closeRealtimeHub(server);
            reject(error);
        };

        const onListening = async () => {
            server.off("error", onError);
            try {
                // The TCP port is the cross-user/process lock. Do not touch the
                // shared database until this process has acquired it.
                normalizeAgpressLayout();
                await initializeSqliteDatabase();
                initializeSharedSqliteStore();
                initializeFeriePermessiSqliteStore();
                initializeProductManagerSqliteStore();
                initializeTicketSupportSqliteStore();
                initializeTransferSqliteStore();
                initializeHaasSqliteStore();
                initializeProductionPlannerSqliteStore();
                resolveReady();

                logger.info("AyPi backend listening", {
                    event: "backend_listening",
                    category: "lifecycle",
                    module: "core",
                    host,
                    port,
                    url,
                    profile: backendConfig.profile,
                    generalDir: backendConfig.modules.feriePermessi.generalDir,
                    logDir: backendConfig.logging.dir,
                    dbPath: backendConfig.database.path,
                });
                resolve({
                    host,
                    port,
                    url,
                    server,
                    stop: () =>
                        new Promise<void>((stopResolve, stopReject) => {
                            releaseProductionPlannerWaiters();
                            closeRealtimeHub(server);
                            server.close((closeErr) => {
                                if (closeErr) {
                                    stopReject(closeErr);
                                    return;
                                }
                                logger.info("AyPi backend stopped", {
                                    event: "backend_stopped",
                                    category: "lifecycle",
                                    module: "core",
                                    host,
                                    port,
                                });
                                try {
                                    closeSqliteDatabase();
                                } catch {
                                    // ignore sqlite shutdown issues
                                }
                                stopResolve();
                            });
                        }),
                });
            } catch (error) {
                rejectReady(error);
                closeRealtimeHub(server);
                server.close(() => {});
                try {
                    closeSqliteDatabase();
                } catch {
                    // ignore sqlite cleanup issues after failed startup
                }
                reject(error);
            }
        };

        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(port, host);
    });
}
