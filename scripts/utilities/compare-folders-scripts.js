const { ipcRenderer } = require("electron");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
let pickFolder;
let withButtonLock;
try {
    ({ pickFolder, withButtonLock } = require("./shared/folder-picker"));
} catch (err) {
    console.error("Errore caricamento folder-picker:", err);
    pickFolder = () => ipcRenderer.invoke("select-root-folder");
    withButtonLock = async (_btn, fn) => fn();
}

const showInfo = (message, detail = "") =>
    ipcRenderer.invoke("show-message-box", { type: "info", message, detail });
const showWarning = (message, detail = "") =>
    ipcRenderer.invoke("show-message-box", { type: "warning", message, detail });
const showError = (message, detail = "") =>
    ipcRenderer.invoke("show-message-box", { type: "error", message, detail });


let folderA = null;
let folderB = null;
let results = [];
let selectedIndex = null;

let selectInProgress = false;

async function handleSelectFolderA() {
    if (selectInProgress) return;
    selectInProgress = true;
    try {
        const btn = document.getElementById("btnSelectFolderA");
        const f = await withButtonLock(btn, () => pickFolder({ cooldownMs: 400 }));
        if (!f) {
            return;
        }
        folderA = f;
        const lbl = document.getElementById("lblFolderA");
        if (lbl) lbl.textContent = f;
    } catch (err) {
        console.error("Errore selezione cartella A:", err);
        await showError("Errore selezione cartella A.", err.message || String(err));
    } finally {
        selectInProgress = false;
    }
}

async function handleSelectFolderB() {
    if (selectInProgress) return;
    selectInProgress = true;
    try {
        const btn = document.getElementById("btnSelectFolderB");
        const f = await withButtonLock(btn, () => pickFolder({ cooldownMs: 400 }));
        if (!f) {
            return;
        }
        folderB = f;
        const lbl = document.getElementById("lblFolderB");
        if (lbl) lbl.textContent = f;
    } catch (err) {
        console.error("Errore selezione cartella B:", err);
        await showError("Errore selezione cartella B.", err.message || String(err));
    } finally {
        selectInProgress = false;
    }
}

async function selectRootFolderSafe() {
    return pickFolder({ cooldownMs: 400 });
}

window.addEventListener("error", (event) => {
    const detail = event?.error?.stack || event?.message || "Errore sconosciuto";
    showError("Errore JS Confronta cartelle.", detail);
});

window.addEventListener("unhandledrejection", (event) => {
    const reason = event?.reason;
    const detail = reason?.stack || reason?.message || String(reason || "Errore sconosciuto");
    showError("Errore promessa non gestita (Confronta cartelle).", detail);
});

function formatMeta(info) {
    if (!info) return "-";
    const sizeStr = typeof info.size === "number" ? `${info.size} B` : "-";
    const dateStr = info.mtime ? new Date(info.mtime).toLocaleString() : "-";
    return `${sizeStr} | ${dateStr}`;
}

function collectFiles(rootPath, includeSubfolders) {
    const res = [];

    function walk(currentPath) {
        let entries;
        try {
            entries = fs.readdirSync(currentPath, { withFileTypes: true });
        } catch (err) {
            console.error("Impossibile leggere cartella:", currentPath, err);
            return;
        }

        for (const entry of entries) {
            const full = path.join(currentPath, entry.name);

            let stat;
            try {
                stat = fs.statSync(full);
            } catch (err) {
                console.error("Impossibile determinare tipo elemento:", full, err);
                continue;
            }

            const isDir = stat.isDirectory();
            const isFile = stat.isFile();

            if (isDir) {
                if (includeSubfolders) {
                    walk(full);
                }
            } else if (isFile) {
                const rel = path.relative(rootPath, full);
                let st = null;
                try {
                    st = fs.statSync(full);
                } catch {}
                res.push({
                    fullPath: full,
                    relPath: rel.replace(/\\/g, "/"),
                    size: st ? st.size : null,
                    mtime: st ? st.mtimeMs : null,
                });
            }
        }
    }

    walk(rootPath);
    return res;
}

function computeHash(fullPath) {
    try {
        const data = fs.readFileSync(fullPath);
        const hash = crypto.createHash("sha1");
        hash.update(data);
        return hash.digest("hex");
    } catch (err) {
        console.error("Errore nel calcolo hash per:", fullPath, err);
        return null;
    }
}

function buildComparison(includeSubfolders, mode) {
    const filesA = collectFiles(folderA, includeSubfolders);
    const filesB = collectFiles(folderB, includeSubfolders);

    const mapA = new Map();
    const mapB = new Map();

    for (const f of filesA) {
        mapA.set(f.relPath, f);
    }
    for (const f of filesB) {
        mapB.set(f.relPath, f);
    }

    const allKeys = new Set([...mapA.keys(), ...mapB.keys()]);
    const result = [];

    for (const rel of allKeys) {
        const a = mapA.get(rel) || null;
        const b = mapB.get(rel) || null;

        let status = "";
        let metaA = a
            ? { size: a.size, mtime: a.mtime, fullPath: a.fullPath }
            : null;
        let metaB = b
            ? { size: b.size, mtime: b.mtime, fullPath: b.fullPath }
            : null;

        if (a && !b) {
            status = "onlyA";
        } else if (!a && b) {
            status = "onlyB";
        } else if (a && b) {
            if (mode === "name") {
                status = "same";
            } else if (mode === "meta") {
                if (
                    metaA.size === metaB.size &&
                    Math.abs((metaA.mtime || 0) - (metaB.mtime || 0)) < 2000
                ) {
                    status = "same";
                } else {
                    status = "diff";
                }
            } else if (mode === "hash") {
                if (
                    metaA.size === metaB.size &&
                    Math.abs((metaA.mtime || 0) - (metaB.mtime || 0)) < 2000
                ) {
                    status = "same";
                } else {
                    const hashA = computeHash(metaA.fullPath);
                    const hashB = computeHash(metaB.fullPath);
                    if (hashA && hashB && hashA === hashB) {
                        status = "same";
                    } else {
                        status = "diff";
                    }
                }
            }
        }

        result.push({
            relPath: rel,
            status,
            metaA,
            metaB,
        });
    }

    result.sort((r1, r2) => r1.relPath.localeCompare(r2.relPath));
    return result;
}

function applyFilters() {
    const showOnlyA = document.getElementById("filterOnlyA").checked;
    const showOnlyB = document.getElementById("filterOnlyB").checked;
    const showDiff = document.getElementById("filterDiff").checked;
    const showSame = document.getElementById("filterSame").checked;

    return results.filter((item) => {
        if (item.status === "onlyA" && !showOnlyA) return false;
        if (item.status === "onlyB" && !showOnlyB) return false;
        if (item.status === "diff" && !showDiff) return false;
        if (item.status === "same" && !showSame) return false;
        return true;
    });
}

function renderTable() {
    const tbody = document.querySelector("#resultsTable tbody");
    tbody.innerHTML = "";
    selectedIndex = null;

    const filtered = applyFilters();

    const btnOpenA = document.getElementById("btnOpenInA");
    const btnOpenB = document.getElementById("btnOpenInB");
    if (btnOpenA) btnOpenA.disabled = true;
    if (btnOpenB) btnOpenB.disabled = true;

    filtered.forEach((item, visibleIndex) => {
        const tr = document.createElement("tr");
        tr.dataset.index = String(visibleIndex);

        tr.classList.add(`status-${item.status}`);

        const tdPath = document.createElement("td");
        tdPath.textContent = item.relPath;

        const tdStatus = document.createElement("td");
        if (item.status === "onlyA") tdStatus.textContent = "Solo in A";
        else if (item.status === "onlyB") tdStatus.textContent = "Solo in B";
        else if (item.status === "diff") tdStatus.textContent = "Diversi";
        else if (item.status === "same") tdStatus.textContent = "Uguali";
        else tdStatus.textContent = "-";

        const tdInfoA = document.createElement("td");
        tdInfoA.textContent = formatMeta(item.metaA);

        const tdInfoB = document.createElement("td");
        tdInfoB.textContent = formatMeta(item.metaB);

        tr.appendChild(tdPath);
        tr.appendChild(tdStatus);
        tr.appendChild(tdInfoA);
        tr.appendChild(tdInfoB);
        tbody.appendChild(tr);

        tr.addEventListener("click", () => {
            const rows = tbody.querySelectorAll("tr");
            rows.forEach((r) => r.classList.remove("row-selected"));
            tr.classList.add("row-selected");

            const realIndex = results.findIndex(
                (r) => r.relPath === item.relPath && r.status === item.status
            );
            selectedIndex = realIndex;

            if (btnOpenA) btnOpenA.disabled = !item.metaA;
            if (btnOpenB) btnOpenB.disabled = !item.metaB;
        });
    });
}

async function handleCompare() {
    if (!folderA || !folderB) {
        await showWarning("Seleziona prima entrambe le cartelle (A e B).");
        return;
    }

    const includeSub = document.getElementById("chkIncludeSubfolders").checked;
    const mode = document.getElementById("compareMode").value;

    if (mode === "hash") {
        await showInfo(
            "Attenzione",
            "La modalità hash può essere lenta su cartelle grandi. AyPi confronterà i file solo se dimensione/data non coincidono."
        );
    }

    try {
        const res = buildComparison(includeSub, mode);
        results = res;

        const total = results.length;
        const onlyA = results.filter((r) => r.status === "onlyA").length;
        const onlyB = results.filter((r) => r.status === "onlyB").length;
        const diff = results.filter((r) => r.status === "diff").length;
        const same = results.filter((r) => r.status === "same").length;

        renderTable();

        await showInfo(
            "Confronto completato.",
            `Totale percorsi: ${total}\nSolo in A: ${onlyA}\nSolo in B: ${onlyB}\nDiversi: ${diff}\nUguali: ${same}`
        );
    } catch (err) {
        console.error("Errore nel confronto cartelle:", err);
        await showError("Errore nel confronto delle cartelle.", err.message || String(err));
    }
}

async function handleOpenIn(side) {
    if (selectedIndex === null || selectedIndex < 0 || selectedIndex >= results.length) {
        await showWarning("Seleziona prima una riga nella tabella.");
        return;
    }

    const item = results[selectedIndex];
    let meta = null;
    if (side === "A") meta = item.metaA;
    else if (side === "B") meta = item.metaB;

    if (!meta || !meta.fullPath) {
        await showWarning(`Il file non esiste nel lato ${side}.`);
        return;
    }

    const dir = path.dirname(meta.fullPath);
    ipcRenderer.send("open-file", dir);
}

function initCompareFolders() {
    console.log("compare-folders-scripts.js caricato OK");

    const btnSelectFolderA = document.getElementById("btnSelectFolderA");
    const btnSelectFolderB = document.getElementById("btnSelectFolderB");
    const lblFolderA = document.getElementById("lblFolderA");
    const lblFolderB = document.getElementById("lblFolderB");

    const btnCompare = document.getElementById("btnCompare");
    const btnOpenInA = document.getElementById("btnOpenInA");
    const btnOpenInB = document.getElementById("btnOpenInB");
    const btnClose = document.getElementById("btnClose");

    const filterOnlyA = document.getElementById("filterOnlyA");
    const filterOnlyB = document.getElementById("filterOnlyB");
    const filterDiff = document.getElementById("filterDiff");
    const filterSame = document.getElementById("filterSame");

    if (!btnSelectFolderA || !btnSelectFolderB || !lblFolderA || !lblFolderB) {
        showError(
            "UI Confronta cartelle incompleta.",
            "Mancano uno o piu elementi: btnSelectFolderA/btnSelectFolderB/lblFolderA/lblFolderB."
        );
        return;
    }

    if (!btnCompare || !btnOpenInA || !btnOpenInB || !btnClose) {
        showError(
            "UI Confronta cartelle incompleta.",
            "Mancano uno o piu pulsanti principali (Confronta/Apri/Chiudi)."
        );
        return;
    }

    btnSelectFolderA.addEventListener("click", handleSelectFolderA);

    btnSelectFolderB.addEventListener("click", handleSelectFolderB);

    btnCompare.addEventListener("click", handleCompare);

    btnOpenInA.addEventListener("click", () => handleOpenIn("A"));
    btnOpenInB.addEventListener("click", () => handleOpenIn("B"));

    btnClose.addEventListener("click", () => {
        window.close();
    });

    if (filterOnlyA && filterOnlyB && filterDiff && filterSame) {
        filterOnlyA.addEventListener("change", renderTable);
        filterOnlyB.addEventListener("change", renderTable);
        filterDiff.addEventListener("change", renderTable);
        filterSame.addEventListener("change", renderTable);
    }

    ipcRenderer.on("compare-folders-set-A", (event, folderPath) => {
        if (folderPath) {
            folderA = folderPath;
            lblFolderA.textContent = folderPath;
        }
    });

    ipcRenderer.on("compare-folders-set-B", (event, folderPath) => {
        if (folderPath) {
            folderB = folderPath;
            lblFolderB.textContent = folderPath;
        }
    });

    window.__aypiCompareSelectA = handleSelectFolderA;
    window.__aypiCompareSelectB = handleSelectFolderB;
    window.__aypiCompareInitAttached = true;
}

if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", () => {
        try {
            initCompareFolders();
        } catch (err) {
            console.error("Errore inizializzazione Confronta cartelle:", err);
            showError("Errore inizializzazione Confronta cartelle.", err.message || String(err));
        }
    });
} else {
    try {
        initCompareFolders();
    } catch (err) {
        console.error("Errore inizializzazione Confronta cartelle:", err);
        showError("Errore inizializzazione Confronta cartelle.", err.message || String(err));
    }
}
