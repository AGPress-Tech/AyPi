const { ipcRenderer } = require("electron");
const fs = require("fs");
const path = require("path");

let rootFolder = null;
let previewData = [];
let selectedIndex = null;

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

function splitNameExt(filename) {
    const ext = path.extname(filename);
    const name = filename.slice(0, ext.length > 0 ? -ext.length : undefined);
    return { name, ext };
}

function parseExtensions(extString) {
    if (!extString) return [];
    return extString
        .split(/[;,]/)
        .map(s => s.trim())
        .filter(Boolean)
        .map(s => (s.startsWith(".") ? s.toLowerCase() : "." + s.toLowerCase()));
}

function collectFiles(rootPath, includeSubfolders, extFilterList) {
    const results = [];

    function walk(currentPath) {
        let entries;
        try {
            entries = fs.readdirSync(currentPath, { withFileTypes: true });
        } catch (err) {
            console.error("Impossibile leggere la cartella:", currentPath, err);
            return;
        }

        for (const entry of entries) {
            const fullPath = path.join(currentPath, entry.name);
            if (entry.isDirectory()) {
                if (includeSubfolders) {
                    walk(fullPath);
                }
            } else if (entry.isFile()) {
                const ext = path.extname(entry.name).toLowerCase();
                if (extFilterList.length === 0 || extFilterList.includes(ext)) {
                    results.push(fullPath);
                }
            }
        }
    }

    walk(rootPath);
    return results;
}

function applyTransform(filename, index) {
    const { name, ext } = splitNameExt(filename);
    const mode = document.getElementById("modeSelect").value;

    if (mode === "prefixSuffix") {
        const prefix = document.getElementById("prefixInput").value || "";
        const suffix = document.getElementById("suffixInput").value || "";
        const newName = prefix + name + suffix + ext;
        return newName;

    } else if (mode === "findReplace") {
        const findText = document.getElementById("findText").value || "";
        const replaceText = document.getElementById("replaceText").value || "";
        const replaceAll = document.getElementById("chkReplaceAll").checked;

        if (!findText) return filename;
        let base = name;
        if (replaceAll) {
            base = base.split(findText).join(replaceText);
        } else {
            base = base.replace(findText, replaceText);
        }
        return base + ext;

    } else if (mode === "cleanup") {
        let base = name;
        const spacesToUnderscore = document.getElementById("chkSpacesToUnderscore").checked;
        const removeBrackets = document.getElementById("chkRemoveBrackets").checked;

        if (spacesToUnderscore) {
            base = base.replace(/ /g, "_");
        }
        if (removeBrackets) {
            base = base.replace(/[()\[\]{}]/g, "");
        }
        return base + ext;

    } else if (mode === "changeCase") {
        const caseMode = document.getElementById("caseMode").value;
        let base = name;

        if (caseMode === "upper") {
            base = base.toUpperCase();
        } else if (caseMode === "lower") {
            base = base.toLowerCase();
        } else if (caseMode === "title") {
            base = base
                .split(/([_\-\s]+)/)
                .map(part => {
                    if (/^[_\-\s]+$/.test(part)) return part;
                    if (!part) return part;
                    return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
                })
                .join("");
        }
        return base + ext;

    } else if (mode === "numbering") {
        const baseText = document.getElementById("numberBase").value || "file";
        const start = parseInt(document.getElementById("numberStart").value || "1", 10);
        const padding = parseInt(document.getElementById("numberPadding").value || "3", 10);

        const num = start + index;
        const numStr = String(num).padStart(padding, "0");
        return `${baseText}_${numStr}${ext}`;
    }

    return filename;
}

function buildPreview(filePaths) {
    previewData = [];
    const usedTargets = new Map();

    const originalKeySet = new Set(filePaths.map(p => p.toLowerCase()));

    filePaths.forEach((fullPath, index) => {
        const dir = path.dirname(fullPath);
        const oldName = path.basename(fullPath);

        let newName = oldName;
        let status = "unchanged";
        let error = null;

        try {
            newName = applyTransform(oldName, index);
        } catch (e) {
            newName = oldName;
            status = "error";
            error = e.message || String(e);
        }

        if (!error && newName !== oldName) {
            const targetFullPath = path.join(dir, newName);

            const sourceKey = fullPath.toLowerCase();
            const targetKey = targetFullPath.toLowerCase();

            const existsOnDisk = fs.existsSync(targetFullPath);
            const targetIsSameFile = targetKey === sourceKey; // solo cambio di maiuscole/minuscole sullo stesso file
            const targetUsedByOthers = usedTargets.has(targetKey);
            const targetIsOtherOriginal = !targetIsSameFile && originalKeySet.has(targetKey);
            const targetIsExternalExisting =
                existsOnDisk && !targetIsSameFile && !originalKeySet.has(targetKey);

            if (targetUsedByOthers || targetIsOtherOriginal || targetIsExternalExisting) {
                status = "conflict";
                error = "Esiste già un file con lo stesso nome.";
            } else {
                status = "rename";
                usedTargets.set(targetKey, true);
            }
        }

        previewData.push({
            fullPath,
            oldName,
            newName,
            status,
            error
        });
    });
}

function renderPreviewTable() {
    const tbody = document.querySelector("#previewTable tbody");
    tbody.innerHTML = "";
    selectedIndex = null;

    previewData.forEach((item, index) => {
        const tr = document.createElement("tr");
        tr.classList.add(`status-${item.status}`);
        tr.dataset.index = index;

        const tdOld = document.createElement("td");
        tdOld.textContent = item.oldName;

        const tdNew = document.createElement("td");
        tdNew.textContent = item.newName;

        const tdStatus = document.createElement("td");
        if (item.status === "rename") {
            tdStatus.textContent = "Da rinominare";
        } else if (item.status === "unchanged") {
            tdStatus.textContent = "Invariato";
        } else if (item.status === "conflict") {
            tdStatus.textContent = `Conflitto: ${item.error}`;
        } else if (item.status === "error") {
            tdStatus.textContent = `Errore: ${item.error}`;
        }

        tr.appendChild(tdOld);
        tr.appendChild(tdNew);
        tr.appendChild(tdStatus);
        tbody.appendChild(tr);

        tr.addEventListener("click", () => {
            const rows = tbody.querySelectorAll("tr");
            rows.forEach(r => r.classList.remove("row-selected"));

            tr.classList.add("row-selected");
            selectedIndex = index;

            const btnOpenFolder = document.getElementById("btnOpenFolder");
            if (btnOpenFolder) {
                btnOpenFolder.disabled = false;
            }
        });
    });

    const btnOpenFolder = document.getElementById("btnOpenFolder");
    if (btnOpenFolder) {
        btnOpenFolder.disabled = previewData.length === 0;
    }
}

async function handlePreview() {
    if (!rootFolder) {
        await showWarning("Seleziona prima una cartella.");
        return;
    }

    const extFilterStr = document.getElementById("extFilter").value.trim();
    const includeSubfolders = document.getElementById("chkIncludeSubfolders").checked;
    const extList = parseExtensions(extFilterStr);

    let files = collectFiles(rootFolder, includeSubfolders, extList);

    const sortOrderSelect = document.getElementById("sortOrder");
    const sortOrder = sortOrderSelect ? sortOrderSelect.value : "nameAsc";

    files.sort((a, b) => {
        const nameA = path.basename(a).toLowerCase();
        const nameB = path.basename(b).toLowerCase();
        const cmp = nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: "base" });
        return sortOrder === "nameDesc" ? -cmp : cmp;
    });

    if (files.length === 0) {
        previewData = [];
        renderPreviewTable();
        await showWarning("Nessun file trovato con i criteri specificati.");
        document.getElementById("btnApply").disabled = true;
        return;
    }

    buildPreview(files);
    renderPreviewTable();

    const toRename = previewData.filter(x => x.status === "rename").length;
    const conflicts = previewData.filter(x => x.status === "conflict" || x.status === "error").length;

    document.getElementById("btnApply").disabled = toRename === 0;

    await showInfo(
        "Anteprima generata.",
        `File totali: ${previewData.length}\nDa rinominare: ${toRename}\nConflitti/Errori: ${conflicts}`
    );
}

async function handleApply() {
    const toRename = previewData.filter(x => x.status === "rename");
    if (toRename.length === 0) {
        await showWarning("Non ci sono file da rinominare.");
        return;
    }

    let ok = 0;
    let fail = 0;

    for (const item of toRename) {
        const dir = path.dirname(item.fullPath);
        const target = path.join(dir, item.newName);

        try {
            fs.renameSync(item.fullPath, target);
            ok++;
        } catch (err) {
            console.error("Errore rinominando:", item.fullPath, "->", target, err);
            fail++;
        }
    }

    await showInfo(
        "Rinomina completata.",
        `Rinomine riuscite: ${ok}\nRinomine fallite: ${fail}`
    );
}

async function handleOpenFolder() {
    if (selectedIndex === null || selectedIndex < 0 || selectedIndex >= previewData.length) {
        await showWarning("Seleziona prima una riga nell'anteprima.");
        return;
    }

    const item = previewData[selectedIndex];
    const dir = path.dirname(item.fullPath);

    if (!dir) {
        await showError("Impossibile determinare la cartella del file selezionato.");
        return;
    }

    ipcRenderer.send("open-file", dir);
}

function switchModePanels() {
    const mode = document.getElementById("modeSelect").value;
    const panels = document.querySelectorAll(".mode-panel");
    panels.forEach(p => p.classList.add("hidden"));

    const panel = document.getElementById(`mode-${mode}`);
    if (panel) panel.classList.remove("hidden");
}

window.addEventListener("DOMContentLoaded", () => {
    console.log("batch-rename-scripts.js caricato");

    const btnSelectFolder = document.getElementById("btnSelectFolder");
    const lblFolder = document.getElementById("selectedFolder");
    const btnPreview = document.getElementById("btnPreview");
    const btnApply = document.getElementById("btnApply");
    const btnClose = document.getElementById("btnClose");
    const modeSelect = document.getElementById("modeSelect");
    const btnOpenFolder = document.getElementById("btnOpenFolder");

    btnSelectFolder.addEventListener("click", async () => {
        const folder = await ipcRenderer.invoke("select-root-folder");
        if (!folder) return;
        rootFolder = folder;
        lblFolder.textContent = folder;
    });

    btnPreview.addEventListener("click", handlePreview);
    btnApply.addEventListener("click", handleApply);
    btnClose.addEventListener("click", () => {
        window.close();
    });
    btnOpenFolder.addEventListener("click", handleOpenFolder);

    modeSelect.addEventListener("change", switchModePanels);
    switchModePanels(); // inizializza pannello corretto

    ipcRenderer.on("batch-rename-set-root", (event, folderPath) => {
        if (folderPath) {
            rootFolder = folderPath;
            lblFolder.textContent = folderPath;
        }
    });
});

