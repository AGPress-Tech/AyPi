import http from "http";
import { randomUUID } from "crypto";
import WebSocket, { WebSocketServer } from "ws";
import { logger } from "../logging/logger";

export type RealtimeModule =
    | "calendar"
    | "purchasing"
    | "ticket"
    | "transfer"
    | "attrezzaggio"
    | "production-planner"
    | "shared"
    | "core";

export type RealtimeChange = {
    module: RealtimeModule;
    method: string;
    path: string;
    requestId: string;
    actor: string;
    source: string;
};

type ClientState = {
    connectionId: string;
    clientId: string;
    user: string;
    version: string;
    remoteAddress: string;
    connectedAt: number;
    alive: boolean;
    modules: Set<string>;
};

const hubs = new WeakMap<http.Server, RealtimeHub>();

function parseModules(value: unknown) {
    if (!Array.isArray(value)) return new Set(["*"]);
    const modules = value
        .map((item) => String(item || "").trim())
        .filter(Boolean);
    return new Set(modules.length ? modules : ["*"]);
}

function closeReason(reason: Buffer) {
    return reason.toString("utf8").slice(0, 160);
}

export class RealtimeHub {
    private readonly socketServer: WebSocketServer;
    private readonly clients = new Map<WebSocket, ClientState>();
    private readonly heartbeatTimer: NodeJS.Timeout;
    private sequence = 0;
    private closing = false;

    constructor(private readonly server: http.Server) {
        this.socketServer = new WebSocketServer({ noServer: true });
        this.server.on("upgrade", this.handleUpgrade);
        this.socketServer.on("connection", this.handleConnection);
        this.socketServer.on("error", (error) => {
            logger.error("WebSocket server error", {
                event: "realtime_server_error",
                category: "realtime",
                module: "core",
                detail: error.message,
            });
        });
        this.heartbeatTimer = setInterval(() => this.heartbeat(), 30000);
        this.heartbeatTimer.unref?.();
    }

    private readonly handleUpgrade = (
        request: http.IncomingMessage,
        socket: import("stream").Duplex,
        head: Buffer,
    ) => {
        let pathname = "";
        try {
            pathname = new URL(request.url || "/", "http://localhost").pathname;
        } catch {
            socket.destroy();
            return;
        }
        if (pathname !== "/ws") {
            socket.destroy();
            return;
        }
        this.socketServer.handleUpgrade(request, socket, head, (webSocket) => {
            this.socketServer.emit("connection", webSocket, request);
        });
    };

    private readonly handleConnection = (
        webSocket: WebSocket,
        request: http.IncomingMessage,
    ) => {
        const url = new URL(request.url || "/ws", "http://localhost");
        const state: ClientState = {
            connectionId: randomUUID(),
            clientId: url.searchParams.get("client") || "aypi-client",
            user: url.searchParams.get("user") || "Operatore AyPi",
            version: url.searchParams.get("version") || "unknown",
            remoteAddress: request.socket.remoteAddress || "",
            connectedAt: Date.now(),
            alive: true,
            modules: new Set(["*"]),
        };
        this.clients.set(webSocket, state);

        webSocket.on("pong", () => {
            state.alive = true;
        });
        webSocket.on("message", (raw) => {
            this.handleMessage(webSocket, state, raw.toString());
        });
        webSocket.on("close", (code, reason) => {
            this.clients.delete(webSocket);
            logger.info("WebSocket client disconnected", {
                event: "realtime_client_disconnected",
                category: "realtime",
                module: "core",
                connectionId: state.connectionId,
                clientId: state.clientId,
                user: state.user,
                remoteAddress: state.remoteAddress,
                code,
                reason: closeReason(reason),
                durationMs: Date.now() - state.connectedAt,
                connectedClients: this.clients.size,
            });
        });
        webSocket.on("error", (error) => {
            logger.warn("WebSocket client error", {
                event: "realtime_client_error",
                category: "realtime",
                module: "core",
                connectionId: state.connectionId,
                clientId: state.clientId,
                remoteAddress: state.remoteAddress,
                detail: error.message,
            });
        });

        this.send(webSocket, {
            type: "connection.ready",
            connectionId: state.connectionId,
            sequence: this.sequence,
            timestamp: new Date().toISOString(),
        });
        logger.info("WebSocket client connected", {
            event: "realtime_client_connected",
            category: "realtime",
            module: "core",
            connectionId: state.connectionId,
            clientId: state.clientId,
            user: state.user,
            version: state.version,
            remoteAddress: state.remoteAddress,
            connectedClients: this.clients.size,
        });
    };

    private handleMessage(
        webSocket: WebSocket,
        state: ClientState,
        raw: string,
    ) {
        try {
            const message = JSON.parse(raw);
            if (message?.type === "subscribe") {
                state.modules = parseModules(message.modules);
                this.send(webSocket, {
                    type: "subscription.ready",
                    modules: Array.from(state.modules),
                    timestamp: new Date().toISOString(),
                });
                return;
            }
            if (message?.type === "ping") {
                this.send(webSocket, {
                    type: "pong",
                    timestamp: new Date().toISOString(),
                });
            }
        } catch (error) {
            logger.warn("Invalid WebSocket client message", {
                event: "realtime_invalid_message",
                category: "realtime",
                module: "core",
                connectionId: state.connectionId,
                clientId: state.clientId,
                detail: error instanceof Error ? error.message : String(error),
            });
        }
    }

    private send(webSocket: WebSocket, payload: Record<string, unknown>) {
        if (webSocket.readyState !== WebSocket.OPEN) return false;
        webSocket.send(JSON.stringify(payload));
        return true;
    }

    private heartbeat() {
        this.clients.forEach((state, webSocket) => {
            if (!state.alive) {
                logger.warn("WebSocket heartbeat timeout", {
                    event: "realtime_heartbeat_timeout",
                    category: "realtime",
                    module: "core",
                    connectionId: state.connectionId,
                    clientId: state.clientId,
                    remoteAddress: state.remoteAddress,
                });
                webSocket.terminate();
                return;
            }
            state.alive = false;
            webSocket.ping();
        });
    }

    publish(change: RealtimeChange) {
        this.sequence += 1;
        const payload = {
            type: "module.changed",
            ...change,
            sequence: this.sequence,
            timestamp: new Date().toISOString(),
        };
        this.clients.forEach((state, webSocket) => {
            if (
                !state.modules.has("*") &&
                !state.modules.has(change.module)
            ) {
                return;
            }
            this.send(webSocket, payload);
        });
    }

    close() {
        if (this.closing) return;
        this.closing = true;
        clearInterval(this.heartbeatTimer);
        this.server.off("upgrade", this.handleUpgrade);
        this.clients.forEach((_state, webSocket) => {
            try {
                webSocket.close(1001, "Backend in arresto");
            } catch {
                webSocket.terminate();
            }
        });
        this.clients.clear();
        this.socketServer.close();
    }
}

export function attachRealtimeHub(server: http.Server) {
    const existing = hubs.get(server);
    if (existing) return existing;
    const hub = new RealtimeHub(server);
    hubs.set(server, hub);
    server.once("close", () => closeRealtimeHub(server));
    return hub;
}

export function closeRealtimeHub(server: http.Server) {
    hubs.get(server)?.close();
    hubs.delete(server);
}
