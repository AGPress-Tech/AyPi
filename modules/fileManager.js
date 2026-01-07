// Gestione finestre e IPC lato main per AyPi

const { ipcMain, dialog, shell, BrowserWindow, app } = require("electron");
const path = require("path");
const { exec } = require("child_process");
const fs = require("fs");
const log = require("electron-log");

const WINDOW_WEB_PREFERENCES = {
    nodeIntegration: true,
    contextIsolation: false,
};

const APP_ICON_PATH = path.join(__dirname, "..", "assets", "app-icon.png");

function animateResize(mainWindow, targetWidth, targetHeight, duration = 100) {
    if (!mainWindow) return;

    const [startWidth, startHeight] = mainWindow.getSize();
    const steps = 20;
    const stepDuration = duration / steps;
    let currentStep = 0;

    const interval = setInterval(() => {
        currentStep++;
        const progress = currentStep / steps;

        const newWidth = Math.round(startWidth + (targetWidth - startWidth) * progress);
        const newHeight = Math.round(startHeight + (targetHeight - startHeight) * progress);

        mainWindow.setSize(newWidth, newHeight);

        if (currentStep >= steps) {
            clearInterval(interval);
            mainWindow.setSize(targetWidth, targetHeight);
            mainWindow.center();
        }
    }, stepDuration);
}

function isWindowAlive(win) {
    return win && !win.isDestroyed();
}

function showMainWindow(mainWindow) {
    if (!isWindowAlive(mainWindow)) return;
    mainWindow.show();
    mainWindow.focus();
}

function showWindow(win) {
    if (!isWindowAlive(win)) return;
    win.show();
    win.focus();
}

function buildHierarchyReportHtml() {
    return "<!DOCTYPE html>\n" +
        "<html lang=\"it\">\n" +
        "<head>\n" +
        "  <meta charset=\"UTF-8\">\n" +
        "  <title>Report gerarchia file</title>\n" +
        "  <link rel=\"stylesheet\" href=\"./report.css\">\n" +
        "</head>\n" +
        "<body>\n" +
        "  <header>\n" +
        "    <h1>Report gerarchia file</h1>\n" +
        "    <div id=\"metaInfo\" class=\"meta-info\"></div>\n" +
        "  </header>\n" +
        "  <main class=\"layout\">\n" +
        "    <aside class=\"sidebar\">\n" +
        "      <h2>Gerarchia</h2>\n" +
        "      <input id=\"treeFilter\" placeholder=\"Filtra per nome/percorso...\">\n" +
        "      <div id=\"treeContainer\" class=\"tree-container\"></div>\n" +
        "    </aside>\n" +
        "    <section class=\"content\">\n" +
        "      <section>\n" +
        "        <h2>Statistiche generali</h2>\n" +
        "        <div id=\"globalStats\"></div>\n" +
        "      </section>\n" +
        "      <section class=\"top-row\">\n" +
        "        <div class=\"top-col\">\n" +
        "          <h2>Top cartelle piÇû pesanti</h2>\n" +
        "          <div class=\"table-wrapper\">\n" +
        "            <table id=\"topFoldersTable\" class=\"data-table\"></table>\n" +
        "          </div>\n" +
        "        </div>\n" +
        "        <div class=\"top-col\">\n" +
        "          <h2>Top file piÇû grandi</h2>\n" +
        "          <div class=\"table-wrapper\">\n" +
        "            <table id=\"topFilesTable\" class=\"data-table\"></table>\n" +
        "          </div>\n" +
        "        </div>\n" +
        "      </section>\n" +
        "      <section id=\"detailsPanel\">\n" +
        "        <h2>Dettagli elemento</h2>\n" +
        "        <div id=\"detailsContent\" class=\"details-content\">Seleziona un elemento dall'albero o dalle tabelle.</div>\n" +
        "      </section>\n" +
        "    </section>\n" +
        "  </main>\n" +
        "  <script src=\"./report.js\"></script>\n" +
        "</body>\n" +
        "</html>\n";
}

function buildHierarchyReportCss() {
    return "html, body {\n" +
        "  margin: 0;\n" +
        "  height: 100%;\n" +
        "  overflow: hidden;\n" +
        "}\n" +
        "body {\n" +
        "  font-family: Arial, sans-serif;\n" +
        "  background-color: #332f2b;\n" +
        "  color: #fff;\n" +
        "}\n" +
        "header {\n" +
        "  padding: 12px 16px;\n" +
        "  background-color: #1f1b18;\n" +
        "  border-bottom: 1px solid #555;\n" +
        "}\n" +
        "h1 {\n" +
        "  margin: 0 0 4px 0;\n" +
        "  color: #cc930e;\n" +
        "}\n" +
        ".meta-info {\n" +
        "  font-size: 12px;\n" +
        "  color: #ccc;\n" +
        "}\n" +
        ".layout {\n" +
        "  display: flex;\n" +
        "  height: calc(100vh - 60px);\n" +
        "}\n" +
        ".sidebar {\n" +
        "  width: 30%;\n" +
        "  border-right: 1px solid #555;\n" +
        "  padding: 10px;\n" +
        "  box-sizing: border-box;\n" +
        "  overflow: auto;\n" +
        "  background-color: #2b2824;\n" +
        "}\n" +
        ".content {\n" +
        "  flex: 1;\n" +
        "  padding: 10px 16px;\n" +
        "  box-sizing: border-box;\n" +
        "  overflow: hidden;\n" +
        "}\n" +
        ".top-row {\n" +
        "  display: flex;\n" +
        "  gap: 16px;\n" +
        "}\n" +
        ".top-col {\n" +
        "  flex: 1;\n" +
        "  min-width: 0;\n" +
        "}\n" +
        "input#treeFilter {\n" +
        "  width: 100%;\n" +
        "  padding: 4px 6px;\n" +
        "  margin-bottom: 8px;\n" +
        "  border-radius: 4px;\n" +
        "  border: 1px solid #777;\n" +
        "  background-color: #1f1b18;\n" +
        "  color: #fff;\n" +
        "  box-sizing: border-box;\n" +
        "}\n" +
        ".tree-container {\n" +
        "  overflow: auto;\n" +
        "}\n" +
        ".tree-node {\n" +
        "  cursor: pointer;\n" +
        "  padding: 2px 0;\n" +
        "  white-space: nowrap;\n" +
        "}\n" +
        ".tree-node .node-icon {\n" +
        "  display: inline-block;\n" +
        "  width: 14px;\n" +
        "}\n" +
        ".tree-node .label {\n" +
        "  margin-left: 4px;\n" +
        "}\n" +
        ".tree-children {\n" +
        "  margin-left: 18px;\n" +
        "  display: none;\n" +
        "}\n" +
        ".tree-node.open + .tree-children {\n" +
        "  display: block;\n" +
        "}\n" +
        ".tree-node.selected {\n" +
        "  background-color: #555;\n" +
        "}\n" +
        ".table-wrapper {\n" +
        "  height: 220px;\n" +
        "  min-height: 140px;\n" +
        "  max-height: 40vh;\n" +
        "  resize: vertical;\n" +
        "  overflow: auto;\n" +
        "  border: 1px solid #555;\n" +
        "  border-radius: 4px;\n" +
        "  margin-bottom: 8px;\n" +
        "}\n" +
        ".data-table {\n" +
        "  width: 100%;\n" +
        "  border-collapse: collapse;\n" +
        "  font-size: 13px;\n" +
        "}\n" +
        ".data-table th,\n" +
        ".data-table td {\n" +
        "  padding: 4px 6px;\n" +
        "  border-bottom: 1px solid #444;\n" +
        "  text-align: left;\n" +
        "}\n" +
        ".data-table th {\n" +
        "  background-color: #1f1b18;\n" +
        "  position: sticky;\n" +
        "  top: 0;\n" +
        "  z-index: 1;\n" +
        "}\n" +
        ".data-table tr:hover {\n" +
        "  background-color: #3a352f;\n" +
        "  cursor: pointer;\n" +
        "}\n" +
        ".details-content {\n" +
        "  margin-top: 8px;\n" +
        "  padding: 8px;\n" +
        "  border-radius: 4px;\n" +
        "  border: 1px solid #555;\n" +
        "  background-color: #2b2824;\n" +
        "  font-size: 13px;\n" +
        "}\n";
}

function buildHierarchyReportJs(data) {
    const serialized = JSON.stringify(data, null, 2);
    return '"use strict";\n\n' +
        "const REPORT_DATA = " + serialized + ";\n\n" +
        "function formatBytes(bytes) {\n" +
        "  if (!bytes || !isFinite(bytes) || bytes <= 0) return \"0 B\";\n" +
        "  var units = [\"B\", \"KB\", \"MB\", \"GB\", \"TB\"];\n" +
        "  var idx = 0;\n" +
        "  var val = bytes;\n" +
        "  while (val >= 1024 && idx < units.length - 1) {\n" +
        "    val /= 1024;\n" +
        "    idx++;\n" +
        "  }\n" +
        "  return val.toFixed(1) + \" \" + units[idx];\n" +
        "}\n\n" +
        "function buildTree(node, container) {\n" +
        "  if (!node) return;\n" +
        "  var wrapper = document.createElement(\"div\");\n" +
        "  wrapper.className = \"tree-node \" + node.type;\n" +
        "  var icon = document.createElement(\"span\");\n" +
        "  icon.className = \"node-icon\";\n" +
        "  icon.textContent = node.type === \"folder\" ? \"\\u25B6\" : \"\\u2022\";\n" +
        "  wrapper.appendChild(icon);\n" +
        "  var label = document.createElement(\"span\");\n" +
        "  label.className = \"label\";\n" +
        "  label.textContent = node.name || \"(senza nome)\";\n" +
        "  wrapper.appendChild(label);\n" +
        "  wrapper.addEventListener(\"click\", function (e) {\n" +
        "    e.stopPropagation();\n" +
        "    document.querySelectorAll(\".tree-node.selected\").forEach(function (n) {\n" +
        "      n.classList.remove(\"selected\");\n" +
        "    });\n" +
        "    wrapper.classList.add(\"selected\");\n" +
        "    showDetails(node);\n" +
        "    if (node.type === \"folder\") {\n" +
        "      var isOpen = wrapper.classList.toggle(\"open\");\n" +
        "      icon.textContent = isOpen ? \"\\u25BC\" : \"\\u25B6\";\n" +
        "    }\n" +
        "  });\n" +
        "  container.appendChild(wrapper);\n" +
        "  if (node.children && node.children.length > 0) {\n" +
        "    var childrenEl = document.createElement(\"div\");\n" +
        "    childrenEl.className = \"tree-children\";\n" +
        "    node.children.forEach(function (child) {\n" +
        "      buildTree(child, childrenEl);\n" +
        "    });\n" +
        "    container.appendChild(childrenEl);\n" +
        "  }\n" +
        "}\n\n" +
        "function renderGlobalStats(data) {\n" +
        "  var el = document.getElementById(\"globalStats\");\n" +
        "  if (!el || !data.globalStats) return;\n" +
        "  var gs = data.globalStats;\n" +
        "  var html = \"\";\n" +
        "  html += \"<p><b>Cartelle:</b> \" + (gs.totalFolders || 0) + \"</p>\";\n" +
        "  html += \"<p><b>File:</b> \" + (gs.totalFiles || 0) + \"</p>\";\n" +
        "  html += \"<p><b>Spazio totale:</b> \" + formatBytes(gs.totalSizeBytes || 0) + \"</p>\";\n" +
        "  html += \"<p><b>ProfonditÇÿ massima:</b> \" + (gs.maxDepth || 0) + \"</p>\";\n" +
        "  el.innerHTML = html;\n" +
        "}\n\n" +
        "function renderTopTable(tableId, rows, columns) {\n" +
        "  var table = document.getElementById(tableId);\n" +
        "  if (!table) return;\n" +
        "  table.innerHTML = \"\";\n" +
        "  var thead = document.createElement(\"thead\");\n" +
        "  var trHead = document.createElement(\"tr\");\n" +
        "  columns.forEach(function (col) {\n" +
        "    var th = document.createElement(\"th\");\n" +
        "    th.textContent = col.label;\n" +
        "    trHead.appendChild(th);\n" +
        "  });\n" +
        "  thead.appendChild(trHead);\n" +
        "  table.appendChild(thead);\n" +
        "  var tbody = document.createElement(\"tbody\");\n" +
        "  (rows || []).forEach(function (row) {\n" +
        "    var tr = document.createElement(\"tr\");\n" +
        "    tr.addEventListener(\"click\", function () {\n" +
        "      showDetails({ name: row.name, fullPath: row.fullPath, sizeBytes: row.sizeBytes || row.totalSizeBytes });\n" +
        "    });\n" +
        "    columns.forEach(function (col) {\n" +
        "      var td = document.createElement(\"td\");\n" +
        "      var v = row[col.field];\n" +
        "      if (col.field.indexOf(\"Bytes\") !== -1) {\n" +
        "        v = formatBytes(v || 0);\n" +
        "      }\n" +
        "      td.textContent = v != null ? v : \"\";\n" +
        "      tr.appendChild(td);\n" +
        "    });\n" +
        "    tbody.appendChild(tr);\n" +
        "  });\n" +
        "  table.appendChild(tbody);\n" +
        "}\n\n" +
        "function showDetails(node) {\n" +
        "  var el = document.getElementById(\"detailsContent\");\n" +
        "  if (!el) return;\n" +
        "  var html = \"\";\n" +
        "  html += \"<p><b>Nome:</b> \" + (node.name || \"(senza nome)\") + \"</p>\";\n" +
        "  if (node.fullPath) {\n" +
        "    html += \"<p><b>Percorso completo:</b><br><span style='font-size:12px;'>\" + node.fullPath + \"</span></p>\";\n" +
        "  }\n" +
        "  if (typeof node.sizeBytes === \"number\") {\n" +
        "    html += \"<p><b>Dimensione:</b> \" + formatBytes(node.sizeBytes) + \"</p>\";\n" +
        "  }\n" +
        "  el.innerHTML = html;\n" +
        "}\n\n" +
        "function applyTreeFilter(query) {\n" +
        "  var q = (query || \"\").toLowerCase();\n" +
        "  var nodes = document.querySelectorAll(\".tree-node\");\n" +
        "  nodes.forEach(function (nodeEl) {\n" +
        "    var labelEl = nodeEl.querySelector(\".label\");\n" +
        "    var text = labelEl ? labelEl.textContent.toLowerCase() : \"\";\n" +
        "    var match = !q || text.indexOf(q) !== -1;\n" +
        "    nodeEl.style.display = match ? \"\" : \"none\";\n" +
        "  });\n" +
        "}\n\n" +
        "function initReport() {\n" +
        "  var data = REPORT_DATA || {};\n" +
        "  var meta = data.meta || {};\n" +
        "  var metaEl = document.getElementById(\"metaInfo\");\n" +
        "  if (metaEl) {\n" +
        "    var when = meta.generatedAt ? new Date(meta.generatedAt).toLocaleString() : \"\";\n" +
        "    var root = meta.rootPath || \"(percorso sconosciuto)\";\n" +
        "    metaEl.textContent = root + \" - generato il \" + when;\n" +
        "  }\n" +
        "  var treeContainer = document.getElementById(\"treeContainer\");\n" +
        "  if (treeContainer && data.hierarchy) {\n" +
        "    buildTree(data.hierarchy, treeContainer);\n" +
        "  }\n" +
        "  renderGlobalStats(data);\n" +
        "  if (Array.isArray(data.topFolders)) {\n" +
        "    renderTopTable(\"topFoldersTable\", data.topFolders, [\n" +
        "      { field: \"name\", label: \"Cartella\" },\n" +
        "      { field: \"totalSizeBytes\", label: \"Dimensione\" },\n" +
        "      { field: \"filesCount\", label: \"File\" },\n" +
        "      { field: \"foldersCount\", label: \"Cartelle\" }\n" +
        "    ]);\n" +
        "  }\n" +
        "  if (Array.isArray(data.topFiles)) {\n" +
        "    renderTopTable(\"topFilesTable\", data.topFiles, [\n" +
        "      { field: \"name\", label: \"File\" },\n" +
        "      { field: \"sizeBytes\", label: \"Dimensione\" }\n" +
        "    ]);\n" +
        "  }\n" +
        "  var filterEl = document.getElementById(\"treeFilter\");\n" +
        "  if (filterEl) {\n" +
        "    filterEl.addEventListener(\"input\", function () {\n" +
        "      applyTreeFilter(filterEl.value);\n" +
        "    });\n" +
        "    filterEl.addEventListener(\"keydown\", function (e) {\n" +
        "      if (e.key === \"Enter\") {\n" +
        "        e.preventDefault();\n" +
        "        applyTreeFilter(filterEl.value);\n" +
        "      }\n" +
        "    });\n" +
        "  }\n" +
        "}\n\n" +
        "document.addEventListener(\"DOMContentLoaded\", initReport);\n";
}

let batchRenameWindow = null;
let qrGeneratorWindow = null;
let compareFoldersWindow = null;
let hierarchyWindow = null;
let timerWindow = null;
let isAppQuitting = false;

function openBatchRenameWindow(mainWindow) {
    if (isWindowAlive(batchRenameWindow)) {
        showWindow(batchRenameWindow);
        return;
    }

    batchRenameWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        parent: mainWindow,
        modal: false,
        webPreferences: WINDOW_WEB_PREFERENCES,
        icon: APP_ICON_PATH,
    });

    batchRenameWindow.loadFile(path.join(__dirname, "..", "pages", "utilities", "batch-rename.html"));
    batchRenameWindow.setMenu(null);

    // Apertura in modalità "fullscreen windowed" (massimizzata)
    batchRenameWindow.once("ready-to-show", () => {
        if (!batchRenameWindow.isDestroyed()) {
            batchRenameWindow.maximize();
        }
    });

    batchRenameWindow.on("closed", () => {
        batchRenameWindow = null;
        showMainWindow(mainWindow);
    });
}

function openQrGeneratorWindow(mainWindow) {
    if (isWindowAlive(qrGeneratorWindow)) {
        showWindow(qrGeneratorWindow);
        return;
    }

    qrGeneratorWindow = new BrowserWindow({
        width: 900,
        height: 800,
        parent: mainWindow,
        modal: false,
        webPreferences: WINDOW_WEB_PREFERENCES,
        icon: APP_ICON_PATH,
    });

    qrGeneratorWindow.loadFile(path.join(__dirname, "..", "pages", "utilities", "qr-generator.html"));
    qrGeneratorWindow.setMenu(null);
    qrGeneratorWindow.center();

    qrGeneratorWindow.on("closed", () => {
        qrGeneratorWindow = null;
        showMainWindow(mainWindow);
    });
}

function openHierarchyWindow(mainWindow) {
    if (isWindowAlive(hierarchyWindow)) {
        showWindow(hierarchyWindow);
        return;
    }

    hierarchyWindow = new BrowserWindow({
        width: 1100,
        height: 800,
        parent: mainWindow,
        modal: false,
        webPreferences: WINDOW_WEB_PREFERENCES,
        icon: APP_ICON_PATH,
    });

    hierarchyWindow.loadFile(path.join(__dirname, "..", "pages", "utilities", "hierarchy.html"));
    hierarchyWindow.setMenu(null);
    hierarchyWindow.center();

    hierarchyWindow.on("closed", () => {
        hierarchyWindow = null;
        showMainWindow(mainWindow);
    });
}

function openTimerWindow(mainWindow) {
    if (isWindowAlive(timerWindow)) {
        showWindow(timerWindow);
        return;
    }

    timerWindow = new BrowserWindow({
        width: 520,
        height: 520,
        parent: mainWindow,
        modal: false,
        webPreferences: WINDOW_WEB_PREFERENCES,
        icon: APP_ICON_PATH,
    });

    timerWindow.loadFile(path.join(__dirname, "..", "pages", "utilities", "timers.html"));
    timerWindow.setMenu(null);
    timerWindow.center();

    timerWindow.on("close", (event) => {
        if (!isAppQuitting) {
            event.preventDefault();
            timerWindow.hide();
            showMainWindow(mainWindow);
        } else {
            timerWindow = null;
        }
    });
}

function openCompareFoldersWindow(slot, folder) {
    const createWindow = () => {
        compareFoldersWindow = new BrowserWindow({
            width: 900,
            height: 800,
            webPreferences: WINDOW_WEB_PREFERENCES,
            icon: APP_ICON_PATH,
        });

        compareFoldersWindow.loadFile(path.join(__dirname, "..", "pages", "utilities", "compare-folders.html"));
        compareFoldersWindow.setMenu(null);
        compareFoldersWindow.center();

        compareFoldersWindow.on("closed", () => {
            compareFoldersWindow = null;
        });

        compareFoldersWindow.webContents.once("did-finish-load", () => {
            if (folder) {
                if (slot === "A") {
                    compareFoldersWindow.webContents.send("compare-folders-set-A", folder);
                } else if (slot === "B") {
                    compareFoldersWindow.webContents.send("compare-folders-set-B", folder);
                }
            }
        });
    };

    if (!compareFoldersWindow || compareFoldersWindow.isDestroyed()) {
        createWindow();
    } else {
        showWindow(compareFoldersWindow);
        if (folder) {
            if (slot === "A") {
                compareFoldersWindow.webContents.send("compare-folders-set-A", folder);
            } else if (slot === "B") {
                compareFoldersWindow.webContents.send("compare-folders-set-B", folder);
            }
        }
    }
}

function setupFileManager(mainWindow) {
    app.on("before-quit", () => {
        isAppQuitting = true;
    });
    ipcMain.on("resize-calcolatore", () => {
        animateResize(mainWindow, 750, 750, 100);
    });

    ipcMain.on("resize-normale", () => {
        animateResize(mainWindow, 750, 550, 100);
    });

    ipcMain.on("open-file", (event, filePath) => {
        const testFile = "\\\\Dl360\\private\\AyPi Server Validator.txt";

        fs.access(testFile, fs.constants.F_OK, (err) => {
            if (err) {
                log.warn("Server non raggiungibile:", err.message);
                dialog.showMessageBox(mainWindow, {
                    type: 'warning',
                    buttons: ['Ok'],
                    title: "Server Non Raggiungibile",
                    message: "Il server DL360 non è disponibile. Verificare la connessione."
                });
                return;
            }

            fs.stat(filePath, (err, stats) => {
                if (err) {
                    dialog.showMessageBox(mainWindow, {
                        type: 'warning',
                        buttons: ['Ok'],
                        title: "Percorso Non Trovato",
                        message: "Il file o la cartella non è disponibile. Controllare e riprovare."
                    });
                    return;
                }

                if (stats.isDirectory()) {
                    shell.openPath(filePath);
                } else {
                    exec(`start "" "${filePath}"`, (error) => {
                        if (error) {
                            if (error.message.includes("utilizzato da un altro processo")) {
                                dialog.showMessageBox(mainWindow, {
                                    type: 'warning',
                                    buttons: ['Apri in sola lettura', 'Annulla'],
                                    title: "File in Uso",
                                    message: "Vuoi aprirlo in sola lettura?"
                                }).then(result => {
                                    if (result.response === 0) {
                                        shell.openPath(filePath);
                                    }
                                });
                            } else {
                                dialog.showMessageBox(mainWindow, {
                                    type: 'error',
                                    buttons: ['Ok'],
                                    title: "Errore",
                                    message: "Errore nell'apertura del file."
                                });
                            }
                        }
                    });
                }
            });
        });
    });

    ipcMain.handle("select-root-folder", async (event) => {
        const senderWin = BrowserWindow.fromWebContents(event.sender);
        const mainWin = isWindowAlive(mainWindow) ? mainWindow : null;
        const win = isWindowAlive(senderWin) ? senderWin : mainWin;
        if (win) {
            win.show();
            win.focus();
        }

        const dialogOptions = {
            title: "Seleziona la cartella",
            properties: ["openDirectory"],
        };
        const result = win
            ? await dialog.showOpenDialog(win, dialogOptions)
            : await dialog.showOpenDialog(dialogOptions);

        if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
            return null;
        }
        return result.filePaths[0];
    });

    ipcMain.handle("select-output-file", async (event, options) => {
        const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;

        const result = await dialog.showSaveDialog(win, {
            title: "Seleziona il file di destinazione",
            defaultPath: options?.defaultName || "output.xlsx",
            filters: options?.filters || [{ name: "File Excel", extensions: ["xlsx"] }],
        });

        if (result.canceled || !result.filePath) {
            return null;
        }
        return result.filePath;
    });

    ipcMain.handle("show-message-box", async (event, options) => {
        const win = BrowserWindow.getFocusedWindow() || mainWindow;

        return dialog.showMessageBox(win, {
            type: options.type || "none",
            buttons: ["OK"],
            title: "AyPi",
            message: options.message || "",
            detail: options.detail || "",
        });
    });

    ipcMain.handle("get-app-version", async () => {
        return app.getVersion();
    });

    const presetsPath = path.join(app.getPath("userData"), "batch-rename-presets.json");

    function loadBatchRenamePresets() {
        try {
            if (!fs.existsSync(presetsPath)) return [];
            const raw = fs.readFileSync(presetsPath, "utf8");
            const data = JSON.parse(raw);
            if (Array.isArray(data)) return data;
            return [];
        } catch (err) {
            log.error("[batch-rename] impossibile leggere i preset:", err);
            return [];
        }
    }

    function saveBatchRenamePresets(list) {
        try {
            fs.writeFileSync(presetsPath, JSON.stringify(list, null, 2), "utf8");
        } catch (err) {
            log.error("[batch-rename] impossibile salvare i preset:", err);
        }
    }

    ipcMain.handle("batch-rename-load-presets", async () => {
        return loadBatchRenamePresets();
    });

    ipcMain.handle("batch-rename-save-preset", async (event, payload) => {
        const name = (payload && payload.name ? String(payload.name) : "").trim();
        const data = payload && payload.data ? payload.data : null;
        if (!name || !data) {
            return loadBatchRenamePresets();
        }

        const list = loadBatchRenamePresets();
        const existingIndex = list.findIndex(p => p && typeof p.name === "string" && p.name === name);
        const entry = { name, data, updatedAt: new Date().toISOString() };
        if (existingIndex >= 0) {
            list[existingIndex] = entry;
        } else {
            list.push(entry);
        }
        saveBatchRenamePresets(list);
        return list;
    });

    ipcMain.handle("batch-rename-delete-preset", async (event, payload) => {
        const name = (payload && payload.name ? String(payload.name) : "").trim();
        if (!name) {
            return loadBatchRenamePresets();
        }
        const list = loadBatchRenamePresets().filter(p => !(p && p.name === name));
        saveBatchRenamePresets(list);
        return list;
    });

    ipcMain.handle("batch-rename-set-hidden", async (event, payload) => {
        const targetPath = payload && payload.path ? String(payload.path) : "";
        const hidden = !!(payload && payload.hidden);
        if (!targetPath) {
            return { ok: false, error: "Percorso non valido" };
        }
        if (process.platform !== "win32") {
            return { ok: false, error: "Attributo nascosto supportato solo su Windows" };
        }

        return new Promise(resolve => {
            const flag = hidden ? "+H" : "-H";
            exec(`attrib ${flag} "${targetPath}"`, (err) => {
                if (err) {
                    log.error("[batch-rename] errore impostando attributo hidden:", targetPath, err);
                    resolve({ ok: false, error: err.message || String(err) });
                } else {
                    resolve({ ok: true });
                }
            });
        });
    });

    ipcMain.on("open-batch-rename-window", () => {
        openBatchRenameWindow(mainWindow);
    });

    ipcMain.on("open-qr-generator-window", () => {
        openQrGeneratorWindow(mainWindow);
    });

    ipcMain.on("open-compare-folders-window", () => {
        openCompareFoldersWindow(null, null);
    });

      ipcMain.on("open-hierarchy-window", () => {
          openHierarchyWindow(mainWindow);
      });

      ipcMain.on("open-timer-window", () => {
          openTimerWindow(mainWindow);
      });

    ipcMain.on("hierarchy-open-batch-rename", (event, payload) => {
        const folder = payload?.folder;
        openBatchRenameWindow(mainWindow);

        if (batchRenameWindow && !batchRenameWindow.isDestroyed() && folder) {
            batchRenameWindow.webContents.once("did-finish-load", () => {
                batchRenameWindow.webContents.send("batch-rename-set-root", folder);
            });
            batchRenameWindow.webContents.send("batch-rename-set-root", folder);
        }
    });

    ipcMain.on("hierarchy-compare-folder-A", (event, payload) => {
        openCompareFoldersWindow("A", payload?.folder);
    });

    ipcMain.on("hierarchy-compare-folder-B", (event, payload) => {
        openCompareFoldersWindow("B", payload?.folder);
    });

    ipcMain.handle("hierarchy-export-navigable-report", async (event, payload) => {
        try {
            const win = BrowserWindow.fromWebContents(event.sender) || mainWindow;

            if (!payload || !payload.data) {
                throw new Error("Dati report non validi.");
            }

            const data = payload.data;
            const rootPath = data.meta?.rootPath || "";
            const rootNameRaw = rootPath ? path.basename(rootPath.replace(/[\\/]+$/, "")) : "root";
            const rootName = rootNameRaw || "root";

            const result = await dialog.showSaveDialog(win, {
                title: "Salva report navigabile",
                defaultPath: `Report ${rootName}.html`,
                filters: [{ name: "File HTML", extensions: ["html"] }],
            });

            if (result.canceled || !result.filePath) {
                return { canceled: true };
            }

            const chosenDir = path.dirname(result.filePath);
            const reportDirName = `Report ${rootName}`;
            const reportDir = path.join(chosenDir, reportDirName);
            fs.mkdirSync(reportDir, { recursive: true });

              const htmlPath = path.join(reportDir, "report-gerarchia.html");
              const jsonPath = path.join(reportDir, "report-data.json");
              const jsPath = path.join(reportDir, "report.js");
              const cssPath = path.join(reportDir, "report.css");
              const chartPath = path.join(reportDir, "chart.umd.js");

              fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2), "utf8");

              try {
                  const templateDir = path.join(__dirname, "..", "templates");
                  const htmlTemplatePath = path.join(templateDir, "hierarchy-report.html");
                  const cssTemplatePath = path.join(templateDir, "hierarchy-report.css");
                  const jsTemplatePath = path.join(templateDir, "hierarchy-report.js");

                  const htmlTemplate = fs.readFileSync(htmlTemplatePath, "utf8");
                  const cssContent = fs.readFileSync(cssTemplatePath, "utf8");
                  const jsTemplate = fs.readFileSync(jsTemplatePath, "utf8");

                  const jsContent =
                      "const REPORT_DATA = " +
                      JSON.stringify(data, null, 2) +
                      ";\n\n" +
                      jsTemplate;

                  fs.writeFileSync(htmlPath, htmlTemplate, "utf8");
                  fs.writeFileSync(cssPath, cssContent, "utf8");
                  fs.writeFileSync(jsPath, jsContent, "utf8");

                  try {
                      const chartMainPath = require.resolve("chart.js");
                      const chartSrcPath = path.join(path.dirname(chartMainPath), "chart.umd.js");
                      fs.copyFileSync(chartSrcPath, chartPath);
                  } catch (chartErr) {
                      log.warn("[hierarchy] impossibile copiare chart.js per il report navigabile:", chartErr);
                  }

                  return {
                      canceled: false,
                      htmlPath,
                      jsonPath,
                  };
              } catch (templateErr) {
                  log.error("[hierarchy] errore durante la generazione del report navigabile da template:", templateErr);
              }

              const htmlContent = buildHierarchyReportHtml();
              const cssContent = buildHierarchyReportCss();
              const jsContent = buildHierarchyReportJs(data);

              fs.writeFileSync(htmlPath, htmlContent, "utf8");
              fs.writeFileSync(cssPath, cssContent, "utf8");
              fs.writeFileSync(jsPath, jsContent, "utf8");

            return {
                canceled: false,
                htmlPath,
                jsonPath,
            };
        } catch (err) {
            log.error("[hierarchy] export-navigable-report error", err);
            return {
                canceled: false,
                error: err.message || String(err),
            };
        }
    });
}

module.exports = { setupFileManager, openTimerWindow };
