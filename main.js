const { app, BrowserWindow, Menu, Tray, ipcMain, globalShortcut } = require("electron");
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
let triggerAdminHotkey = null;

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
            label: "Admin Prompt",
            click: () => {
                if (triggerAdminHotkey) {
                    triggerAdminHotkey();
                }
            },
        },
        { type: "separator" },
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

    triggerAdminHotkey = () => {
        const windows = BrowserWindow.getAllWindows();
        windows.forEach((win) => {
            if (!win || win.isDestroyed() || !win.webContents) return;
            win.webContents.send("admin-hotkey");
        });
    };

    globalShortcut.register("F2", () => {
        if (triggerAdminHotkey) triggerAdminHotkey();
    });
});

app.on("browser-window-created", (_event, win) => {
    if (!win || !win.webContents) return;
    win.webContents.on("did-finish-load", () => {
        win.webContents.insertCSS(SCROLLBAR_CSS).catch(() => {});
        const installHotkey = `
            (() => {
                if (window.__aypiAdminHotkeyInstalled) return;
                window.__aypiAdminHotkeyInstalled = true;
                try {
                    const { ipcRenderer } = require("electron");
                    const ensureAdminPrompt = () => {
                        if (document.getElementById("aypi-admin-overlay")) {
                            return;
                        }
                        const overlay = document.createElement("div");
                        overlay.id = "aypi-admin-overlay";
                        overlay.style.position = "fixed";
                        overlay.style.inset = "0";
                        overlay.style.background = "rgba(0, 0, 0, 0.55)";
                        overlay.style.display = "none";
                        overlay.style.alignItems = "center";
                        overlay.style.justifyContent = "center";
                        overlay.style.zIndex = "9999";

                        const card = document.createElement("div");
                        card.style.background = "#2b2824";
                        card.style.border = "1px solid #4a433d";
                        card.style.borderRadius = "10px";
                        card.style.boxShadow = "0 8px 20px rgba(0,0,0,0.6)";
                        card.style.padding = "14px 16px";
                        card.style.minWidth = "280px";

                        const title = document.createElement("div");
                        title.textContent = "Admin";
                        title.style.color = "#e4ab32";
                        title.style.fontWeight = "600";
                        title.style.marginBottom = "8px";

                        const input = document.createElement("input");
                        input.type = "password";
                        input.placeholder = "Password";
                        input.style.width = "100%";
                        input.style.boxSizing = "border-box";
                        input.style.padding = "6px 8px";
                        input.style.borderRadius = "6px";
                        input.style.border = "1px solid #777";
                        input.style.background = "#1f1c19";
                        input.style.color = "#fff";
                        input.style.marginBottom = "10px";

                        const actions = document.createElement("div");
                        actions.style.display = "flex";
                        actions.style.justifyContent = "flex-end";
                        actions.style.gap = "8px";

                        const cancelBtn = document.createElement("button");
                        cancelBtn.type = "button";
                        cancelBtn.textContent = "Annulla";
                        cancelBtn.style.padding = "6px 12px";
                        cancelBtn.style.borderRadius = "6px";
                        cancelBtn.style.border = "none";
                        cancelBtn.style.background = "#4a433d";
                        cancelBtn.style.color = "#f3e6d5";

                        const okBtn = document.createElement("button");
                        okBtn.type = "button";
                        okBtn.textContent = "Conferma";
                        okBtn.style.padding = "6px 12px";
                        okBtn.style.borderRadius = "6px";
                        okBtn.style.border = "none";
                        okBtn.style.background = "#cc930e";
                        okBtn.style.color = "#332f2b";

                        actions.appendChild(cancelBtn);
                        actions.appendChild(okBtn);

                        card.appendChild(title);
                        card.appendChild(input);
                        card.appendChild(actions);
                        overlay.appendChild(card);
                        document.body.appendChild(overlay);

                        const close = () => {
                            overlay.style.display = "none";
                            input.value = "";
                        };

                        cancelBtn.addEventListener("click", close);
                        overlay.addEventListener("click", (event) => {
                            if (event.target === overlay) close();
                        });

                        const submit = async () => {
                            const password = input.value;
                            if (!password) return;
                            const result = await ipcRenderer.invoke("admin-auth", password);
                            if (result && result.ok) {
                                ipcRenderer.invoke("show-message-box", {
                                    type: "info",
                                    message: "Accesso admin attivo fino alla chiusura dell'app.",
                                });
                            } else {
                                ipcRenderer.invoke("show-message-box", {
                                    type: "warning",
                                    message: "Password non valida.",
                                });
                            }
                            close();
                        };

                        okBtn.addEventListener("click", submit);
                        input.addEventListener("keydown", (event) => {
                            if (event.key === "Enter") {
                                event.preventDefault();
                                submit();
                            } else if (event.key === "Escape") {
                                event.preventDefault();
                                close();
                            }
                        });
                    };

                    const runPrompt = async () => {
                        const isAdmin = await ipcRenderer.invoke("admin-is-enabled");
                        if (isAdmin) {
                            await ipcRenderer.invoke("admin-disable");
                            ipcRenderer.invoke("show-message-box", {
                                type: "info",
                                message: "Modalita ADMIN terminata",
                            });
                            return;
                        }

                        ensureAdminPrompt();
                        const overlay = document.getElementById("aypi-admin-overlay");
                        const input = overlay ? overlay.querySelector("input") : null;
                        if (!overlay || !input) return;
                        overlay.style.display = "flex";
                        input.focus();
                        input.select();
                    };

                    window.addEventListener("keydown", async (event) => {
                        if (event.key !== "F2") return;
                        event.preventDefault();
                        runPrompt();
                    });

                    ipcRenderer.on("admin-hotkey", () => {
                        runPrompt();
                    });
                } catch (err) {
                    console.error("Admin hotkey install failed:", err);
                }
            })();
        `;
        win.webContents.executeJavaScript(installHotkey, true).catch(() => {});
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
