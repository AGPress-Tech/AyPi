// Importazione dei moduli principali di Electron e Node.js
const { ipcMain, dialog, shell, BrowserWindow, app } = require("electron");
const path = require("path");
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

let batchRenameWindow = null;
let qrGeneratorWindow = null;
let compareFoldersWindow = null;

/**
 * Apre (o porta in primo piano) la finestra di Rinomina File in Batch.
 * Viene usata dalle utilities AyPi dalla pagina Utilities.
 */
function openBatchRenameWindow(mainWindow) {
    if (batchRenameWindow && !batchRenameWindow.isDestroyed()) {
        batchRenameWindow.focus();
        return;
    }

    batchRenameWindow = new BrowserWindow({
        width: 900,
        height: 800,
        parent: mainWindow,
        modal: false,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
        },
        icon: path.join(__dirname, "..", "assets", "app-icon.png"),
    });

    batchRenameWindow.loadFile(path.join(__dirname, "..", "pages", "utilities", "batch-rename.html"));
    batchRenameWindow.setMenu(null);

    // Centra la finestra
    batchRenameWindow.center();

    batchRenameWindow.on("closed", () => {
        batchRenameWindow = null;

        // 🔥 Quando la finestra si chiude, riportiamo AyPi in primo piano
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.show();  // la rende visibile se nascosta
            mainWindow.focus(); // la porta davanti
        }
    });
}

function openQrGeneratorWindow(mainWindow) {
    if (qrGeneratorWindow && !qrGeneratorWindow.isDestroyed()) {
        qrGeneratorWindow.focus();
        return;
    }

    qrGeneratorWindow = new BrowserWindow({
        width: 900,     // <--- STESSO VALORE DI BATCH RENAME
        height: 800,    // <--- STESSO VALORE DI BATCH RENAME
        parent: mainWindow,
        modal: false,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
        },
        icon: path.join(__dirname, "..", "assets", "app-icon.png"),
    });

    qrGeneratorWindow.loadFile(path.join(__dirname, "..", "pages", "utilities", "qr-generator.html"));
    qrGeneratorWindow.setMenu(null);

    // Centra la finestra (come per Batch Rename)
    qrGeneratorWindow.center();

    qrGeneratorWindow.on("closed", () => {
        qrGeneratorWindow = null;

        // Riporta AyPi in primo piano (come Batch Rename)
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.show();
            mainWindow.focus();
        }
    });
}

function openCompareFoldersWindow(mainWindow) {
    if (compareFoldersWindow && !compareFoldersWindow.isDestroyed()) {
        compareFoldersWindow.focus();
        return;
    }

    compareFoldersWindow = new BrowserWindow({
        width: 900,
        height: 800,
        parent: mainWindow,
        modal: false,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
        },
        icon: path.join(__dirname, "..", "assets", "app-icon.png"),
    });

    compareFoldersWindow.loadFile(path.join(__dirname, "..", "pages", "utilities", "compare-folders.html"));
    compareFoldersWindow.setMenu(null);
    compareFoldersWindow.center();

    compareFoldersWindow.on("closed", () => {
        compareFoldersWindow = null;

        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.show();
            mainWindow.focus();
        }
    });
}


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
                    // Se è un file → prova ad aprirlo con l'applicazione predefinita
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

    // Handler per selezionare una cartella radice (usato dalle Utilities AyPi)
    ipcMain.handle("select-root-folder", async () => {
        const result = await dialog.showOpenDialog(mainWindow, {
            title: "Seleziona la cartella",
            properties: ["openDirectory"],
        });

        if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
            return null;
        }
        return result.filePaths[0];
    });

    // Handler per selezionare un file di output (es. Excel generati dalle Utilities)
    ipcMain.handle("select-output-file", async (event, options) => {
        const result = await dialog.showSaveDialog(mainWindow, {
            title: "Seleziona il file di destinazione",
            defaultPath: options?.defaultName || "output.xlsx",
            filters: [
                { name: "File Excel", extensions: ["xlsx"] },
            ],
        });

        if (result.canceled || !result.filePath) {
            return null;
        }
        return result.filePath;
    });

    // Handler generico per mostrare finestre di messaggio (info / warning / error)
    ipcMain.handle("show-message-box", async (event, options) => {
        const win = BrowserWindow.getFocusedWindow() || mainWindow;

        return dialog.showMessageBox(win, {
            type: options.type || "none",
            buttons: ["OK"],
            title: "AyPi",
            message: options.message || "",
            detail: options.detail || "",
        });
    });

    ipcMain.handle("get-app-version", async () => {
        return app.getVersion();
    });

    ipcMain.on("open-batch-rename-window", () => {
        openBatchRenameWindow(mainWindow);
    });

    ipcMain.on("open-qr-generator-window", () => {
        openQrGeneratorWindow(mainWindow);
    });

    ipcMain.on("open-compare-folders-window", () => {
        openCompareFoldersWindow(mainWindow);
    });
}

// Esporta la funzione per essere usata nel main process
module.exports = { setupFileManager };
