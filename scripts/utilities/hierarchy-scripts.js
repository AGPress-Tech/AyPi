const { ipcRenderer } = require("electron");
const path = require("path");
const fs = require("fs");

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
let originalRootTree = null;
let selectedElement = null;
let lastSelectedNodeData = null;

// batch ricevuti dal main durante la scansione
let pendingEntries = [];
let isBuildingTree = false;

// riferimenti DOM (riempiti in DOMContentLoaded)
let treeRootEl = null;
let lblSelectedFolder = null;
let detailsBox = null;
// menu contestuale albero
let contextMenuEl = null;
let contextMenuNode = null;

// Messaggi "quantistici"
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

function copyToClipboard(text) {
    try {
        const electron = require("electron");
        const clip = electron.clipboard;
        if (clip && typeof clip.writeText === "function") {
            clip.writeText(text);
        } else if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text);
        } else {
            console.warn("Clipboard API non disponibile");
        }
    } catch (err) {
        console.error("Errore copia negli appunti:", err);
    }
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
// Report navigabile: raccolta dati (Versione 1)
// -------------------------

function collectReportData(maxTop = 50) {
    if (!rootTree) {
        return null;
    }

    let totalFiles = 0;
    let totalFolders = 0;
    let totalSizeBytes = 0;
    let maxDepth = 0;

    const topFolders = [];
    const topFiles = [];

    function pushSorted(arr, item, key, limit) {
        arr.push(item);
        arr.sort((a, b) => (b[key] || 0) - (a[key] || 0));
        if (arr.length > limit) {
            arr.length = limit;
        }
    }

    function walk(node, depth) {
        if (!node) return null;

        if (depth > maxDepth) {
            maxDepth = depth;
        }

        if (node.type === "file") {
            const size = typeof node.size === "number" ? node.size : 0;
            totalFiles++;
            totalSizeBytes += size;

            const fileInfo = {
                name: node.name,
                fullPath: node.fullPath || "",
                sizeBytes: size,
                depth,
            };
            pushSorted(topFiles, fileInfo, "sizeBytes", maxTop);

            return {
                name: node.name,
                type: "file",
                fullPath: node.fullPath || "",
                sizeBytes: size,
                depth,
            };
        }

        if (node.type === "folder") {
            totalFolders++;

            let folderFilesCount = 0;
            let folderFoldersCount = 0;
            let folderTotalSize = 0;

            const childrenOut = [];

            if (Array.isArray(node.children)) {
                for (const child of node.children) {
                    const childOut = walk(child, depth + 1);
                    if (!childOut) continue;
                    childrenOut.push(childOut);

                    if (childOut.type === "file") {
                        folderFilesCount += 1;
                        folderTotalSize += childOut.sizeBytes || 0;
                    } else if (childOut.type === "folder") {
                        folderFilesCount += childOut.filesCount || 0;
                        folderFoldersCount += 1 + (childOut.foldersCount || 0);
                        folderTotalSize += childOut.totalSizeBytes || 0;
                    }
                }
            }

            const folderInfo = {
                name: node.name,
                type: "folder",
                fullPath: node.fullPath || "",
                depth,
                filesCount: folderFilesCount,
                foldersCount: folderFoldersCount,
                totalSizeBytes: folderTotalSize,
                children: childrenOut,
            };

            pushSorted(
                topFolders,
                {
                    name: folderInfo.name,
                    fullPath: folderInfo.fullPath,
                    depth: folderInfo.depth,
                    filesCount: folderInfo.filesCount,
                    foldersCount: folderInfo.foldersCount,
                    totalSizeBytes: folderInfo.totalSizeBytes,
                },
                "totalSizeBytes",
                maxTop
            );

            return folderInfo;
        }

        return null;
    }

    const hierarchyOut = walk(rootTree, 0);

    const report = {
        meta: {
            reportVersion: "1.0.0",
            generatedAt: new Date().toISOString(),
            rootPath: rootTree.fullPath || "",
        },
        globalStats: {
            totalFiles,
            totalFolders,
            totalSizeBytes,
            maxDepth,
        },
        hierarchy: hierarchyOut,
        topFolders,
        topFiles,
    };

    return report;
}

// -------------------------
// Scansione directory lato renderer (stile Confronta cartelle)
// -------------------------

function scanFolderRecursively(rootFolder) {
    const entries = [];

    function walk(currentPath) {
        let dirEntries;
        try {
            dirEntries = fs.readdirSync(currentPath, { withFileTypes: true });
        } catch (err) {
            console.warn("Impossibile leggere cartella:", currentPath, err);
            return;
        }

        const relDir = path.relative(rootFolder, currentPath);
        entries.push({
            kind: "folder",
            fullPath: currentPath,
            relPath: relDir || "",
        });

        for (const entry of dirEntries) {
            const full = path.join(currentPath, entry.name);

            let stat;
            try {
                stat = fs.statSync(full);
            } catch (err) {
                console.warn("Impossibile determinare tipo elemento:", full, err);
                continue;
            }

            if (stat.isDirectory()) {
                walk(full);
            } else if (stat.isFile()) {
                const rel = path.relative(rootFolder, full);
                entries.push({
                    kind: "file",
                    fullPath: full,
                    relPath: rel.replace(/\\/g, "/"),
                    size: stat.size,
                    mtimeMs: stat.mtimeMs,
                });
            }
        }
    }

    walk(rootFolder);
    return entries;
}

// -------------------------
// Cloni e filtri albero (per opzioni di scansione)
// -------------------------

function cloneTree(node) {
    if (!node) return null;
    return JSON.parse(JSON.stringify(node));
}

function normalizeScanOptions(options) {
    const rawDepth = Number(options.maxDepth);
    const maxDepth =
        Number.isFinite(rawDepth) && rawDepth > 0 ? rawDepth : null;

    const normalizeExt = (e) =>
        String(e || "")
            .toLowerCase()
            .replace(/^\./, "")
            .trim();

    const normalizeName = (s) => String(s || "").toLowerCase().trim();

    const excludeExtensions = Array.isArray(options.excludeExtensions)
        ? options.excludeExtensions.map(normalizeExt).filter((e) => e.length > 0)
        : [];
    const excludeFolders = Array.isArray(options.excludeFolders)
        ? options.excludeFolders.map(normalizeName).filter((f) => f.length > 0)
        : [];
    const excludeFiles = Array.isArray(options.excludeFiles)
        ? options.excludeFiles.map(normalizeName).filter((f) => f.length > 0)
        : [];

    return {
        maxDepth,
        excludeExtensions,
        excludeFolders,
        excludeFiles,
    };
}

function buildFilteredTreeFromOptions(sourceRoot, options) {
    if (!sourceRoot) return null;

    const { maxDepth, excludeExtensions, excludeFolders, excludeFiles } =
        normalizeScanOptions(options || {});

    const extSet = new Set(excludeExtensions);
    const folderSet = new Set(excludeFolders);
    const fileSet = new Set(excludeFiles);

    const normalizeName = (s) => String(s || "").toLowerCase().trim();

    function isExcludedFolder(name, depth) {
        if (depth === 0) return false; // non escludiamo mai la root
        const n = normalizeName(name);

        // Esclusione per cartelle: corrispondenza "contiene" (case-insensitive)
        for (const pattern of folderSet) {
            if (pattern && n.includes(pattern)) {
                return true;
            }
        }
        return false;
    }

    function isExcludedFile(name) {
        const lower = normalizeName(name);

        // Esclusione per file: corrispondenza "contiene" (case-insensitive)
        for (const pattern of fileSet) {
            if (pattern && lower.includes(pattern)) {
                return true;
            }
        }

        if (extSet.size > 0) {
            const ext = (path.extname(lower) || "").replace(/^\./, "");
            if (ext && extSet.has(ext)) {
                return true;
            }
        }
        return false;
    }

    function cloneAndFilter(node, depth) {
        if (!node) return null;

        if (node.type === "file") {
            if (isExcludedFile(node.name)) return null;
            return { ...node };
        }

        if (node.type === "folder") {
            if (isExcludedFolder(node.name, depth)) {
                return null;
            }

            const cloned = { ...node, children: [] };
            const nextDepth = depth + 1;

            if (Array.isArray(node.children)) {
                for (const child of node.children) {
                    if (maxDepth !== null && nextDepth > maxDepth) {
                        // non scendiamo oltre la profondità massima
                        continue;
                    }
                    const filteredChild = cloneAndFilter(child, nextDepth);
                    if (filteredChild) {
                        cloned.children.push(filteredChild);
                    }
                }
            }

            // se non è la root e non ha figli dopo il filtro, elimina la cartella
            if (depth > 0 && (!cloned.children || cloned.children.length === 0)) {
                return null;
            }

            return cloned;
        }

        return null;
    }

    const filtered = cloneAndFilter(sourceRoot, 0);
    if (!filtered) {
        // mantieni almeno la root vuota
        return { ...sourceRoot, children: [] };
    }
    return filtered;
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
    // salva il dato associato al nodo DOM (usato da menu contestuale)
    wrapper.__nodeData = nodeData;

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
                        focusNodeInTreeSmart(p);
                        normalizeTreeIcons();
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
// Menu contestuale albero
// -------------------------

function initContextMenu() {
    contextMenuEl = document.getElementById("treeContextMenu");

    if (!contextMenuEl) return;

    // click sulle voci del menu
    contextMenuEl.addEventListener("click", (e) => {
        const item = e.target.closest(".context-menu-item");
        if (!item || !contextMenuNode) return;

        const action = item.getAttribute("data-action");
        const node = contextMenuNode;
        const fullPath = node.fullPath;

        if (!fullPath) {
            hideTreeContextMenu();
            return;
        }

        // per le azioni cartella usiamo sempre una cartella:
        // se è un file, usiamo la cartella padre
        const folderForActions =
            node.type === "folder" ? fullPath : path.dirname(fullPath);

        if (action === "open") {
            try {
                const electron = require("electron");
                const shell = electron.shell;
                if (node.type === "file" && shell.showItemInFolder) {
                    shell.showItemInFolder(fullPath);
                } else if (shell.openPath) {
                    shell.openPath(fullPath);
                }
            } catch (err) {
                console.error("Errore aprendo percorso:", err);
            }
        } else if (action === "copy-full") {
            copyToClipboard(fullPath);
        } else if (action === "copy-rel") {
            if (rootTree && rootTree.fullPath) {
                const rel = path.relative(rootTree.fullPath, fullPath);
                copyToClipboard(rel || ".");
            } else {
                copyToClipboard(fullPath);
            }
        } else if (action === "open-batch-rename") {
            ipcRenderer.send("hierarchy-open-batch-rename", {
                folder: folderForActions,
            });
        } else if (action === "compare-A") {
            ipcRenderer.send("hierarchy-compare-folder-A", {
                folder: folderForActions,
            });
        } else if (action === "compare-B") {
            ipcRenderer.send("hierarchy-compare-folder-B", {
                folder: folderForActions,
            });
        }

        hideTreeContextMenu();
    });

    // click fuori: chiudi menu
    window.addEventListener("click", () => {
        hideTreeContextMenu();
    });

    // scroll: chiudi menu
    window.addEventListener(
        "scroll",
        () => {
            hideTreeContextMenu();
        },
        true
    );

    // gestione tasto destro sull'albero via delega
    if (treeRootEl) {
        treeRootEl.addEventListener("contextmenu", (e) => {
            const nodeEl = e.target.closest(".tree-node");
            if (!nodeEl || !nodeEl.__nodeData) return;

            e.preventDefault();
            e.stopPropagation();

            const nodeData = nodeEl.__nodeData;
            selectNode(nodeEl, nodeData);
            showTreeContextMenu(e.clientX, e.clientY, nodeData);
        });
    }
}

function showTreeContextMenu(x, y, nodeData) {
    if (!contextMenuEl) return;

    contextMenuNode = nodeData;

    const menuWidth = 260;
    const menuHeight = 180;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let left = x;
    let top = y;

    if (left + menuWidth > vw) left = vw - menuWidth - 4;
    if (top + menuHeight > vh) top = vh - menuHeight - 4;

    contextMenuEl.style.left = `${left}px`;
    contextMenuEl.style.top = `${top}px`;
    contextMenuEl.style.display = "block";
}

function hideTreeContextMenu() {
    if (contextMenuEl) {
        contextMenuEl.style.display = "none";
    }
    contextMenuNode = null;
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

// Variante che chiude tutte le cartelle e apre solo il percorso necessario
// fino al nodo target (usata dai risultati di ricerca).
function focusNodeInTreeSmart(fullPath) {
    if (!rootTree || !treeRootEl) return;

    // Trova il nodo DOM corrispondente al percorso richiesto
    let targetDom = null;
    treeRootEl.querySelectorAll(".tree-node").forEach((el) => {
        if (!targetDom && el.__nodeData && el.__nodeData.fullPath === fullPath) {
            targetDom = el;
        }
    });

    if (!targetDom || !targetDom.__nodeData) return;
    const targetNode = targetDom.__nodeData;

    // 1) Chiudi tutte le cartelle (collassa l'intero albero)
    treeRootEl.querySelectorAll(".tree-children").forEach((children) => {
        children.classList.remove("open");
        const parent = children.parentElement;
        if (parent) {
            const icon = parent.querySelector(":scope > .node-icon");
            if (icon) icon.textContent = "؟";
        }
    });

    // 2) Risali dal nodo target fino alla radice, aprendo solo il percorso necessario
    let current = targetDom;
    while (current && current.classList && current.classList.contains("tree-node")) {
        const childrenContainer = current.querySelector(":scope > .tree-children");
        if (childrenContainer) {
            childrenContainer.classList.add("open");
            const icon = current.querySelector(":scope > .node-icon");
            if (icon) icon.textContent = "";
        }
        current = current.parentElement ? current.parentElement.closest(".tree-node") : null;
    }

    // 3) Porta in vista e seleziona il nodo
    targetDom.scrollIntoView({ behavior: "smooth", block: "center" });
    selectNode(targetDom, targetNode);
}

// Normalizza le icone delle cartelle (aperte/chiuse) in base allo stato .open
function normalizeTreeIcons() {
    if (!treeRootEl) return;

    treeRootEl.querySelectorAll(".tree-node").forEach((nodeEl) => {
        const icon = nodeEl.querySelector(":scope > .node-icon");
        if (!icon) return;

        const childrenContainer = nodeEl.querySelector(":scope > .tree-children");
        if (childrenContainer) {
            const isOpen = childrenContainer.classList.contains("open");
            // aperto (▼) / chiuso (▶)
            icon.textContent = isOpen ? "\u25BC" : "\u25B6";
        }
    });
}

// -------------------------
// Inizializzazione finestra
// -------------------------

window.addEventListener("DOMContentLoaded", () => {
    treeRootEl = document.getElementById("treeRoot");
    lblSelectedFolder = document.getElementById("selectedFolder");
    detailsBox = document.getElementById("detailsBox");

    const scanOptionsPanelEl = document.querySelector(".scan-options-panel");
    const scanOptionsToggleEl = document.getElementById("scanOptionsToggle");
    const scanOptionsArrowEl = document.getElementById("scanOptionsArrow");
    const scanDepthInputEl = document.getElementById("scanDepth");
    const excludeExtensionsInputEl = document.getElementById("excludeExtensions");
    const excludeFoldersInputEl = document.getElementById("excludeFolders");
    const excludeFilesInputEl = document.getElementById("excludeFiles");
    const btnApplyScanFilter = document.getElementById("btnApplyScanFilter");

    const btnClose = document.getElementById("btnClose");
    const btnSelectFolder = document.getElementById("btnSelectFolder");
    const btnStartScan = document.getElementById("btnStartScan");
    const btnExportNavigableReport = document.getElementById("btnExportNavigableReport");

    const searchInput = document.getElementById("searchInput");
    const btnSearch = document.getElementById("btnSearch");
    const searchResultsEl = document.getElementById("searchResults");

    // inizializza il menu contestuale dell'albero
    initContextMenu();

    if (scanOptionsPanelEl && scanOptionsToggleEl && scanOptionsArrowEl) {
        const updateArrow = () => {
            const collapsed = scanOptionsPanelEl.classList.contains("collapsed");
            scanOptionsArrowEl.textContent = collapsed ? "\u25B6" : "\u25BC"; // ▶ / ▼
        };

        updateArrow();

        scanOptionsToggleEl.addEventListener("click", () => {
            scanOptionsPanelEl.classList.toggle("collapsed");
            updateArrow();
        });
    }


    // ---------------------
    // Filtro "Opzioni di scansione"
    // ---------------------

    function collectScanOptionsFromInputs() {
        let maxDepth = null;
        if (scanDepthInputEl && scanDepthInputEl.value.trim() !== "") {
            const n = parseInt(scanDepthInputEl.value, 10);
            if (!Number.isNaN(n) && n > 0) {
                maxDepth = n;
            }
        }

        function parseList(raw) {
            if (!raw) return [];
            return raw
                // separa SOLO per virgola o punto e virgola, permettendo spazi interni nei nomi
                .split(/[,;]+/)
                .map((s) => s.trim())
                .filter((s) => s.length > 0);
        }

        const excludeExtensions = parseList(
            excludeExtensionsInputEl ? excludeExtensionsInputEl.value : ""
        );
        const excludeFolders = parseList(
            excludeFoldersInputEl ? excludeFoldersInputEl.value : ""
        );
        const excludeFiles = parseList(
            excludeFilesInputEl ? excludeFilesInputEl.value : ""
        );

        return {
            maxDepth,
            excludeExtensions,
            excludeFolders,
            excludeFiles,
        };
    }

    function applyScanFilterFromInputs() {
        if (!rootTree && !originalRootTree) {
            return;
        }

        // Se non abbiamo ancora lo snapshot dell'albero completo, creiamolo ora
        if (!originalRootTree && rootTree) {
            originalRootTree = cloneTree(rootTree);
        }

        if (!originalRootTree) return;

        const options = collectScanOptionsFromInputs();
        const hasFilters =
            options.maxDepth !== null ||
            (options.excludeExtensions && options.excludeExtensions.length > 0) ||
            (options.excludeFolders && options.excludeFolders.length > 0) ||
            (options.excludeFiles && options.excludeFiles.length > 0);

        if (!hasFilters) {
            // Nessun filtro: ripristina l'albero completo
            rootTree = cloneTree(originalRootTree);
        } else {
            // Applica i filtri allo snapshot originale
            rootTree = buildFilteredTreeFromOptions(originalRootTree, options);
        }

        renderTreeFromModel();
    }

    if (btnApplyScanFilter) {
        btnApplyScanFilter.addEventListener("click", () => {
            applyScanFilterFromInputs();
        });
    }

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
        originalRootTree = null;
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

        rootTree = null;
        originalRootTree = null;
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

        // Scansione completa lato renderer (stile Confronta cartelle)
        setTimeout(() => {
            try {
                const entries = scanFolderRecursively(selectedFolder);

                rootTree = createRootTree(selectedFolder);
                pendingEntries = entries.slice();

                buildTreeFromPendingAsync(() => {
                    originalRootTree = cloneTree(rootTree);
                    renderTreeFromModel();
                    detailsBox.innerHTML = "<p>Seleziona un nodo per vedere i dettagli.</p>";
                });
            } catch (err) {
                console.error("Errore durante la scansione locale:", err);
                treeRootEl.innerHTML = "<p>Errore durante la scansione.</p>";
                detailsBox.innerHTML = "<p>Errore durante la scansione. Controlla la console.</p>";
            }
        }, 10);
    });

    if (btnSearch && searchInput && searchResultsEl) {

        const runSearch = () => {
            const q = searchInput.value.trim();

            // Allunga automaticamente il box risultati a 100px
            // solo se è più basso (per non accorciare un resize manuale).
            if (searchResultsEl.clientHeight < 100) {
                searchResultsEl.style.height = "100px";
            }

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
                            focusNodeInTreeSmart(p);
                            normalizeTreeIcons();
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

    if (btnExportNavigableReport) {
        btnExportNavigableReport.addEventListener("click", () => {
            exportNavigableReport();
        });
    }

});

// -------------------------
// Esporta report navigabile (HTML + JSON)
// -------------------------

async function exportNavigableReport() {
    if (!rootTree) {
        await showError("Nessuna gerarchia disponibile.", "Esegui prima una scansione.");
        return;
    }

    const reportData = collectReportData(50);
    if (!reportData) {
        await showError("Impossibile preparare i dati del report.");
        return;
    }

    try {
        const result = await ipcRenderer.invoke("hierarchy-export-navigable-report", {
            rootPath: reportData.meta.rootPath,
            data: reportData,
        });

        if (result && result.error) {
            await showError("Errore durante l'esportazione del report navigabile.", result.error);
        } else if (!result || result.canceled) {
            // annullato: nessun messaggio
        } else {
            await showInfo(
                "Report navigabile esportato.",
                `File HTML: ${result.htmlPath}\nDati JSON: ${result.jsonPath}`
            );
        }
    } catch (err) {
        console.error("Errore export navigable report:", err);
        await showError(
            "Errore durante l'esportazione del report navigabile.",
            err.message || String(err)
        );
    }
}

// -------------------------
// Listener dal main
// -------------------------

ipcRenderer.on("hierarchy-progress", (event, payload) => {
    const { totalFiles, totalDirs } = payload;

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
    const { rootFolder, totalFiles, totalDirs, entries } = payload;

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

    // ---------------------
    // Nuova costruzione completa dell'albero
    // ---------------------

    rootTree = createRootTree(rootFolder || selectedFolder || "");
    originalRootTree = null;
    pendingEntries = Array.isArray(entries) ? entries.slice() : [];
    isBuildingTree = false;

    if (!Array.isArray(entries) || entries.length === 0) {
        treeRootEl.innerHTML = "<p>Nessun elemento trovato.</p>";
        detailsBox.innerHTML = "<p>Seleziona un nodo per vedere i dettagli.</p>";
        return;
    }

    buildTreeFromPendingAsync(() => {
        originalRootTree = cloneTree(rootTree);
        renderTreeFromModel();
        detailsBox.innerHTML = "<p>Seleziona un nodo per vedere i dettagli.</p>";
    });

    return;

    // L'albero Š stato costruito in modo incrementale nei vari "progress":
    // qui dobbiamo solo prendere uno snapshot per i filtri e renderizzare.
    pendingEntries = [];
    isBuildingTree = false;

    // snapshot dell'albero completo (base per i filtri)
    originalRootTree = cloneTree(rootTree);
    renderTreeFromModel();
    detailsBox.innerHTML = "<p>Seleziona un nodo per vedere i dettagli.</p>";
});
