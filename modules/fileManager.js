// Importazione dei moduli principali di Electron e Node.js
const { ipcMain, dialog, shell } = require("electron");
const { exec } = require("child_process");
const fs = require("fs");
const log = require("electron-log");

/**
 * Funzione che anima il ridimensionamento della finestra principale
 * @param {BrowserWindow} mainWindow - finestra principale di Electron
 * @param {number} targetWidth - larghezza finale desiderata
 * @param {number} targetHeight - altezza finale desiderata
 * @param {number} duration - durata dell’animazione in millisecondi (default 100ms)
 */
function animateResize(mainWindow, targetWidth, targetHeight, duration = 100) {
    if (!mainWindow) return; // Se non esiste la finestra, interrompe la funzione

    // Ottiene dimensioni iniziali della finestra
    const [startWidth, startHeight] = mainWindow.getSize();
    const steps = 20; // Numero di passaggi intermedi per l’animazione
    const stepDuration = duration / steps; // Durata di ogni step
    let currentStep = 0;

    // Imposta un intervallo per aggiornare progressivamente le dimensioni
    const interval = setInterval(() => {
        currentStep++;
        const progress = currentStep / steps; // Progresso dell’animazione (da 0 a 1)

        // Calcola nuove dimensioni proporzionali al progresso
        const newWidth = Math.round(startWidth + (targetWidth - startWidth) * progress);
        const newHeight = Math.round(startHeight + (targetHeight - startHeight) * progress);

        // Applica le nuove dimensioni
        mainWindow.setSize(newWidth, newHeight);

        // Quando l’animazione è completa, ferma l’intervallo e centra la finestra
        if (currentStep >= steps) {
            clearInterval(interval);
            mainWindow.setSize(targetWidth, targetHeight);
            mainWindow.center();
        }
    }, stepDuration);
}

/**
 * Registra gli handler IPC per la gestione dei file e del ridimensionamento finestra
 * @param {BrowserWindow} mainWindow - finestra principale di Electron
 */
function setupFileManager(mainWindow) {

    // Evento IPC per ridimensionare la finestra alla modalità "calcolatore"
    ipcMain.on("resize-calcolatore", () => {
        animateResize(mainWindow, 750, 750, 100);
    });

    // Evento IPC per tornare alla modalità finestra "normale"
    ipcMain.on("resize-normale", () => {
        animateResize(mainWindow, 750, 550, 100);
    });

    // Evento IPC per aprire un file o cartella
    ipcMain.on("open-file", (event, filePath) => {
        // File di test per verificare la raggiungibilità del server DL360
        const testFile = "\\\\Dl360\\private\\AyPi Server Validator.txt";

        // Verifica se il server è raggiungibile
        fs.access(testFile, fs.constants.F_OK, (err) => {
            if (err) {
                // Se il file non è accessibile → server non raggiungibile
                log.warn("Server non raggiungibile:", err.message);
                dialog.showMessageBox(mainWindow, {
                    type: 'warning',
                    buttons: ['Ok'],
                    title: "Server Non Raggiungibile",
                    message: "Il server DL360 non è disponibile. Verificare la connessione."
                });
                return;
            }

            // Se il server risponde, verifica il file richiesto
            fs.stat(filePath, (err, stats) => {
                if (err) {
                    // Se il percorso non esiste
                    dialog.showMessageBox(mainWindow, {
                        type: 'warning',
                        buttons: ['Ok'],
                        title: "Percorso Non Trovato",
                        message: "Il file o la cartella non è disponibile. Controllare e riprovare."
                    });
                    return;
                }

                // Se è una cartella → apri direttamente in Esplora Risorse
                if (stats.isDirectory()) {
                    shell.openPath(filePath);
                } else {
                    // Se è un file → prova ad aprirlo
                    exec(`start "" "${filePath}"`, (error) => {
                        if (error) {
                            // Caso: file già aperto da un altro processo
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
                                // Altro tipo di errore generico
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

// Esporta la funzione per essere usata nel main process
module.exports = { setupFileManager };
