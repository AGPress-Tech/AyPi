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
    if (!net.isOnline()) {
        log.warn("Tentativo di apertura file senza connessione di rete.");
        dialog.showMessageBox(mainWindow, {
            type: 'warning',
            buttons: ['Ok'],
            defaultId: 0,
            title: "Connessione di Rete Assente",
            message: "Il PC non è connesso a una rete. Connettersi a una rete e riprovare."
        });
        return;
    }

    exec(`start "" "${filePath}"`, (error) => {
        if (error) {
            log.error("Errore nell'apertura del file:", error);

            let fileNotFound = false;

            if (error.message.includes("Impossibile accedere al file.") || 
                error.message.includes("Il file è utilizzato da un altro processo.")) {

                dialog.showMessageBox(mainWindow, {
                    type: 'warning',
                    buttons: ['Apri in sola lettura', 'Annulla'],
                    defaultId: 0,
                    title: "File in Uso",
                    message: "Il file è attualmente in uso da un altro operatore. Vuoi aprirlo in sola lettura?"
                }).then(result => {
                    if (result.response === 0) { // L'utente ha scelto "Apri in sola lettura"
                        shell.openPath(filePath).then(openError => {
                            if (openError) {
                                log.error("Errore nell'apertura in sola lettura:", openError);
                                dialog.showMessageBox(mainWindow, {
                                    type: 'error',
                                    buttons: ['Ok'],
                                    defaultId: 0,
                                    title: "Errore",
                                    message: "Il file non può essere aperto nemmeno in sola lettura."
                                });
                            } else {
                                log.info("File aperto in sola lettura:", filePath);
                            }
                        });
                    }
                });

            } else if (error.message.includes("Impossibile trovare il file") || 
                       error.message.includes("Il sistema non trova il file")) {
                fileNotFound = true;
                dialog.showMessageBox(mainWindow, {
                    type: 'warning',
                    buttons: ['Ok'],
                    defaultId: 0,
                    title: "File Non Trovato",
                    message: "Il file sembra essere stato spostato o eliminato. Verificare il percorso e riprovare."
                });

            } else {
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

            if (fileNotFound) {
                log.warn("Il file potrebbe essere stato spostato o eliminato:", filePath);
            }
        }
    });
});
