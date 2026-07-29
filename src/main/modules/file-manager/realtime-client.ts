import { app, BrowserWindow, ipcMain } from "electron";
import log from "electron-log";
import { randomUUID } from "crypto";
import WebSocket from "ws";
import { resolveAypiBackendBaseUrl } from "./backend-client";

type RealtimeStatus = {
    state: "connecting" | "connected" | "disconnected";
    connectedAt?: string;
    lastEventAt?: string;
    retryInMs?: number;
    detail?: string;
};

const SUBSCRIBED_MODULES = [
    "calendar",
    "purchasing",
    "ticket",
    "transfer",
    "attrezzaggio",
    "production-planner",
    "shared",
];
const CONNECTION_READY_TIMEOUT_MS = 15000;
const WATCHDOG_CHECK_INTERVAL_MS = 10000;
const WATCHDOG_ACTIVITY_TIMEOUT_MS = 70000;

let started = false;
let stopping = false;
let socket: WebSocket | null = null;
let retryTimer: NodeJS.Timeout | null = null;
let connectionReadyTimer: NodeJS.Timeout | null = null;
let watchdogTimer: NodeJS.Timeout | null = null;
let retryAttempt = 0;
let status: RealtimeStatus = { state: "disconnected" };
let lastActivityAt = 0;
let forcedReconnectDetail = "";
const instanceId = randomUUID();

function broadcast(channel: string, payload: unknown) {
    BrowserWindow.getAllWindows().forEach((window) => {
        if (window.isDestroyed() || window.webContents.isDestroyed()) return;
        window.webContents.send(channel, payload);
    });
}

function setStatus(next: RealtimeStatus) {
    status = next;
    broadcast("aypi-realtime-status", status);
}

function buildWebSocketUrl() {
    const url = new URL(resolveAypiBackendBaseUrl());
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = "/ws";
    url.search = "";
    url.searchParams.set("client", instanceId);
    url.searchParams.set(
        "user",
        process.env.USERNAME || process.env.USER || "Operatore AyPi",
    );
    url.searchParams.set("version", app.getVersion());
    return url.toString();
}

function scheduleReconnect(detail?: string) {
    if (stopping || retryTimer) return;
    const baseDelay = Math.min(30000, 1000 * 2 ** Math.min(retryAttempt, 5));
    const retryInMs = baseDelay + Math.floor(Math.random() * 500);
    retryAttempt += 1;
    setStatus({ state: "disconnected", retryInMs, detail });
    retryTimer = setTimeout(() => {
        retryTimer = null;
        connect();
    }, retryInMs);
    retryTimer.unref?.();
}

function clearSocketTimers() {
    if (connectionReadyTimer) {
        clearTimeout(connectionReadyTimer);
        connectionReadyTimer = null;
    }
    if (watchdogTimer) {
        clearInterval(watchdogTimer);
        watchdogTimer = null;
    }
}

function markSocketActivity() {
    lastActivityAt = Date.now();
}

function forceReconnect(targetSocket: WebSocket, detail: string) {
    if (stopping || socket !== targetSocket) return;
    forcedReconnectDetail = detail;
    clearSocketTimers();
    setStatus({ state: "disconnected", detail });
    log.warn(`[realtime] ${detail}`);
    targetSocket.terminate();
}

function handleMessage(raw: WebSocket.RawData) {
    markSocketActivity();
    let message: any;
    try {
        message = JSON.parse(raw.toString());
    } catch (error) {
        log.warn("[realtime] Messaggio WebSocket non valido:", error);
        return;
    }
    if (message?.type === "connection.ready") {
        if (connectionReadyTimer) {
            clearTimeout(connectionReadyTimer);
            connectionReadyTimer = null;
        }
        retryAttempt = 0;
        setStatus({
            state: "connected",
            connectedAt: new Date().toISOString(),
        });
        socket?.send(
            JSON.stringify({
                type: "subscribe",
                modules: SUBSCRIBED_MODULES,
            }),
        );
        broadcast("aypi-realtime-event", {
            type: "connection.resync",
            module: "*",
            timestamp: new Date().toISOString(),
        });
        return;
    }
    if (message?.type !== "module.changed") return;
    status = {
        ...status,
        lastEventAt: message.timestamp || new Date().toISOString(),
    };
    broadcast("aypi-realtime-event", message);
    broadcast("aypi-realtime-status", status);
}

function connect() {
    if (stopping || socket) return;
    let url = "";
    try {
        url = buildWebSocketUrl();
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        log.warn("[realtime] URL WebSocket non valido:", detail);
        scheduleReconnect(detail);
        return;
    }

    setStatus({ state: "connecting" });
    const nextSocket = new WebSocket(url, {
        handshakeTimeout: 10000,
    });
    socket = nextSocket;

    nextSocket.on("open", () => {
        log.info("[realtime] Connessione WebSocket aperta.");
        markSocketActivity();
        connectionReadyTimer = setTimeout(() => {
            forceReconnect(
                nextSocket,
                "Handshake realtime non completato: riconnessione automatica.",
            );
        }, CONNECTION_READY_TIMEOUT_MS);
        connectionReadyTimer.unref?.();
        watchdogTimer = setInterval(() => {
            const inactiveForMs = Date.now() - lastActivityAt;
            if (inactiveForMs < WATCHDOG_ACTIVITY_TIMEOUT_MS) return;
            forceReconnect(
                nextSocket,
                `Connessione realtime inattiva da ${Math.round(
                    inactiveForMs / 1000,
                )} secondi: riconnessione automatica.`,
            );
        }, WATCHDOG_CHECK_INTERVAL_MS);
        watchdogTimer.unref?.();
    });
    nextSocket.on("ping", markSocketActivity);
    nextSocket.on("pong", markSocketActivity);
    nextSocket.on("message", handleMessage);
    nextSocket.on("close", (code, reason) => {
        clearSocketTimers();
        if (socket === nextSocket) socket = null;
        const detail =
            forcedReconnectDetail ||
            `Connessione chiusa (${code})${
                reason.length ? `: ${reason.toString("utf8")}` : ""
            }`;
        forcedReconnectDetail = "";
        if (!stopping) {
            if (!detail.includes("riconnessione automatica")) {
                log.warn(`[realtime] ${detail}`);
            }
            scheduleReconnect(detail);
        }
    });
    nextSocket.on("error", (error) => {
        log.warn("[realtime] Errore WebSocket:", error.message);
        forceReconnect(
            nextSocket,
            `Errore realtime: ${error.message}. Riconnessione automatica.`,
        );
    });
}

export function setupRealtimeClient() {
    if (started) return;
    started = true;
    ipcMain.handle("aypi-realtime-status-get", () => status);
    app.once("before-quit", () => {
        stopping = true;
        if (retryTimer) {
            clearTimeout(retryTimer);
            retryTimer = null;
        }
        clearSocketTimers();
        socket?.close(1000, "Applicazione in chiusura");
        socket = null;
    });
    connect();
}
