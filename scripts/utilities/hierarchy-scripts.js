const { ipcRenderer } = require("electron");
const path = require("path");

const FUN_MESSAGES = [
    "Calcolo degli atomi dei file...",
    "Allineamento dei bit con l'asse di rotazione terrestre...",
    "Stima della distanza Terra–Sole–file selezionati...",
    "Ottimizzazione del coefficiente di entropia dei backup...",
    "Calcolo subatomico quantistico dei metadati...",
    "Sincronizzazione con il fuso orario dei ping di rete...",
    "Ricalibrazione della matrice spazio–tempo dei percorsi...",
    "Normalizzazione logaritmica delle estensioni esotiche...",
];

let lastFunMessageTime = 0;
let funMessageIndex = 0;

let XLSX;
try {
    XLSX = require("xlsx");
} catch (err) {
    console.error("Modulo 'xlsx' non disponibile. Esegui `npm install xlsx` se vuoi l'export.");
}

let selectedFolder = null;
let rootTree = null;
let selectedElement = null;
let lastSelectedNodeData = null;

// batch ricevuti dal main durante la scansione
let pendingEntries = [];
let isBuildingTree = false;

// riferimenti DOM (li riempiamo in DOMContentLoaded)
let treeRootEl = null;
let lblSelectedFolder = null;
let detailsBox = null;

// -------------------------
// Helper dialog
// -------------------------

function showDialog(type, message, detail = "") {
    return ipcRenderer.invoke("show-message-box", { type, message, detail });
}

function showInfo(message, detail = "") {
    return showDialog("info", message, detail);
}

function showError(message, detail = "") {
    return showDialog("error", message, detail);
}

// -------------------------
// Struttura albero in memoria
// -------------------------

function createRootTree(rootFolder) {
    return {
        name: path.basename(rootFolder) || rootFolder,
        type: "folder",
        fullPath: rootFolder,
        children: [],
    };
}

function ensureFolderPath(parts) {
    if (!rootTree) return null;
    let node = rootTree;
    let currentFullPath = rootTree.fullPath;

    for (const segment of parts) {
        currentFullPath = path.join(currentFullPath, segment);

        let child = node.children.find(
            (c) => c.type === "folder" && c.name === segment
        );
        if (!child) {
            child = {
                name: segment,
                type: "folder",
                fullPath: currentFullPath,
                children: [],
            };
            node.children.push(child);
        }
        node = child;
    }

    return node;
}

/**
 * entry = { kind, fullPath, relPath, size, mtimeMs }
 */
function addEntryToTree(entry) {
    if (!rootTree) return;

    const normalizedRel = (entry.relPath || "").replace(/\\/g, "/");
    if (!normalizedRel) {
        // root stesso
        return;
    }

    const parts = normalizedRel.split("/").filter(Boolean);
    if (parts.length === 0) return;

    if (entry.kind === "folder") {
        ensureFolderPath(parts);
    } else if (entry.kind === "file") {
        const fileName = parts[parts.length - 1];
        const folderParts = parts.slice(0, -1);

        const parentFolder = ensureFolderPath(folderParts);
        if (!parentFolder) return;

        const existing = parentFolder.children.find(
            (c) => c.type === "file" && c.name === fileName && c.fullPath === entry.fullPath
        );
        if (existing) return;

        parentFolder.children.push({
            name: fileName,
            type: "file",
            fullPath: entry.fullPath,
            size: entry.size ?? null,
            mtimeMs: entry.mtimeMs ?? null,
        });
    }
}

// -------------------------
// Conteggi diretti / ricorsivi + peso
// -------------------------

function computeFolderStatsDirect(node) {
    let folders = 0;
    let files = 0;
    let totalSize = 0;

    if (!node || node.type !== "folder" || !Array.isArray(node.children)) {
        return { folders: 0, files: 0, totalSize: 0 };
    }

    for (const child of node.children) {
        if (child.type === "folder") {
            folders++;
        } else if (child.type === "file") {
            files++;
            if (typeof child.size === "number") {
                totalSize += child.size;
            }
        }
    }
    return { folders, files, totalSize };
}

/**
 * Conteggio ricorsivo NON bloccante.
 */
function computeFolderStatsRecursiveAsync(node, onProgress, onDone) {
    if (!node || node.type !== "folder") {
        if (onDone) onDone({ folders: 0, files: 0, totalSize: 0 });
        return;
    }

    const stack = Array.isArray(node.children) ? [...node.children] : [];
    let folders = 0;
    let files = 0;
    let totalSize = 0;
    let processed = 0;
    const totalInitial = stack.length || 1;

    const CHUNK_TIME_MS = 16;

    function step() {
        const start = performance.now();

        while (stack.length > 0 && (performance.now() - start) < CHUNK_TIME_MS) {
            const cur = stack.pop();

            if (cur.type === "folder") {
                folders++;
                if (Array.isArray(cur.children) && cur.children.length > 0) {
                    stack.push(...cur.children);
                }
            } else if (cur.type === "file") {
                files++;
                if (typeof cur.size === "number") {
                    totalSize += cur.size;
                }
            }

            processed++;
        }

        if (onProgress) {
            const remaining = stack.length;
            const progressRatio =
                totalInitial > 0 ? Math.min(1, processed / (processed + remaining || 1)) : 0;
            onProgress({
                folders,
                files,
                totalSize,
                processed,
                remaining,
                progressRatio,
            });
        }

        if (stack.length > 0) {
            setTimeout(step, 0);
        } else {
            if (onDone) onDone({ folders, files, totalSize });
        }
    }

    setTimeout(step, 0);
}

function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let idx = 0;
    let val = bytes;
    while (val >= 1024 && idx < units.length - 1) {
        val /= 1024;
        idx++;
    }
    return `${val.toFixed(2)} ${units[idx]}`;
}

// -------------------------
// Export gerarchia in Excel
// -------------------------

function collectSubtreeRows(node, basePath, acc = []) {
    if (!node) return acc;

    if (node.type === "folder") {
        if (Array.isArray(node.children)) {
            for (const child of node.children) {
                collectSubtreeRows(child, basePath, acc);
            }
        }
    } else if (node.type === "file") {
        const rel =
            basePath && node.fullPath
                ? path.relative(basePath, node.fullPath)
                : node.fullPath || node.name;

        acc.push({
            Nome: node.name,
            Tipo: "File",
            "Percorso relativo": rel || "",
            "Percorso completo": node.fullPath || "",
            Dimensione: node.size ?? "",
            "Dimensione (formattata)": node.size ? formatBytes(node.size) : "",
            "Ultima modifica": node.mtimeMs
                ? new Date(node.mtimeMs).toLocaleString()
                : "",
        });
    }

    return acc;
}

// -------------------------
// Creazione DOM albero
// -------------------------

function createTreeNode(nodeData) {
    const wrapper = document.createElement("div");
    wrapper.classList.add("tree-node");

    const icon = document.createElement("span");
    icon.classList.add("node-icon");

    const label = document.createElement("span");
    label.textContent = nodeData.name;

    wrapper.appendChild(icon);
    wrapper.appendChild(label);

    if (nodeData.type === "folder") {
        icon.textContent = "▶";

        const childrenContainer = document.createElement("div");
        childrenContainer.classList.add("tree-children");

        if (Array.isArray(nodeData.children)) {
            const sorted = [...nodeData.children].sort((a, b) => {
                if (a.type !== b.type) {
                    return a.type === "folder" ? -1 : 1;
                }
                return a.name.localeCompare(b.name);
            });

            sorted.forEach((child) => {
                const childNode = createTreeNode(child);
                childrenContainer.appendChild(childNode);
            });
        }

        wrapper.appendChild(childrenContainer);

        wrapper.addEventListener("click", (e) => {
            e.stopPropagation();
            selectNode(wrapper, nodeData);

            const open = childrenContainer.classList.toggle("open");
            icon.textContent = open ? "▼" : "▶";
        });
    } else {
        icon.textContent = "•";

        wrapper.addEventListener("click", (e) => {
            e.stopPropagation();
            selectNode(wrapper, nodeData);
        });
    }

    return wrapper;
}

function renderTreeFromModel() {
    if (!treeRootEl) return;

    treeRootEl.innerHTML = "";

    if (!rootTree) {
        treeRootEl.innerHTML = "<p>Nessun risultato da mostrare.</p>";
        return;
    }

    const rootDom = createTreeNode(rootTree);
    treeRootEl.appendChild(rootDom);
}

// -------------------------
// Costruzione albero da pendingEntries (NON bloccante)
// -------------------------

function buildTreeFromPendingAsync(onDone) {
    if (!rootTree || pendingEntries.length === 0) {
        pendingEntries = [];
        if (onDone) onDone();
        return;
    }

    isBuildingTree = true;
    let index = 0;
    const total = pendingEntries.length;
    const CHUNK_TIME_MS = 16;

    function step() {
        const start = performance.now();

        while (index < total && (performance.now() - start) < CHUNK_TIME_MS) {
            const entry = pendingEntries[index];
            addEntryToTree(entry);
            index++;
        }

        if (treeRootEl) {
            treeRootEl.innerHTML = `
        <p>Costruzione albero...</p>
        <p>${index} / ${total} elementi elaborati</p>
        `;

        const buildFunStatus = document.getElementById("buildFunStatus");
        if (buildFunStatus) {
            const now = performance.now();
            if (now - lastFunMessageTime > 15000) { // 15 secondi
                funMessageIndex = (funMessageIndex + 1) % FUN_MESSAGES.length;
                buildFunStatus.textContent = FUN_MESSAGES[funMessageIndex];
                lastFunMessageTime = now;
            }
        }

        }

        if (index < total) {
            setTimeout(step, 0);
        } else {
            pendingEntries = [];
            isBuildingTree = false;
            if (onDone) onDone();
        }
    }

    setTimeout(step, 0);
}

// -------------------------
// Selezione nodo
// -------------------------

function selectNode(domNode, data) {
    if (selectedElement) {
        selectedElement.classList.remove("selected");
    }
    selectedElement = domNode;
    selectedElement.classList.add("selected");

    lastSelectedNodeData = data;

    updateDetails(data);
}

// -------------------------
// Dettagli nodo selezionato
// -------------------------

function updateDetails(data) {
    if (!detailsBox) return;
    const box = detailsBox;
    box.innerHTML = "";

    box.innerHTML += `<p><b>Nome:</b> ${data.name}</p>`;
    box.innerHTML += `<p><b>Tipo:</b> ${data.type}</p>`;

    if (data.fullPath) {
        box.innerHTML += `<p><b>Percorso completo:</b><br><span style="font-size:12px;">${data.fullPath}</span></p>`;
    }

    // FILE
    if (data.type === "file") {
        if (typeof data.size === "number") {
            box.innerHTML += `<p><b>Dimensione:</b> ${data.size} byte (${formatBytes(
                data.size
            )})</p>`;
        }
        if (typeof data.mtimeMs === "number") {
            const dt = new Date(data.mtimeMs);
            box.innerHTML += `<p><b>Ultima modifica:</b> ${dt.toLocaleString()}</p>`;
        }
        return;
    }

    // CARTELLA
    if (data.type === "folder") {
        const direct = computeFolderStatsDirect(data);

        box.innerHTML += `
            <p><b>Elementi diretti:</b> 
                ${direct.folders} cartelle, ${direct.files} file 
                (${formatBytes(direct.totalSize)} solo file diretti)
            </p>

            <p id="recursiveInfo">
                <b>Elementi (incluse sottocartelle):</b>
                <span class="muted">non calcolato</span>
            </p>
            <p id="recursiveSizeInfo">
                <b>Peso complessivo (incluse sottocartelle):</b>
                <span class="muted">non calcolato</span>
            </p>

            <p id="funStatus" class="fun-status muted"></p>

            <div class="details-buttons-row">
                <button id="btnCalcRecursive" class="small-btn">Calcola ricorsivamente</button>
                <button id="btnExportHierarchy" class="small-btn">Esporta gerarchia in Excel</button>
            </div>

            <div id="recursiveProgress" class="progress-container" style="display:none;">
                <div class="progress-bar"></div>
            </div>
        `;

        const btnCalc = document.getElementById("btnCalcRecursive");
        const btnExport = document.getElementById("btnExportHierarchy");
        const recursiveInfo = document.getElementById("recursiveInfo");
        const recursiveSizeInfo = document.getElementById("recursiveSizeInfo");
        const progressEl = document.getElementById("recursiveProgress");
        const funStatus = document.getElementById("funStatus");

        if (btnCalc && recursiveInfo && recursiveSizeInfo && progressEl) {
            btnCalc.addEventListener("click", () => {
                const targetNode = lastSelectedNodeData || data;
                if (!targetNode || targetNode.type !== "folder") return;

                progressEl.style.display = "block";
                recursiveInfo.innerHTML =
                    `<b>Elementi (incluse sottocartelle):</b> <span class="muted">calcolo in corso...</span>`;
                recursiveSizeInfo.innerHTML =
                    `<b>Peso complessivo (incluse sottocartelle):</b> <span class="muted">calcolo in corso...</span>`;
                btnCalc.disabled = true;

                if (funStatus) {
                    funMessageIndex = 0;
                    lastFunMessageTime = performance.now();
                    funStatus.textContent = "Avvio calcolo quantistico preliminare...";
                }

                computeFolderStatsRecursiveAsync(
                    targetNode,
                    (partial) => {
                        // progress parziale: cambiamo messaggio solo ogni ~15s
                        if (funStatus) {
                            const now = performance.now();
                            if (now - lastFunMessageTime > 15000) {
                                funMessageIndex = (funMessageIndex + 1) % FUN_MESSAGES.length;
                                funStatus.textContent = FUN_MESSAGES[funMessageIndex];
                                lastFunMessageTime = now;
                            }
                        }
                    },
                    (totals) => {
                        progressEl.style.display = "none";
                        btnCalc.disabled = false;

                        recursiveInfo.innerHTML =
                            `<b>Elementi (incluse sottocartelle):</b> ${totals.folders} cartelle, ${totals.files} file`;
                        recursiveSizeInfo.innerHTML =
                            `<b>Peso complessivo (incluse sottocartelle):</b> ${formatBytes(totals.totalSize)}`;

                        if (funStatus) {
                            funStatus.textContent = "Calcolo completato. Gli elettroni possono riposare.";
                        }
                    }
                );
            });
        }

        if (btnExport) {
            btnExport.addEventListener("click", async () => {
                if (!XLSX) {
                    await showError(
                        "Modulo 'xlsx' non disponibile.",
                        "Esegui 'npm install xlsx' nella cartella del progetto AyPi per abilitare l'esportazione."
                    );
                    return;
                }

                const targetNode = lastSelectedNodeData || data;
                if (!targetNode || targetNode.type !== "folder") {
                    await showError("Nessuna cartella valida selezionata per l'esportazione.");
                    return;
                }

                const basePath = targetNode.fullPath || selectedFolder;
                const rows = collectSubtreeRows(targetNode, basePath);

                if (!rows || rows.length === 0) {
                    await showInfo("Nessun file da esportare.", "La cartella selezionata non contiene file.");
                    return;
                }

                const defaultNameSafe =
                    (targetNode.name || "cartella") + "_gerarchia.xlsx";

                const outputPath = await ipcRenderer.invoke("select-output-file", {
                    defaultName: defaultNameSafe,
                });

                if (!outputPath) {
                    return;
                }

                try {
                    const wb = XLSX.utils.book_new();
                    const ws = XLSX.utils.json_to_sheet(rows);
                    XLSX.utils.book_append_sheet(wb, ws, "Gerarchia");

                    XLSX.writeFile(wb, outputPath);

                    await showInfo("Esportazione completata.", outputPath);
                } catch (err) {
                    console.error("Errore durante l'esportazione Excel:", err);
                    await showError(
                        "Errore durante l'esportazione Excel.",
                        err.message || String(err)
                    );
                }
            });
        }
    }
}

// -------------------------
// Inizializzazione finestra
// -------------------------

window.addEventListener("DOMContentLoaded", () => {
    treeRootEl = document.getElementById("treeRoot");
    lblSelectedFolder = document.getElementById("selectedFolder");
    detailsBox = document.getElementById("detailsBox");

    const btnClose = document.getElementById("btnClose");
    const btnSelectFolder = document.getElementById("btnSelectFolder");
    const btnStartScan = document.getElementById("btnStartScan");

    treeRootEl.innerHTML = "<p>Seleziona una cartella e premi 'Avvia scansione'.</p>";
    detailsBox.innerHTML = "<p>Seleziona un nodo per vedere i dettagli.</p>";

    btnClose.addEventListener("click", () => {
        window.close();
    });

    btnSelectFolder.addEventListener("click", async () => {
        const folder = await ipcRenderer.invoke("select-root-folder");

        if (!folder) {
            console.log("Nessuna cartella selezionata.");
            return;
        }

        selectedFolder = folder;
        rootTree = null;
        selectedElement = null;
        lastSelectedNodeData = null;
        pendingEntries = [];
        isBuildingTree = false;

        lblSelectedFolder.textContent = folder;
        treeRootEl.innerHTML = "<p>Premi 'Avvia scansione' per visualizzare la gerarchia...</p>";
        detailsBox.innerHTML = "<p>Seleziona un nodo per vedere i dettagli.</p>";

        console.log("Cartella selezionata:", folder);
    });

    btnStartScan.addEventListener("click", () => {
        if (!selectedFolder) {
            console.warn("Seleziona prima una cartella!");
            return;
        }

        rootTree = createRootTree(selectedFolder);
        selectedElement = null;
        lastSelectedNodeData = null;
        pendingEntries = [];
        isBuildingTree = false;

        treeRootEl.innerHTML = "<p>Scansione in corso...</p>";

        detailsBox.innerHTML = `
            <p>Scansione in corso... Attendere.</p>
            <p id="scanFunStatus" class="fun-status muted"></p>
        `;

        // inizializza messaggi divertenti
        funMessageIndex = 0;
        lastFunMessageTime = performance.now();
        const scanFunStatus = document.getElementById("scanFunStatus");
        if (scanFunStatus) {
            scanFunStatus.textContent = FUN_MESSAGES[funMessageIndex];
        }

        ipcRenderer.send("hierarchy-start-scan", {
            rootFolder: selectedFolder,
        });
    });

});

// -------------------------
// Listener dal main
// -------------------------

ipcRenderer.on("hierarchy-progress", (event, payload) => {
    const { batch, totalFiles, totalDirs } = payload;

    if (!rootTree) return;

    if (Array.isArray(batch) && batch.length > 0) {
        pendingEntries.push(...batch);
    }

    if (treeRootEl) {
        treeRootEl.innerHTML = `
            <p>Scansione in corso...</p>
            <p>File scansionati: ${totalFiles}</p>
            <p>Cartelle scansionate: ${totalDirs}</p>
        `;
    }

    // 🔹 Aggiorna il messaggio divertente SOLO ogni ~15 secondi
    if (detailsBox) {
        const scanFunStatus = document.getElementById("scanFunStatus");
        if (scanFunStatus) {
            const now = performance.now();
            if (now - lastFunMessageTime > 15000) { // 15 secondi
                funMessageIndex = (funMessageIndex + 1) % FUN_MESSAGES.length;
                scanFunStatus.textContent = FUN_MESSAGES[funMessageIndex];
                lastFunMessageTime = now;
            }
        }
    }
});

ipcRenderer.on("hierarchy-complete", (event, payload) => {
    const { totalFiles, totalDirs } = payload;

    console.log(
        `%cScansione completata. File: ${totalFiles}, Cartelle: ${totalDirs}`,
        "color: lightgreen;"
    );

    if (!treeRootEl) return;

    treeRootEl.innerHTML = `
    <p>Scansione completata.</p>
    <p>Costruzione albero in corso...</p>
    `;

    detailsBox.innerHTML = `
        <p>Costruzione dell'albero in corso... Attendere.</p>
        <p id="buildFunStatus" class="fun-status muted"></p>
    `;

    // inizializza messaggi divertenti per la costruzione albero
    funMessageIndex = 0;
    lastFunMessageTime = performance.now();

    const buildFunStatus = document.getElementById("buildFunStatus");
    if (buildFunStatus) {
        buildFunStatus.textContent = FUN_MESSAGES[funMessageIndex];
    }


    buildTreeFromPendingAsync(() => {
        renderTreeFromModel();
        detailsBox.innerHTML = "<p>Seleziona un nodo per vedere i dettagli.</p>";
    });
});

