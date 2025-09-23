const { ipcMain, dialog, shell } = require("electron");
const { exec } = require("child_process");
const fs = require("fs");
const log = require("electron-log");

function setupFileManager(mainWindow) {
    ipcMain.on("resize-calcolatore", () => {
        if (mainWindow) {
            mainWindow.setSize(750, 750);
            mainWindow.center();
        }
    });

    ipcMain.on("resize-normale", () => {
        if (mainWindow) {
            mainWindow.setSize(750, 550);
            mainWindow.center();
        }
    });

    ipcMain.on("open-file", (event, filePath) => {
        const testFile = "\\\\Dl360\\private\\AyPi Server Validator.txt";

        fs.access(testFile, fs.constants.F_OK, (err) => {
            if (err) {
                log.warn("Server non raggiungibile:", err.message);
                dialog.showMessageBox(mainWindow, {
                    type: 'warning',
                    buttons: ['Ok'],
                    title: "Server Non Raggiungibile",
                    message: "Il server \\\\dl360 non è disponibile. Verificare la connessione."
                });
                return;
            }

            fs.stat(filePath, (err, stats) => {
                if (err) {
                    dialog.showMessageBox(mainWindow, {
                        type: 'warning',
                        buttons: ['Ok'],
                        title: "Percorso Non Trovato",
                        message: "Il file o la cartella non è disponibile. Controllare e riprovare."
                    });
                    return;
                }

                if (stats.isDirectory()) {
                    shell.openPath(filePath);
                } else {
                    exec(`start "" "${filePath}"`, (error) => {
                        if (error) {
                            if (error.message.includes("utilizzato da un altro processo")) {
                                dialog.showMessageBox(mainWindow, {
                                    type: 'warning',
                                    buttons: ['Apri in sola lettura', 'Annulla'],
                                    title: "File in Uso",
                                    message: "Vuoi aprirlo in sola lettura?"
                                }).then(result => {
                                    if (result.response === 0) {
                                        shell.openPath(filePath);
                                    }
                                });
                            } else {
                                dialog.showMessageBox(mainWindow, {
                                    type: 'error',
                                    buttons: ['Ok'],
                                    title: "Errore",
                                    message: "Errore nell'apertura del file."
                                });
                            }
                        }
                    });
                }
            });
        });
    });
}

module.exports = { setupFileManager };
