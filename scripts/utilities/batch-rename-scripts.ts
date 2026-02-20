// @ts-nocheck
import "../shared/dev-guards";
import { ipcRenderer } from "electron";
import { showInfo, showWarning, showError } from "../shared/dialogs";
import { state } from "./batch-rename/state";
import { parseExtensions } from "./batch-rename/utils";
import { getFilterConfigFromUI } from "./batch-rename/filters";
import { collectTargets } from "./batch-rename/collector";
import { refreshFolderTree } from "./batch-rename/tree";
import { setStatus, updateSelectedFolderLabel } from "./batch-rename/ui/status";
import { buildPreviewWithCopyMove, renderPreviewTable } from "./batch-rename/preview";
import { getTransformsConfigFromUI } from "./batch-rename/transforms";
import { buildPresetFromUI, applyPresetToUI, loadPresetsIntoUI } from "./batch-rename/presets";
import { handleApply, handleOpenFolder, handleUndoLast } from "./batch-rename/operations";
import { pickFolder, withButtonLock } from "./shared/folder-picker";

async function selectRootFolderSafe() {
    return pickFolder({ cooldownMs: 400 });
}

window.addEventListener("error", (event) => {
    const detail = event?.error?.stack || event?.message || "Errore sconosciuto";
    ipcRenderer.invoke("show-message-box", {
        type: "error",
        message: "Errore JS Batch Rename.",
        detail,
    });
});

window.addEventListener("unhandledrejection", (event) => {
    const reason = event?.reason;
    const detail = reason?.stack || reason?.message || String(reason || "Errore sconosciuto");
    showError("Errore promessa non gestita (Batch Rename).", detail);
});

async function handlePreview() {
    if (!state.rootFolder) {
        await showWarning("Seleziona prima una cartella.");
        return;
    }

    const extFilterStr = document.getElementById("extFilter").value.trim();
    const includeSubfolders = document.getElementById("chkIncludeSubfolders").checked;
    const extList = parseExtensions(extFilterStr);

    const scopeInput = document.querySelector('input[name="renameScope"]:checked');
    const scope = scopeInput ? scopeInput.value : "files";

    const filterConfig = getFilterConfigFromUI({ showWarning });

    setStatus("Scansione in corso...");

    const items = collectTargets(state.rootFolder, {
        includeSubfolders,
        extFilterList: extList,
        scope,
        filterConfig,
    });

    const totalFound = items.length;
    const lblTotalFound = document.getElementById("lblTotalFound");
    if (lblTotalFound) lblTotalFound.textContent = String(totalFound);

    let itemsFiltered = items;

    const sortOrderSelect = document.getElementById("sortOrder");
    const sortOrder = sortOrderSelect ? sortOrderSelect.value : "nameAsc";

    itemsFiltered.sort((a, b) => {
        const nameA = a.name.toLowerCase();
        const nameB = b.name.toLowerCase();
        const extA = a.ext || "";
        const extB = b.ext || "";

        const sizeA = a.stats ? a.stats.size : 0;
        const sizeB = b.stats ? b.stats.size : 0;
        const timeA = a.stats && a.stats.mtime ? a.stats.mtime.getTime() : 0;
        const timeB = b.stats && b.stats.mtime ? b.stats.mtime.getTime() : 0;

        switch (sortOrder) {
            case "nameDesc": {
                const cmp = nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: "base" });
                return -cmp;
            }
            case "extAsc": {
                const cmp = extA.localeCompare(extB, undefined, { numeric: true, sensitivity: "base" });
                return cmp || nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: "base" });
            }
            case "extDesc": {
                const cmp = extA.localeCompare(extB, undefined, { numeric: true, sensitivity: "base" });
                return -cmp || nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: "base" });
            }
            case "sizeAsc":
                return sizeA - sizeB;
            case "sizeDesc":
                return sizeB - sizeA;
            case "dateAsc":
                return timeA - timeB;
            case "dateDesc":
                return timeB - timeA;
            case "nameAsc":
            default: {
                const cmp = nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: "base" });
                return cmp;
            }
        }
    });

    if (itemsFiltered.length === 0) {
        state.previewData = [];
        renderPreviewTable();
        await showWarning("Nessun file trovato con i criteri specificati.");
        document.getElementById("btnApply").disabled = true;
        const lblFilteredIncluded = document.getElementById("lblFilteredIncluded");
        if (lblFilteredIncluded) lblFilteredIncluded.textContent = "0";
        setStatus("Nessun elemento incluso dai filtri.");
        return;
    }

    const lblFilteredIncluded = document.getElementById("lblFilteredIncluded");
    if (lblFilteredIncluded) lblFilteredIncluded.textContent = String(itemsFiltered.length);

    const transformsConfig = getTransformsConfigFromUI();

    if (transformsConfig.copyMove.enabled) {
        const dest = transformsConfig.copyMove.destPath || "";
        if (!dest.trim()) {
            await showWarning(
                "Blocco Copia/Sposta attivo ma percorso vuoto.",
                "Specifica un percorso di destinazione oppure disattiva il blocco Copia / Sposta in cartella."
            );
        }
    }

    buildPreviewWithCopyMove(itemsFiltered, transformsConfig, state.rootFolder);
    renderPreviewTable();

    const toRename = state.previewData.filter((x) => x.status === "rename").length;
    const conflicts = state.previewData.filter((x) => x.status === "conflict" || x.status === "error").length;

    const hasConflicts = conflicts > 0;

    document.getElementById("btnApply").disabled = toRename === 0 || hasConflicts;

    const btnUndoLast = document.getElementById("btnUndoLast");
    if (btnUndoLast) {
        btnUndoLast.disabled = !state.lastRenameOperations;
    }

    await showInfo(
        "Anteprima generata.",
        `File totali: ${state.previewData.length}\nDa rinominare: ${toRename}\nConflitti/Errori: ${conflicts}`
    );

    if (conflicts > 0) {
        setStatus("Sono presenti conflitti o errori: risolvi prima di procedere.");
    } else {
        setStatus("Anteprima pronta. Nessun conflitto rilevato.");
    }
}

window.addEventListener("DOMContentLoaded", () => {
    console.log("batch-rename-scripts.js caricato");

    const btnSelectFolder = document.getElementById("btnSelectFolder");
    const btnPreview = document.getElementById("btnPreview");
    const btnApply = document.getElementById("btnApply");
    const btnClose = document.getElementById("btnClose");
    const btnOpenFolder = document.getElementById("btnOpenFolder");
    const btnUndoLast = document.getElementById("btnUndoLast");
    const presetSelect = document.getElementById("presetSelect");
    const presetNameInput = document.getElementById("presetName");
    const btnPresetSave = document.getElementById("btnPresetSave");
    const btnPresetDelete = document.getElementById("btnPresetDelete");
    const rmDigits = document.getElementById("rmDigits");
    const rmSymbols = document.getElementById("rmSymbols");
    const rmExtraSpaces = document.getElementById("rmExtraSpaces");
    const rmAll = document.getElementById("rmAll");

    btnSelectFolder.addEventListener("click", async () => {
        try {
            const folder = await withButtonLock(btnSelectFolder, () => selectRootFolderSafe());
            if (!folder) return;
            state.rootFolder = folder;
            updateSelectedFolderLabel();
            refreshFolderTree();
        } catch (err) {
            console.error("Errore selezione cartella:", err);
            await showError("Errore selezione cartella.", err.message || String(err));
        }
    });

    btnPreview.addEventListener("click", handlePreview);
    btnApply.addEventListener("click", () => handleApply(showInfo, showWarning));
    btnClose.addEventListener("click", () => {
        window.close();
    });
    btnOpenFolder.addEventListener("click", () => handleOpenFolder(showWarning, showError));
    if (btnUndoLast) {
        btnUndoLast.addEventListener("click", () => handleUndoLast(showInfo, showWarning));
        btnUndoLast.disabled = true;
    }
    if (btnPresetSave && presetSelect) {
        btnPresetSave.addEventListener("click", async () => {
            const rawName = presetNameInput ? presetNameInput.value : "";
            const currentName = rawName || presetSelect.value || "";
            const name = (currentName || "").trim();
            if (!name) {
                await showWarning("Inserisci un nome per il preset.");
                if (presetNameInput) presetNameInput.focus();
                return;
            }
            const preset = buildPresetFromUI(name);
            try {
                await ipcRenderer.invoke("batch-rename-save-preset", {
                    name,
                    data: preset,
                });
                await loadPresetsIntoUI(name);
                if (presetNameInput) presetNameInput.value = name;
                setStatus(`Preset "${name}" salvato.`);
            } catch (err) {
                console.error("Errore salvando il preset:", err);
                await showError("Errore durante il salvataggio del preset.", err.message || String(err));
            }
        });
    }
    if (btnPresetDelete && presetSelect) {
        btnPresetDelete.addEventListener("click", async () => {
            const name = presetSelect.value;
            if (!name) return;
            const conferma = window.confirm(`Vuoi eliminare il preset "${name}"?`);
            if (!conferma) return;
            try {
                await ipcRenderer.invoke("batch-rename-delete-preset", { name });
                await loadPresetsIntoUI("");
                setStatus(`Preset "${name}" eliminato.`);
            } catch (err) {
                console.error("Errore eliminando il preset:", err);
                await showError("Errore durante l'eliminazione del preset.", err.message || String(err));
            }
        });
    }
    if (presetSelect && btnPresetDelete) {
        presetSelect.addEventListener("change", async () => {
            const name = presetSelect.value;
            btnPresetDelete.disabled = !name;
            if (!name) return;

            try {
                const presets = await ipcRenderer.invoke("batch-rename-load-presets");
                const presetObj = (presets || []).find((p) => p && p.name === name);
                if (presetObj && presetObj.data) {
                    applyPresetToUI(presetObj.data);
                    if (presetNameInput) presetNameInput.value = name;
                    setStatus(`Preset "${name}" caricato. Genera una nuova anteprima per vedere l'effetto.`);
                }
            } catch (err) {
                console.error("Errore caricando il preset selezionato:", err);
            }
        });
    }

    setStatus("Pronto");

    function syncRemoveAllState() {
        const isAll = rmAll?.checked || false;
        if (rmDigits) {
            rmDigits.disabled = isAll;
            if (isAll) rmDigits.checked = false;
        }
        if (rmSymbols) {
            rmSymbols.disabled = isAll;
            if (isAll) rmSymbols.checked = false;
        }
        if (rmExtraSpaces) {
            rmExtraSpaces.disabled = isAll;
            if (isAll) rmExtraSpaces.checked = false;
        }
    }

    if (rmAll) {
        rmAll.addEventListener("change", syncRemoveAllState);
    }
    syncRemoveAllState();

    ipcRenderer.on("batch-rename-set-root", (event, folderPath) => {
        if (folderPath) {
            state.rootFolder = folderPath;
            updateSelectedFolderLabel();
            refreshFolderTree();
        }
    });

    updateSelectedFolderLabel();
    refreshFolderTree();
    if (presetSelect) {
        loadPresetsIntoUI("");
    }
});



