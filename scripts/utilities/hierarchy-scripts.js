const { ipcRenderer } = require("electron");
const path = require("path");

let XLSX;
try {
    XLSX = require("xlsx");
} catch (err) {
    console.error("Modulo 'xlsx' non disponibile. Esegui `npm install xlsx` se vuoi l'export.");
}

// -------------------------
// Stato globale
// -------------------------

let selectedFolder = null;
let rootTree = null;
let selectedElement = null;
let lastSelectedNodeData = null;

// batch ricevuti dal main durante la scansione
let pendingEntries = [];
let isBuildingTree = false;

// riferimenti DOM (riempiti in DOMContentLoaded)
let treeRootEl = null;
let lblSelectedFolder = null;
let detailsBox = null;

// Messaggi “quantistici”
const FUN_MESSAGES = [
    "Calcolo degli atomi dei file...",
    "Allineamento dei bit con l'asse di rotazione terrestre...",
    "Stima della distanza Terra–Sole–file richiesti...",
    "Ottimizzazione del coefficiente di entropia dei backup...",
    "Calcolo subatomico quantistico dei metadati...",
    "Sincronizzazione con il fuso orario dei ping di rete...",
    "Ricalibrazione della matrice spazio–tempo dei percorsi...",
    "Normalizzazione logaritmica delle estensioni esotiche..."
];

let lastFunMessageTime = 0;
let funMessageIndex = 0;

// Ricerca globale nell'albero
let searchGeneration = 0;
let lastSearchProgressTime = 0;


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
 * Conteggio ricorsivo NON bloccante di un ramo.
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
// Export gerarchia in Excel (ramo cartella)
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
// Utility: figli ordinati (cartelle prima, poi file, alfabetic)
// -------------------------

function getSortedChildren(node) {
    if (!node || !Array.isArray(node.children)) return [];
    return [...node.children].sort((a, b) => {
        if (a.type !== b.type) {
            return a.type === "folder" ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
    });
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

        const sorted = getSortedChildren(nodeData);
        sorted.forEach((child) => {
            const childNode = createTreeNode(child);
            childrenContainer.appendChild(childNode);
        });

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
        }

        const buildFunStatus = document.getElementById("buildFunStatus");
        if (buildFunStatus) {
            const now = performance.now();
            if (now - lastFunMessageTime > 5000) { // 5 secondi
                funMessageIndex = (funMessageIndex + 1) % FUN_MESSAGES.length;
                buildFunStatus.textContent = FUN_MESSAGES[funMessageIndex];
                lastFunMessageTime = now;
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

        box.innerHTML += `
            <div class="details-buttons-row">
                <button id="btnFindSameName" class="small-btn">Trova tutti i file con questo nome</button>
            </div>
            <div id="sameNameResults" class="same-name-results"></div>
        `;

        const btnFind = document.getElementById("btnFindSameName");
        const resultsDiv = document.getElementById("sameNameResults");

        if (btnFind && resultsDiv) {
            btnFind.addEventListener("click", () => {
                if (!rootTree) {
                    resultsDiv.innerHTML = "<p class='muted'>Gerarchia non disponibile.</p>";
                    return;
                }

                const fileName = data.name;
                const matches = findFilesWithName(rootTree, fileName);

                if (!matches || matches.length === 0) {
                    resultsDiv.innerHTML = "<p class='muted'>Nessun altro file con questo nome.</p>";
                    return;
                }

                let html = `<p><b>Trovati ${matches.length} file con nome '${fileName}':</b></p><ul>`;
                for (const m of matches) {
                    const safePath = (m.fullPath || "").replace(/&/g, "&amp;").replace(/</g, "&lt;");
                    html += `<li class="sameNameLink" data-path="${m.fullPath}">${safePath}</li>`;
                }
                html += "</ul>";
                html += `<button id="exportSameName" class="small-btn">Esporta in Excel</button>`;

                resultsDiv.innerHTML = html;

                document.querySelectorAll(".sameNameLink").forEach(el => {
                    el.addEventListener("click", () => {
                        const p = el.getAttribute("data-path");
                        focusNodeInTree(p);
                    });
                });

                const btnExportSame = document.getElementById("exportSameName");
                if (btnExportSame) {
                    btnExportSame.addEventListener("click", () => {
                        exportSameNameList(matches);
                    });
                }
            });
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
// Ricerca file con stesso nome nel tree
// -------------------------

function findFilesWithName(root, fileName) {
    const results = [];
    if (!root) return results;

    const stack = [root];

    while (stack.length > 0) {
        const node = stack.pop();

        if (node.type === "file" && node.name === fileName) {
            results.push(node);
        }

        if (node.type === "folder" && Array.isArray(node.children)) {
            for (const c of node.children) stack.push(c);
        }
    }

    return results;
}

// -------------------------
// Esporta lista file con stesso nome
// -------------------------

function exportSameNameList(list) {
    if (!XLSX) {
        showError(
            "Modulo 'xlsx' non disponibile.",
            "Esegui 'npm install xlsx' nella cartella del progetto AyPi per abilitare l'esportazione."
        );
        return;
    }

    if (!list || list.length === 0) {
        showInfo("Nessun dato da esportare.");
        return;
    }

    const rows = list.map(n => ({
        Nome: n.name,
        "Percorso completo": n.fullPath || "",
        Dimensione: n.size ?? "",
        "Dimensione formattata": n.size ? formatBytes(n.size) : "",
        "Ultima modifica": n.mtimeMs ? new Date(n.mtimeMs).toLocaleString() : ""
    }));

    ipcRenderer.invoke("select-output-file", {
        defaultName: (list[0].name || "file") + "_occurrenze.xlsx"
    }).then(outputPath => {
        if (!outputPath) return;

        try {
            const wb = XLSX.utils.book_new();
            const ws = XLSX.utils.json_to_sheet(rows);
            XLSX.utils.book_append_sheet(wb, ws, "Occorrenze");

            XLSX.writeFile(wb, outputPath);
            showInfo("Esportazione completata.", outputPath);
        } catch (err) {
            console.error("Errore export same-name:", err);
            showError(
                "Errore durante l'esportazione.",
                err.message || String(err)
            );
        }
    });
}


// -------------------------
// Ricerca globale nell'albero (async, non blocca)
// -------------------------

function searchTreeAsync(query, onProgress, onDone) {
    if (!rootTree) {
        if (onDone) onDone([]);
        return;
    }

    const q = (query || "").toLowerCase();
    if (!q) {
        if (onDone) onDone([]);
        return;
    }

    const results = [];
    const stack = [rootTree];
    const CHUNK_TIME_MS = 16;
    const myGen = ++searchGeneration; // token per annullare ricerche vecchie

    function step() {
        if (myGen !== searchGeneration) {
            // C'è una nuova ricerca partita, questa è vecchia → stop
            return;
        }

        const start = performance.now();

        while (stack.length > 0 && (performance.now() - start) < CHUNK_TIME_MS) {
            const node = stack.pop();

            const name = (node.name || "").toLowerCase();
            const full = (node.fullPath || "").toLowerCase();

            if (name.includes(q) || full.includes(q)) {
                results.push(node);
            }

            if (node.type === "folder" && Array.isArray(node.children)) {
                for (const c of node.children) {
                    stack.push(c);
                }
            }
        }

        const processed = results.length; // non è proprio il numero nodi, ma va bene per feedback
        const remaining = stack.length;

        if (onProgress) {
            const now = performance.now();
            // aggiorniamo la UI al massimo ~5 volte al secondo
            if (now - lastSearchProgressTime > 200) {
                onProgress({ processed, remaining });
                lastSearchProgressTime = now;
            }
        }

        if (stack.length > 0) {
            setTimeout(step, 0);
        } else {
            if (onDone) onDone(results);
        }
    }

    setTimeout(step, 0);
}

// -------------------------
// Focus su nodo nell'albero (teletrasporto)
// -------------------------

function focusNodeInTree(fullPath) {
    if (!rootTree || !treeRootEl) return;
    const rootDom = treeRootEl.querySelector(".tree-node");
    if (!rootDom) return;

    const stack = [{ node: rootTree, dom: rootDom }];

    while (stack.length > 0) {
        const { node, dom } = stack.pop();

        if (node.fullPath === fullPath) {
            dom.scrollIntoView({ behavior: "smooth", block: "center" });
            selectNode(dom, node);
            return;
        }

        if (node.type === "folder" && Array.isArray(node.children)) {
            const childrenContainer = dom.querySelector(":scope > .tree-children");
            if (!childrenContainer) continue;

            // espandi il ramo
            childrenContainer.classList.add("open");
            const icon = dom.querySelector(":scope > .node-icon");
            if (icon) icon.textContent = "▼";

            const domChildren = childrenContainer.querySelectorAll(":scope > .tree-node");
            const sorted = getSortedChildren(node);

            for (let i = 0; i < sorted.length && i < domChildren.length; i++) {
                stack.push({
                    node: sorted[i],
                    dom: domChildren[i]
                });
            }
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

    const searchInput = document.getElementById("searchInput");
    const btnSearch = document.getElementById("btnSearch");
    const searchResultsEl = document.getElementById("searchResults");


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

        // messaggi divertenti per la scansione
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

    if (btnSearch && searchInput && searchResultsEl) {

        const runSearch = () => {
            const q = searchInput.value.trim();
            if (!q) {
                searchResultsEl.innerHTML = "<span class='muted'>Inserisci un testo da cercare.</span>";
                return;
            }
            if (!rootTree) {
                searchResultsEl.innerHTML = "<span class='muted'>Nessuna gerarchia caricata. Esegui una scansione prima.</span>";
                return;
            }

            searchResultsEl.innerHTML = `<span class='muted'>Ricerca in corso per: "${q}"...</span>`;

            searchTreeAsync(
                q,
                (partial) => {
                    // feedback leggero durante la ricerca
                    searchResultsEl.innerHTML = `
                        <span class='muted'>Ricerca in corso...</span>
                        <br><span class='muted'>Elementi trovati finora: ${partial.processed}, in analisi: ~${partial.remaining}</span>
                    `;
                },
                (matches) => {
                    if (!matches || matches.length === 0) {
                        searchResultsEl.innerHTML = `<span class='muted'>Nessun elemento trovato per: "${q}".</span>`;
                        return;
                    }

                    let html = `<p><b>Risultati: ${matches.length}</b></p><ul>`;
                    for (const node of matches.slice(0, 500)) { // limitiamo la visualizzazione per non esplodere
                        const safePath = (node.fullPath || node.name || "")
                            .replace(/&/g, "&amp;")
                            .replace(/</g, "&lt;");
                        html += `<li class="searchResultLink" data-path="${node.fullPath}">${safePath}</li>`;
                    }
                    if (matches.length > 500) {
                        html += `<li class='muted'>... altri ${matches.length - 500} risultati non mostrati</li>`;
                    }
                    html += "</ul>";

                    searchResultsEl.innerHTML = html;

                    searchResultsEl.querySelectorAll(".searchResultLink").forEach(el => {
                        el.addEventListener("click", () => {
                            const p = el.getAttribute("data-path");
                            focusNodeInTree(p);
                        });
                    });
                }
            );
        };

        btnSearch.addEventListener("click", () => {
            runSearch();
        });

        // Invio nella textbox = cerca
        searchInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                runSearch();
            }
        });
    }

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

    // messaggi divertenti durante la scansione
    if (detailsBox) {
        const scanFunStatus = document.getElementById("scanFunStatus");
        if (scanFunStatus) {
            const now = performance.now();
            if (now - lastFunMessageTime > 15000) {
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

    if (!treeRootEl || !detailsBox) return;

    treeRootEl.innerHTML = `
        <p>Scansione completata.</p>
        <p>Costruzione albero in corso...</p>
    `;

    detailsBox.innerHTML = `
        <p>Costruzione dell'albero in corso... Attendere.</p>
        <p id="buildFunStatus" class="fun-status muted"></p>
    `;

    // messaggi divertenti per costruzione albero
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
