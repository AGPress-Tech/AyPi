// @ts-nocheck
require("./shared/dev-guards");
const { ipcRenderer } = require("electron");
const { initCommonUI } = require("../modules/utils");
let showInfo;
let showWarning;
let showError;
try {
    ({ showInfo, showWarning, showError } = require("./shared/dialogs"));
} catch (err) {
    console.error("Errore caricamento dialogs:", err);
    showInfo = (message, detail = "") =>
        ipcRenderer.invoke("show-message-box", { type: "info", message, detail });
    showWarning = (message, detail = "") =>
        ipcRenderer.invoke("show-message-box", { type: "warning", message, detail });
    showError = (message, detail = "") =>
        ipcRenderer.invoke("show-message-box", { type: "error", message, detail });
}
const fs = require("fs");
const path = require("path");

window.addEventListener("error", (event) => {
    const detail = event?.error?.stack || event?.message || "Errore sconosciuto";
    ipcRenderer.invoke("show-message-box", {
        type: "error",
        message: "Errore JS Utilities.",
        detail,
    });
});

window.addEventListener("unhandledrejection", (event) => {
    const reason = event?.reason;
    const detail = reason?.stack || reason?.message || String(reason || "Errore sconosciuto");
    ipcRenderer.invoke("show-message-box", {
        type: "error",
        message: "Errore promessa non gestita (Utilities).",
        detail,
    });
});

let XLSX;
try {
    XLSX = require("xlsx");
} catch (err) {
    console.error("Modulo 'xlsx' non trovato. Esegui: npm install xlsx");
}

initCommonUI();

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

window.addEventListener("DOMContentLoaded", async () => {
    console.log("utilities-scripts.js caricato");
    ipcRenderer.send("resize-normale");

    const btn = document.getElementById("transcribeFileNames");

    if (!btn) {
        console.error("Bottone #transcribeFileNames non trovato.");
        return;
    }

    btn.addEventListener("click", async () => {
        console.log("Bottone Trascrivi Nomi Files cliccato");

        if (!XLSX) {
            await showError(
                "Modulo 'xlsx' non trovato.",
                "Esegui 'npm install xlsx' nella cartella del progetto AyPi."
            );
            return;
        }

        try {
            await showInfo("Seleziona la cartella da analizzare.");

            let rootFolder;
            try {
                rootFolder = await ipcRenderer.invoke("select-root-folder");
            } catch (err) {
                await showError("Errore selezione cartella.", err.message || String(err));
                return;
            }
            if (!rootFolder) {
                await showWarning("Operazione annullata dall'utente.");
                return;
            }

            await showInfo("Seleziona dove salvare il file Excel.");

            let outputPath;
            try {
                outputPath = await ipcRenderer.invoke("select-output-file", {
                    defaultName: "lista_file.xlsx"
                });
            } catch (err) {
                await showError("Errore selezione file di destinazione.", err.message || String(err));
                return;
            }
            if (!outputPath) {
                await showWarning("Operazione annullata dall'utente.");
                return;
            }

            console.log("Scansione in corso su:", rootFolder);

            const rows = scanFolder(rootFolder);

            if (rows.length === 0) {
                await showWarning("Nessun file trovato nella cartella selezionata.");
                return;
            }

            const wb = XLSX.utils.book_new();
            const ws = XLSX.utils.json_to_sheet(rows);
            XLSX.utils.book_append_sheet(wb, ws, "File");

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

    const btnBatchRename = document.getElementById("batchRenameFiles");
    if (btnBatchRename) {
        btnBatchRename.addEventListener("click", () => {
            ipcRenderer.send("open-batch-rename-window");
        });
    }

    const btnQrGen = document.getElementById("qrGenerator");
    if (btnQrGen) {
        btnQrGen.addEventListener("click", () => {
            ipcRenderer.send("open-qr-generator-window");
        });
    }

    const btnCompareFolders = document.getElementById("compareFolders");
    if (btnCompareFolders) {
        btnCompareFolders.addEventListener("click", () => {
            ipcRenderer.send("open-compare-folders-window");
        });
    }

    const btnHierarchy = document.getElementById("hierarchyGenerator");
    if (btnHierarchy) {
        btnHierarchy.addEventListener("click", () => {
            ipcRenderer.send("open-hierarchy-window");
        });
    }

    const btnAdmin = document.getElementById("amministrazione");
    const btnFeriePermessi = document.getElementById("feriePermessi");
    const btnSyncLegacyAll = document.getElementById("aypiSyncLegacyAll");
    const adminOverlay = document.getElementById("adminOverlay");
    const adminPassword = document.getElementById("adminPassword");
    const adminError = document.getElementById("adminError");
    const adminCancel = document.getElementById("adminCancel");
    const adminConfirm = document.getElementById("adminConfirm");
    let adminPromptAction = null;

    const setSyncLegacyVisible = (enabled) => {
        if (!btnSyncLegacyAll) return;
        btnSyncLegacyAll.classList.toggle("is-hidden", !enabled);
    };

    function closeAdminPrompt() {
        if (!adminOverlay) return;
        adminOverlay.classList.add("is-hidden");
        adminOverlay.setAttribute("aria-hidden", "true");
        if (adminPassword) adminPassword.value = "";
        if (adminError) adminError.classList.add("is-hidden");
    }

    function openAdminPrompt() {
        if (!adminOverlay) return;
        adminOverlay.classList.remove("is-hidden");
        adminOverlay.setAttribute("aria-hidden", "false");
        if (adminPassword) {
            adminPassword.focus();
            adminPassword.select();
        }
    }

    async function confirmAdminPassword() {
        const password = adminPassword ? adminPassword.value : "";
        if (!password) {
            if (adminError) adminError.classList.remove("is-hidden");
            return;
        }
        if (adminPromptAction === "login-only") {
            const result = await ipcRenderer.invoke("admin-auth", { password });
            if (!result || !result.ok) {
                if (adminError) adminError.classList.remove("is-hidden");
                return;
            }
            closeAdminPrompt();
            setSyncLegacyVisible(true);
            return;
        }
        if (password !== "AGPress") {
            if (adminError) adminError.classList.remove("is-hidden");
            return;
        }
        closeAdminPrompt();
        ipcRenderer.send("open-amministrazione-window");
    }

    if (btnAdmin) {
        btnAdmin.addEventListener("click", () => {
            adminPromptAction = "open-amministrazione";
            openAdminPrompt();
        });
    }

    if (btnFeriePermessi) {
        btnFeriePermessi.addEventListener("click", () => {
            ipcRenderer.send("open-ferie-permessi-window");
        });
    }

    const btnPurchaseRequests = document.getElementById("purchaseRequests");
    if (btnPurchaseRequests) {
        btnPurchaseRequests.addEventListener("click", () => {
            ipcRenderer.send("open-product-manager-window");
        });
    }

    if (btnSyncLegacyAll) {
        btnSyncLegacyAll.addEventListener("click", async () => {
            const confirm = await ipcRenderer.invoke("show-message-box", {
                type: "warning",
                buttons: ["Annulla", "Procedi"],
                defaultId: 1,
                cancelId: 0,
                title: "Sincronizzazione e pulizia legacy",
                message: "Confermi la sincronizzazione dai legacy ai nuovi shard e la rimozione dei dati legacy?",
                detail: "Questa operazione va fatta solo quando tutte le postazioni sono aggiornate.",
            });
            if (!confirm || confirm.response !== 1) return;
            const result = await ipcRenderer.invoke("aypi-sync-legacy-all");
            if (!result || !result.ok) {
                await showError("Operazione non riuscita.", result?.reason || "Errore sconosciuto");
                return;
            }
            const removedCount = Array.isArray(result.removed) ? result.removed.length : 0;
            const synced = result.synced || {};
            const calendarInfo = synced.calendar ? `Calendar: ${synced.calendar}` : "Calendar: -";
            const purchasingInfo = synced.purchasing ? `Purchasing: ${synced.purchasing}` : "Purchasing: -";
            await showInfo(
                "Operazione completata.",
                `${calendarInfo}\n${purchasingInfo}\nRimossi: ${removedCount} elementi legacy.`,
            );
        });
    }

    if (adminCancel) {
        adminCancel.addEventListener("click", () => {
            closeAdminPrompt();
        });
    }

    if (adminConfirm) {
        adminConfirm.addEventListener("click", () => {
            confirmAdminPassword();
        });
    }

    if (adminPassword) {
        adminPassword.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                event.preventDefault();
                confirmAdminPassword();
            } else if (event.key === "Escape") {
                event.preventDefault();
                closeAdminPrompt();
            }
        });
    }

    window.addEventListener("keydown", async (event) => {
        if (event.key === "F2") {
            event.preventDefault();
            adminPromptAction = "login-only";
            openAdminPrompt();
        }
    });

    ipcRenderer.on("admin-state-changed", (_event, payload) => {
        const enabled = !!payload?.enabled;
        setSyncLegacyVisible(enabled);
    });

    try {
        const enabled = await ipcRenderer.invoke("admin-is-enabled");
        setSyncLegacyVisible(!!enabled);
    } catch (err) {
        setSyncLegacyVisible(false);
    }
});



