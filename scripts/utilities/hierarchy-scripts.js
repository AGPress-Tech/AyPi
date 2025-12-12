const { ipcRenderer } = require("electron");
const path = require("path");
const fs = require("fs");

let XLSX;
try {
    XLSX = require("xlsx");
} catch (err) {
    console.error("Modulo 'xlsx' non disponibile. Esegui `npm install xlsx` se vuoi l'export.");
}

let Chart = null;
let timelineChartInstance = null;
let extChartInstance = null;
try {
    Chart = require("chart.js/auto");
} catch (err) {
    console.warn("Modulo 'chart.js' non disponibile per la timeline:", err && err.message ? err.message : err);
}

// -------------------------
// Stato globale
// -------------------------

let selectedFolder = null;
let rootTree = null;
let originalRootTree = null;
let selectedElement = null;
let lastSelectedNodeData = null;
let lastReportData = null;

// batch ricevuti dal main durante la scansione
let pendingEntries = [];
let isBuildingTree = false;

// riferimenti DOM (riempiti in DOMContentLoaded)
let treeRootEl = null;
let lblSelectedFolder = null;
let detailsBox = null;
let detailsTabs = null;
let detailsTabButtons = null;
// menu contestuale albero
let contextMenuEl = null;
let contextMenuNode = null;
let topElementsLimitInput = null;
let topElementsModeSelect = null;
let topElementsTableEl = null;

// Messaggi "quantistici"
const FUN_MESSAGES = [
    "Calcolo degli atomi dei file...",
    "Allineamento dei bit con l'asse di rotazione terrestre...",
    "Stima della distanza Terra–Sole dei file richiesti...",
    "Ottimizzazione del coefficiente di entropia dei backup...",
    "Calcolo subatomico quantistico dei metadati...",
    "Sincronizzazione con il fuso orario dei ping di rete...",
    "Ricalibrazione della matrice spazio/tempo dei percorsi...",
    "Normalizzazione logaritmica delle estensioni esotiche...",
    "Consultazione dell'oracolo dei filesystem...",
    "Compattazione delle stringhe secondo la teoria delle supercorde...",
    "Verifica della coerenza karmica dei nomi file...",
    "Risoluzione delle ambiguità tramite inferenza probabilistica avanzata...",
    "Interrogazione del cache cosmico universale...",
    "Bilanciamento termodinamico delle directory...",
    "Analisi spettroscopica dei byte inattivi...",
    "Decompressione metafisica dei percorsi annidati...",
    "Allineamento neurale tra CPU e memoria RAM...",
    "Applicazione del principio di indeterminazione ai file duplicati...",
    "Stabilizzazione quantistica delle dimensioni su disco...",
    "Verifica della conservazione della massa dei byte...",
    "Interpolazione frattale delle sottocartelle...",
    "Riconciliazione filosofica tra file e cartelle...",
    "Riduzione entropica delle nomenclature legacy...",
    "Scansione euristica dei percorsi improbabili...",
    "Riorganizzazione topologica dello spazio di archiviazione...",
    "Compilazione delle statistiche secondo standard galattici...",
    "Rilevamento di fluttuazioni anomale nei timestamp...",
    "Ottimizzazione predittiva basata su modelli astrali...",
    "Verifica di consistenza temporale multiverso...",
    "Mappatura sinaptica dei collegamenti simbolici...",
    "Analisi comparativa delle dimensioni in unità planck...",
    "Stabilizzazione del continuum file–cartella...",
    "Calcolo della probabilità di esistenza dei file fantasma...",
    "Applicazione del protocollo di realtà aumentata ai percorsi...",
    "Risoluzione dei conflitti tramite arbitrato algoritmico supremo...",
    "Ricostruzione causale della genealogia dei file...",
    "Calibrazione dei checksum secondo costanti universali...",
    "Determinazione del grado di maturità evolutiva delle directory..."
];

let lastFunMessageTime = 0;
let funMessageIndex = 0;

// Icone albero gerarchia
const FOLDER_CLOSED_ICON = "\u25B6"; // triangolo verso destra
const FOLDER_OPEN_ICON = "\u25BC";   // triangolo verso il basso
const FILE_ICON = "-";          // icona semplice per i file

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
    let minMtimeMs = null;
    let maxMtimeMs = null;

    const topFolders = [];
    const topFiles = [];
    const allFilesForOld = [];

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
            const mtimeMs = typeof node.mtimeMs === "number" ? node.mtimeMs : null;
            totalFiles++;
            totalSizeBytes += size;

            if (typeof mtimeMs === "number") {
                if (minMtimeMs === null || mtimeMs < minMtimeMs) {
                    minMtimeMs = mtimeMs;
                }
                if (maxMtimeMs === null || mtimeMs > maxMtimeMs) {
                    maxMtimeMs = mtimeMs;
                }
            }

            const fileInfo = {
                name: node.name,
                fullPath: node.fullPath || "",
                sizeBytes: size,
                depth,
                mtimeMs,
            };
            pushSorted(topFiles, fileInfo, "sizeBytes", maxTop);
            allFilesForOld.push(fileInfo);

            return {
                name: node.name,
                type: "file",
                fullPath: node.fullPath || "",
                sizeBytes: size,
                depth,
                mtimeMs,
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

    // Top file meno recenti: su tutti i file (non solo i più grandi)
    const topOldFiles = allFilesForOld
        .filter((f) => typeof f.mtimeMs === "number")
        .sort((a, b) => (a.mtimeMs || 0) - (b.mtimeMs || 0))
        .slice(0, maxTop);

    const extensionStatsMap = Object.create(null);
    const timeBucketsMap = Object.create(null);

    // popoliamo extensionStats e timeBuckets a partire da tutti i file con mtime
    for (const f of allFilesForOld) {
        const extRaw = path.extname(f.name || "").toLowerCase();
        const ext = extRaw || "(senza estensione)";
        if (!extensionStatsMap[ext]) {
            extensionStatsMap[ext] = {
                extension: ext,
                  count: 0,
                  totalSizeBytes: 0,
              };
          }
          extensionStatsMap[ext].count += 1;
          extensionStatsMap[ext].totalSizeBytes += f.sizeBytes || 0;

          if (typeof f.mtimeMs === "number") {
              const d = new Date(f.mtimeMs);
              const key =
                  d.getFullYear() +
                  "-" +
                  String(d.getMonth() + 1).padStart(2, "0");
              timeBucketsMap[key] = (timeBucketsMap[key] || 0) + 1;
          }
      }

      const extensionStats = Object.values(extensionStatsMap).sort(
          (a, b) => (b.totalSizeBytes || 0) - (a.totalSizeBytes || 0)
      );

      const timeBuckets = Object.entries(timeBucketsMap)
          .map(([label, count]) => ({ label, count }))
          .sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));

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
              minMtimeMs,
            maxMtimeMs,
        },
        hierarchy: hierarchyOut,
        topFolders,
        topFiles,
        topOldFiles,
        extensionStats,
        timeBuckets,
    };

  return report;
}

function computeReportDataForTop(limit) {
    if (!rootTree) return null;
    const n = Number(limit);
    const maxTop = Number.isFinite(n) && n > 0 ? n : 20;
    const report = collectReportData(maxTop);
    lastReportData = report;
    return report;
}

function computeStatsForSubtree(rootNode) {
    if (!rootNode) return null;

    let totalFiles = 0;
    let totalFolders = 0;
    let totalSizeBytes = 0;
    let maxDepth = 0;
    let minMtimeMs = null;
    let maxMtimeMs = null;

    const extensionStatsMap = Object.create(null);
    const mtimeList = [];
    const stack = [{ node: rootNode, depth: 0 }];

    while (stack.length > 0) {
        const { node, depth } = stack.pop();

        if (depth > maxDepth) {
            maxDepth = depth;
        }

        if (node.type === "folder") {
            totalFolders++;
            if (Array.isArray(node.children)) {
                for (const child of node.children) {
                    stack.push({ node: child, depth: depth + 1 });
                }
            }
        } else if (node.type === "file") {
            totalFiles++;
            const size = typeof node.size === "number" ? node.size : 0;
            totalSizeBytes += size;

            const mtimeMs = typeof node.mtimeMs === "number" ? node.mtimeMs : null;
            if (typeof mtimeMs === "number") {
                mtimeList.push(mtimeMs);
                if (minMtimeMs === null || mtimeMs < minMtimeMs) {
                    minMtimeMs = mtimeMs;
                }
                if (maxMtimeMs === null || mtimeMs > maxMtimeMs) {
                    maxMtimeMs = mtimeMs;
                }
            }

            const extRaw = path.extname(node.name || "").toLowerCase();
            const ext = extRaw || "(senza estensione)";
            if (!extensionStatsMap[ext]) {
                extensionStatsMap[ext] = {
                    extension: ext,
                    count: 0,
                    totalSizeBytes: 0,
                };
            }
            extensionStatsMap[ext].count += 1;
            extensionStatsMap[ext].totalSizeBytes += size;
        }
    }

    const extensionStats = Object.values(extensionStatsMap).sort(
        (a, b) => (b.totalSizeBytes || 0) - (a.totalSizeBytes || 0)
    );

    let timeBuckets = [];
    if (mtimeList.length > 0 && minMtimeMs != null && maxMtimeMs != null) {
        const now = Date.now();
        const oneYearMs = 365 * 24 * 60 * 60 * 1000;
        const useHalfYear = now - minMtimeMs > oneYearMs;

        const bucketMap = Object.create(null);
        for (const mtimeMs of mtimeList) {
            const d = new Date(mtimeMs);
            let label;
            if (useHalfYear) {
                const half = d.getMonth() < 6 ? 1 : 2;
                label = `${d.getFullYear()}-H${half}`;
            } else {
                label = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
            }
            bucketMap[label] = (bucketMap[label] || 0) + 1;
        }

        // Costruisce una sequenza continua di periodi, includendo anche i bucket con 0 file
        timeBuckets = [];
        if (useHalfYear) {
            const start = new Date(minMtimeMs);
            const end = new Date(maxMtimeMs);
            let year = start.getFullYear();
            let halfIndex = start.getMonth() < 6 ? 1 : 2;
            const endYear = end.getFullYear();
            const endHalfIndex = end.getMonth() < 6 ? 1 : 2;

            while (year < endYear || (year === endYear && halfIndex <= endHalfIndex)) {
                const label = `${year}-H${halfIndex}`;
                const count = bucketMap[label] || 0;
                timeBuckets.push({ label, count });

                if (halfIndex === 1) {
                    halfIndex = 2;
                } else {
                    halfIndex = 1;
                    year += 1;
                }
            }
        } else {
            const start = new Date(minMtimeMs);
            const end = new Date(maxMtimeMs);
            let year = start.getFullYear();
            let month = start.getMonth(); // 0-11
            const endYear = end.getFullYear();
            const endMonth = end.getMonth();

            while (year < endYear || (year === endYear && month <= endMonth)) {
                const label = `${year}-${String(month + 1).padStart(2, "0")}`;
                const count = bucketMap[label] || 0;
                timeBuckets.push({ label, count });

                month += 1;
                if (month > 11) {
                    month = 0;
                    year += 1;
                }
            }
        }
    }

    return {
        node: rootNode,
        totalFiles,
        totalFolders,
        totalSizeBytes,
        maxDepth,
        minMtimeMs,
        maxMtimeMs,
        extensionStats,
        timeBuckets,
    };
}

function isTopTabActive() {
    if (!detailsTabButtons) return false;
    for (const btn of detailsTabButtons) {
        if (btn.classList.contains("active") && btn.getAttribute("data-tab") === "details-top") {
            return true;
        }
    }
    return false;
}

function isStatsTabActive() {
    if (!detailsTabButtons) return false;
    for (const btn of detailsTabButtons) {
        if (btn.classList.contains("active") && btn.getAttribute("data-tab") === "details-stats") {
            return true;
        }
    }
    return false;
}

  function renderTopElementsPanel() {
    if (!topElementsTableEl) return;
    if (!rootTree) {
        topElementsTableEl.innerHTML = "<tbody><tr><td>Nessuna gerarchia disponibile. Esegui una scansione.</td></tr></tbody>";
        return;
    }

    const mode = topElementsModeSelect ? topElementsModeSelect.value : "files";
    const rawLimit = topElementsLimitInput ? Number(topElementsLimitInput.value) : 20;
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 20;

    const report = computeReportDataForTop(limit);
    if (!report) {
        topElementsTableEl.innerHTML = "<tbody><tr><td>Impossibile calcolare i dati.</td></tr></tbody>";
        return;
    }

    let rows = [];
    let columns = [];

    if (mode === "folders") {
        rows = (report.topFolders || []).slice(0, limit).map((r, idx) => ({
            index: idx + 1,
            name: r.name,
            fullPath: r.fullPath,
            totalSizeBytes: r.totalSizeBytes,
            filesCount: r.filesCount,
            foldersCount: r.foldersCount,
        }));
        columns = [
            { field: "index", label: "#" },
            { field: "name", label: "Cartella" },
            { field: "totalSizeBytes", label: "Dimensione" },
            { field: "filesCount", label: "File" },
            { field: "foldersCount", label: "Cartelle" },
        ];
    } else if (mode === "old") {
        const srcOld = Array.isArray(report.topOldFiles)
            ? report.topOldFiles
            : (report.topFiles || []).filter((f) => typeof f.mtimeMs === "number");
        rows = srcOld.slice(0, limit).map((r, idx) => ({
            index: idx + 1,
            name: r.name,
            fullPath: r.fullPath,
            sizeBytes: r.sizeBytes,
            mtime: r.mtimeMs ? new Date(r.mtimeMs).toLocaleString() : "",
        }));
        columns = [
            { field: "index", label: "#" },
            { field: "name", label: "File" },
            { field: "sizeBytes", label: "Dimensione" },
            { field: "mtime", label: "Ultima modifica" },
        ];
    } else {
        rows = (report.topFiles || []).slice(0, limit).map((r, idx) => ({
            index: idx + 1,
            name: r.name,
            fullPath: r.fullPath,
            sizeBytes: r.sizeBytes,
        }));
        columns = [
            { field: "index", label: "#" },
            { field: "name", label: "File" },
            { field: "sizeBytes", label: "Dimensione" },
        ];
    }

    if (!rows.length) {
        topElementsTableEl.innerHTML = "<tbody><tr><td>Nessun elemento da mostrare.</td></tr></tbody>";
        return;
    }

    const thead = document.createElement("thead");
    const trHead = document.createElement("tr");
    columns.forEach((col) => {
        const th = document.createElement("th");
        th.textContent = col.label;
        trHead.appendChild(th);
    });
    thead.appendChild(trHead);

    const tbody = document.createElement("tbody");
    rows.forEach((row) => {
        const tr = document.createElement("tr");
        tr.dataset.fullPath = row.fullPath || "";
        tr.addEventListener("click", () => {
            if (tr.dataset.fullPath) {
                focusNodeInTreeSmart(tr.dataset.fullPath);
                normalizeTreeIcons();
            }
        });
        columns.forEach((col) => {
            const td = document.createElement("td");
            let v = row[col.field];
            if (col.field === "sizeBytes" || col.field === "totalSizeBytes") {
                v = formatBytes(v || 0);
            }
            td.textContent = v != null ? v : "";
            tr.appendChild(td);
        });
        tbody.appendChild(tr);
    });

    topElementsTableEl.innerHTML = "";
    topElementsTableEl.appendChild(thead);
    topElementsTableEl.appendChild(tbody);
}

let extStatsMode = "size";
let extStatsSortDir = "desc";
let timelineYearFrom = null;
let timelineYearTo = null;
let statsYearFrom = null;
let statsYearTo = null;

function renderStatsPanel() {
    const box = document.getElementById("detailsStatsBox");
    if (!box) return;
    if (!rootTree) {
        box.innerHTML = "<p class='muted'>Nessuna gerarchia disponibile. Esegui una scansione.</p>";
        return;
    }

    const baseNode = lastSelectedNodeData || rootTree;
    const stats = computeStatsForSubtree(baseNode);
    if (!stats) {
        box.innerHTML = "<p class='muted'>Impossibile calcolare le statistiche.</p>";
        return;
    }

    const extStats = stats.extensionStats || [];
    const timeBuckets = stats.timeBuckets || [];

    let html = "";
    html += `<p><b>Base statistica:</b><br><span style="font-size:12px;">${baseNode.fullPath || baseNode.name || "(sconosciuta)"}<\/span></p>`;
    html += "<hr>";
    html += `<p><b>File totali (subtree):</b> ${stats.totalFiles || 0}</p>`;
    html += `<p><b>Cartelle (subtree):</b> ${stats.totalFolders || 0}</p>`;
    html += `<p><b>Spazio totale:</b> ${formatBytes(stats.totalSizeBytes || 0)}</p>`;
    html += `<p><b>Profondità massima:</b> ${stats.maxDepth || 0}</p>`;

    if (stats.minMtimeMs || stats.maxMtimeMs) {
        const minStr = stats.minMtimeMs ? new Date(stats.minMtimeMs).toLocaleString() : "";
        const maxStr = stats.maxMtimeMs ? new Date(stats.maxMtimeMs).toLocaleString() : "";
        html += "<hr>";
        html += `<p><b>Periodo modifiche:</b><br>`;
        if (minStr) html += `<span>Dal: ${minStr}</span><br>`;
        if (maxStr) html += `<span>Al: ${maxStr}</span>`;
        html += "</p>";
    }

    // controlli per grafico estensioni
    html += "<hr>";
    html += "<div class=\"top-elements-controls\">";
    html += "  <div class=\"top-elements-control\">";
    html += "    <label for=\"extStatsMode\">Estensioni per:</label>";
    html += `    <select id=\"extStatsMode\">`;
    html += `      <option value=\"size\"${extStatsMode === "size" ? " selected" : ""}>Dimensione</option>`;
    html += `      <option value=\"count\"${extStatsMode === "count" ? " selected" : ""}>Conteggio</option>`;
    html += "    </select>";
    html += "  </div>";
    html += "</div>";

    if (extStats.length) {
        const topExt = extStats.slice(0, 12);
        let maxMetric = 0;
        topExt.forEach((e) => {
            const metric = extStatsMode === "count" ? e.count : e.totalSizeBytes || 0;
            if (metric > maxMetric) maxMetric = metric;
        });

        html += "<p><b>Estensioni principali:</b></p>";
        html += "<div class=\"ext-chart\">";
        topExt.forEach((e) => {
            const metric = extStatsMode === "count" ? e.count : e.totalSizeBytes || 0;
            const pct = maxMetric > 0 ? Math.max(4, Math.round((metric * 100) / maxMetric)) : 0;
            const rightLabel =
                extStatsMode === "count"
                    ? String(e.count || 0)
                    : formatBytes(e.totalSizeBytes || 0);
            html += "<div class=\"ext-row\">";
            html += `<span class=\"ext-label\">${e.extension || "(n/d)"}<\/span>`;
            html += `<div class=\"ext-bar-wrapper\"><div class=\"ext-bar\" style=\"width:${pct}%\"><\/div><\/div>`;
            html += `<span class=\"ext-size\">${rightLabel}<\/span>`;
            html += "</div>";
        });
        html += "</div>";
    }

    if (timeBuckets.length) {
        const maxPoints = 24;
        const slice =
            timeBuckets.length > maxPoints
                ? timeBuckets.slice(timeBuckets.length - maxPoints)
                : timeBuckets;

        let maxCount = 0;
        slice.forEach((b) => {
            if (b.count > maxCount) maxCount = b.count;
        });

        html += "<hr>";
        html += "<p><b>Timeline modifiche (file per periodo):</b></p>";
        html += "<div class=\"ext-chart\">";
        slice.forEach((b) => {
            const pct = maxCount > 0 ? Math.max(4, Math.round((b.count * 100) / maxCount)) : 0;
            html += "<div class=\"ext-row\">";
            html += `<span class=\"ext-label\">${b.label}<\/span>`;
            html += `<div class=\"ext-bar-wrapper\"><div class=\"ext-bar\" style=\"width:${pct}%\"><\/div><\/div>`;
            html += `<span class=\"ext-size\">${b.count}<\/span>`;
            html += "</div>";
        });
        html += "</div>";
    }

    box.innerHTML = html;

    const selectEl = document.getElementById("extStatsMode");
    if (selectEl) {
        selectEl.addEventListener("change", () => {
            extStatsMode = selectEl.value === "count" ? "count" : "size";
            renderStatsPanel();
        });
    }
}

// Nuova implementazione avanzata del pannello Statistiche (con grafico timeline)
function renderStatsPanelV2() {
    const box = document.getElementById("detailsStatsBox");
    if (!box) return;
    if (!rootTree) {
        box.innerHTML = "<p class='muted'>Nessuna gerarchia disponibile. Esegui una scansione.</p>";
        return;
    }

    const baseNode = lastSelectedNodeData || rootTree;
    const stats = computeStatsForSubtree(baseNode);
    if (!stats) {
        box.innerHTML = "<p class='muted'>Impossibile calcolare le statistiche.</p>";
        return;
    }

    const extStats = stats.extensionStats || [];
    const timeBuckets = stats.timeBuckets || [];
    const baseLabel = baseNode.fullPath || baseNode.name || "(sconosciuta)";

    const minYear =
        stats.minMtimeMs != null ? new Date(stats.minMtimeMs).getFullYear() : null;
    const maxYear =
        stats.maxMtimeMs != null ? new Date(stats.maxMtimeMs).getFullYear() : null;

    // Default globale: se l'utente non ha ancora scelto un range,
    // usa sempre gli ultimi 10 anni rispetto all'anno corrente.
    if (statsYearFrom == null || statsYearTo == null) {
        const currentYear = new Date().getFullYear();
        statsYearTo = currentYear;
        statsYearFrom = currentYear - 9;
    }

    if (minYear != null && maxYear != null) {
        if (timelineYearFrom == null) timelineYearFrom = minYear;
        if (timelineYearTo == null) timelineYearTo = maxYear;
        if (timelineYearFrom < minYear) timelineYearFrom = minYear;
        if (timelineYearTo > maxYear) timelineYearTo = maxYear;
        if (timelineYearFrom > timelineYearTo) timelineYearFrom = timelineYearTo;
    }

    let html = "";
    html += `<p><b>Base statistica:</b><br><span style="font-size:12px;">${baseLabel}<\/span></p>`;
    html += "<hr>";
    html += "<div class=\"stats-summary\">";
    html += `<div><b>File:</b> ${stats.totalFiles || 0}</div>`;
    html += `<div><b>Cartelle:</b> ${stats.totalFolders || 0}</div>`;
    html += `<div><b>Spazio totale:</b> ${formatBytes(stats.totalSizeBytes || 0)}</div>`;
    html += `<div><b>Profondità massima:</b> ${stats.maxDepth || 0}</div>`;
    html += "</div>";

    // Controlli per grafico estensioni
    html += "<hr>";
    html += "<p><b>Estensioni principali:</b></p>";
    html += "<div class=\"top-elements-controls\">";
    html += "  <div class=\"top-elements-control\">";
    html += "    <label for=\"extStatsMode\">Estensioni per:</label>";
    html += `    <select id=\"extStatsMode\">`;
    html += `      <option value=\"size\"${extStatsMode === "size" ? " selected" : ""}>Dimensione</option>`;
    html += `      <option value=\"count\"${extStatsMode === "count" ? " selected" : ""}>Conteggio</option>`;
    html += "    </select>";
    html += "  </div>";
    html += "  <div class=\"top-elements-control\">";
    html += "    <label for=\"extStatsSort\">Ordine:</label>";
    html += `    <select id=\"extStatsSort\">`;
    html += `      <option value=\"desc\"${extStatsSortDir === "desc" ? " selected" : ""}>Decrescente</option>`;
    html += `      <option value=\"asc\"${extStatsSortDir === "asc" ? " selected" : ""}>Crescente</option>`;
    html += "    </select>";
    html += "  </div>";
    html += "</div>";

    html += "<div class=\"stats-section\">";
    if (Chart && extStats.length) {
        html += "  <canvas id=\"extStatsChart\"></canvas>";
    } else {
        html += "  <div class=\"ext-chart\" id=\"extStatsChartContainer\"></div>";
    }
    html += "</div>";

    // Sezione timeline modifiche
    html += "<hr>";
    html += "<p><b>Timeline modifiche (file per periodo):</b></p>";
    if (minYear != null && maxYear != null) {
        html += "<div class=\"top-elements-controls stats-timeline-filters\">";
        html += "  <div class=\"top-elements-control\">";
        html += "    <label for=\"timelineYearFrom\">Anno da:</label>";
        html += `    <input type=\"number\" id=\"timelineYearFrom\" value=\"${statsYearFrom != null ? statsYearFrom : ""}\">`;
        html += "  </div>";
        html += "  <div class=\"top-elements-control\">";
        html += "    <label for=\"timelineYearTo\">Anno a:</label>";
        html += `    <input type=\"number\" id=\"timelineYearTo\" value=\"${statsYearTo != null ? statsYearTo : ""}\">`;
        html += "  </div>";
        html += "</div>";
    }
    html += "<div class=\"stats-section\">";
    if (Chart) {
        html += "  <canvas id=\"timelineChart\"></canvas>";
    } else {
        html += "  <div class=\"ext-chart\" id=\"timelineFallback\"></div>";
    }
    html += "</div>";

    box.innerHTML = html;

    // Grafico estensioni o fallback testuale
    if (Chart && extStats.length) {
        const canvasExt = document.getElementById("extStatsChart");
        if (canvasExt && canvasExt.getContext) {
            const ctxExt = canvasExt.getContext("2d");

            const modeKey = extStatsMode === "count" ? "count" : "totalSizeBytes";
            const sorted = extStats.slice().sort((a, b) => {
                const av = a[modeKey] || 0;
                const bv = b[modeKey] || 0;
                return extStatsSortDir === "asc" ? av - bv : bv - av;
            });

            const topExt = sorted.slice(0, 12);
            const labelsExt = topExt.map((e) => e.extension || "(n/d)");
            const dataExt = topExt.map((e) =>
                extStatsMode === "count" ? e.count || 0 : e.totalSizeBytes || 0
            );

            if (extChartInstance) {
                extChartInstance.destroy();
            }

            extChartInstance = new Chart(ctxExt, {
                type: "bar",
                data: {
                    labels: labelsExt,
                    datasets: [
                        {
                            label: extStatsMode === "count" ? "File" : "Dimensione (byte)",
                            data: dataExt,
                            backgroundColor: "#cc930e",
                        },
                    ],
                },
                options: {
                    indexAxis: "y",
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        x: {
                            ticks: {
                                color: "#eee",
                            },
                            grid: {
                                color: "#444",
                            },
                        },
                        y: {
                            ticks: {
                                color: "#eee",
                            },
                            grid: {
                                color: "#444",
                            },
                        },
                    },
                    plugins: {
                        legend: {
                            display: false,
                        },
                        tooltip: {
                            callbacks: {
                                label(context) {
                                    const v = context.parsed.x || 0;
                                    if (extStatsMode === "count") {
                                        return `${v} file`;
                                    }
                                    return formatBytes(v);
                                },
                            },
                        },
                    },
                    animation: {
                        duration: 1200,
                        easing: "easeInQuad",
                        delay(ctx) {
                            if (ctx.type !== "data" || ctx.mode !== "default") {
                                return 0;
                            }
                            return ctx.dataIndex * 80;
                        },
                    },
                },
            });
        }
    } else {
        const extContainer = document.getElementById("extStatsChartContainer");
        if (extContainer) {
            if (!extStats.length) {
                extContainer.innerHTML =
                    "<p class='muted'>Nessun dato disponibile per le estensioni.</p>";
            } else {
                const modeKey = extStatsMode === "count" ? "count" : "totalSizeBytes";
                const sorted = extStats.slice().sort((a, b) => {
                    const av = a[modeKey] || 0;
                    const bv = b[modeKey] || 0;
                    return extStatsSortDir === "asc" ? av - bv : bv - av;
                });

                const topExt = sorted.slice(0, 12);
                let extHtml = "";
                topExt.forEach((e) => {
                    const metric =
                        extStatsMode === "count" ? e.count || 0 : e.totalSizeBytes || 0;
                    const rightLabel =
                        extStatsMode === "count"
                            ? String(e.count || 0)
                            : formatBytes(e.totalSizeBytes || 0);
                    extHtml += "<div class=\"ext-row\">";
                    extHtml += `<span class=\"ext-label\">${e.extension || "(n/d)"}<\/span>`;
                    extHtml += `<div class=\"ext-bar-wrapper\"><div class=\"ext-bar\" style=\"width:100%\"><\/div><\/div>`;
                    extHtml += `<span class=\"ext-size\">${rightLabel}<\/span>`;
                    extHtml += "</div>";
                });
                extContainer.innerHTML = extHtml;
            }
        }
    }

    // Lettura filtri temporali dagli input e applicazione ai bucket
    let filteredBuckets = timeBuckets;
    const yearFromInput = document.getElementById("timelineYearFrom");
    const yearToInput = document.getElementById("timelineYearTo");

    function recomputeFilteredBuckets() {
        filteredBuckets = timeBuckets;

        if (yearFromInput && yearFromInput.value !== "") {
            const v = parseInt(yearFromInput.value, 10);
            if (!Number.isNaN(v)) {
                statsYearFrom = v;
            }
        }
        if (yearToInput && yearToInput.value !== "") {
            const v = parseInt(yearToInput.value, 10);
            if (!Number.isNaN(v)) {
                statsYearTo = v;
            }
        }

        // Default globale: se nessun anno � impostato, usa sempre
        // gli ultimi 10 anni rispetto all'anno corrente.
        if (statsYearFrom == null && statsYearTo == null) {
            const currentYear = new Date().getFullYear();
            statsYearTo = currentYear;
            statsYearFrom = currentYear - 9;
            if (yearFromInput) {
                yearFromInput.value = String(statsYearFrom);
            }
            if (yearToInput) {
                yearToInput.value = String(statsYearTo);
            }
        }

        if (timeBuckets.length && (statsYearFrom != null || statsYearTo != null)) {
            filteredBuckets = timeBuckets.filter((b) => {
                const year = parseInt(String(b.label).slice(0, 4), 10);
                if (Number.isNaN(year)) return true;
                if (statsYearFrom != null && year < statsYearFrom) return false;
                if (statsYearTo != null && year > statsYearTo) return false;
                return true;
            });
        }

        // Se il range scelto non produce alcun bucket, torna a mostrare
        // la timeline completa cos� il grafico non si "rompe".
        if (!filteredBuckets.length) {
            filteredBuckets = timeBuckets;
        }
    }

    recomputeFilteredBuckets();

    // Timeline con Chart.js (o fallback testuale)
    if (Chart && filteredBuckets.length) {
        const canvas = document.getElementById("timelineChart");
        if (canvas && canvas.getContext) {
            const ctx = canvas.getContext("2d");
            const labels = filteredBuckets.map((b) => b.label);
            const data = filteredBuckets.map((b) => b.count);

            if (timelineChartInstance) {
                timelineChartInstance.destroy();
            }

            timelineChartInstance = new Chart(ctx, {
                type: "line",
                data: {
                    labels,
                    datasets: [
                        {
                            label: "File modificati",
                            data,
                            borderColor: "#cc930e",
                            backgroundColor: "rgba(204,147,14,0.25)",
                            tension: 0.25,
                            pointRadius: 2,
                        },
                    ],
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: {
                        mode: "index",
                        intersect: false,
                    },
                    scales: {
                        x: {
                            ticks: {
                                autoSkip: true,
                                maxTicksLimit: 12,
                                color: "#eee",
                            },
                            grid: {
                                color: "#444",
                            },
                        },
                        y: {
                            beginAtZero: true,
                            ticks: {
                                color: "#eee",
                            },
                            grid: {
                                color: "#444",
                            },
                        },
                    },
                    plugins: {
                        legend: {
                            display: false,
                        },
                        tooltip: {
                            enabled: true,
                        },
                    },
                    animations: {
                        x: {
                            type: "number",
                            easing: "easeInQuad",
                            duration: 600,
                            from: NaN,
                            delay(ctx) {
                                if (ctx.type !== "data" || ctx.xStarted) {
                                    return 0;
                                }
                                ctx.xStarted = true;
                                return ctx.dataIndex * 60;
                            },
                        },
                        y: {
                            type: "number",
                            easing: "easeInQuad",
                            duration: 600,
                            from: (ctx) => {
                                const yScale = ctx.chart.scales.y;
                                return yScale ? yScale.getPixelForValue(0) : 0;
                            },
                            delay(ctx) {
                                if (ctx.type !== "data" || ctx.yStarted) {
                                    return 0;
                                }
                                ctx.yStarted = true;
                                return ctx.dataIndex * 60;
                            },
                        },
                    },
                },
            });
        }

        // Eventi per aggiornare il grafico timeline sui cambi anno
        const applyYearFilter = () => {
            recomputeFilteredBuckets();
            renderStatsPanelV2();
        };

        if (yearFromInput) {
            yearFromInput.addEventListener("change", () => {
                applyYearFilter();
            });
            yearFromInput.addEventListener("keydown", (e) => {
                if (e.key === "Enter") {
                    e.preventDefault();
                    applyYearFilter();
                }
            });
            yearFromInput.addEventListener("blur", () => {
                applyYearFilter();
            });
        }
        if (yearToInput) {
            yearToInput.addEventListener("change", () => {
                applyYearFilter();
            });
            yearToInput.addEventListener("keydown", (e) => {
                if (e.key === "Enter") {
                    e.preventDefault();
                    applyYearFilter();
                }
            });
            yearToInput.addEventListener("blur", () => {
                applyYearFilter();
            });
        }
    } else {
        const fallbackEl = document.getElementById("timelineFallback");
        if (fallbackEl && filteredBuckets.length) {
            const maxPoints = 24;
            const slice =
                filteredBuckets.length > maxPoints
                    ? filteredBuckets.slice(filteredBuckets.length - maxPoints)
                    : filteredBuckets;

            let maxCount = 0;
            slice.forEach((b) => {
                if (b.count > maxCount) maxCount = b.count;
            });

            let timelineHtml = "";
            slice.forEach((b) => {
                const pct =
                    maxCount > 0
                        ? Math.max(4, Math.round((b.count * 100) / maxCount))
                        : 0;
                timelineHtml += "<div class=\"ext-row\">";
                timelineHtml += `<span class=\"ext-label\">${b.label}<\/span>`;
                timelineHtml += `<div class=\"ext-bar-wrapper\"><div class=\"ext-bar\" style=\"width:${pct}%\"><\/div><\/div>`;
                timelineHtml += `<span class=\"ext-size\">${b.count}<\/span>`;
                timelineHtml += "</div>";
            });
            fallbackEl.innerHTML = timelineHtml;
        } else if (fallbackEl) {
            fallbackEl.innerHTML =
                "<p class='muted'>Nessun dato disponibile per la timeline.</p>";
        }
    }

    const selectModeEl = document.getElementById("extStatsMode");
    if (selectModeEl) {
        selectModeEl.addEventListener("change", () => {
            extStatsMode = selectModeEl.value === "count" ? "count" : "size";
            renderStatsPanelV2();
        });
    }

    const selectSortEl = document.getElementById("extStatsSort");
    if (selectSortEl) {
        selectSortEl.addEventListener("change", () => {
            extStatsSortDir = selectSortEl.value === "asc" ? "asc" : "desc";
            renderStatsPanelV2();
        });
    }
}

// Sostituisce la vecchia implementazione con la nuova avanzata
renderStatsPanel = renderStatsPanelV2;

// -------------------------
// Scansione directory lato renderer (stile Confronta cartelle)
// -------------------------

async function scanFolderRecursively(rootFolder, onProgress) {
    const entries = [];
    let totalFiles = 0;
    let totalDirs = 0;
    let processed = 0;
    const PROGRESS_EVERY = 200;

    function emitProgress(force) {
        if (!onProgress) return;
        if (!force && processed % PROGRESS_EVERY !== 0) return;
        onProgress({ totalFiles, totalDirs });
    }

    async function walk(currentPath) {
        let dirEntries;
        try {
            dirEntries = await fs.promises.readdir(currentPath, { withFileTypes: true });
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
        totalDirs++;
        processed++;
        emitProgress(false);

        for (const entry of dirEntries) {
            const full = path.join(currentPath, entry.name);

            let stat;
            try {
                stat = await fs.promises.stat(full);
            } catch (err) {
                console.warn("Impossibile determinare tipo elemento:", full, err);
                continue;
            }

            if (stat.isDirectory()) {
                await walk(full);
            } else if (stat.isFile()) {
                const rel = path.relative(rootFolder, full);
                entries.push({
                    kind: "file",
                    fullPath: full,
                    relPath: rel.replace(/\\/g, "/"),
                    size: stat.size,
                    mtimeMs: stat.mtimeMs,
                });
                totalFiles++;
                processed++;
                emitProgress(false);
            }
        }
    }

    await walk(rootFolder);
    emitProgress(true);
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
                        // non scendiamo oltre la profondit� massima
                        continue;
                    }
                    const filteredChild = cloneAndFilter(child, nextDepth);
                    if (filteredChild) {
                        cloned.children.push(filteredChild);
                    }
                }
            }

            // se non � la root e non ha figli dopo il filtro, elimina la cartella
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
        icon.textContent = FOLDER_CLOSED_ICON;

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
            icon.textContent = open ? FOLDER_OPEN_ICON : FOLDER_CLOSED_ICON;
        });
    } else {
        icon.textContent = "-";

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

    // Se la tab Statistiche � attiva, aggiorna subito il pannello
    if (isStatsTabActive && isStatsTabActive()) {
        renderStatsPanel();
    }
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
            // C'� una nuova ricerca partita, questa � vecchia ? stop
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

        const processed = results.length; // non � proprio il numero nodi, ma va bene per feedback
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
        // se � un file, usiamo la cartella padre
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
            if (icon) icon.textContent = FOLDER_CLOSED_ICON;

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
            if (icon) icon.textContent = FOLDER_CLOSED_ICON;
        }
    });

    // 2) Risali dal nodo target fino alla radice, aprendo solo il percorso necessario
    let current = targetDom;
    while (current && current.classList && current.classList.contains("tree-node")) {
        const childrenContainer = current.querySelector(":scope > .tree-children");
        if (childrenContainer) {
            childrenContainer.classList.add("open");
            const icon = current.querySelector(":scope > .node-icon");
            if (icon) icon.textContent = FOLDER_OPEN_ICON;
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
            // aperto (?) / chiuso (?)
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
    detailsTabs = document.querySelectorAll(".details-tab-content");
    detailsTabButtons = document.querySelectorAll(".details-tab-btn");

    topElementsLimitInput = document.getElementById("topElementsLimit");
    topElementsModeSelect = document.getElementById("topElementsMode");
    topElementsTableEl = document.getElementById("topElementsTable");

    if (detailsTabButtons && detailsTabs) {
        detailsTabButtons.forEach((btn) => {
            btn.addEventListener("click", () => {
                const tabId = btn.getAttribute("data-tab");
                if (!tabId) return;

                detailsTabButtons.forEach((b) => b.classList.remove("active"));
                btn.classList.add("active");

                detailsTabs.forEach((panel) => {
                    if (panel.id === tabId) {
                        panel.classList.remove("hidden");
                    } else {
                        panel.classList.add("hidden");
                    }
                });

                if (tabId === "details-top") {
                    renderTopElementsPanel();
                } else if (tabId === "details-stats") {
                    renderStatsPanel();
                }
            });
        });
    }

    if (topElementsLimitInput) {
        topElementsLimitInput.addEventListener("change", () => {
            if (isTopTabActive()) {
                renderTopElementsPanel();
            }
        });
    }

    if (topElementsModeSelect) {
        topElementsModeSelect.addEventListener("change", () => {
            if (isTopTabActive()) {
                renderTopElementsPanel();
            }
        });
    }

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
            scanOptionsArrowEl.textContent = collapsed ? "\u25B6" : "\u25BC"; // ? / ?
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

    btnStartScan.addEventListener("click", async () => {
        if (!selectedFolder) {
            console.warn("Seleziona prima una cartella!");
            return;
        }

        btnStartScan.disabled = true;

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

        try {
            const entries = await scanFolderRecursively(
                selectedFolder,
                ({ totalFiles, totalDirs }) => {
                    if (treeRootEl) {
                        treeRootEl.innerHTML = `
                            <p>Scansione in corso...</p>
                            <p>File scansionati: ${totalFiles}</p>
                            <p>Cartelle scansionate: ${totalDirs}</p>
                        `;
                    }

                    const scanFunStatusEl = document.getElementById("scanFunStatus");
                    if (scanFunStatusEl) {
                        const now = performance.now();
                        if (now - lastFunMessageTime > 5000) {
                            funMessageIndex =
                                (funMessageIndex + 1) % FUN_MESSAGES.length;
                            scanFunStatusEl.textContent =
                                FUN_MESSAGES[funMessageIndex];
                            lastFunMessageTime = now;
                        }
                    }
                }
            );

            rootTree = createRootTree(selectedFolder);
            pendingEntries = entries.slice();

            // fase di costruzione albero: messaggio + fun messages
            detailsBox.innerHTML = `
                <p>Costruzione dell'albero in corso... Attendere.</p>
                <p id="buildFunStatus" class="fun-status muted"></p>
            `;
            funMessageIndex = 0;
            lastFunMessageTime = performance.now();
            const buildFunStatus = document.getElementById("buildFunStatus");
            if (buildFunStatus) {
                buildFunStatus.textContent = FUN_MESSAGES[funMessageIndex];
            }

            buildTreeFromPendingAsync(() => {
                originalRootTree = cloneTree(rootTree);
                renderTreeFromModel();
                detailsBox.innerHTML =
                    "<p>Seleziona un nodo per vedere i dettagli.</p>";
                btnStartScan.disabled = false;
            });
        } catch (err) {
            console.error("Errore durante la scansione locale:", err);
            treeRootEl.innerHTML = "<p>Errore durante la scansione.</p>";
            detailsBox.innerHTML =
                "<p>Errore durante la scansione. Controlla la console.</p>";
            btnStartScan.disabled = false;
        }
    });

    if (btnSearch && searchInput && searchResultsEl) {

        const runSearch = () => {
            const q = searchInput.value.trim();

            // Allunga automaticamente il box risultati a 100px
            // solo se � pi� basso (per non accorciare un resize manuale).
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

    // L'albero � stato costruito in modo incrementale nei vari "progress":
    // qui dobbiamo solo prendere uno snapshot per i filtri e renderizzare.
    pendingEntries = [];
    isBuildingTree = false;

    // snapshot dell'albero completo (base per i filtri)
    originalRootTree = cloneTree(rootTree);
    renderTreeFromModel();
    detailsBox.innerHTML = "<p>Seleziona un nodo per vedere i dettagli.</p>";
});
