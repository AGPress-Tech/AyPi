const { ipcRenderer } = require("electron");
const { initCommonUI } = require("../modules/utils");
const fs = require("fs");
const path = require("path");

let XLSX;
try {
    XLSX = require("xlsx");
} catch (err) {
    console.error("Modulo 'xlsx' non trovato. Esegui: npm install xlsx");
}

initCommonUI();

/**
 * Scansiona una cartella in modo ricorsivo e restituisce
 * un array di oggetti con le info sui file.
 */
function scanFolder(rootPath) {
    const results = [];

    function walk(currentPath) {
        let entries;
        try {
            entries = fs.readdirSync(currentPath, { withFileTypes: true });
        } catch (err) {
            console.error(`Impossibile leggere la cartella: ${currentPath}`, err);
            return;
        }

        for (const entry of entries) {
            const fullPath = path.join(currentPath, entry.name);

            if (entry.isDirectory()) {
                walk(fullPath);
            } else if (entry.isFile()) {
                results.push({
                    "Nome file": entry.name,
                    "Percorso relativo": path.relative(rootPath, fullPath),
                    "Percorso completo": path.resolve(fullPath)
                });
            }
        }
    }

    walk(rootPath);
    return results;
}

// 🔹 helper per mostrare dialog dalla renderer
function showDialog(type, message, detail = "") {
    return ipcRenderer.invoke("show-message-box", { type, message, detail });
}

function showInfo(message, detail = "") {
    return showDialog("info", message, detail);
}

function showWarning(message, detail = "") {
    return showDialog("warning", message, detail);
}

function showError(message, detail = "") {
    return showDialog("error", message, detail);
}

window.addEventListener("DOMContentLoaded", () => {
    console.log("utilities-scripts.js caricato ✔");
    ipcRenderer.send("resize-normale");

    const btn = document.getElementById("transcribeFileNames");

    if (!btn) {
        console.error("Bottone #transcribeFileNames non trovato.");
        return;
    }

    btn.addEventListener("click", async () => {
        console.log("Bottone Trascrivi Nomi Files cliccato ✔");

        if (!XLSX) {
            await showError(
                "Modulo 'xlsx' non trovato.",
                "Esegui 'npm install xlsx' nella cartella del progetto AyPi."
            );
            return;
        }

        try {
            await showInfo("Seleziona la cartella da analizzare.");

            // Selezione cartella
            const rootFolder = await ipcRenderer.invoke("select-root-folder");
            if (!rootFolder) {
                await showWarning("Operazione annullata dall'utente.");
                return;
            }

            await showInfo("Seleziona dove salvare il file Excel.");

            // Selezione file di output
            const outputPath = await ipcRenderer.invoke("select-output-file", {
                defaultName: "lista_file.xlsx"
            });
            if (!outputPath) {
                await showWarning("Operazione annullata dall'utente.");
                return;
            }

            // Qui niente dialog “in corso”, semplicemente lavoriamo
            console.log("Scansione in corso su:", rootFolder);

            const rows = scanFolder(rootFolder);

            if (rows.length === 0) {
                await showWarning("Nessun file trovato nella cartella selezionata.");
                return;
            }

            const wb = XLSX.utils.book_new();
            const ws = XLSX.utils.json_to_sheet(rows);
            XLSX.utils.book_append_sheet(wb, ws, "File");

            // Creo directory di output se non esiste
            const dirOut = path.dirname(outputPath);
            if (!fs.existsSync(dirOut)) {
                fs.mkdirSync(dirOut, { recursive: true });
            }

            XLSX.writeFile(wb, outputPath);

            await showInfo(
                "File Excel creato con successo.",
                outputPath
            );
        } catch (err) {
            console.error("Errore durante la generazione della lista file:", err);
            await showError(
                "Errore inatteso durante la generazione della lista file.",
                err.message || String(err)
            );
        }
    });
});
