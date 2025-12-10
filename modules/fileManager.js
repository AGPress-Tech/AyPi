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
let hierarchyWindow = null;

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

function openHierarchyWindow(mainWindow) {
    if (hierarchyWindow && !hierarchyWindow.isDestroyed()) {
        hierarchyWindow.focus();
        return;
    }

    hierarchyWindow = new BrowserWindow({
        width: 1100,
        height: 800,
        parent: mainWindow,
        modal: false,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
        },
        icon: path.join(__dirname, "..", "assets", "app-icon.png"),
    });

    hierarchyWindow.loadFile(
        path.join(__dirname, "..", "pages", "utilities", "hierarchy.html")
    );
    hierarchyWindow.setMenu(null);
    hierarchyWindow.center();

    hierarchyWindow.on("closed", () => {
        hierarchyWindow = null;

        // Riporta AyPi in primo piano
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.show();
            mainWindow.focus();
        }
    });
}

function startHierarchyScan(win, rootFolder, options = {}) {
    const webContents = win.webContents;

    log.info("[hierarchy] start-scan", {
        rootFolder,
        options,
    });

    // Coda di directory da processare (DFS)
    const pendingDirs = [{ dir: rootFolder, depth: 0 }];
    const allEntries = [];

    let totalFiles = 0;
    let totalDirs = 0;

    const BATCH_SIZE = 500;

    const rawDepth = Number(options.maxDepth);
    const maxDepth =
        Number.isFinite(rawDepth) && rawDepth > 0 ? rawDepth : null;

    const excludeExtensions = Array.isArray(options.excludeExtensions)
        ? options.excludeExtensions
              .map((e) => String(e).toLowerCase().replace(/^\./, "").trim())
              .filter((e) => e.length > 0)
        : [];
    const excludeFolders = Array.isArray(options.excludeFolders)
        ? options.excludeFolders
              .map((f) => String(f).toLowerCase().trim())
              .filter((f) => f.length > 0)
        : [];
    const excludeFiles = Array.isArray(options.excludeFiles)
        ? options.excludeFiles
              .map((f) => String(f).toLowerCase().trim())
              .filter((f) => f.length > 0)
        : [];

    const excludeExtSet = new Set(excludeExtensions);
    const excludeFolderSet = new Set(excludeFolders);
    const excludeFileSet = new Set(excludeFiles);

    function isExcludedFolder(name) {
        if (!name) return false;
        return excludeFolderSet.has(String(name).toLowerCase());
    }

    function isExcludedFile(name) {
        if (!name) return false;
        const lower = String(name).toLowerCase();
        if (excludeFileSet.has(lower)) return true;

        if (excludeExtSet.size > 0) {
            const ext = path.extname(lower).replace(/^\./, "");
            if (ext && excludeExtSet.has(ext)) {
                return true;
            }
        }
        return false;
    }

    function step() {
        const batch = [];

        // Elaboriamo directory finché:
        // - ce ne sono
        // - e non abbiamo riempito il batch
        while (pendingDirs.length > 0 && batch.length < BATCH_SIZE) {
            const { dir: currentDir, depth: currentDepth } =
                pendingDirs.pop();
            totalDirs++;

            let entries;
            try {
                entries = fs.readdirSync(currentDir, { withFileTypes: true });
            } catch (err) {
                console.warn("Impossibile leggere la cartella:", currentDir, err.message);
                continue;
            }

            // Aggiungiamo la directory stessa come entry "folder"
            const relDir = path.relative(rootFolder, currentDir);
            const folderEntry = {
                kind: "folder",
                fullPath: currentDir,
                relPath: relDir || "", // root = stringa vuota
            };
            batch.push(folderEntry);
            allEntries.push(folderEntry);

            for (const entry of entries) {
                const fullPath = path.join(currentDir, entry.name);

                // Determiniamo sempre il tipo reale tramite fs.statSync,
                // così gestiamo correttamente anche file "speciali" (OneDrive, link, ecc.).
                let stat;
                try {
                    stat = fs.statSync(fullPath);
                } catch (err) {
                    console.warn("Impossibile determinare il tipo dell'elemento:", fullPath, err.message);
                    continue;
                }

                const isDir = stat.isDirectory();
                const isFile = stat.isFile();

                if (isDir) {
                    if (isExcludedFolder(entry.name)) {
                        continue;
                    }

                    // metti in coda per elaborarla dopo
                    const nextDepth = currentDepth + 1;
                    if (maxDepth === null || nextDepth <= maxDepth) {
                        pendingDirs.push({ dir: fullPath, depth: nextDepth });
                    }
                } else if (isFile) {
                    if (isExcludedFile(entry.name)) {
                        continue;
                    }
                    let st;
                    try {
                        st = fs.statSync(fullPath);
                    } catch (err) {
                        console.warn("Impossibile leggere stat del file:", fullPath, err.message);
                        continue;
                    }

                    const relPath = path.relative(rootFolder, fullPath);

                    totalFiles++;
                    const fileEntry = {
                        kind: "file",
                        fullPath,
                        relPath,
                        size: st.size,
                        mtimeMs: st.mtimeMs,
                    };
                    batch.push(fileEntry);
                    allEntries.push(fileEntry);
                }

                if (batch.length >= BATCH_SIZE) {
                    break;
                }
            }
        }

        if (batch.length > 0) {
            try {
                const sample = batch
                    .slice(0, 10)
                    .map((e) => `${e.kind}:${e.relPath}`);
                log.info("[hierarchy] progress-batch", {
                    rootFolder,
                    batchCount: batch.length,
                    totalFiles,
                    totalDirs,
                    sample,
                });
            } catch (err) {
                log.warn("[hierarchy] progress-log-error", err);
            }

            webContents.send("hierarchy-progress", {
                rootFolder,
                batch,
                totalFiles,
                totalDirs,
            });
        }

        if (pendingDirs.length > 0) {
            // Continua con il prossimo chunk senza bloccare l'UI
            setImmediate(step);
        } else {
            // Fine scansione
            log.info("[hierarchy] complete", {
                rootFolder,
                totalFiles,
                totalDirs,
                entries: allEntries.length,
            });

            webContents.send("hierarchy-complete", {
                rootFolder,
                totalFiles,
                totalDirs,
                entries: allEntries,
            });
        }
    }

    // Avvia la prima iterazione
    step();
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
    ipcMain.handle("select-root-folder", async (event) => {
        // Usa la finestra che ha richiesto la selezione (se esiste),
        // altrimenti ricade sulla finestra principale.
        const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;

        const result = await dialog.showOpenDialog(win, {
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
        const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;

        const result = await dialog.showSaveDialog(win, {
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

    ipcMain.on("hierarchy-start-scan", (event, data) => {
        if (!data || !data.rootFolder) {
            return;
        }

        const win = BrowserWindow.fromWebContents(event.sender);
        if (!win || win.isDestroyed()) {
            return;
        }

        console.log("Richiesta scansione gerarchia REALE:", data.rootFolder);

        startHierarchyScan(win, data.rootFolder, data.options || {});
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

    ipcMain.on("open-hierarchy-window", () => {
        openHierarchyWindow(mainWindow);
    });

    // ------------------------
    // Gerarchia → Batch Rename
    // ------------------------
    ipcMain.on("hierarchy-open-batch-rename", (event, payload) => {
        const folder = payload?.folder;

        if (!batchRenameWindow || batchRenameWindow.isDestroyed()) {
            batchRenameWindow = new BrowserWindow({
                width: 800,
                height: 800,
                webPreferences: {
                    nodeIntegration: true,
                    contextIsolation: false,
                },
                icon: path.join(__dirname, "assets", "app-icon.png"),
            });

            batchRenameWindow.setMenu(null);
            batchRenameWindow.loadFile("./pages/utilities/batch-rename.html"
            );

            batchRenameWindow.on("closed", () => {
                batchRenameWindow = null;
            });

            batchRenameWindow.webContents.once("did-finish-load", () => {
                if (folder) {
                    batchRenameWindow.webContents.send("batch-rename-set-root", folder);
                }
            });
        } else {
            batchRenameWindow.show();
            batchRenameWindow.focus();
            if (folder) {
                batchRenameWindow.webContents.send("batch-rename-set-root", folder);
            }
        }
    });

    // ------------------------
    // Gerarchia → Confronta cartelle (A/B)
    // ------------------------
    ipcMain.on("hierarchy-compare-folder-A", (event, payload) => {
        openCompareFoldersWindow("A", payload?.folder);
    });

    ipcMain.on("hierarchy-compare-folder-B", (event, payload) => {
        openCompareFoldersWindow("B", payload?.folder);
    });

    function openCompareFoldersWindow(slot, folder) {
        if (!compareFoldersWindow || compareFoldersWindow.isDestroyed()) {
            compareFoldersWindow = new BrowserWindow({
                width: 900,
                height: 800,
                webPreferences: {
                    nodeIntegration: true,
                    contextIsolation: false,
                },
                icon: path.join(__dirname, "assets", "app-icon.png"),
            });

            compareFoldersWindow.setMenu(null);
            compareFoldersWindow.loadFile("./pages/utilities/compare-folders.html");

            compareFoldersWindow.on("closed", () => {
                compareFoldersWindow = null;
            });

            compareFoldersWindow.webContents.once("did-finish-load", () => {
                if (folder) {
                    if (slot === "A") {
                        compareFoldersWindow.webContents.send("compare-folders-set-A", folder);
                    } else if (slot === "B") {
                        compareFoldersWindow.webContents.send("compare-folders-set-B", folder);
                    }
                }
            });
        } else {
            compareFoldersWindow.show();
            compareFoldersWindow.focus();
            if (folder) {
                if (slot === "A") {
                    compareFoldersWindow.webContents.send("compare-folders-set-A", folder);
                } else if (slot === "B") {
                    compareFoldersWindow.webContents.send("compare-folders-set-B", folder);
                }
            }
        }
    }

}

// Esporta la funzione per essere usata nel main process
module.exports = { setupFileManager };
