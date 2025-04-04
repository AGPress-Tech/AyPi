const { app, BrowserWindow, ipcMain, dialog, net, shell } = require("electron");
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
        width: 750,
        height: 550,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
        },
        icon: path.join(__dirname, 'assets', 'app-icon.png')
    });

    mainWindow.loadFile("./pages/moduli.html");
    mainWindow.setMenu(null);

    if (net.isOnline()) {
        autoUpdater.checkForUpdatesAndNotify();
    } else {
        dialog.showMessageBox(mainWindow, {
            type: "info",
            title: "Verificare Connessione",
            message: "Connessione ad Internet assente, impossibile verificare la presenza di nuovi aggiornamenti!",
        });
    }
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

autoUpdater.on("update-downloaded", async () => {
    const releaseNotes = await getReleaseNotes();

    dialog.showMessageBox(mainWindow, {
        type: "info",
        title: "Aggiornamento pronto",
        message: `L'aggiornamento è stato scaricato. Vuoi riavviare ora per applicarlo?\n\nNote di aggiornamento:\n\n${releaseNotes}`,
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
        title: "Errore Aggiornamento",
        message: "Errore durante l'aggiornamento. Contattare Ayrton."
    });
});

ipcMain.handle("get-app-version", async () => {
    return app.getVersion();
});

// Funzione per ottenere le note di rilascio dalla GitHub API
async function getReleaseNotes() {
    const releaseUrl = 'https://api.github.com/repos/AGPress-Tech/AyPi/releases/latest';
    
    try {
        const response = await fetch(releaseUrl);
        const data = await response.json();
        return data.body || "Nessuna nota di rilascio disponibile.";
    } catch (error) {
        log.error("Errore nel recupero delle note di rilascio:", error);
        return "Errore nel recupero delle note di rilascio.";
    }
}

// Apertura file o cartella
ipcMain.on("open-file", (event, filePath) => {
    const testFile = "\\\\Dl360\\private\\AyPi Server Validator.txt"; 

    fs.access(testFile, fs.constants.F_OK, (err) => {
        if (err) {
            log.warn("Il server non è raggiungibile:", err.message);
            dialog.showMessageBox(mainWindow, {
                type: 'warning',
                buttons: ['Ok'],
                title: "Server Non Raggiungibile",
                message: `Il server \\dl360 non è disponibile. Verificare la connessione e riprovare.`
            });
            return;
        }

        log.info("Il server è accessibile.");

        fs.stat(filePath, (err, stats) => {
            if (err) {
                log.warn("Percorso non trovato:", filePath);
                dialog.showMessageBox(mainWindow, {
                    type: 'warning',
                    buttons: ['Ok'],
                    title: "Percorso Non Trovato",
                    message: "Il file o la cartella sembra essere stata spostata o eliminata. Verificare il percorso e riprovare."
                });
                return;
            }

            if (stats.isDirectory()) {
                log.info("Apertura cartella:", filePath);
                shell.openPath(filePath);
            } else {
                log.info("Apertura file:", filePath);
                exec(`start "" "${filePath}"`, (error) => {
                    if (error) {
                        log.error("Errore nell'apertura del file:", error);
                        dialog.showMessageBox(mainWindow, {
                            type: 'error',
                            buttons: ['Ok'],
                            title: "Errore",
                            message: "Errore nell'apertura del file. Contattare Ayrton."
                        });
                    }
                });
            }
        });
    });
});
