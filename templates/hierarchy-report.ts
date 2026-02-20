// @ts-nocheck
"use strict";

let lastSelectedNode = null;
let extChartInstance = null;
let timelineChartInstance = null;
let extStatsMode = "size";
let extStatsSortDir = "desc";
let statsYearFrom = null;
let statsYearTo = null;

function formatBytes(bytes) {
    if (!bytes || !isFinite(bytes) || bytes <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let idx = 0;
    let val = bytes;
    while (val >= 1024 && idx < units.length - 1) {
        val /= 1024;
        idx++;
    }
    return val.toFixed(2) + " " + units[idx];
}

function buildTree(node, container) {
    if (!node) return;

    const wrapper = document.createElement("div");
    wrapper.className = "tree-node " + node.type;

    const icon = document.createElement("span");
    icon.className = "node-icon";
    icon.textContent = node.type === "folder" ? "\u25B6" : "-";
    wrapper.appendChild(icon);

    const label = document.createElement("span");
    label.className = "label";
    label.textContent = node.name || "(senza nome)";
    wrapper.appendChild(label);

    wrapper.addEventListener("click", (e) => {
        e.stopPropagation();
        document
            .querySelectorAll(".tree-node.selected")
            .forEach((n) => n.classList.remove("selected"));
        wrapper.classList.add("selected");

        lastSelectedNode = node;
        showDetails(node);

        if (node.type === "folder") {
            const isOpen = wrapper.classList.toggle("open");
            icon.textContent = isOpen ? "\u25BC" : "\u25B6";
        }

        const activeTabBtn = document.querySelector(".details-tab-btn.active");
        if (activeTabBtn && activeTabBtn.getAttribute("data-tab") === "details-stats") {
            renderStatsPanel(getReportDataSafe());
        }
    });

    container.appendChild(wrapper);

    if (Array.isArray(node.children) && node.children.length > 0) {
        const childrenEl = document.createElement("div");
        childrenEl.className = "tree-children";
        node.children.forEach((child) => {
            buildTree(child, childrenEl);
        });
        container.appendChild(childrenEl);
    }
}

function showDetails(node) {
    const el = document.getElementById("detailsContent");
    if (!el) return;

    let html = "";
    html += `<p><b>Nome:</b> ${node.name || "(senza nome)"}</p>`;

    if (node.fullPath) {
        html += `<p><b>Percorso completo:</b><br><span style="font-size:12px;">${node.fullPath}</span></p>`;
    }

    if (node.type === "file") {
        const size =
            typeof node.sizeBytes === "number"
                ? node.sizeBytes
                : typeof node.size === "number"
                ? node.size
                : null;
        if (typeof size === "number") {
            html += `<p><b>Dimensione:</b> ${size} byte (${formatBytes(size)})</p>`;
        }
        if (node.mtimeMs) {
            const dt = new Date(node.mtimeMs);
            html += `<p><b>Ultima modifica:</b> ${dt.toLocaleString()}</p>`;
        }
    } else if (node.type === "folder") {
        if (typeof node.totalSizeBytes === "number") {
            html += `<p><b>Dimensione (subtree):</b> ${formatBytes(
                node.totalSizeBytes
            )}</p>`;
        }
        if (typeof node.filesCount === "number") {
            html += `<p><b>File (subtree):</b> ${node.filesCount}</p>`;
        }
        if (typeof node.foldersCount === "number") {
            html += `<p><b>Cartelle (subtree):</b> ${node.foldersCount}</p>`;
        }
    }

    el.innerHTML = html;
}

function renderTopElementsPanel(data) {
    const limitInput = document.getElementById("topElementsLimit");
    const modeSelect = document.getElementById("topElementsMode");
    const tableEl = document.getElementById("topElementsTable");
    if (!limitInput || !modeSelect || !tableEl) return;

    const n = Number(limitInput.value);
    const maxTop = Number.isFinite(n) && n > 0 ? n : 20;
    const mode = modeSelect.value || "files";

    let rows = [];
    let columns = [];

    if (mode === "files") {
        const src = Array.isArray(data.topFiles) ? data.topFiles : [];
        rows = src.slice(0, maxTop).map((r, idx) => ({
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
    } else if (mode === "folders") {
        const src = Array.isArray(data.topFolders) ? data.topFolders : [];
        rows = src.slice(0, maxTop).map((r, idx) => ({
            index: idx + 1,
            name: r.name,
            fullPath: r.fullPath,
            filesCount: r.filesCount,
            foldersCount: r.foldersCount,
            totalSizeBytes: r.totalSizeBytes,
        }));
        columns = [
            { field: "index", label: "#" },
            { field: "name", label: "Cartella" },
            { field: "filesCount", label: "File" },
            { field: "foldersCount", label: "Cartelle" },
            { field: "totalSizeBytes", label: "Dimensione" },
        ];
    } else if (mode === "old") {
        const src = Array.isArray(data.topOldFiles)
            ? data.topOldFiles
            : Array.isArray(data.topFiles)
            ? data.topFiles.slice().sort((a, b) => (a.mtimeMs || 0) - (b.mtimeMs || 0))
            : [];
        rows = src.slice(0, maxTop).map((r, idx) => ({
            index: idx + 1,
            name: r.name,
            fullPath: r.fullPath,
            sizeBytes: r.sizeBytes,
            mtimeMs: r.mtimeMs,
        }));
        columns = [
            { field: "index", label: "#" },
            { field: "name", label: "File" },
            { field: "sizeBytes", label: "Dimensione" },
            { field: "mtime", label: "Ultima modifica" },
        ];
    }

    if (!rows.length) {
        tableEl.innerHTML =
            "<tbody><tr><td>Nessun elemento da mostrare.</td></tr></tbody>";
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
        tr.addEventListener("click", () => {
            showDetails({
                name: row.name,
                fullPath: row.fullPath,
                sizeBytes: row.sizeBytes,
            });
        });

        columns.forEach((col) => {
            const td = document.createElement("td");
            let v;
            if (col.field === "mtime") {
                v = row.mtimeMs ? new Date(row.mtimeMs).toLocaleString() : "";
            } else {
                v = row[col.field];
            }
            if (col.field === "sizeBytes" || col.field === "totalSizeBytes") {
                v = formatBytes(v || 0);
            }
            td.textContent = v != null ? v : "";
            tr.appendChild(td);
        });
        tbody.appendChild(tr);
    });

    tableEl.innerHTML = "";
    tableEl.appendChild(thead);
    tableEl.appendChild(tbody);
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

            const size =
                typeof node.sizeBytes === "number"
                    ? node.sizeBytes
                    : typeof node.size === "number"
                    ? node.size
                    : 0;
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

            const name = node.name || "";
            const dotIndex = name.lastIndexOf(".");
            let ext =
                dotIndex >= 0 ? name.substring(dotIndex).toLowerCase() : "(senza estensione)";
            if (!ext) ext = "(senza estensione)";

            let bucket = extensionStatsMap[ext];
            if (!bucket) {
                bucket = {
                    extension: ext,
                    count: 0,
                    totalSizeBytes: 0,
                };
                extensionStatsMap[ext] = bucket;
            }
            bucket.count += 1;
            bucket.totalSizeBytes += size;
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

        timeBuckets = Object.entries(bucketMap)
            .map(([label, count]) => ({ label, count }))
            .sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
    }

    return {
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

function renderStatsPanel(data) {
    const box = document.getElementById("detailsStatsBox");
    if (!box) return;

    const hierarchyRoot = data.hierarchy;
    const baseNode = lastSelectedNode || hierarchyRoot;
    if (!baseNode) {
        box.innerHTML =
            "<p class='muted'>Nessuna gerarchia disponibile. Esegui una scansione.</p>";
        return;
    }

    const stats = computeStatsForSubtree(baseNode);
    if (!stats) {
        box.innerHTML =
            "<p class='muted'>Impossibile calcolare le statistiche per questo nodo.</p>";
        return;
    }

    const extStats = stats.extensionStats || [];
    const timeBuckets = stats.timeBuckets || [];

    let html = "";
    const baseLabel =
        baseNode.fullPath || baseNode.name || (data.meta && data.meta.rootPath) || "(sconosciuta)";
    html += `<p><b>Base statistica:</b><br><span style="font-size:12px;">${baseLabel}</span></p>`;
    html += "<hr>";
    html += "<div class=\"stats-summary\">";
    html += `<div><b>File:</b> ${stats.totalFiles || 0}</div>`;
    html += `<div><b>Cartelle:</b> ${stats.totalFolders || 0}</div>`;
    html += `<div><b>Spazio totale:</b> ${formatBytes(
        stats.totalSizeBytes || 0
    )}</div>`;
    html += `<div><b>Profondità massima:</b> ${stats.maxDepth || 0}</div>`;
    html += "</div>";

    if (stats.minMtimeMs || stats.maxMtimeMs) {
        const minStr = stats.minMtimeMs
            ? new Date(stats.minMtimeMs).toLocaleString()
            : "";
        const maxStr = stats.maxMtimeMs
            ? new Date(stats.maxMtimeMs).toLocaleString()
            : "";
        html += "<hr>";
        html += "<p><b>Periodo modifiche:</b><br>";
        if (minStr) html += `<span>Dal: ${minStr}</span><br>`;
        if (maxStr) html += `<span>Al: ${maxStr}</span>`;
        html += "</p>";
    }

    html += "<hr>";
    html += "<p><b>Estensioni principali:</b></p>";
    html += "<div class=\"top-elements-controls\">";
    html += "  <div class=\"top-elements-control\">";
    html += "    <label for=\"extStatsMode\">Estensioni per:</label>";
    html += `    <select id=\"extStatsMode\">`;
    html += `      <option value=\"size\"${
        extStatsMode === "size" ? " selected" : ""
    }>Dimensione</option>`;
    html += `      <option value=\"count\"${
        extStatsMode === "count" ? " selected" : ""
    }>Conteggio</option>`;
    html += "    </select>";
    html += "  </div>";
    html += "  <div class=\"top-elements-control\">";
    html += "    <label for=\"extStatsSort\">Ordine:</label>";
    html += `    <select id=\"extStatsSort\">`;
    html += `      <option value=\"desc\"${
        extStatsSortDir === "desc" ? " selected" : ""
    }>Decrescente</option>`;
    html += `      <option value=\"asc\"${
        extStatsSortDir === "asc" ? " selected" : ""
    }>Crescente</option>`;
    html += "    </select>";
    html += "  </div>";
    html += "</div>";

    html += "<div class=\"stats-section\">";
    html +=
        typeof Chart !== "undefined"
            ? '<canvas id="extStatsChart"></canvas>'
            : '<div id="extStatsFallback" class="muted">Chart.js non disponibile.</div>';
    html += "</div>";

    html += "<hr>";
    html += "<p><b>Timeline modifiche (file per periodo):</b></p>";
    html += '<div class="stats-timeline-filters">';
    html += '  <div class="top-elements-control">';
    html += '    <label for="timelineYearFrom">Anno da:</label>';
    html += `    <input type="number" id="timelineYearFrom" value="${
        statsYearFrom != null ? statsYearFrom : ""
    }">`;
    html += "  </div>";
    html += '  <div class="top-elements-control">';
    html += '    <label for="timelineYearTo">Anno a:</label>';
    html += `    <input type="number" id="timelineYearTo" value="${
        statsYearTo != null ? statsYearTo : ""
    }">`;
    html += "  </div>";
    html += "</div>";

    html += '<div class="stats-section">';
    html +=
        typeof Chart !== "undefined"
            ? '<canvas id="timelineChart"></canvas>'
            : '<div id="timelineFallback" class="muted">Chart.js non disponibile.</div>';
    html += "</div>";

    box.innerHTML = html;

    if (typeof Chart === "undefined") {
        return;
    }

    const extCanvas = document.getElementById("extStatsChart");
    if (extCanvas && extStats.length) {
        const modeKey = extStatsMode === "count" ? "count" : "totalSizeBytes";
        const sorted = extStats
            .slice()
            .sort((a, b) => {
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

        extChartInstance = new Chart(extCanvas.getContext("2d"), {
            type: "bar",
            data: {
                labels: labelsExt,
                datasets: [
                    {
                        label: extStatsMode === "count" ? "Conteggio file" : "Dimensione",
                        data: dataExt,
                        backgroundColor: "rgba(204,147,14,0.7)",
                    },
                ],
            },
            options: {
                indexAxis: "y",
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: {
                        ticks: { color: "#eee" },
                        grid: { color: "#444" },
                    },
                    y: {
                        ticks: { color: "#eee" },
                        grid: { color: "#444" },
                    },
                },
                animation: {
                    duration: 900,
                    easing: "easeInOutQuad",
                },
            },
        });
    }

    const tlCanvas = document.getElementById("timelineChart");
    if (tlCanvas && timeBuckets.length) {
        const yearFromInput = document.getElementById("timelineYearFrom");
        const yearToInput = document.getElementById("timelineYearTo");

        if (statsYearFrom == null && statsYearTo == null) {
            const currentYear = new Date().getFullYear();
            statsYearTo = currentYear;
            statsYearFrom = currentYear - 9;
        }

        let filteredBuckets = timeBuckets.slice();
        if (filteredBuckets.length && (statsYearFrom != null || statsYearTo != null)) {
            filteredBuckets = filteredBuckets.filter((b) => {
                const year = parseInt(String(b.label).slice(0, 4), 10);
                if (Number.isNaN(year)) return true;
                if (statsYearFrom != null && year < statsYearFrom) return false;
                if (statsYearTo != null && year > statsYearTo) return false;
                return true;
            });
            if (!filteredBuckets.length) {
                filteredBuckets = timeBuckets.slice();
            }
        }

        if (yearFromInput) {
            yearFromInput.value = statsYearFrom != null ? String(statsYearFrom) : "";
        }
        if (yearToInput) {
            yearToInput.value = statsYearTo != null ? String(statsYearTo) : "";
        }

        const labelsTl = filteredBuckets.map((b) => b.label);
        const dataTl = filteredBuckets.map((b) => b.count || 0);

        if (timelineChartInstance) {
            timelineChartInstance.destroy();
        }

        timelineChartInstance = new Chart(tlCanvas.getContext("2d"), {
            type: "line",
            data: {
                labels: labelsTl,
                datasets: [
                    {
                        label: "File modificati",
                        data: dataTl,
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
                plugins: { legend: { display: false } },
                interaction: { mode: "index", intersect: false },
                scales: {
                    x: {
                        ticks: { color: "#eee", maxTicksLimit: 16 },
                        grid: { color: "#444" },
                    },
                    y: {
                        beginAtZero: true,
                        ticks: { color: "#eee" },
                        grid: { color: "#444" },
                    },
                },
                animation: {
                    duration: 1000,
                    easing: "easeInQuad",
                },
            },
        });

        const applyYearFilter = () => {
            let fromVal = statsYearFrom;
            let toVal = statsYearTo;

            if (yearFromInput && yearFromInput.value !== "") {
                const v = parseInt(yearFromInput.value, 10);
                if (!Number.isNaN(v)) fromVal = v;
            }
            if (yearToInput && yearToInput.value !== "") {
                const v = parseInt(yearToInput.value, 10);
                if (!Number.isNaN(v)) toVal = v;
            }

            statsYearFrom = fromVal;
            statsYearTo = toVal;

            renderStatsPanel(data);
        };

        if (yearFromInput) {
            yearFromInput.addEventListener("change", applyYearFilter);
            yearFromInput.addEventListener("keydown", (e) => {
                if (e.key === "Enter") {
                    e.preventDefault();
                    applyYearFilter();
                }
            });
        }
        if (yearToInput) {
            yearToInput.addEventListener("change", applyYearFilter);
            yearToInput.addEventListener("keydown", (e) => {
                if (e.key === "Enter") {
                    e.preventDefault();
                    applyYearFilter();
                }
            });
        }
    }

    const modeEl = document.getElementById("extStatsMode");
    const sortEl = document.getElementById("extStatsSort");
    if (modeEl) {
        modeEl.addEventListener("change", () => {
            extStatsMode = modeEl.value === "count" ? "count" : "size";
            renderStatsPanel(data);
        });
    }
    if (sortEl) {
        sortEl.addEventListener("change", () => {
            extStatsSortDir = sortEl.value === "asc" ? "asc" : "desc";
            renderStatsPanel(data);
        });
    }
}

function initTabs(data) {
    const buttons = document.querySelectorAll(".details-tab-btn");
    const panels = document.querySelectorAll(".details-tab-content");

    buttons.forEach((btn) => {
        btn.addEventListener("click", () => {
            const tabId = btn.getAttribute("data-tab");
            if (!tabId) return;

            buttons.forEach((b) => b.classList.remove("active"));
            btn.classList.add("active");

            panels.forEach((panel) => {
                if (panel.id === tabId) {
                    panel.classList.remove("hidden");
                } else {
                    panel.classList.add("hidden");
                }
            });

            if (tabId === "details-top") {
                renderTopElementsPanel(data);
            } else if (tabId === "details-stats") {
                renderStatsPanel(data);
            }
        });
    });
}

function applyTreeFilter(query) {
    const q = (query || "").toLowerCase();
    const nodes = document.querySelectorAll(".tree-node");
    nodes.forEach((nodeEl) => {
        const labelEl = nodeEl.querySelector(".label");
        const text = labelEl ? labelEl.textContent.toLowerCase() : "";
        const match = !q || text.indexOf(q) !== -1;
        nodeEl.style.display = match ? "" : "none";
    });
}

function getReportDataSafe() {
    return typeof REPORT_DATA === "object" && REPORT_DATA ? REPORT_DATA : {};
}

function initReport() {
    const data = getReportDataSafe();

    const meta = data.meta || {};
    const metaEl = document.getElementById("metaInfo");
    if (metaEl) {
        const when = meta.generatedAt
            ? new Date(meta.generatedAt).toLocaleString()
            : "";
        const root = meta.rootPath || "(percorso sconosciuto)";
        metaEl.textContent = `${root} - generato il ${when}`;
    }

    const treeRootEl = document.getElementById("treeRoot");
    if (treeRootEl && data.hierarchy) {
        buildTree(data.hierarchy, treeRootEl);
    }

    showDetails({
        name: meta.rootPath || "root",
        fullPath: meta.rootPath || "",
        type: "folder",
        totalSizeBytes: (data.globalStats || {}).totalSizeBytes,
        filesCount: (data.globalStats || {}).totalFiles,
        foldersCount: (data.globalStats || {}).totalFolders,
    });

    initTabs(data);

    const limitInput = document.getElementById("topElementsLimit");
    const modeSelect = document.getElementById("topElementsMode");
    if (limitInput && modeSelect) {
        limitInput.addEventListener("change", () => renderTopElementsPanel(data));
        modeSelect.addEventListener("change", () => renderTopElementsPanel(data));
    }

    const filterEl = document.getElementById("treeFilter");
    if (filterEl) {
        filterEl.addEventListener("input", () => {
            applyTreeFilter(filterEl.value);
        });
        filterEl.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                applyTreeFilter(filterEl.value);
            }
        });
    }
}

document.addEventListener("DOMContentLoaded", initReport);

