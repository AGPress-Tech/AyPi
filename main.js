const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const { setupAutoUpdater } = require("./modules/updater");
const { setupFileManager } = require("./modules/fileManager");
const { setupRobotManager } = require("./modules/robotManager");

let mainWindow;

app.setPath("userData", path.join(app.getPath("appData"), "AyPiUserData"));
app.commandLine.appendSwitch("disable-gpu-shader-disk-cache");

app.whenReady().then(() => {
    mainWindow = new BrowserWindow({
        width: 750,
        height: 550,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
        },
        icon: path.join(__dirname, 'assets', 'app-icon.png')
    });

    mainWindow.loadFile("./pages/index.html");
    mainWindow.setMenu(null);

    setupAutoUpdater(mainWindow);
    setupFileManager(mainWindow);
    setupRobotManager(mainWindow);
});

ipcMain.handle("get-app-version", async () => {
    return app.getVersion();
});

ipcMain.handle("select-root-folder", async () => {
    const result = await dialog.showOpenDialog({
        title: "Seleziona la cartella da analizzare",
        properties: ["openDirectory"]
    });

    if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
        return null;
    }
    return result.filePaths[0];
});

ipcMain.handle("select-output-file", async (event, options) => {
    const result = await dialog.showSaveDialog({
        title: "Seleziona il file Excel di destinazione",
        defaultPath: options?.defaultName || "lista_file.xlsx",
        filters: [
            { name: "File Excel", extensions: ["xlsx"] }
        ]
    });

    if (result.canceled || !result.filePath) {
        return null;
    }
    return result.filePath;
});

ipcMain.handle("show-message-box", async (event, options) => {
    // options: { type, message, detail }
    const win = BrowserWindow.getFocusedWindow() || mainWindow;

    return dialog.showMessageBox(win, {
        type: options.type || "none",  // "info", "error", "warning", "question", "none"
        buttons: ["OK"],
        title: "AyPi",
        message: options.message || "",
        detail: options.detail || ""
    });
});