const { app, BrowserWindow } = require("electron");
const path = require("path");
const { setupAutoUpdater } = require("./modules/updater");
const { setupFileManager } = require("./modules/fileManager");
const { setupRobotManager } = require("./modules/robotManager");

let mainWindow;
let batchRenameWindow = null;
let compareFoldersWindow = null;

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
        icon: path.join(__dirname, "assets", "app-icon.png"),
    });

    mainWindow.loadFile("./pages/index.html");
    mainWindow.setMenu(null);

    setupAutoUpdater(mainWindow);
    setupFileManager(mainWindow);
    setupRobotManager(mainWindow);
});
