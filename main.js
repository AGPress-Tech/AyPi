const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const { autoUpdater } = require("electron-updater");
const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");

let mainWindow;

const log = require("electron-log");
log.transports.file.level = "info";
autoUpdater.logger = log;

app.whenReady().then(() => {
    mainWindow = new BrowserWindow({
        width: 650,
        height: 550,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
        },
        icon: path.join(__dirname, 'assets', 'app-icon.png')
    });

    mainWindow.loadFile("index.html");

    mainWindow.setMenu(null);

    autoUpdater.checkForUpdatesAndNotify();
});

autoUpdater.setFeedURL({
    provider: 'github',
    owner: 'AGPress-Tech',
    repo: 'AyPi',
    private: false,
    url: 'https://github.com/AGPress-Tech/AyPi/releases/download/'
});


autoUpdater.on("update-available", (info) => {
    log.info("Aggiornamento disponibile: " + info.version);
    dialog.showMessageBox(mainWindow, {
        type: "info",
        title: "Aggiornamento disponibile",
        message: `È disponibile una nuova versione (${info.version}). L'aggiornamento verrà scaricato in background.`,
    });
});

autoUpdater.on("update-downloaded", () => {
    dialog.showMessageBox(mainWindow, {
        type: "info",
        title: "Aggiornamento pronto",
        message: "L'aggiornamento è stato scaricato. Vuoi riavviare ora per applicarlo?",
        buttons: ["Riavvia ora", "Dopo"],
    }).then((result) => {
        if (result.response === 0) {
            log.info("Riavvio per installare l'aggiornamento.");
            autoUpdater.quitAndInstall();
        } else {
            log.info("L'utente ha scelto di aggiornare più tardi.");
        }
    });
});

autoUpdater.on("error", (error) => {
    log.error("Errore nell'aggiornamento:", error);

    dialog.showMessageBox(mainWindow, {
        type: 'error',
        buttons: ['Ok'],
        defaultId: 0,
        title: "Errore Aggiornamento",
        message: "Errore durante l'aggiornamento. Contattare Ayrton."
    });
});

ipcMain.handle("get-app-version", async () => {
    return app.getVersion();
});

ipcMain.on("open-file", (event, filePath) => {
    exec(`start "" "${filePath}"`, (error) => {
        if (error) {
            log.error("Errore nell'apertura de file:", error);
            dialog.showMessageBox(mainWindow, {
                type: 'error',
                buttons: ['Ok'],
                defaultId: 0,
                title: "Errore",
                message: "Errore nell'esecuzione dell'applicazione. Contattare Ayrton."
            }).then(() => {
                app.quit();
            });
        }
    });
});
