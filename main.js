const { app, BrowserWindow, Menu, Tray, ipcMain } = require("electron");
const path = require("path");
const { setupAutoUpdater } = require("./modules/updater");
const { setupFileManager, openTimerWindow } = require("./modules/fileManager");
const { setupRobotManager } = require("./modules/robotManager");

let mainWindow;
let tray = null;
let isQuitting = false;
let trayTimers = [];
let trayMenu = null;
let pendingTrayPopup = false;
let fpCalendarSplashShown = false;

const APP_NAME = "AyPi";
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

function getTrayIconPath() {
    const icoPath = path.join(__dirname, "assets", "app-icon.ico");
    const pngPath = path.join(__dirname, "assets", "app-icon.png");
    return process.platform === "win32" ? icoPath : pngPath;
}

function isWindowAlive(win) {
    return win && !win.isDestroyed();
}

function showAndFocus(win) {
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
        label: `${timer.name} • ${timer.time}`,
        click: () => {
            openTimerWindow(mainWindow);
        },
    }));

    trayMenu = Menu.buildFromTemplate([
        ...(timerItems.length
            ? [
                { label: "Timer / Cronometri in corso", enabled: false },
                ...timerItems,
                { type: "separator" },
            ]
            : []),
        {
            label: "Apri",
            click: () => {
                showAndFocus(mainWindow);
            },
        },
        {
            label: "Esci",
            click: () => {
                isQuitting = true;
                app.quit();
            },
        },
    ]);
}

function requestTrayUpdateAndPopup() {
    if (!tray) return;
    pendingTrayPopup = true;
    requestTrayUpdate();
    setTimeout(() => {
        if (!pendingTrayPopup) return;
        pendingTrayPopup = false;
        updateTrayMenu();
        tray.popUpContextMenu(trayMenu || undefined);
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

    mainWindow.loadFile("./pages/index.html");
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
});

app.on("browser-window-created", (_event, win) => {
    if (!win || !win.webContents) return;
    win.webContents.on("did-finish-load", () => {
        win.webContents.insertCSS(SCROLLBAR_CSS).catch(() => {});
    });
});

app.on("before-quit", () => {
    isQuitting = true;
});

app.on("browser-window-focus", () => {
    requestTrayUpdate();
});

app.on("browser-window-created", () => {
    requestTrayUpdate();
});

ipcMain.on("timers-tray-update", (event, payload) => {
    const items = payload && Array.isArray(payload.items) ? payload.items : [];
    trayTimers = items
        .filter(item => item && typeof item.name === "string" && typeof item.time === "string")
        .map(item => ({
            name: item.name,
            time: item.time,
        }));
    updateTrayMenu();
    if (pendingTrayPopup) {
        pendingTrayPopup = false;
        tray.popUpContextMenu(trayMenu || undefined);
    }
});

ipcMain.handle("fp-calendar-splash-should-show", () => {
    const shouldShow = !fpCalendarSplashShown;
    fpCalendarSplashShown = true;
    return shouldShow;
});
