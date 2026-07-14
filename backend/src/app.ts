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
import { normalizeAgpressLayout } from "./shared/storage/agpress-layout";
import {
    getRequestClient,
    getRequestId,
    getRequestUser,
    setRequestId,
} from "./shared/http/context";

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

function inferRequestModule(requestUrl: string) {
    const normalizedUrl = String(requestUrl || "").toLowerCase();
    if (normalizedUrl.includes("/api/ferie-permessi/")) return "calendar";
    if (normalizedUrl.includes("/api/product-manager/")) return "purchasing";
    if (normalizedUrl.includes("/api/ticket-support/")) return "ticket";
    if (normalizedUrl.includes("/api/transfer-attrezzaggio/")) return "transfer";
    if (normalizedUrl.includes("/api/haas-attrezzaggio/")) return "attrezzaggio";
    if (normalizedUrl.includes("/api/shared/")) return "shared";
    return "core";
}

function shouldSkipHttpAccessLog(method: string, requestUrl: string) {
    const normalizedMethod = String(method || "").toUpperCase();
    const normalizedUrl = String(requestUrl || "").toLowerCase();
    return (
        normalizedMethod === "GET" &&
        normalizedUrl === "/api/ferie-permessi/payload"
    );
}

export function createBackendServer() {
    const router = new Router();
    registerRoutes(router);
    const nextRequestId = buildRequestIdFactory();

    return http.createServer(async (request, response) => {
        const startedAt = Date.now();
        const method = (request.method || "GET").toUpperCase();
        const requestUrl = request.url || "/";
        const remoteAddress = request.socket?.remoteAddress || "";
        const module = inferRequestModule(requestUrl);
        const skipHttpAccessLog = shouldSkipHttpAccessLog(method, requestUrl);
        const requestId = nextRequestId();
        setRequestId(request, requestId);
        response.setHeader("x-aypi-request-id", requestId);

        response.setHeader("Access-Control-Allow-Origin", "*");
        response.setHeader(
            "Access-Control-Allow-Methods",
            "GET,POST,PUT,DELETE,OPTIONS",
        );
        response.setHeader(
            "Access-Control-Allow-Headers",
            "Content-Type,x-aypi-user,x-aypi-client",
        );

        if (method === "OPTIONS") {
            response.writeHead(204);
            response.end();
            return;
        }

        try {
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
}

export async function startBackendServer(): Promise<BackendServerHandle> {
    normalizeAgpressLayout();
    await initializeSqliteDatabase();
    initializeSharedSqliteStore();
    initializeFeriePermessiSqliteStore();
    initializeProductManagerSqliteStore();
    initializeTicketSupportSqliteStore();
    initializeTransferSqliteStore();
    initializeHaasSqliteStore();

    return new Promise((resolve, reject) => {
        const server = createBackendServer();
        const host = backendConfig.host;
        const port = backendConfig.port;
        const url = buildBackendUrl();

        const onError = (error: Error) => {
            server.off("listening", onListening);
            reject(error);
        };

        const onListening = () => {
            server.off("error", onError);
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
        };

        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(port, host);
    });
}
