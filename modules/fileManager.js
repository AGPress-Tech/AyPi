const { ipcMain, dialog, shell } = require("electron");
const { exec } = require("child_process");
const fs = require("fs");
const log = require("electron-log");

function animateResize(mainWindow, targetWidth, targetHeight, duration = 100) {
    if (!mainWindow) return;

    const [startWidth, startHeight] = mainWindow.getSize();
    const steps = 20;
    const stepDuration = duration / steps;
    let currentStep = 0;

    const interval = setInterval(() => {
        currentStep++;
        const progress = currentStep / steps;

        const newWidth = Math.round(startWidth + (targetWidth - startWidth) * progress);
        const newHeight = Math.round(startHeight + (targetHeight - startHeight) * progress);

        mainWindow.setSize(newWidth, newHeight);

        if (currentStep >= steps) {
            clearInterval(interval);
            mainWindow.setSize(targetWidth, targetHeight);
            mainWindow.center();
        }
    }, stepDuration);
}

function setupFileManager(mainWindow) {
    ipcMain.on("resize-calcolatore", () => {
        animateResize(mainWindow, 750, 750, 100);
    });

    ipcMain.on("resize-normale", () => {
        animateResize(mainWindow, 750, 550, 100);
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
                    message: "Il server DL360 non è disponibile. Verificare la connessione."
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
