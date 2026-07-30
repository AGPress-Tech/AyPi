import http from "http";
import { randomUUID } from "crypto";
import WebSocket, { WebSocketServer } from "ws";
import { logger } from "../../shared/logging/logger";
import {
    subscribeRealtimeChanges,
    type RealtimeChange,
} from "../../shared/realtime/websocket-hub";
import { resolveMobileAdminSession } from "./security";

type MobileSocketState = {
    id: string;
    adminName: string;
    alive: boolean;
};

export class MobileRealtimeHub {
    private readonly socketServer = new WebSocketServer({ noServer: true });
    private readonly clients = new Map<WebSocket, MobileSocketState>();
    private readonly heartbeatTimer: NodeJS.Timeout;
    private readonly unsubscribeChanges: () => void;
    private sequence = 0;

    constructor(private readonly server: http.Server) {
        server.on("upgrade", this.handleUpgrade);
        this.socketServer.on("connection", this.handleConnection);
        this.socketServer.on("error", (error) => {
            logger.error("Mobile realtime server error", {
                event: "mobile_realtime_server_error",
                category: "realtime",
                module: "calendar",
                detail: error.message,
            });
        });
        this.unsubscribeChanges = subscribeRealtimeChanges((change) =>
            this.deliver(change),
        );
        this.heartbeatTimer = setInterval(() => this.heartbeat(), 30000);
        this.heartbeatTimer.unref?.();
    }

    private readonly handleUpgrade = (
        request: http.IncomingMessage,
        socket: import("stream").Duplex,
        head: Buffer,
    ) => {
        try {
            const pathname = new URL(
                request.url || "/",
                "http://localhost",
            ).pathname;
            if (pathname !== "/ws") {
                socket.destroy();
                return;
            }

            const session = resolveMobileAdminSession(request);
            if (!session) {
                socket.write(
                    "HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n",
                );
                socket.destroy();
                return;
            }
            request.headers["x-aypi-user"] = session.adminName;
            this.socketServer.handleUpgrade(request, socket, head, (webSocket) => {
                this.socketServer.emit("connection", webSocket, request);
            });
        } catch (error) {
            logger.warn("Mobile realtime upgrade rejected", {
                event: "mobile_realtime_upgrade_rejected",
                category: "realtime",
                module: "calendar",
                detail: error instanceof Error ? error.message : String(error),
            });
            try {
                socket.write(
                    "HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n",
                );
            } catch {
                // The socket may already be unavailable.
            }
            socket.destroy();
        }
    };

    private readonly handleConnection = (
        webSocket: WebSocket,
        request: http.IncomingMessage,
    ) => {
        const session = resolveMobileAdminSession(request);
        if (!session) {
            webSocket.close(1008, "Sessione non valida");
            return;
        }
        const state: MobileSocketState = {
            id: randomUUID(),
            adminName: session.adminName,
            alive: true,
        };
        this.clients.set(webSocket, state);
        webSocket.on("pong", () => {
            state.alive = true;
        });
        webSocket.on("message", (raw) => {
            try {
                const message = JSON.parse(raw.toString());
                if (message?.type === "ping") {
                    this.send(webSocket, {
                        type: "pong",
                        timestamp: new Date().toISOString(),
                    });
                }
            } catch {
                // Ignore malformed client messages; the mobile socket is read-only.
            }
        });
        webSocket.on("close", () => this.clients.delete(webSocket));
        webSocket.on("error", () => this.clients.delete(webSocket));
        this.send(webSocket, {
            type: "connection.ready",
            connectionId: state.id,
            sequence: this.sequence,
            modules: [
                "calendar",
                "shared",
                "purchasing",
                "ticket",
                "production-planner",
            ],
            timestamp: new Date().toISOString(),
        });
        logger.info("Mobile realtime client connected", {
            event: "mobile_realtime_connected",
            category: "realtime",
            module: "calendar",
            user: state.adminName,
            connectionId: state.id,
        });
    };

    private send(webSocket: WebSocket, payload: Record<string, unknown>) {
        if (webSocket.readyState !== WebSocket.OPEN) return;
        webSocket.send(JSON.stringify(payload));
    }

    private deliver(change: RealtimeChange) {
        if (
            ![
                "calendar",
                "shared",
                "purchasing",
                "ticket",
                "production-planner",
            ].includes(change.module)
        ) return;
        this.sequence += 1;
        const payload = {
            type: "module.changed",
            ...change,
            sequence: this.sequence,
            timestamp: new Date().toISOString(),
        };
        this.clients.forEach((_state, socket) => this.send(socket, payload));
    }

    private heartbeat() {
        this.clients.forEach((state, socket) => {
            if (!state.alive) {
                socket.terminate();
                this.clients.delete(socket);
                return;
            }
            state.alive = false;
            try {
                if (socket.readyState === WebSocket.OPEN) {
                    socket.ping();
                }
            } catch {
                socket.terminate();
                this.clients.delete(socket);
            }
        });
    }

    close() {
        clearInterval(this.heartbeatTimer);
        this.unsubscribeChanges();
        this.server.off("upgrade", this.handleUpgrade);
        this.clients.forEach((_state, socket) => {
            try {
                socket.close(1001, "Gateway in arresto");
            } catch {
                socket.terminate();
            }
        });
        this.clients.clear();
        this.socketServer.close();
    }
}
