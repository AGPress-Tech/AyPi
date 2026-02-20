import { app, BrowserWindow, Menu, Tray, ipcMain, globalShortcut } from "electron";
import path from "path";
import { setupAutoUpdater } from "./modules/updater";
import { setupFileManager, openTimerWindow } from "./modules/fileManager";
import { setupRobotManager } from "./modules/robotManager";

let mainWindow: BrowserWindow | null;
let tray: Tray | null = null;
let isQuitting = false;
let trayTimers: Array<{ name: string; time: string }> = [];
let trayMenu: Electron.Menu | null = null;
let pendingTrayPopup = false;
let triggerAdminHotkey: (() => void) | null = null;

const APP_NAME = "AyPi";
const APP_ID = "com.Agpress.AyPi";
const SCROLLBAR_CSS = `
    * {
        scrollbar-width: thin;
        scrollbar-color: rgba(120, 120, 120, 0.45) transparent;
    }
    *::-webkit-scrollbar {
        width: 6px;
        height: 6px;
    }
    *::-webkit-scrollbar-track {
        background: transparent;
    }
    *::-webkit-scrollbar-thumb {
        background-color: rgba(120, 120, 120, 0.45);
        border-radius: 999px;
    }
    *::-webkit-scrollbar-thumb:hover {
        background-color: rgba(120, 120, 120, 0.7);
    }
`;

const IS_DEV = !app.isPackaged;
if (IS_DEV) {
    process.env.AYPI_DEV = "1";
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
    app.quit();
} else {
    app.on("second-instance", () => {
        showAndFocus(mainWindow);
    });
}

app.setPath("userData", path.join(app.getPath("appData"), "AyPiUserData"));
app.commandLine.appendSwitch("disable-gpu-shader-disk-cache");
if (process.platform === "win32") {
    try {
        app.setAppUserModelId(APP_ID);
        app.setJumpList([]);
    } catch {
        // ignore: only relevant for Windows shell integration
    }
}

if (IS_DEV) {
    const onChannels = new Set<string>();
    const handleChannels = new Set<string>();
    const originalOn = ipcMain.on.bind(ipcMain);
    const originalHandle = ipcMain.handle.bind(ipcMain);

    ipcMain.on = (channel: string, listener: (...args: any[]) => void) => {
        onChannels.add(channel);
        return originalOn(channel, listener);
    };

    ipcMain.handle = (channel: string, listener: (...args: any[]) => any) => {
        handleChannels.add(channel);
        return originalHandle(channel, listener);
    };

    ipcMain.handle("dev-ipc-channels", () => ({
        on: Array.from(onChannels),
        handle: Array.from(handleChannels),
    }));

    try {
        const fs = require("fs");
        const Module = require("module");
        const originalLoad = Module._load;
        Module._load = function (request: string, parent: { filename?: string } | null, isMain: boolean) {
            if (typeof request === "string" && request.startsWith(".") && parent && parent.filename) {
                try {
                    const resolved = Module._resolveFilename(request, parent, isMain);
                    if (typeof resolved === "string" && !fs.existsSync(resolved)) {
                        console.warn(`[aypi-dev] require missing path: ${request} -> ${resolved}`);
                    }
                } catch (err) {
                    console.warn(`[aypi-dev] require resolve failed: ${request}`, err);
                }
            }
            return originalLoad.apply(this, arguments as any);
        };
    } catch (err) {
        console.warn("[aypi-dev] Module patch failed:", err);
    }
}

function getTrayIconPath() {
    const icoPath = path.join(__dirname, "assets", "app-icon.ico");
    const pngPath = path.join(__dirname, "assets", "app-icon.png");
    return process.platform === "win32" ? icoPath : pngPath;
}

function isWindowAlive(win: BrowserWindow | null | undefined): win is BrowserWindow {
    return !!win && !win.isDestroyed();
}

function showAndFocus(win: BrowserWindow | null | undefined) {
    if (!isWindowAlive(win)) return;
    if (win.isMinimized()) {
        win.restore();
    }
    win.show();
    win.focus();
}

function createTray() {
    if (tray) return;
    tray = new Tray(getTrayIconPath());
    tray.setToolTip(APP_NAME);
    updateTrayMenu();
    tray.on("double-click", () => {
        showAndFocus(mainWindow);
    });
    tray.on("right-click", () => {
        requestTrayUpdateAndPopup();
    });
}

function updateTrayMenu() {
    if (!tray) return;

    const timerItems = (trayTimers || []).map(timer => ({
        label: `${timer.name} â€¢ ${timer.time}`,
        click: () => {
            if (!mainWindow) return;
            openTimerWindow(mainWindow);
        },
    }));

    const template: Electron.MenuItemConstructorOptions[] = [
        ...(timerItems.length
            ? [
                { label: "Timer / Cronometri in corso", enabled: false },
                ...timerItems,
                { type: "separator" as const },
            ]
            : []),
        {
            label: "Apri",
            click: () => {
                showAndFocus(mainWindow);
            },
        },
        {
            label: "Admin Prompt",
            click: () => {
                if (triggerAdminHotkey) {
                    triggerAdminHotkey();
                }
            },
        },
        { type: "separator" as const },
        {
            label: "Esci",
            click: () => {
                isQuitting = true;
                app.quit();
            },
        },
    ];
    trayMenu = Menu.buildFromTemplate(template);
}

function requestTrayUpdateAndPopup() {
    if (!tray) return;
    pendingTrayPopup = true;
    requestTrayUpdate();
    setTimeout(() => {
        if (!pendingTrayPopup) return;
        pendingTrayPopup = false;
        updateTrayMenu();
        tray?.popUpContextMenu(trayMenu || undefined);
    }, 200);
}

function requestTrayUpdate() {
    const windows = BrowserWindow.getAllWindows();
    windows.forEach(win => {
        if (win && win.webContents) {
            win.webContents.send("timers-tray-request");
        }
    });
}

app.whenReady().then(() => {
    mainWindow = new BrowserWindow({
        width: 750,
        height: 550,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
        },
        icon: path.join(__dirname, "assets", "app-icon.png"),
    });

    mainWindow.loadFile(path.join(__dirname, "pages", "index.html"));
    mainWindow.setMenu(null);

    mainWindow.on("close", (event) => {
        if (!isQuitting) {
            event.preventDefault();
            mainWindow.hide();
        }
    });

    createTray();

    setupAutoUpdater(mainWindow);
    setupFileManager(mainWindow);
    setupRobotManager();

    triggerAdminHotkey = () => {
        const windows = BrowserWindow.getAllWindows();
        windows.forEach((win) => {
            if (!win || win.isDestroyed() || !win.webContents) return;
            win.webContents.send("admin-hotkey");
        });
    };
});

app.on("browser-window-created", (_event, win) => {
    if (!win || !win.webContents) return;
    const notifyAdminPromptClose = () => {
        if (!win || win.isDestroyed() || !win.webContents) return;
        win.webContents.send("admin-hotkey-close");
    };
    win.on("blur", notifyAdminPromptClose);
    win.on("minimize", notifyAdminPromptClose);
    win.on("hide", notifyAdminPromptClose);
    win.webContents.on("did-finish-load", () => {
        win.webContents.insertCSS(SCROLLBAR_CSS).catch(() => {});
    });
    win.webContents.on("before-input-event", (event, input) => {
        if (input && input.key === "F2" && input.type === "keyDown") {
            event.preventDefault();
            if (win && win.webContents) {
                win.webContents.send("admin-hotkey");
            }
        }
    });
});

app.on("before-quit", () => {
    isQuitting = true;
    globalShortcut.unregister("F2");
});

app.on("browser-window-focus", () => {
    requestTrayUpdate();
});

app.on("browser-window-created", () => {
    requestTrayUpdate();
});

ipcMain.on("timers-tray-update", (_event, payload) => {
    const items = payload && Array.isArray(payload.items) ? payload.items : [];
    trayTimers = items
        .filter(item => item && typeof item.name === "string" && typeof item.time === "string")
        .map(item => ({
            name: item.name,
            time: item.time,
        }));
    updateTrayMenu();
    if (pendingTrayPopup && tray) {
        pendingTrayPopup = false;
        tray.popUpContextMenu(trayMenu || undefined);
    }
});
