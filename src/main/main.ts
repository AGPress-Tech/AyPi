import { app, BrowserWindow, Menu, Tray, ipcMain, globalShortcut } from "electron";
import path from "path";
import fs from "fs";
import {
    setupFileManager,
    openTimerWindow,
    applyInterfaceIconToWindow,
    getInterfaceIconPath,
    setInterfaceIconTheme,
} from "./modules/fileManager";
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
const IS_BLUE_ARCHIVE_PREVIEW = process.argv.includes("--bluearchive-preview");
if (IS_BLUE_ARCHIVE_PREVIEW) {
    process.env.AYPI_BLUEARCHIVE_PREVIEW = "1";
}
let isBlueArchiveTheme = false;
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
    // Suppress Electron security warnings in dev console
    process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = "true";
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

function getThemeSettingsPath() {
    return path.join(app.getPath("userData"), "interface-theme.json");
}

function loadBlueArchivePreference() {
    if (IS_BLUE_ARCHIVE_PREVIEW) return true;
    try {
        const saved = JSON.parse(fs.readFileSync(getThemeSettingsPath(), "utf8"));
        return saved && saved.theme === "bluearchive";
    } catch {
        return false;
    }
}

function saveThemePreference(theme: "standard" | "bluearchive") {
    if (IS_BLUE_ARCHIVE_PREVIEW) return;
    fs.mkdirSync(app.getPath("userData"), { recursive: true });
    fs.writeFileSync(
        getThemeSettingsPath(),
        JSON.stringify({ theme, updatedAt: new Date().toISOString() }, null, 2),
        "utf8",
    );
}

function usesBlueArchiveUi() {
    return IS_BLUE_ARCHIVE_PREVIEW || isBlueArchiveTheme;
}

async function loadMainInterface(win: BrowserWindow, useBlueArchive: boolean) {
    win.setMinimumSize(useBlueArchive ? 1040 : 0, useBlueArchive ? 640 : 0);
    win.setBackgroundColor(useBlueArchive ? "#eaf7ff" : "#ffffff");
    win.setSize(useBlueArchive ? 1360 : 750, useBlueArchive ? 820 : 550, true);
    win.center();
    await win.loadFile(
        path.join(
            __dirname,
            "pages",
            useBlueArchive ? "bluearchive-preview.html" : "index.html",
        ),
    );
}
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
    return getInterfaceIconPath(true);
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
    isBlueArchiveTheme = loadBlueArchivePreference();
    const useBlueArchiveUi = usesBlueArchiveUi();
    setInterfaceIconTheme(useBlueArchiveUi ? "bluearchive" : "standard");
    mainWindow = new BrowserWindow({
        width: useBlueArchiveUi ? 1360 : 750,
        height: useBlueArchiveUi ? 820 : 550,
        minWidth: useBlueArchiveUi ? 1040 : undefined,
        minHeight: useBlueArchiveUi ? 640 : undefined,
        backgroundColor: useBlueArchiveUi ? "#eaf7ff" : undefined,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
        },
        icon: getInterfaceIconPath(),
    });

    mainWindow.loadFile(
        path.join(
            __dirname,
            "pages",
            useBlueArchiveUi ? "bluearchive-preview.html" : "index.html",
        ),
    );
    mainWindow.setMenu(null);

    mainWindow.on("close", (event) => {
        if (IS_BLUE_ARCHIVE_PREVIEW) {
            isQuitting = true;
            return;
        }
        if (!isQuitting) {
            event.preventDefault();
            mainWindow.hide();
        }
    });

    if (IS_BLUE_ARCHIVE_PREVIEW) {
        setupFileManager(mainWindow);
        setupRobotManager();
        triggerAdminHotkey = () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send("admin-hotkey");
            }
        };
        return;
    }

    createTray();

    try {
        const { setupAutoUpdater } = require("./modules/updater");
        if (typeof setupAutoUpdater === "function") {
            setupAutoUpdater(mainWindow);
        }
    } catch (err) {
        console.error("Auto-updater non disponibile:", err);
    }
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
    applyInterfaceIconToWindow(win);
    const notifyAdminPromptClose = () => {
        if (!win || win.isDestroyed() || !win.webContents) return;
        win.webContents.send("admin-hotkey-close");
        win.webContents.send("theme-hotkey-close");
        win.webContents.send("animation-lab-close");
    };
    win.on("blur", notifyAdminPromptClose);
    win.on("minimize", notifyAdminPromptClose);
    win.on("hide", notifyAdminPromptClose);
    win.webContents.on("did-finish-load", () => {
        win.webContents.insertCSS(SCROLLBAR_CSS).catch(() => {});
    });
    win.webContents.on("before-input-event", (event, input) => {
        if (
            input &&
            input.key === "F4" &&
            input.type === "keyDown" &&
            !input.isAutoRepeat &&
            win === mainWindow
        ) {
            event.preventDefault();
            win.webContents.send("theme-hotkey");
            return;
        }
        if (
            input &&
            input.key === "F6" &&
            input.type === "keyDown" &&
            !input.isAutoRepeat &&
            win === mainWindow &&
            usesBlueArchiveUi()
        ) {
            event.preventDefault();
            win.webContents.send("animation-lab-hotkey");
            return;
        }
        if (
            !input ||
            input.key !== "F2" ||
            input.type !== "keyDown" ||
            input.isAutoRepeat
        ) return;
        event.preventDefault();
        if (!win || win.isDestroyed() || !win.webContents) return;
        const isAttrezzaggioWindow = win.webContents
            .getURL()
            .toLowerCase()
            .includes("attrezzaggio.html");
        win.webContents.send(
            isAttrezzaggioWindow
                ? "attrezzaggio-add-row-shortcut"
                : "admin-hotkey",
        );
    });

    if (IS_DEV) {
        win.webContents.on("console-message", (_event, level, message, line, sourceId) => {
            console.log(`[renderer:${level}] ${message} (${sourceId}:${line})`);
        });
        win.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
            console.error(`[renderer] did-fail-load ${errorCode} ${errorDescription} ${validatedURL}`);
        });
        win.webContents.on("render-process-gone", (_event, details) => {
            console.error("[renderer] process gone:", details);
        });
    }
});

app.on("before-quit", () => {
    isQuitting = true;
    globalShortcut.unregister("F2");
});

ipcMain.on("quit-app", () => {
    isQuitting = true;
    app.quit();
});

ipcMain.handle("theme-auth", async (event, password) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    if (!mainWindow || senderWindow !== mainWindow) return { ok: false };
    const value = typeof password === "string" ? password.trim() : "";
    let nextTheme: "standard" | "bluearchive" | null = null;
    if (value === "BlueArchive") nextTheme = "bluearchive";
    if (value === "AGPress") nextTheme = "standard";
    if (!nextTheme) return { ok: false };

    saveThemePreference(nextTheme);
    isBlueArchiveTheme = nextTheme === "bluearchive";
    const targetUsesBlueArchive = isBlueArchiveTheme;
    setInterfaceIconTheme(nextTheme);
    if (tray) {
        tray.setImage(getTrayIconPath());
    }
    setTimeout(() => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        loadMainInterface(mainWindow, targetUsesBlueArchive).catch((error) => {
            console.error("Impossibile cambiare modalità grafica:", error);
        });
    }, 60);
    return { ok: true, theme: nextTheme };
});

ipcMain.handle("theme-current", () =>
    usesBlueArchiveUi() ? "bluearchive" : "standard",
);

ipcMain.handle("animation-lab-auth", (event, password) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    return !!(
        mainWindow &&
        senderWindow === mainWindow &&
        usesBlueArchiveUi() &&
        password === "BlueArchive"
    );
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
