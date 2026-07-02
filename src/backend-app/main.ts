import { app, BrowserWindow, Menu, Tray, dialog, shell, ipcMain } from "electron";
import path from "path";
import fs from "fs";
import { ensureBackendRuntimeConfigFile, getMachineSummary, loadBackendRuntimeConfig } from "./config";
import {
    buildLogViewerHtml,
    loadLogViewerData,
    type LogViewerCursor,
    type LogViewerFilters,
} from "./log-viewer";

type BackendState = {
    running: boolean;
    error: string;
    url: string;
    startedAt: string;
};

type BackendHandle = {
    stop: () => Promise<void>;
    url: string;
};

let tray: Tray | null = null;
let backendHandle: BackendHandle | null = null;
let keepAliveWindow: BrowserWindow | null = null;
let logViewerWindow: BrowserWindow | null = null;
let backendState: BackendState = {
    running: false,
    error: "",
    url: "",
    startedAt: "",
};
const debugLogPath = path.join(process.env.TEMP || process.cwd(), "aypi-backend-tray.log");

const isHeadless =
    process.argv.includes("--headless") ||
    process.env.AYPI_BACKEND_HEADLESS === "1";
const gotLock = isHeadless ? true : app.requestSingleInstanceLock();

if (!gotLock) {
    app.quit();
}

function getTrayIconPath() {
    const icoPath = path.join(__dirname, "..", "assets", "app-icon.ico");
    const pngPath = path.join(__dirname, "..", "assets", "app-icon.png");
    return process.platform === "win32" ? icoPath : pngPath;
}

function debugLog(message: string, extra?: unknown) {
    try {
        const line = `[${new Date().toISOString()}] ${message}${
            extra === undefined ? "" : ` ${JSON.stringify(extra)}`
        }\n`;
        fs.appendFileSync(debugLogPath, line, "utf8");
    } catch {
        // ignore
    }
}

function applyRuntimeConfig() {
    const loaded = loadBackendRuntimeConfig();
    ensureBackendRuntimeConfigFile(loaded.configPath);
    process.env.AYPI_BACKEND_HOST = loaded.config.host;
    process.env.AYPI_BACKEND_ADVERTISED_HOST = loaded.config.advertisedHost;
    process.env.AYPI_BACKEND_PORT = String(loaded.config.port);
    process.env.AYPI_FP_CALENDAR_DIR = loaded.config.calendarDir;
    process.env.AYPI_FP_GENERAL_DIR = loaded.config.generalDir;
    process.env.AYPI_LOG_DIR = loaded.config.logDir;
    return loaded;
}

async function startBackend() {
    if (backendHandle) return backendHandle;
    const backendModulePath = path.join(__dirname, "..", "backend-dist", "app");
    debugLog("startBackend.require", { backendModulePath });
    const backendModule = require(backendModulePath) as {
        startBackendServer: () => Promise<BackendHandle>;
    };
    backendHandle = await backendModule.startBackendServer();
    debugLog("startBackend.started", { url: backendHandle.url });
    backendState = {
        running: true,
        error: "",
        url: backendHandle.url,
        startedAt: new Date().toISOString(),
    };
    updateTrayMenu();
    return backendHandle;
}

async function stopBackend() {
    if (!backendHandle) return;
    const current = backendHandle;
    backendHandle = null;
    await current.stop();
    backendState = {
        running: false,
        error: "",
        url: "",
        startedAt: "",
    };
    updateTrayMenu();
}

async function restartBackend() {
    try {
        await stopBackend();
    } catch {
        // continue with restart
    }
    return startBackend();
}

function updateTrayMenu() {
    if (!tray) return;
    const loaded = loadBackendRuntimeConfig();
    const machine = getMachineSummary();
    const statusLabel = backendState.running
        ? `Backend attivo: ${backendState.url}`
        : `Backend fermo${backendState.error ? ` (${backendState.error})` : ""}`;
    const template: Electron.MenuItemConstructorOptions[] = [
        { label: statusLabel, enabled: false },
        { label: `Host: ${loaded.config.host}:${loaded.config.port}`, enabled: false },
        { label: `Calendar: ${loaded.config.calendarDir}`, enabled: false },
        { label: `General: ${loaded.config.generalDir}`, enabled: false },
        { label: `PID: ${machine.pid} • ${machine.hostName}`, enabled: false },
        { type: "separator" },
        {
            label: "Avvia backend",
            enabled: !backendState.running,
            click: () => {
                startBackend().catch(handleBackendError);
            },
        },
        {
            label: "Ferma backend",
            enabled: backendState.running,
            click: () => {
                stopBackend().catch(handleBackendError);
            },
        },
        {
            label: "Riavvia backend",
            click: () => {
                restartBackend().catch(handleBackendError);
            },
        },
        { type: "separator" },
        {
            label: "Apri logger backend",
            click: () => {
                openLogViewerWindow();
            },
        },
        {
            label: "Apri cartella log",
            click: () => {
                fs.mkdirSync(loaded.config.logDir, { recursive: true });
                shell.openPath(loaded.config.logDir);
            },
        },
        {
            label: "Apri cartella script server",
            click: () => {
                shell.openPath(path.join(process.resourcesPath, "backend-scripts"));
            },
        },
        {
            label: "Apri config runtime",
            click: async () => {
                await shell.openPath(loaded.configPath);
            },
        },
        { type: "separator" },
        {
            label: "Esci",
            click: async () => {
                await stopBackend().catch(() => {});
                app.quit();
            },
        },
    ];
    tray.setContextMenu(Menu.buildFromTemplate(template));
    tray.setToolTip(
        backendState.running
            ? `AyPi Backend attivo su ${backendState.url}`
            : `AyPi Backend fermo${backendState.error ? `: ${backendState.error}` : ""}`,
    );
}

function handleBackendError(error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[AyPi Backend tray] error:", detail);
    debugLog("handleBackendError", { detail });
    backendState = {
        running: false,
        error: detail,
        url: "",
        startedAt: "",
    };
    updateTrayMenu();
    if (isHeadless) {
        app.exit(1);
        return;
    }
    if (!isHeadless) {
        dialog.showErrorBox("AyPi Backend", detail);
    }
}

function registerLogViewerIpc() {
    ipcMain.removeHandler("backend-log-viewer:list");
    ipcMain.handle(
        "backend-log-viewer:list",
        async (
            _event,
            filters: LogViewerFilters = {},
            cursor?: LogViewerCursor | null,
        ) => {
            const loaded = loadBackendRuntimeConfig();
            fs.mkdirSync(loaded.config.logDir, { recursive: true });
            return loadLogViewerData(
                loaded.config.logDir,
                debugLogPath,
                filters,
                cursor,
            );
        },
    );
}

function openLogViewerWindow() {
    if (logViewerWindow && !logViewerWindow.isDestroyed()) {
        if (logViewerWindow.isMinimized()) logViewerWindow.restore();
        logViewerWindow.maximize();
        logViewerWindow.show();
        logViewerWindow.focus();
        return;
    }
    logViewerWindow = new BrowserWindow({
        width: 1520,
        height: 920,
        minWidth: 1180,
        minHeight: 760,
        autoHideMenuBar: true,
        title: "AyPi Backend Logger",
        backgroundColor: "#eef2f7",
        icon: getTrayIconPath(),
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
        },
    });
    logViewerWindow.maximize();
    logViewerWindow.on("closed", () => {
        logViewerWindow = null;
    });
    logViewerWindow
        .loadURL(
            `data:text/html;charset=UTF-8,${encodeURIComponent(
                buildLogViewerHtml(),
            )}`,
        )
        .catch((error) => {
            handleBackendError(error);
        });
}

async function bootstrap() {
    debugLog("bootstrap.begin", { argv: process.argv, headless: isHeadless });
    app.setName("AyPi Backend");
    app.setAppUserModelId("com.Agpress.AyPiBackend");
    const loaded = applyRuntimeConfig();
    debugLog("bootstrap.config", loaded.config);
    registerLogViewerIpc();
    if (isHeadless) {
        keepAliveWindow = new BrowserWindow({
            show: false,
            width: 1,
            height: 1,
            frame: false,
            skipTaskbar: true,
        });
        keepAliveWindow.loadURL("about:blank").catch(() => {});
        debugLog("bootstrap.keepAliveWindow.created");
    }
    if (!isHeadless) {
        tray = new Tray(getTrayIconPath());
        updateTrayMenu();
        tray.on("double-click", () => {
            openLogViewerWindow();
        });
    }
    try {
        await startBackend();
    } catch (error) {
        handleBackendError(error);
    }
}

app.whenReady().then(bootstrap);
app.on("window-all-closed", () => {});
app.on("before-quit", async () => {
    debugLog("before-quit");
    await stopBackend().catch(() => {});
    if (keepAliveWindow && !keepAliveWindow.isDestroyed()) {
        keepAliveWindow.destroy();
        keepAliveWindow = null;
    }
});

process.on("SIGINT", async () => {
    await stopBackend().catch(() => {});
    process.exit(0);
});
process.on("SIGTERM", async () => {
    await stopBackend().catch(() => {});
    process.exit(0);
});
