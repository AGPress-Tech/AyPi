const { app, BrowserWindow, Menu, Tray, ipcMain } = require("electron");
const path = require("path");
const { setupAutoUpdater } = require("./modules/updater");
const { setupFileManager, openTimerWindow } = require("./modules/fileManager");
const { setupRobotManager } = require("./modules/robotManager");

let mainWindow;
let batchRenameWindow = null;
let compareFoldersWindow = null;
let tray = null;
let isQuitting = false;
let trayTimers = [];
let trayMenu = null;
let pendingTrayPopup = false;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
    app.quit();
} else {
    app.on("second-instance", () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) {
                mainWindow.restore();
            }
            mainWindow.show();
            mainWindow.focus();
        }
    });
}

app.setPath("userData", path.join(app.getPath("appData"), "AyPiUserData"));
app.commandLine.appendSwitch("disable-gpu-shader-disk-cache");

function getTrayIconPath() {
    const icoPath = path.join(__dirname, "assets", "app-icon.ico");
    const pngPath = path.join(__dirname, "assets", "app-icon.png");
    return process.platform === "win32" ? icoPath : pngPath;
}

function createTray() {
    if (tray) return;
    tray = new Tray(getTrayIconPath());
    tray.setToolTip("AyPi");
    updateTrayMenu();
    tray.on("double-click", () => {
        if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
        }
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
                if (mainWindow) {
                    mainWindow.show();
                    mainWindow.focus();
                }
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
    setupRobotManager(mainWindow);
});

app.on("before-quit", () => {
    isQuitting = true;
});

app.on("browser-window-focus", () => {
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
