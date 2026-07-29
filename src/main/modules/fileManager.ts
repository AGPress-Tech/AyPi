// Gestione finestre e IPC lato main per AyPi

import { ipcMain, dialog, shell, BrowserWindow, app, screen } from "electron";
import path from "path";
import fs from "fs";
import log from "electron-log";
import { requestAypiBackend } from "./file-manager/backend-client";
import { registerBatchRenameIpc } from "./file-manager/batch-rename-ipc";
import { registerHierarchyReportIpc } from "./file-manager/hierarchy-report-ipc";
import { isDl360ServerReachable } from "./file-manager/network-files";
import {
    isSameDay,
    isYoungerThanMinutes,
    startOfWeekMonday,
    toDateKey,
} from "./file-manager/git-date-utils";
import {
    readGitStatsSnapshot,
    readGitflowSnapshot,
    writeGitStatsSnapshot,
    writeGitflowSnapshot,
} from "./file-manager/git-snapshots";
import {
    fetchGithubCommits,
    fetchGithubDiffTotalsForCommits,
    fetchGithubJson as fetchJson,
    fetchGithubTags,
    readSharedGithubToken,
    resolveGithubTagCommit,
} from "./file-manager/github-client";
import { registerAttrezzaggioDataIpc } from "./file-manager/attrezzaggio-data-ipc";
import { registerProductionPlannerIpc } from "./file-manager/production-planner-ipc";
import { setupRealtimeClient } from "./file-manager/realtime-client";
import { registerFilesystemDialogIpc } from "./file-manager/filesystem-dialog-ipc";
import { registerFileNavigationIpc } from "./file-manager/file-navigation-ipc";
import { registerAdminStateIpc } from "./file-manager/admin-state-ipc";
import {
    createProductManagerSessionState,
    registerProductManagerSessionIpc,
} from "./file-manager/product-manager-session";
import { registerFeriePermessiConfigIpc } from "./file-manager/ferie-permessi-config-ipc";
import { registerNativeAppIpc } from "./file-manager/native-app-ipc";
import {
    getGitDailyStats,
    getLocalWeekDiffTotals,
    registerLocalGitStatsIpc,
    resolveGitRepoRoot,
} from "./file-manager/local-git-stats";
import { registerMainWindowLayoutIpc } from "./file-manager/main-window-layout-ipc";
import { registerAttrezzaggioPdfPreviewIpc } from "./file-manager/attrezzaggio-pdf-preview-ipc";

const WINDOW_WEB_PREFERENCES = {
    nodeIntegration: true,
    contextIsolation: false,
};

const STANDARD_APP_ICON_PATH = path.join(
    __dirname,
    "..",
    "assets",
    "app-icon.png",
);
const STANDARD_APP_TRAY_ICON_PATH = path.join(
    __dirname,
    "..",
    "assets",
    "app-icon.ico",
);
const BLUE_ARCHIVE_APP_ICON_PATH = path.join(
    __dirname,
    "..",
    "assets",
    "app-icon-bluearchive.png",
);
const BLUE_ARCHIVE_APP_TRAY_ICON_PATH = path.join(
    __dirname,
    "..",
    "assets",
    "app-icon-bluearchive.ico",
);
let APP_ICON_PATH = STANDARD_APP_ICON_PATH;
let interfaceIconTheme: "standard" | "bluearchive" = "standard";

function getInterfaceIconPath(forTray = false) {
    if (interfaceIconTheme === "bluearchive") {
        const blueArchivePath =
            process.platform === "win32"
                ? BLUE_ARCHIVE_APP_TRAY_ICON_PATH
                : BLUE_ARCHIVE_APP_ICON_PATH;
        if (fs.existsSync(blueArchivePath)) return blueArchivePath;
    }
    return process.platform === "win32"
        ? STANDARD_APP_TRAY_ICON_PATH
        : STANDARD_APP_ICON_PATH;
}

function applyInterfaceIconToWindow(win: BrowserWindow) {
    if (!win || win.isDestroyed()) return;
    const iconPath = getInterfaceIconPath(false);
    try {
        if (process.platform === "win32") {
            win.setAppDetails({
                appId:
                    interfaceIconTheme === "bluearchive"
                        ? "com.Agpress.AyPi.BlueArchive"
                        : "com.Agpress.AyPi",
            });
        }
        win.setIcon(iconPath);
    } catch (err) {
        log.warn("[interface-icon] impossibile aggiornare finestra:", err);
    }
}

function setInterfaceIconTheme(theme: "standard" | "bluearchive") {
    interfaceIconTheme = theme === "bluearchive" ? "bluearchive" : "standard";
    APP_ICON_PATH = getInterfaceIconPath(false);
    BrowserWindow.getAllWindows().forEach(applyInterfaceIconToWindow);
}
function handleServerUnavailableForModule(
    mainWindow: BrowserWindow,
    moduleWindow?: BrowserWindow | null,
) {
    dialog.showMessageBoxSync(mainWindow, {
        type: "warning",
        buttons: ["Ok"],
        title: "Server Non Raggiungibile",
        message:
            "Il server DL360 non è disponibile. Verificare la connessione.",
    });
    if (isWindowAlive(moduleWindow)) {
        suppressTicketWindowChaining = true;
        moduleWindow.close();
        suppressTicketWindowChaining = false;
    }
    showMainWindow(mainWindow);
}

async function guardServerAndOpenModule(
    mainWindow: BrowserWindow,
    moduleWindow: BrowserWindow | null,
    openFn: () => void,
) {
    const reachable = await isDl360ServerReachable();
    if (!reachable) {
        handleServerUnavailableForModule(mainWindow, moduleWindow);
        return;
    }
    openFn();
}

async function fetchGithubStats(owner: string, repo: string, token?: string) {
    const base = `https://api.github.com/repos/${owner}/${repo}`;
    const retry = async (url: string, attempts = 8) => {
        for (let i = 0; i < attempts; i += 1) {
            const res = await fetchJson(url, token);
            if (res && res.__pending) {
                const delay = Math.min(1200 + i * 600, 5000);
                log.warn("[github-stats] pending (202), retrying", {
                    url,
                    attempt: i + 1,
                    delayMs: delay,
                });
                await new Promise((resolve) => setTimeout(resolve, delay));
                continue;
            }
            return res;
        }
        log.warn("[github-stats] pending (202) after retries, giving up", {
            url,
            attempts,
        });
        return [];
    };

    const [codeFrequency, commitActivity, tags] = await Promise.all([
        retry(`${base}/stats/code_frequency`),
        retry(`${base}/stats/commit_activity`),
        fetchJson(`${base}/tags?per_page=100`, token),
    ]);

    const commitsByWeek = new Map<number, number>();
    const commitActivityList = Array.isArray(commitActivity)
        ? commitActivity
        : [];
    const codeFrequencyList = Array.isArray(codeFrequency) ? codeFrequency : [];
    if (!codeFrequencyList.length) {
        log.warn("[github-stats] code_frequency empty", { owner, repo });
    }
    if (!commitActivityList.length) {
        log.warn("[github-stats] commit_activity empty", { owner, repo });
    }

    commitActivityList.forEach((entry) => {
        if (!entry || typeof entry.week !== "number") return;
        commitsByWeek.set(entry.week, entry.total || 0);
    });

    let data = codeFrequencyList.map((entry) => {
        const week = entry[0];
        const additions = entry[1] || 0;
        const deletions = Math.abs(entry[2] || 0);
        // GitHub stats weeks are anchored to Sunday (UTC). Shift to Monday to match UI week labels.
        const weekDate = new Date((week + 86400) * 1000);
        return {
            date: weekDate.toISOString().slice(0, 10),
            additions,
            deletions,
            commits: commitsByWeek.get(week) || 0,
        };
    });
    let warning: string | undefined;
    if (!commitActivityList.length && data.length) {
        try {
            const minWeek = data[0]?.date
                ? new Date(`${data[0].date}T00:00:00Z`)
                : null;
            const minDate =
                minWeek && !Number.isNaN(minWeek.getTime())
                    ? minWeek
                    : undefined;
            const commitList = await fetchGithubCommits(
                owner,
                repo,
                token,
                5000,
                minDate,
            );
            const commitCounts = new Map<string, number>();
            commitList.forEach((entry) => {
                const date = new Date(entry.date);
                if (Number.isNaN(date.getTime())) return;
                const key = toDateKey(startOfWeekMonday(date));
                commitCounts.set(key, (commitCounts.get(key) || 0) + 1);
            });
            data.forEach((row) => {
                const rowDate = new Date(`${row.date}T00:00:00Z`);
                const key = Number.isNaN(rowDate.getTime())
                    ? row.date
                    : toDateKey(startOfWeekMonday(rowDate));
                row.commits = commitCounts.get(key) || 0;
            });
            warning = warning || "commit-activity-fallback";
        } catch {
            warning = "commit-activity-empty";
        }
    }
    if (!data.length) {
        try {
            const commitList = await fetchGithubCommits(
                owner,
                repo,
                token,
                5000,
            );
            const commitCounts = new Map<string, number>();
            commitList.forEach((entry) => {
                const date = new Date(entry.date);
                if (Number.isNaN(date.getTime())) return;
                const key = toDateKey(startOfWeekMonday(date));
                commitCounts.set(key, (commitCounts.get(key) || 0) + 1);
            });
            const weeks = Array.from(commitCounts.keys()).sort();
            data = weeks.map((week) => ({
                date: week,
                additions: 0,
                deletions: 0,
                commits: commitCounts.get(week) || 0,
            }));
            warning =
                warning ||
                (data.length
                    ? "commit-activity-fallback"
                    : "commit-activity-empty");
        } catch {
            warning = warning || "commit-activity-empty";
        }
    }

    // include current (incomplete) week commit count
    if (data.length) {
        const lastDate = new Date(`${data[data.length - 1].date}T00:00:00Z`);
        const lastWeekStart = Number.isNaN(lastDate.getTime())
            ? null
            : startOfWeekMonday(lastDate);
        const nowWeekStart = startOfWeekMonday(new Date());
        if (
            !lastWeekStart ||
            nowWeekStart.getTime() > lastWeekStart.getTime()
        ) {
            let weekCommits = 0;
            let weekAdditions = 0;
            let weekDeletions = 0;
            try {
                const sinceDate = nowWeekStart;
                const recentCommits = await fetchGithubCommits(
                    owner,
                    repo,
                    token,
                    800,
                    sinceDate,
                );
                weekCommits = recentCommits.filter((entry) => {
                    const time = new Date(entry.date).getTime();
                    return !Number.isNaN(time) && time >= sinceDate.getTime();
                }).length;
                const currentWeekCommits = recentCommits.filter((entry) => {
                    const time = new Date(entry.date).getTime();
                    return !Number.isNaN(time) && time >= sinceDate.getTime();
                });
                // Prefer local git diff totals when available (faster and more accurate in dev/runtime with repo).
                const localTotals = getLocalWeekDiffTotals(
                    nowWeekStart,
                    app.getAppPath(),
                );
                if (localTotals.additions > 0 || localTotals.deletions > 0) {
                    weekAdditions = localTotals.additions;
                    weekDeletions = localTotals.deletions;
                } else if (currentWeekCommits.length) {
                    const remoteTotals = await fetchGithubDiffTotalsForCommits(
                        owner,
                        repo,
                        currentWeekCommits,
                        token,
                    );
                    weekAdditions = remoteTotals.additions;
                    weekDeletions = remoteTotals.deletions;
                }
            } catch (err) {
                log.warn("[github-stats] current week commits fetch failed", {
                    owner,
                    repo,
                    error: err?.message || String(err),
                });
            }
            data.push({
                date: toDateKey(nowWeekStart),
                additions: weekAdditions,
                deletions: weekDeletions,
                commits: weekCommits,
            });
            warning = warning || "commit-week-partial";
        } else {
            // Week already present from GitHub stats: enrich current week diffs when GitHub returns stale/zero code_frequency.
            const lastRow = data[data.length - 1];
            if (lastRow && (Number(lastRow.commits || 0) > 0)) {
                const hasDiff =
                    Number(lastRow.additions || 0) > 0 ||
                    Number(lastRow.deletions || 0) > 0;
                if (!hasDiff) {
                    const localTotals = getLocalWeekDiffTotals(
                        nowWeekStart,
                        app.getAppPath(),
                    );
                    if (
                        localTotals.additions > 0 ||
                        localTotals.deletions > 0
                    ) {
                        lastRow.additions = localTotals.additions;
                        lastRow.deletions = localTotals.deletions;
                        warning = warning || "code-frequency-local";
                    } else {
                        try {
                            const sinceDate = nowWeekStart;
                            const recentCommits = await fetchGithubCommits(
                                owner,
                                repo,
                                token,
                                800,
                                sinceDate,
                            );
                            const currentWeekCommits = recentCommits.filter(
                                (entry) => {
                                    const time = new Date(entry.date).getTime();
                                    return (
                                        !Number.isNaN(time) &&
                                        time >= sinceDate.getTime()
                                    );
                                },
                            );
                            if (currentWeekCommits.length) {
                                const remoteTotals =
                                    await fetchGithubDiffTotalsForCommits(
                                        owner,
                                        repo,
                                        currentWeekCommits,
                                        token,
                                    );
                                lastRow.additions = remoteTotals.additions;
                                lastRow.deletions = remoteTotals.deletions;
                            }
                        } catch (err) {
                            log.warn(
                                "[github-stats] current week diff enrichment failed",
                                {
                                    owner,
                                    repo,
                                    error: err?.message || String(err),
                                },
                            );
                        }
                    }
                }
            }
        }
    }

    const tagList = Array.isArray(tags) ? tags.slice(0, 50) : [];
    const tagDetails = await Promise.all(
        tagList.map(async (tag) => {
            const sha = tag?.commit?.sha;
            if (!sha) return null;
            const resolved = await resolveGithubTagCommit(base, sha, token);
            return resolved ? { name: tag.name, date: resolved.date } : null;
        }),
    );

    const tagPayload = tagDetails.filter(Boolean);

    return {
        ok: true,
        fetchedAt: new Date().toISOString(),
        data,
        tags: tagPayload,
        warning,
    };
}

function animateResize(
    mainWindow: BrowserWindow,
    targetWidth: number,
    targetHeight: number,
    duration = 100,
) {
    if (!mainWindow) return;

    const [startWidth, startHeight] = mainWindow.getSize();
    const steps = 20;
    const stepDuration = duration / steps;
    let currentStep = 0;

    const interval = setInterval(() => {
        currentStep++;
        const progress = currentStep / steps;

        const newWidth = Math.round(
            startWidth + (targetWidth - startWidth) * progress,
        );
        const newHeight = Math.round(
            startHeight + (targetHeight - startHeight) * progress,
        );

        mainWindow.setSize(newWidth, newHeight);

        if (currentStep >= steps) {
            clearInterval(interval);
            mainWindow.setSize(targetWidth, targetHeight);
            mainWindow.center();
        }
    }, stepDuration);
}

function isWindowAlive(
    win: BrowserWindow | null | undefined,
): win is BrowserWindow {
    return !!win && !win.isDestroyed();
}

function mainWindowUsesBlueArchiveLayout(mainWindow: BrowserWindow) {
    if (!isWindowAlive(mainWindow) || mainWindow.webContents.isDestroyed()) {
        return false;
    }
    try {
        return decodeURIComponent(mainWindow.webContents.getURL())
            .toLowerCase()
            .includes("bluearchive-preview.html");
    } catch {
        return false;
    }
}

function showMainWindow(mainWindow: BrowserWindow) {
    if (!isWindowAlive(mainWindow)) return;
    if (mainWindow.isMinimized()) {
        mainWindow.restore();
    }
    mainWindow.show();
    mainWindow.focus();
}

function showWindow(win: BrowserWindow) {
    if (!isWindowAlive(win)) return;
    win.show();
    win.focus();
}

function hasAnyProductOrTicketWindow() {
    return [
        productManagerWindow,
        productManagerCartWindow,
        productManagerInterventionsWindow,
        ticketSupportWindow,
        ticketSupportAdminWindow,
    ].some((win) => isWindowAlive(win));
}

function broadcastProductManagerSession(payload) {
    [
        productManagerWindow,
        productManagerCartWindow,
        productManagerInterventionsWindow,
        ticketSupportWindow,
        ticketSupportAdminWindow,
    ].forEach((win) => {
        if (isWindowAlive(win)) {
            win.webContents.send("pm-session-updated", payload || null);
        }
    });
}

function buildHierarchyReportHtml() {
    return (
        "<!DOCTYPE html>\n" +
        '<html lang="it">\n' +
        "<head>\n" +
        '  <meta charset="UTF-8">\n' +
        "  <title>Report gerarchia file</title>\n" +
        '  <link rel="stylesheet" href="./report.css">\n' +
        "</head>\n" +
        "<body>\n" +
        "  <header>\n" +
        "    <h1>Report gerarchia file</h1>\n" +
        '    <div id="metaInfo" class="meta-info"></div>\n' +
        "  </header>\n" +
        '  <main class="layout">\n' +
        '    <aside class="sidebar">\n' +
        "      <h2>Gerarchia</h2>\n" +
        '      <input id="treeFilter" placeholder="Filtra per nome/percorso...">\n' +
        '      <div id="treeContainer" class="tree-container"></div>\n' +
        "    </aside>\n" +
        '    <section class="content">\n' +
        "      <section>\n" +
        "        <h2>Statistiche generali</h2>\n" +
        '        <div id="globalStats"></div>\n' +
        "      </section>\n" +
        '      <section class="top-row">\n' +
        '        <div class="top-col">\n' +
        "          <h2>Top cartelle piÇû pesanti</h2>\n" +
        '          <div class="table-wrapper">\n' +
        '            <table id="topFoldersTable" class="data-table"></table>\n' +
        "          </div>\n" +
        "        </div>\n" +
        '        <div class="top-col">\n' +
        "          <h2>Top file piÇû grandi</h2>\n" +
        '          <div class="table-wrapper">\n' +
        '            <table id="topFilesTable" class="data-table"></table>\n' +
        "          </div>\n" +
        "        </div>\n" +
        "      </section>\n" +
        '      <section id="detailsPanel">\n' +
        "        <h2>Dettagli elemento</h2>\n" +
        '        <div id="detailsContent" class="details-content">Seleziona un elemento dall\'albero o dalle tabelle.</div>\n' +
        "      </section>\n" +
        "    </section>\n" +
        "  </main>\n" +
        '  <script src="./report.js"></script>\n' +
        "</body>\n" +
        "</html>\n"
    );
}

function buildHierarchyReportCss() {
    return (
        "html, body {\n" +
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
        "}\n"
    );
}

function buildHierarchyReportJs(data) {
    const serialized = JSON.stringify(data, null, 2);
    return (
        '"use strict";\n\n' +
        "const REPORT_DATA = " +
        serialized +
        ";\n\n" +
        "function formatBytes(bytes) {\n" +
        '  if (!bytes || !isFinite(bytes) || bytes <= 0) return "0 B";\n' +
        '  var units = ["B", "KB", "MB", "GB", "TB"];\n' +
        "  var idx = 0;\n" +
        "  var val = bytes;\n" +
        "  while (val >= 1024 && idx < units.length - 1) {\n" +
        "    val /= 1024;\n" +
        "    idx++;\n" +
        "  }\n" +
        '  return val.toFixed(1) + " " + units[idx];\n' +
        "}\n\n" +
        "function buildTree(node, container) {\n" +
        "  if (!node) return;\n" +
        '  var wrapper = document.createElement("div");\n' +
        '  wrapper.className = "tree-node " + node.type;\n' +
        '  var icon = document.createElement("span");\n' +
        '  icon.className = "node-icon";\n' +
        '  icon.textContent = node.type === "folder" ? "\\u25B6" : "\\u2022";\n' +
        "  wrapper.appendChild(icon);\n" +
        '  var label = document.createElement("span");\n' +
        '  label.className = "label";\n' +
        '  label.textContent = node.name || "(senza nome)";\n' +
        "  wrapper.appendChild(label);\n" +
        '  wrapper.addEventListener("click", function (e) {\n' +
        "    e.stopPropagation();\n" +
        '    document.querySelectorAll(".tree-node.selected").forEach(function (n) {\n' +
        '      n.classList.remove("selected");\n' +
        "    });\n" +
        '    wrapper.classList.add("selected");\n' +
        "    showDetails(node);\n" +
        '    if (node.type === "folder") {\n' +
        '      var isOpen = wrapper.classList.toggle("open");\n' +
        '      icon.textContent = isOpen ? "\\u25BC" : "\\u25B6";\n' +
        "    }\n" +
        "  });\n" +
        "  container.appendChild(wrapper);\n" +
        "  if (node.children && node.children.length > 0) {\n" +
        '    var childrenEl = document.createElement("div");\n' +
        '    childrenEl.className = "tree-children";\n' +
        "    node.children.forEach(function (child) {\n" +
        "      buildTree(child, childrenEl);\n" +
        "    });\n" +
        "    container.appendChild(childrenEl);\n" +
        "  }\n" +
        "}\n\n" +
        "function renderGlobalStats(data) {\n" +
        '  var el = document.getElementById("globalStats");\n' +
        "  if (!el || !data.globalStats) return;\n" +
        "  var gs = data.globalStats;\n" +
        '  var html = "";\n' +
        '  html += "<p><b>Cartelle:</b> " + (gs.totalFolders || 0) + "</p>";\n' +
        '  html += "<p><b>File:</b> " + (gs.totalFiles || 0) + "</p>";\n' +
        '  html += "<p><b>Spazio totale:</b> " + formatBytes(gs.totalSizeBytes || 0) + "</p>";\n' +
        '  html += "<p><b>ProfonditÇÿ massima:</b> " + (gs.maxDepth || 0) + "</p>";\n' +
        "  el.innerHTML = html;\n" +
        "}\n\n" +
        "function renderTopTable(tableId, rows, columns) {\n" +
        "  var table = document.getElementById(tableId);\n" +
        "  if (!table) return;\n" +
        '  table.innerHTML = "";\n' +
        '  var thead = document.createElement("thead");\n' +
        '  var trHead = document.createElement("tr");\n' +
        "  columns.forEach(function (col) {\n" +
        '    var th = document.createElement("th");\n' +
        "    th.textContent = col.label;\n" +
        "    trHead.appendChild(th);\n" +
        "  });\n" +
        "  thead.appendChild(trHead);\n" +
        "  table.appendChild(thead);\n" +
        '  var tbody = document.createElement("tbody");\n' +
        "  (rows || []).forEach(function (row) {\n" +
        '    var tr = document.createElement("tr");\n' +
        '    tr.addEventListener("click", function () {\n' +
        "      showDetails({ name: row.name, fullPath: row.fullPath, sizeBytes: row.sizeBytes || row.totalSizeBytes });\n" +
        "    });\n" +
        "    columns.forEach(function (col) {\n" +
        '      var td = document.createElement("td");\n' +
        "      var v = row[col.field];\n" +
        '      if (col.field.indexOf("Bytes") !== -1) {\n' +
        "        v = formatBytes(v || 0);\n" +
        "      }\n" +
        '      td.textContent = v != null ? v : "";\n' +
        "      tr.appendChild(td);\n" +
        "    });\n" +
        "    tbody.appendChild(tr);\n" +
        "  });\n" +
        "  table.appendChild(tbody);\n" +
        "}\n\n" +
        "function showDetails(node) {\n" +
        '  var el = document.getElementById("detailsContent");\n' +
        "  if (!el) return;\n" +
        '  var html = "";\n' +
        '  html += "<p><b>Nome:</b> " + (node.name || "(senza nome)") + "</p>";\n' +
        "  if (node.fullPath) {\n" +
        '    html += "<p><b>Percorso completo:</b><br><span style=\'font-size:12px;\'>" + node.fullPath + "</span></p>";\n' +
        "  }\n" +
        '  if (typeof node.sizeBytes === "number") {\n' +
        '    html += "<p><b>Dimensione:</b> " + formatBytes(node.sizeBytes) + "</p>";\n' +
        "  }\n" +
        "  el.innerHTML = html;\n" +
        "}\n\n" +
        "function applyTreeFilter(query) {\n" +
        '  var q = (query || "").toLowerCase();\n' +
        '  var nodes = document.querySelectorAll(".tree-node");\n' +
        "  nodes.forEach(function (nodeEl) {\n" +
        '    var labelEl = nodeEl.querySelector(".label");\n' +
        '    var text = labelEl ? labelEl.textContent.toLowerCase() : "";\n' +
        "    var match = !q || text.indexOf(q) !== -1;\n" +
        '    nodeEl.style.display = match ? "" : "none";\n' +
        "  });\n" +
        "}\n\n" +
        "function initReport() {\n" +
        "  var data = REPORT_DATA || {};\n" +
        "  var meta = data.meta || {};\n" +
        '  var metaEl = document.getElementById("metaInfo");\n' +
        "  if (metaEl) {\n" +
        '    var when = meta.generatedAt ? new Date(meta.generatedAt).toLocaleString() : "";\n' +
        '    var root = meta.rootPath || "(percorso sconosciuto)";\n' +
        '    metaEl.textContent = root + " - generato il " + when;\n' +
        "  }\n" +
        '  var treeContainer = document.getElementById("treeContainer");\n' +
        "  if (treeContainer && data.hierarchy) {\n" +
        "    buildTree(data.hierarchy, treeContainer);\n" +
        "  }\n" +
        "  renderGlobalStats(data);\n" +
        "  if (Array.isArray(data.topFolders)) {\n" +
        '    renderTopTable("topFoldersTable", data.topFolders, [\n' +
        '      { field: "name", label: "Cartella" },\n' +
        '      { field: "totalSizeBytes", label: "Dimensione" },\n' +
        '      { field: "filesCount", label: "File" },\n' +
        '      { field: "foldersCount", label: "Cartelle" }\n' +
        "    ]);\n" +
        "  }\n" +
        "  if (Array.isArray(data.topFiles)) {\n" +
        '    renderTopTable("topFilesTable", data.topFiles, [\n' +
        '      { field: "name", label: "File" },\n' +
        '      { field: "sizeBytes", label: "Dimensione" }\n' +
        "    ]);\n" +
        "  }\n" +
        '  var filterEl = document.getElementById("treeFilter");\n' +
        "  if (filterEl) {\n" +
        '    filterEl.addEventListener("input", function () {\n' +
        "      applyTreeFilter(filterEl.value);\n" +
        "    });\n" +
        '    filterEl.addEventListener("keydown", function (e) {\n' +
        '      if (e.key === "Enter") {\n' +
        "        e.preventDefault();\n" +
        "        applyTreeFilter(filterEl.value);\n" +
        "      }\n" +
        "    });\n" +
        "  }\n" +
        "}\n\n" +
        'document.addEventListener("DOMContentLoaded", initReport);\n'
    );
}

let batchRenameWindow: BrowserWindow | null = null;
let batchRenameWindowTheme: "standard" | "bluearchive" = "standard";
let fileListWindow: BrowserWindow | null = null;
let fileListWindowTheme: "standard" | "bluearchive" = "standard";
let qrGeneratorWindow: BrowserWindow | null = null;
let qrGeneratorWindowTheme: "standard" | "bluearchive" = "standard";
let compareFoldersWindow: BrowserWindow | null = null;
let compareFoldersWindowTheme: "standard" | "bluearchive" = "standard";
let hierarchyWindow: BrowserWindow | null = null;
let hierarchyWindowTheme: "standard" | "bluearchive" = "standard";
let timerWindow: BrowserWindow | null = null;
let timerWindowTheme: "standard" | "bluearchive" = "standard";
let infographicsWindow: BrowserWindow | null = null;
let gitflowWindow: BrowserWindow | null = null;
let productionPlannerWindow: BrowserWindow | null = null;
let productionPlannerAnalysisWindow: BrowserWindow | null = null;
let feriePermessiWindow: BrowserWindow | null = null;
let feriePermessiWindowTheme: "standard" | "bluearchive" = "standard";
let feriePermessiHoursWindow: BrowserWindow | null = null;
let feriePermessiHoursWindowTheme: "standard" | "bluearchive" = "standard";
let feriePermessiAnalysisWindow: BrowserWindow | null = null;
let feriePermessiAnalysisWindowTheme: "standard" | "bluearchive" = "standard";
let productManagerWindow: BrowserWindow | null = null;
let productManagerCartWindow: BrowserWindow | null = null;
let productManagerInterventionsWindow: BrowserWindow | null = null;
let productManagerWindowTheme: "standard" | "bluearchive" = "standard";
let productManagerCartWindowTheme: "standard" | "bluearchive" = "standard";
let productManagerInterventionsWindowTheme: "standard" | "bluearchive" =
    "standard";
let ticketSupportWindow: BrowserWindow | null = null;
let ticketSupportAdminWindow: BrowserWindow | null = null;
let ticketSupportWindowTheme: "standard" | "bluearchive" = "standard";
let ticketSupportAdminWindowTheme: "standard" | "bluearchive" = "standard";
let assigneesManagerWindow: BrowserWindow | null = null;
let assigneesManagerWindowTheme: "standard" | "bluearchive" = "standard";
let adminManagerWindow: BrowserWindow | null = null;
let adminManagerWindowTheme: "standard" | "bluearchive" = "standard";
let transferAttrezzaggioWindow: BrowserWindow | null = null;
let allowTransferAttrezzaggioWindowClose = false;
let transferAttrezzaggioClosePromptPending = false;
const productManagerSessionState = createProductManagerSessionState();
let suppressTicketWindowChaining = false;
let feriePermessiSplashShown = false;
let productManagerSplashShown = false;
let ticketSupportSplashShown = false;
let isAppQuitting = false;

function openFileListWindow(
    mainWindow,
    options: { theme?: "standard" | "bluearchive" } = {},
) {
    const requestedTheme =
        options.theme === "bluearchive" ? "bluearchive" : "standard";
    if (isWindowAlive(fileListWindow)) {
        if (fileListWindowTheme !== requestedTheme) {
            fileListWindowTheme = requestedTheme;
            fileListWindow.loadFile(
                path.join(__dirname, "..", "pages", "utilities", "file-list.html"),
                { query: { theme: fileListWindowTheme } },
            );
        }
        showWindow(fileListWindow);
        return;
    }

    fileListWindowTheme = requestedTheme;
    fileListWindow = new BrowserWindow({
        width: 1000,
        height: 760,
        minWidth: requestedTheme === "bluearchive" ? 780 : 680,
        minHeight: requestedTheme === "bluearchive" ? 620 : 520,
        parent: mainWindow,
        modal: false,
        webPreferences: WINDOW_WEB_PREFERENCES,
        icon: APP_ICON_PATH,
    });
    fileListWindow.loadFile(
        path.join(__dirname, "..", "pages", "utilities", "file-list.html"),
        { query: { theme: fileListWindowTheme } },
    );
    fileListWindow.setMenu(null);
    fileListWindow.center();
    fileListWindow.on("closed", () => {
        fileListWindow = null;
        fileListWindowTheme = "standard";
        showMainWindow(mainWindow);
    });
}

function openBatchRenameWindow(
    mainWindow,
    options: { theme?: "standard" | "bluearchive" } = {},
) {
    const requestedTheme =
        options.theme === "bluearchive" ? "bluearchive" : "standard";
    if (isWindowAlive(batchRenameWindow)) {
        if (batchRenameWindowTheme !== requestedTheme) {
            batchRenameWindowTheme = requestedTheme;
            batchRenameWindow.loadFile(
                path.join(__dirname, "..", "pages", "utilities", "batch-rename.html"),
                { query: { theme: batchRenameWindowTheme } },
            );
        }
        showWindow(batchRenameWindow);
        return;
    }

    batchRenameWindowTheme = requestedTheme;
    batchRenameWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        parent: mainWindow,
        modal: false,
        webPreferences: WINDOW_WEB_PREFERENCES,
        icon: APP_ICON_PATH,
    });

    batchRenameWindow.loadFile(
        path.join(__dirname, "..", "pages", "utilities", "batch-rename.html"),
        { query: { theme: batchRenameWindowTheme } },
    );
    batchRenameWindow.setMenu(null);

    // Apertura in modalità "fullscreen windowed" (massimizzata)
    batchRenameWindow.once("ready-to-show", () => {
        if (!batchRenameWindow.isDestroyed()) {
            batchRenameWindow.maximize();
        }
    });

    batchRenameWindow.on("closed", () => {
        batchRenameWindow = null;
        batchRenameWindowTheme = "standard";
        showMainWindow(mainWindow);
    });
}

function openQrGeneratorWindow(
    mainWindow,
    options: { theme?: "standard" | "bluearchive" } = {},
) {
    const requestedTheme =
        options.theme === "bluearchive" ? "bluearchive" : "standard";
    if (isWindowAlive(qrGeneratorWindow)) {
        if (qrGeneratorWindowTheme !== requestedTheme) {
            qrGeneratorWindowTheme = requestedTheme;
            qrGeneratorWindow.loadFile(
                path.join(__dirname, "..", "pages", "utilities", "qr-generator.html"),
                { query: { theme: qrGeneratorWindowTheme } },
            );
        }
        showWindow(qrGeneratorWindow);
        return;
    }

    qrGeneratorWindowTheme = requestedTheme;
    qrGeneratorWindow = new BrowserWindow({
        width: 900,
        height: 800,
        parent: mainWindow,
        modal: false,
        webPreferences: WINDOW_WEB_PREFERENCES,
        icon: APP_ICON_PATH,
    });

    qrGeneratorWindow.loadFile(
        path.join(__dirname, "..", "pages", "utilities", "qr-generator.html"),
        { query: { theme: qrGeneratorWindowTheme } },
    );
    qrGeneratorWindow.setMenu(null);
    qrGeneratorWindow.center();

    qrGeneratorWindow.on("closed", () => {
        qrGeneratorWindow = null;
        qrGeneratorWindowTheme = "standard";
        showMainWindow(mainWindow);
    });
}

function openHierarchyWindow(
    mainWindow,
    options: { theme?: "standard" | "bluearchive" } = {},
) {
    const requestedTheme =
        options.theme === "bluearchive" ? "bluearchive" : "standard";
    if (isWindowAlive(hierarchyWindow)) {
        if (hierarchyWindowTheme !== requestedTheme) {
            hierarchyWindowTheme = requestedTheme;
            hierarchyWindow.setMinimumSize(
                requestedTheme === "bluearchive" ? 980 : 0,
                requestedTheme === "bluearchive" ? 680 : 0,
            );
            hierarchyWindow.setSize(
                requestedTheme === "bluearchive" ? 1320 : 1100,
                requestedTheme === "bluearchive" ? 850 : 800,
            );
            hierarchyWindow.loadFile(
                path.join(__dirname, "..", "pages", "utilities", "hierarchy.html"),
                { query: { theme: hierarchyWindowTheme } },
            );
            hierarchyWindow.center();
        }
        showWindow(hierarchyWindow);
        return;
    }

    hierarchyWindowTheme = requestedTheme;
    hierarchyWindow = new BrowserWindow({
        width: requestedTheme === "bluearchive" ? 1320 : 1100,
        height: requestedTheme === "bluearchive" ? 850 : 800,
        minWidth: requestedTheme === "bluearchive" ? 980 : undefined,
        minHeight: requestedTheme === "bluearchive" ? 680 : undefined,
        parent: mainWindow,
        modal: false,
        webPreferences: WINDOW_WEB_PREFERENCES,
        icon: APP_ICON_PATH,
    });

    hierarchyWindow.loadFile(
        path.join(__dirname, "..", "pages", "utilities", "hierarchy.html"),
        { query: { theme: hierarchyWindowTheme } },
    );
    hierarchyWindow.setMenu(null);
    hierarchyWindow.center();

    hierarchyWindow.on("closed", () => {
        hierarchyWindow = null;
        hierarchyWindowTheme = "standard";
        showMainWindow(mainWindow);
    });
}

function openInfographicsWindow(mainWindow) {
    if (isWindowAlive(infographicsWindow)) {
        showWindow(infographicsWindow);
        return;
    }

    infographicsWindow = new BrowserWindow({
        width: 980,
        height: 640,
        parent: mainWindow,
        modal: false,
        webPreferences: WINDOW_WEB_PREFERENCES,
        icon: APP_ICON_PATH,
        backgroundColor: "#0f1115",
        show: false,
    });

    infographicsWindow.loadFile(
        path.join(__dirname, "..", "pages", "utilities", "infographics.html"),
    );
    infographicsWindow.setMenu(null);
    infographicsWindow.maximize();

    infographicsWindow.once("ready-to-show", () => {
        if (!infographicsWindow.isDestroyed()) {
            infographicsWindow.show();
        }
    });

    infographicsWindow.on("closed", () => {
        infographicsWindow = null;
        showMainWindow(mainWindow);
    });
}

function openGitflowWindow(mainWindow, options?: { force?: boolean }) {
    if (isWindowAlive(gitflowWindow)) {
        showWindow(gitflowWindow);
        return;
    }

    const workArea = screen.getPrimaryDisplay().workAreaSize;
    const targetWidth = Math.max(1000, Math.min(1800, workArea.width - 120));
    const targetHeight = Math.max(
        520,
        Math.min(820, Math.round(workArea.height * 0.75)),
    );

    gitflowWindow = new BrowserWindow({
        width: targetWidth,
        height: targetHeight,
        parent: mainWindow,
        modal: false,
        webPreferences: WINDOW_WEB_PREFERENCES,
        icon: APP_ICON_PATH,
        backgroundColor: "#0f1115",
    });

    const force = options && options.force ? "1" : "0";
    gitflowWindow.loadFile(
        path.join(__dirname, "..", "pages", "utilities", "gitflow.html"),
        {
            query: { force },
        },
    );
    gitflowWindow.setMenu(null);
    gitflowWindow.center();

    gitflowWindow.on("closed", () => {
        gitflowWindow = null;
        showMainWindow(mainWindow);
    });
}

function openTimerWindow(mainWindow, options: { theme?: string } = {}) {
    const requestedTheme = options.theme === "bluearchive" ? "bluearchive" : "standard";
    if (isWindowAlive(timerWindow)) {
        if (timerWindowTheme !== requestedTheme) {
            timerWindowTheme = requestedTheme;
            timerWindow.setSize(
                requestedTheme === "bluearchive" ? 740 : 520,
                requestedTheme === "bluearchive" ? 700 : 520,
            );
            timerWindow.loadFile(
                path.join(__dirname, "..", "pages", "utilities", "timers.html"),
                { query: { theme: requestedTheme } },
            );
            timerWindow.center();
        }
        showWindow(timerWindow);
        return;
    }

    timerWindowTheme = requestedTheme;
    timerWindow = new BrowserWindow({
        width: requestedTheme === "bluearchive" ? 740 : 520,
        height: requestedTheme === "bluearchive" ? 700 : 520,
        minWidth: requestedTheme === "bluearchive" ? 620 : undefined,
        minHeight: requestedTheme === "bluearchive" ? 560 : undefined,
        parent: mainWindow,
        modal: false,
        webPreferences: WINDOW_WEB_PREFERENCES,
        icon: APP_ICON_PATH,
    });

    timerWindow.loadFile(
        path.join(__dirname, "..", "pages", "utilities", "timers.html"),
        { query: { theme: requestedTheme } },
    );
    timerWindow.setMenu(null);
    timerWindow.center();

    timerWindow.on("close", (event) => {
        if (!isAppQuitting) {
            event.preventDefault();
            timerWindow.hide();
            showMainWindow(mainWindow);
        } else {
            timerWindow = null;
            timerWindowTheme = "standard";
        }
    });
}

function openProductionPlannerWindow() {
    if (isWindowAlive(productionPlannerWindow)) {
        showWindow(productionPlannerWindow);
        return;
    }

    productionPlannerWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        modal: false,
        webPreferences: WINDOW_WEB_PREFERENCES,
        icon: APP_ICON_PATH,
        show: false,
        backgroundColor: "#f4f7fb",
    });

    productionPlannerWindow.maximize();
    productionPlannerWindow.loadFile(
        path.join(
            __dirname,
            "..",
            "pages",
            "utilities",
            "production-planner.html",
        ),
    );
    productionPlannerWindow.setMenu(null);
    productionPlannerWindow.webContents.on(
        "console-message",
        (_event, level, message, line, sourceId) => {
            const payload = {
                level,
                message,
                line,
                source: sourceId,
            };
            if (level >= 2) {
                log.error("[production-planner:renderer] Console error.", payload);
                return;
            }
            log.debug("[production-planner:renderer] Console message.", payload);
        },
    );
    productionPlannerWindow.webContents.on(
        "did-fail-load",
        (_event, errorCode, errorDescription, validatedURL) => {
            log.error("[production-planner:renderer] Caricamento pagina fallito.", {
                errorCode,
                errorDescription,
                url: validatedURL,
            });
        },
    );
    productionPlannerWindow.webContents.on(
        "render-process-gone",
        (_event, details) => {
            log.error("[production-planner:renderer] Processo terminato.", details);
        },
    );

    productionPlannerWindow.once("ready-to-show", () => {
        if (!productionPlannerWindow.isDestroyed()) {
            productionPlannerWindow.show();
            productionPlannerWindow.focus();
        }
    });

    productionPlannerWindow.on("closed", () => {
        productionPlannerWindow = null;
    });
}

function openProductionPlannerAnalysisWindow() {
    if (isWindowAlive(productionPlannerAnalysisWindow)) {
        showWindow(productionPlannerAnalysisWindow);
        return;
    }

    productionPlannerAnalysisWindow = new BrowserWindow({
        width: 1360,
        height: 860,
        minWidth: 1080,
        minHeight: 680,
        modal: false,
        webPreferences: WINDOW_WEB_PREFERENCES,
        icon: APP_ICON_PATH,
        show: false,
        backgroundColor: "#edf4fa",
    });

    productionPlannerAnalysisWindow.maximize();
    productionPlannerAnalysisWindow.loadFile(
        path.join(
            __dirname,
            "..",
            "pages",
            "utilities",
            "production-planner-analysis.html",
        ),
    );
    productionPlannerAnalysisWindow.setMenu(null);

    productionPlannerAnalysisWindow.once("ready-to-show", () => {
        if (!productionPlannerAnalysisWindow?.isDestroyed()) {
            productionPlannerAnalysisWindow.show();
            productionPlannerAnalysisWindow.focus();
        }
    });

    productionPlannerAnalysisWindow.on("closed", () => {
        productionPlannerAnalysisWindow = null;
    });
}

function openFeriePermessiWindow(
    mainWindow,
    options: { theme?: "standard" | "bluearchive" } = {},
) {
    const nextTheme =
        options.theme === "bluearchive" ? "bluearchive" : "standard";
    if (isWindowAlive(feriePermessiWindow)) {
        if (feriePermessiWindowTheme !== nextTheme) {
            feriePermessiWindowTheme = nextTheme;
            feriePermessiWindow.loadFile(
                path.join(__dirname, "..", "pages", "utilities", "ferie-permessi.html"),
                {
                    query: {
                        fpSplash:
                            feriePermessiWindowTheme === "bluearchive"
                                ? "1"
                                : "0",
                        theme: feriePermessiWindowTheme,
                    },
                },
            );
        }
        showWindow(feriePermessiWindow);
        return;
    }

    feriePermessiWindowTheme = nextTheme;

    const shouldShowSplash =
        feriePermessiWindowTheme === "bluearchive" ||
        !feriePermessiSplashShown;
    feriePermessiSplashShown = true;

    feriePermessiWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        modal: false,
        webPreferences: WINDOW_WEB_PREFERENCES,
        icon: APP_ICON_PATH,
        show: false,
        backgroundColor: "#f6f8fc",
    });

    feriePermessiWindow.maximize();
    feriePermessiWindow.loadFile(
        path.join(__dirname, "..", "pages", "utilities", "ferie-permessi.html"),
        {
            query: {
                fpSplash: shouldShowSplash ? "1" : "0",
                theme: feriePermessiWindowTheme,
            },
        },
    );
    feriePermessiWindow.setMenu(null);

    feriePermessiWindow.once("ready-to-show", () => {
        if (!feriePermessiWindow.isDestroyed()) {
            feriePermessiWindow.show();
        }
    });

    feriePermessiWindow.on("closed", () => {
        feriePermessiWindow = null;
        feriePermessiWindowTheme = "standard";
        showMainWindow(mainWindow);
    });
}

function openProductManagerWindow(
    mainWindow,
    options: { theme?: "standard" | "bluearchive" } = {},
) {
    const requestedTheme =
        options.theme === "bluearchive" ? "bluearchive" : "standard";
    if (isWindowAlive(productManagerWindow)) {
        productManagerWindowTheme = requestedTheme;
        productManagerWindow.loadFile(
            path.join(
                __dirname,
                "..",
                "pages",
                "utilities",
                "product-manager.html",
            ),
            {
                query: {
                    pmSplash: "0",
                    theme: productManagerWindowTheme,
                },
            },
        );
        showWindow(productManagerWindow);
        return;
    }
    if (!hasAnyProductOrTicketWindow()) {
        productManagerSessionState.clear({ forceLogout: true });
    }

    productManagerWindowTheme = requestedTheme;
    productManagerWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: WINDOW_WEB_PREFERENCES,
        icon: APP_ICON_PATH,
        show: false,
        backgroundColor:
            productManagerWindowTheme === "bluearchive"
                ? "#edf9ff"
                : "#f4f2ef",
    });

    productManagerWindow.maximize();
    const shouldShowSplash =
        productManagerWindowTheme === "standard" &&
        !productManagerSplashShown;
    if (productManagerWindowTheme === "standard") {
        productManagerSplashShown = true;
    }
    productManagerWindow.loadFile(
        path.join(
            __dirname,
            "..",
            "pages",
            "utilities",
            "product-manager.html",
        ),
        {
            query: {
                pmSplash: shouldShowSplash ? "1" : "0",
                theme: productManagerWindowTheme,
            },
        },
    );
    productManagerWindow.setMenu(null);

    productManagerWindow.once("ready-to-show", () => {
        if (!productManagerWindow.isDestroyed()) {
            productManagerWindow.show();
        }
    });
    productManagerWindow.webContents.once("did-finish-load", () => {
        if (!productManagerWindow.isDestroyed()) {
            productManagerWindow.webContents.send(
                "pm-force-logout",
                productManagerSessionState.consumeForceLogout(),
            );
        }
    });

    productManagerWindow.on("closed", () => {
        productManagerWindow = null;
        productManagerWindowTheme = "standard";
        if (!hasAnyProductOrTicketWindow()) {
            productManagerSessionState.clear({ forceLogout: true });
        }
    });
}

function openProductManagerCartWindow(
    mainWindow,
    options: { theme?: "standard" | "bluearchive" } = {},
) {
    const requestedTheme =
        options.theme === "bluearchive" ? "bluearchive" : "standard";
    if (isWindowAlive(productManagerCartWindow)) {
        productManagerCartWindowTheme = requestedTheme;
        productManagerCartWindow.loadFile(
            path.join(
                __dirname,
                "..",
                "pages",
                "utilities",
                "product-manager-cart.html",
            ),
            { query: { theme: productManagerCartWindowTheme } },
        );
        showWindow(productManagerCartWindow);
        return;
    }
    if (!hasAnyProductOrTicketWindow()) {
        productManagerSessionState.clear({ forceLogout: true });
    }

    productManagerCartWindowTheme = requestedTheme;
    productManagerCartWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: WINDOW_WEB_PREFERENCES,
        icon: APP_ICON_PATH,
        show: false,
        backgroundColor:
            productManagerCartWindowTheme === "bluearchive"
                ? "#edf9ff"
                : "#f4f2ef",
    });

    productManagerCartWindow.maximize();
    productManagerCartWindow.loadFile(
        path.join(
            __dirname,
            "..",
            "pages",
            "utilities",
            "product-manager-cart.html",
        ),
        { query: { theme: productManagerCartWindowTheme } },
    );
    productManagerCartWindow.setMenu(null);

    productManagerCartWindow.once("ready-to-show", () => {
        if (!productManagerCartWindow.isDestroyed()) {
            productManagerCartWindow.show();
        }
    });

    productManagerCartWindow.webContents.once("did-finish-load", () => {
        if (!productManagerCartWindow.isDestroyed()) {
            productManagerCartWindow.webContents.send(
                "pm-force-logout",
                productManagerSessionState.consumeForceLogout(),
            );
        }
    });

    productManagerCartWindow.on("closed", () => {
        productManagerCartWindow = null;
        productManagerCartWindowTheme = "standard";
        if (!hasAnyProductOrTicketWindow()) {
            productManagerSessionState.clear({ forceLogout: true });
        }
    });
}

function openProductManagerInterventionsWindow(
    mainWindow,
    options: { theme?: "standard" | "bluearchive" } = {},
) {
    const requestedTheme =
        options.theme === "bluearchive" ? "bluearchive" : "standard";
    if (isWindowAlive(productManagerInterventionsWindow)) {
        productManagerInterventionsWindowTheme = requestedTheme;
        productManagerInterventionsWindow.loadFile(
            path.join(
                __dirname,
                "..",
                "pages",
                "utilities",
                "product-manager-interventions.html",
            ),
            { query: { theme: productManagerInterventionsWindowTheme } },
        );
        showWindow(productManagerInterventionsWindow);
        return;
    }
    if (!hasAnyProductOrTicketWindow()) {
        productManagerSessionState.clear({ forceLogout: true });
    }

    productManagerInterventionsWindowTheme = requestedTheme;
    productManagerInterventionsWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: WINDOW_WEB_PREFERENCES,
        icon: APP_ICON_PATH,
        show: false,
        backgroundColor:
            productManagerInterventionsWindowTheme === "bluearchive"
                ? "#edf9ff"
                : "#f4f2ef",
    });

    productManagerInterventionsWindow.maximize();
    productManagerInterventionsWindow.loadFile(
        path.join(
            __dirname,
            "..",
            "pages",
            "utilities",
            "product-manager-interventions.html",
        ),
        { query: { theme: productManagerInterventionsWindowTheme } },
    );
    productManagerInterventionsWindow.setMenu(null);

    productManagerInterventionsWindow.once("ready-to-show", () => {
        if (!productManagerInterventionsWindow.isDestroyed()) {
            showWindow(productManagerInterventionsWindow);
        }
    });

    productManagerInterventionsWindow.webContents.once(
        "did-finish-load",
        () => {
            if (!productManagerInterventionsWindow.isDestroyed()) {
                productManagerInterventionsWindow.webContents.send(
                    "pm-force-logout",
                    productManagerSessionState.consumeForceLogout(),
                );
            }
        },
    );

    productManagerInterventionsWindow.on("closed", () => {
        productManagerInterventionsWindow = null;
        productManagerInterventionsWindowTheme = "standard";
        if (!hasAnyProductOrTicketWindow()) {
            productManagerSessionState.clear({ forceLogout: true });
        }
    });
}

function openFeriePermessiHoursWindow(mainWindow) {
    if (isWindowAlive(feriePermessiHoursWindow)) {
        if (feriePermessiHoursWindowTheme !== feriePermessiWindowTheme) {
            feriePermessiHoursWindowTheme = feriePermessiWindowTheme;
            feriePermessiHoursWindow.loadFile(
                path.join(__dirname, "..", "pages", "utilities", "ferie-permessi-hours.html"),
                { query: { theme: feriePermessiHoursWindowTheme } },
            );
        }
        showWindow(feriePermessiHoursWindow);
        return;
    }

    feriePermessiHoursWindowTheme = feriePermessiWindowTheme;

    feriePermessiHoursWindow = new BrowserWindow({
        width: 1000,
        height: 720,
        parent: mainWindow,
        modal: false,
        webPreferences: WINDOW_WEB_PREFERENCES,
        icon: APP_ICON_PATH,
    });

    feriePermessiHoursWindow.loadFile(
        path.join(
            __dirname,
            "..",
            "pages",
            "utilities",
            "ferie-permessi-hours.html",
        ),
        { query: { theme: feriePermessiHoursWindowTheme } },
    );
    feriePermessiHoursWindow.setMenu(null);

    feriePermessiHoursWindow.once("ready-to-show", () => {
        if (!feriePermessiHoursWindow.isDestroyed()) {
            feriePermessiHoursWindow.show();
        }
    });

    feriePermessiHoursWindow.on("closed", () => {
        feriePermessiHoursWindow = null;
        feriePermessiHoursWindowTheme = "standard";
        showMainWindow(mainWindow);
    });
}

function openFeriePermessiAnalysisWindow(mainWindow) {
    if (isWindowAlive(feriePermessiAnalysisWindow)) {
        if (feriePermessiAnalysisWindowTheme !== feriePermessiWindowTheme) {
            feriePermessiAnalysisWindowTheme = feriePermessiWindowTheme;
            feriePermessiAnalysisWindow.loadFile(
                path.join(__dirname, "..", "pages", "utilities", "ferie-permessi-analysis.html"),
                { query: { theme: feriePermessiAnalysisWindowTheme } },
            );
        } else {
            feriePermessiAnalysisWindow.reload();
        }
        showWindow(feriePermessiAnalysisWindow);
        return;
    }

    feriePermessiAnalysisWindowTheme = feriePermessiWindowTheme;

    feriePermessiAnalysisWindow = new BrowserWindow({
        width: 1360,
        height: 860,
        modal: false,
        webPreferences: WINDOW_WEB_PREFERENCES,
        icon: APP_ICON_PATH,
        show: false,
        backgroundColor: "#f3f6fb",
    });

    feriePermessiAnalysisWindow.loadFile(
        path.join(
            __dirname,
            "..",
            "pages",
            "utilities",
            "ferie-permessi-analysis.html",
        ),
        { query: { theme: feriePermessiAnalysisWindowTheme } },
    );
    feriePermessiAnalysisWindow.setMenu(null);

    feriePermessiAnalysisWindow.once("ready-to-show", () => {
        if (!feriePermessiAnalysisWindow.isDestroyed()) {
            feriePermessiAnalysisWindow.maximize();
            feriePermessiAnalysisWindow.show();
        }
    });

    feriePermessiAnalysisWindow.on("closed", () => {
        feriePermessiAnalysisWindow = null;
        feriePermessiAnalysisWindowTheme = "standard";
    });
}

function openTicketSupportWindow(
    mainWindow,
    options: {
        theme?: "standard" | "bluearchive";
        showSplash?: boolean;
    } = {},
) {
    const requestedTheme =
        options.theme === "bluearchive" ? "bluearchive" : "standard";
    const showSplash = options.showSplash !== false;
    const shouldShowSplash =
        showSplash &&
        (requestedTheme === "bluearchive" || !ticketSupportSplashShown);
    if (requestedTheme === "standard" && showSplash) {
        ticketSupportSplashShown = true;
    }
    if (isWindowAlive(ticketSupportWindow)) {
        ticketSupportWindowTheme = requestedTheme;
        ticketSupportWindow.loadFile(
            path.join(
                __dirname,
                "..",
                "pages",
                "utilities",
                "ticket-support.html",
            ),
            {
                query: {
                    theme: ticketSupportWindowTheme,
                    tsSplash: shouldShowSplash ? "1" : "0",
                },
            },
        );
        showWindow(ticketSupportWindow);
        return;
    }

    if (!hasAnyProductOrTicketWindow()) {
        productManagerSessionState.clear({ forceLogout: true });
    }

    ticketSupportWindowTheme = requestedTheme;
    ticketSupportWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: WINDOW_WEB_PREFERENCES,
        icon: APP_ICON_PATH,
        show: false,
        backgroundColor:
            ticketSupportWindowTheme === "bluearchive"
                ? "#edf8fd"
                : "#f4f7fb",
    });

    ticketSupportWindow.maximize();
    ticketSupportWindow.loadFile(
        path.join(__dirname, "..", "pages", "utilities", "ticket-support.html"),
        {
            query: {
                theme: ticketSupportWindowTheme,
                tsSplash: shouldShowSplash ? "1" : "0",
            },
        },
    );
    ticketSupportWindow.setMenu(null);

    ticketSupportWindow.once("ready-to-show", () => {
        if (!ticketSupportWindow.isDestroyed()) {
            ticketSupportWindow.show();
        }
    });

    ticketSupportWindow.webContents.once("did-finish-load", () => {
        if (!ticketSupportWindow.isDestroyed()) {
            ticketSupportWindow.webContents.send(
                "pm-force-logout",
                productManagerSessionState.consumeForceLogout(),
            );
        }
    });

    ticketSupportWindow.on("closed", () => {
        ticketSupportWindow = null;
        ticketSupportWindowTheme = "standard";
        if (!hasAnyProductOrTicketWindow()) {
            productManagerSessionState.clear({ forceLogout: true });
        }
        if (suppressTicketWindowChaining) return;
        if (isWindowAlive(ticketSupportAdminWindow)) {
            showWindow(ticketSupportAdminWindow);
        }
    });
}

function openTicketSupportAdminWindow(
    mainWindow,
    options: { theme?: "standard" | "bluearchive" } = {},
) {
    const requestedTheme =
        options.theme === "bluearchive" ? "bluearchive" : "standard";
    if (isWindowAlive(ticketSupportAdminWindow)) {
        ticketSupportAdminWindowTheme = requestedTheme;
        ticketSupportAdminWindow.loadFile(
            path.join(
                __dirname,
                "..",
                "pages",
                "utilities",
                "ticket-support-admin.html",
            ),
            {
                query: {
                    tsView: "admin",
                    theme: ticketSupportAdminWindowTheme,
                },
            },
        );
        showWindow(ticketSupportAdminWindow);
        return;
    }

    if (!hasAnyProductOrTicketWindow()) {
        productManagerSessionState.clear({ forceLogout: true });
    }

    ticketSupportAdminWindowTheme = requestedTheme;
    ticketSupportAdminWindow = new BrowserWindow({
        width: 1280,
        height: 840,
        webPreferences: WINDOW_WEB_PREFERENCES,
        icon: APP_ICON_PATH,
        show: false,
        backgroundColor:
            ticketSupportAdminWindowTheme === "bluearchive"
                ? "#edf8fd"
                : "#f6f8fc",
    });

    ticketSupportAdminWindow.maximize();
    ticketSupportAdminWindow.loadFile(
        path.join(
            __dirname,
            "..",
            "pages",
            "utilities",
            "ticket-support-admin.html",
        ),
        {
            query: {
                tsView: "admin",
                theme: ticketSupportAdminWindowTheme,
            },
        },
    );
    ticketSupportAdminWindow.setMenu(null);

    ticketSupportAdminWindow.once("ready-to-show", () => {
        if (!ticketSupportAdminWindow.isDestroyed()) {
            ticketSupportAdminWindow.show();
        }
    });

    ticketSupportAdminWindow.webContents.once("did-finish-load", () => {
        if (!ticketSupportAdminWindow.isDestroyed()) {
            ticketSupportAdminWindow.webContents.send(
                "pm-force-logout",
                productManagerSessionState.consumeForceLogout(),
            );
        }
    });

    ticketSupportAdminWindow.on("closed", () => {
        ticketSupportAdminWindow = null;
        const closingTheme = ticketSupportAdminWindowTheme;
        ticketSupportAdminWindowTheme = "standard";
        if (!hasAnyProductOrTicketWindow()) {
            productManagerSessionState.clear({ forceLogout: true });
        }
        if (suppressTicketWindowChaining) return;
        if (isWindowAlive(ticketSupportWindow)) {
            showWindow(ticketSupportWindow);
        } else {
            openTicketSupportWindow(mainWindow, {
                theme: closingTheme,
                showSplash: false,
            });
        }
    });
}

function openAssigneesManagerWindow(
    mainWindow,
    options: { theme?: "standard" | "bluearchive" } = {},
) {
    const requestedTheme =
        options.theme === "bluearchive"
            ? "bluearchive"
            : options.theme === "standard"
              ? "standard"
              : feriePermessiWindowTheme;
    if (isWindowAlive(assigneesManagerWindow)) {
        if (assigneesManagerWindowTheme !== requestedTheme) {
            assigneesManagerWindowTheme = requestedTheme;
            assigneesManagerWindow.loadFile(
                path.join(__dirname, "..", "pages", "utilities", "assignees-manager.html"),
                { query: { theme: assigneesManagerWindowTheme } },
            );
        }
        showWindow(assigneesManagerWindow);
        return;
    }

    assigneesManagerWindowTheme = requestedTheme;

    assigneesManagerWindow = new BrowserWindow({
        width: 1040,
        height: 760,
        webPreferences: WINDOW_WEB_PREFERENCES,
        icon: APP_ICON_PATH,
        show: false,
        backgroundColor: "#f5f7fb",
    });

    assigneesManagerWindow.maximize();
    assigneesManagerWindow.loadFile(
        path.join(
            __dirname,
            "..",
            "pages",
            "utilities",
            "assignees-manager.html",
        ),
        { query: { theme: assigneesManagerWindowTheme } },
    );
    assigneesManagerWindow.setMenu(null);

    assigneesManagerWindow.once("ready-to-show", () => {
        if (!assigneesManagerWindow.isDestroyed()) {
            showWindow(assigneesManagerWindow);
        }
    });

    assigneesManagerWindow.on("closed", () => {
        assigneesManagerWindow = null;
        assigneesManagerWindowTheme = "standard";
    });
}

function openAdminManagerWindow(
    mainWindow,
    options: { theme?: "standard" | "bluearchive" } = {},
) {
    const requestedTheme =
        options.theme === "bluearchive"
            ? "bluearchive"
            : options.theme === "standard"
              ? "standard"
              : feriePermessiWindowTheme;
    if (isWindowAlive(adminManagerWindow)) {
        if (adminManagerWindowTheme !== requestedTheme) {
            adminManagerWindowTheme = requestedTheme;
            adminManagerWindow.loadFile(
                path.join(__dirname, "..", "pages", "utilities", "admin-manager.html"),
                { query: { theme: adminManagerWindowTheme } },
            );
        }
        showWindow(adminManagerWindow);
        return;
    }

    adminManagerWindowTheme = requestedTheme;

    adminManagerWindow = new BrowserWindow({
        width: 980,
        height: 760,
        webPreferences: WINDOW_WEB_PREFERENCES,
        icon: APP_ICON_PATH,
        show: false,
        backgroundColor: "#f5f7fb",
    });

    adminManagerWindow.loadFile(
        path.join(__dirname, "..", "pages", "utilities", "admin-manager.html"),
        { query: { theme: adminManagerWindowTheme } },
    );
    adminManagerWindow.setMenu(null);

    adminManagerWindow.once("ready-to-show", () => {
        if (!adminManagerWindow.isDestroyed()) {
            showWindow(adminManagerWindow);
        }
    });

    adminManagerWindow.on("closed", () => {
        adminManagerWindow = null;
        adminManagerWindowTheme = "standard";
    });
}

function openTransferAttrezzaggioWindow(mainWindow) {
    if (isWindowAlive(transferAttrezzaggioWindow)) {
        showWindow(transferAttrezzaggioWindow);
        return;
    }

    allowTransferAttrezzaggioWindowClose = false;
    transferAttrezzaggioClosePromptPending = false;
    transferAttrezzaggioWindow = new BrowserWindow({
        width: 1280,
        height: 860,
        parent: mainWindow,
        modal: false,
        webPreferences: WINDOW_WEB_PREFERENCES,
        icon: APP_ICON_PATH,
    });

    transferAttrezzaggioWindow.loadFile(
        path.join(__dirname, "..", "pages", "attrezzaggio.html"),
    );
    transferAttrezzaggioWindow.setMenu(null);
    transferAttrezzaggioWindow.once("ready-to-show", () => {
        if (!transferAttrezzaggioWindow?.isDestroyed()) {
            transferAttrezzaggioWindow.maximize();
            showWindow(transferAttrezzaggioWindow);
        }
    });

    transferAttrezzaggioWindow.on("close", (event) => {
        if (isAppQuitting || allowTransferAttrezzaggioWindowClose) return;
        event.preventDefault();
        if (transferAttrezzaggioClosePromptPending) return;
        transferAttrezzaggioClosePromptPending = true;
        transferAttrezzaggioWindow?.webContents.send(
            "attrezzaggio-confirm-window-close",
        );
    });

    transferAttrezzaggioWindow.on("closed", () => {
        transferAttrezzaggioWindow = null;
        allowTransferAttrezzaggioWindowClose = false;
        transferAttrezzaggioClosePromptPending = false;
        showMainWindow(mainWindow);
    });
}

function openCompareFoldersWindow(
    slot,
    folder,
    options: { theme?: "standard" | "bluearchive" } = {},
) {
    const requestedTheme =
        options.theme === "bluearchive" ? "bluearchive" : "standard";
    const sendPendingFolder = () => {
        if (!folder || !isWindowAlive(compareFoldersWindow)) return;
        compareFoldersWindow.webContents.send(
            slot === "B" ? "compare-folders-set-B" : "compare-folders-set-A",
            folder,
        );
    };
    const loadCompareInterface = () => {
        if (!isWindowAlive(compareFoldersWindow)) return;
        compareFoldersWindow.webContents.once("did-finish-load", sendPendingFolder);
        compareFoldersWindow.loadFile(
            path.join(
                __dirname,
                "..",
                "pages",
                "utilities",
                "compare-folders.html",
            ),
            { query: { theme: compareFoldersWindowTheme } },
        );
    };
    const createWindow = () => {
        compareFoldersWindowTheme = requestedTheme;
        compareFoldersWindow = new BrowserWindow({
            width: 900,
            height: 800,
            webPreferences: WINDOW_WEB_PREFERENCES,
            icon: APP_ICON_PATH,
        });

        loadCompareInterface();
        compareFoldersWindow.setMenu(null);
        compareFoldersWindow.center();

        compareFoldersWindow.on("closed", () => {
            compareFoldersWindow = null;
            compareFoldersWindowTheme = "standard";
        });
    };

    if (!compareFoldersWindow || compareFoldersWindow.isDestroyed()) {
        createWindow();
    } else {
        if (compareFoldersWindowTheme !== requestedTheme) {
            compareFoldersWindowTheme = requestedTheme;
            loadCompareInterface();
        } else {
            sendPendingFolder();
        }
        showWindow(compareFoldersWindow);
    }
}

function setupFileManager(mainWindow) {
    setupRealtimeClient();
    app.on("before-quit", () => {
        isAppQuitting = true;
    });

    registerMainWindowLayoutIpc({
        ipcMain,
        mainWindow,
        animateResize,
        usesPersistentLayout: mainWindowUsesBlueArchiveLayout,
    });

    registerFileNavigationIpc({
        ipcMain,
        dialog,
        shell,
        browserWindow: BrowserWindow,
        mainWindow,
    });

    registerAdminStateIpc({
        ipcMain,
        browserWindow: BrowserWindow,
    });

    registerFilesystemDialogIpc({
        ipcMain,
        app,
        dialog,
        browserWindow: BrowserWindow,
        mainWindow,
        log,
    });

    registerFeriePermessiConfigIpc({
        ipcMain,
        log,
    });

    registerProductManagerSessionIpc(
        ipcMain,
        productManagerSessionState,
        broadcastProductManagerSession,
    );

    registerNativeAppIpc({
        ipcMain,
        app,
        dialog,
        browserWindow: BrowserWindow,
        mainWindow,
    });

    registerLocalGitStatsIpc({
        ipcMain,
        app,
    });

    ipcMain.handle("github-stats-get", async (_event, options) => {
        const owner =
            options && options.owner ? String(options.owner) : "AGPress-Tech";
        const repo = options && options.repo ? String(options.repo) : "AyPi";
        const token =
            options && options.token
                ? String(options.token)
                : process.env.GITHUB_TOKEN ||
                  process.env.GH_TOKEN ||
                  readSharedGithubToken();
        const tokenPresent = !!token;
        const targetPath =
            options && options.persistPath
                ? String(options.persistPath)
                : undefined;
        const force = !!(options && options.force);
        const maxCacheMinutes =
            options && Number.isFinite(Number(options.maxCacheMinutes))
                ? Number(options.maxCacheMinutes)
                : 15;
        const cached = readGitStatsSnapshot(targetPath);
        if (!force && cached && cached.fetchedAt) {
            try {
                const last = new Date(cached.fetchedAt);
                if (
                    !Number.isNaN(last.getTime()) &&
                    isYoungerThanMinutes(last, maxCacheMinutes)
                ) {
                    return cached;
                }
            } catch (_err) {
                // ignore
            }
        }
        try {
            const payload = await fetchGithubStats(owner, repo, token);
            const payloadWithToken = { ...payload, tokenPresent };
            if (Array.isArray(payloadWithToken.data) && payloadWithToken.data.length) {
                // Enrich rows with commits>0 but zero code frequency using local git stats.
                // This fixes cases where GitHub stats stay stale on recent weeks.
                const repoRoot = resolveGitRepoRoot(app.getAppPath());
                if (repoRoot) {
                    const local = getGitDailyStats(repoRoot);
                    if (local?.ok && Array.isArray(local.data)) {
                        const localMap = new Map<string, { additions: number; deletions: number }>();
                        local.data.forEach((row) => {
                            const rowDate = row?.date ? new Date(`${row.date}T00:00:00Z`) : null;
                            if (!rowDate || Number.isNaN(rowDate.getTime())) return;
                            const key = toDateKey(startOfWeekMonday(rowDate));
                            const prev = localMap.get(key) || { additions: 0, deletions: 0 };
                            prev.additions += Number(row.additions || 0);
                            prev.deletions += Number(row.deletions || 0);
                            localMap.set(key, prev);
                        });
                        let enrichedRows = 0;
                        payloadWithToken.data.forEach((row) => {
                            const commits = Number(row?.commits || 0);
                            const hasDiff =
                                Number(row?.additions || 0) !== 0 ||
                                Number(row?.deletions || 0) !== 0;
                            if (commits <= 0 || hasDiff) return;
                            const rowDate = row?.date ? new Date(`${row.date}T00:00:00Z`) : null;
                            if (!rowDate || Number.isNaN(rowDate.getTime())) return;
                            const key = toDateKey(startOfWeekMonday(rowDate));
                            const localRow = localMap.get(key);
                            if (!localRow) return;
                            if (Number(localRow.additions || 0) === 0 && Number(localRow.deletions || 0) === 0) return;
                            row.additions = localRow.additions;
                            row.deletions = localRow.deletions;
                            enrichedRows += 1;
                        });
                        if (enrichedRows > 0) {
                            payloadWithToken.warning = payloadWithToken.warning || "code-frequency-local";
                        }
                    }
                }
            }
            const hasCodeFrequency =
                Array.isArray(payloadWithToken.data) &&
                payloadWithToken.data.some(
                    (row) =>
                        (row?.additions || 0) !== 0 ||
                        (row?.deletions || 0) !== 0,
                );
            if (
                !hasCodeFrequency &&
                cached &&
                Array.isArray(cached.data) &&
                cached.data.length
            ) {
                const cachedMap = new Map<
                    string,
                    { additions: number; deletions: number }
                >();
                cached.data.forEach((row) => {
                    const rowDate = row?.date
                        ? new Date(`${row.date}T00:00:00Z`)
                        : null;
                    if (!rowDate || Number.isNaN(rowDate.getTime())) return;
                    const key = toDateKey(startOfWeekMonday(rowDate));
                    cachedMap.set(key, {
                        additions: Number(row.additions || 0),
                        deletions: Number(row.deletions || 0),
                    });
                });
                payloadWithToken.data.forEach((row) => {
                    const rowDate = new Date(`${row.date}T00:00:00Z`);
                    if (Number.isNaN(rowDate.getTime())) return;
                    const key = toDateKey(startOfWeekMonday(rowDate));
                    const cachedRow = cachedMap.get(key);
                    if (cachedRow) {
                        row.additions = cachedRow.additions;
                        row.deletions = cachedRow.deletions;
                    }
                });
                payloadWithToken.warning =
                    payloadWithToken.warning || "code-frequency-cache";
            } else if (!hasCodeFrequency) {
                const repoRoot = resolveGitRepoRoot(app.getAppPath());
                if (repoRoot) {
                    const local = getGitDailyStats(repoRoot);
                    if (local && local.ok && Array.isArray(local.data)) {
                        const localMap = new Map<
                            string,
                            { additions: number; deletions: number }
                        >();
                        local.data.forEach((row) => {
                            const rowDate = row?.date
                                ? new Date(`${row.date}T00:00:00Z`)
                                : null;
                            if (!rowDate || Number.isNaN(rowDate.getTime()))
                                return;
                            const key = toDateKey(startOfWeekMonday(rowDate));
                            const prev = localMap.get(key) || {
                                additions: 0,
                                deletions: 0,
                            };
                            prev.additions += Number(row.additions || 0);
                            prev.deletions += Number(row.deletions || 0);
                            localMap.set(key, prev);
                        });
                        payloadWithToken.data.forEach((row) => {
                            const rowDate = new Date(`${row.date}T00:00:00Z`);
                            if (Number.isNaN(rowDate.getTime())) return;
                            const key = toDateKey(startOfWeekMonday(rowDate));
                            const localRow = localMap.get(key);
                            if (localRow) {
                                row.additions = localRow.additions;
                                row.deletions = localRow.deletions;
                            }
                        });
                        payloadWithToken.warning =
                            payloadWithToken.warning || "code-frequency-local";
                    }
                }
            }
            const totalCommits = Array.isArray(payloadWithToken.data)
                ? payloadWithToken.data.reduce(
                      (sum, entry) =>
                          sum +
                          (entry && typeof entry.commits === "number"
                              ? entry.commits
                              : 0),
                      0,
                  )
                : 0;
            // Prefer Gitflow cache commits if it yields a higher (more complete) total
            if (
                Array.isArray(payloadWithToken.data) &&
                payloadWithToken.data.length
            ) {
                const gitflowCached = readGitflowSnapshot(
                    "\\\\Dl360\\pubbliche\\TECH\\AyPi\\AGPRESS\\General\\data\\gitflow.json",
                );
                if (gitflowCached && Array.isArray(gitflowCached.commits)) {
                    const commitCounts = new Map<string, number>();
                    gitflowCached.commits.forEach((entry) => {
                        const date = new Date(entry.date);
                        if (Number.isNaN(date.getTime())) return;
                        const key = toDateKey(startOfWeekMonday(date));
                        commitCounts.set(key, (commitCounts.get(key) || 0) + 1);
                    });
                    const rebuilt = payloadWithToken.data.map((row) => {
                        const rowDate = new Date(`${row.date}T00:00:00Z`);
                        const week = Number.isNaN(rowDate.getTime())
                            ? row.date
                            : toDateKey(startOfWeekMonday(rowDate));
                        return {
                            ...row,
                            commits: commitCounts.get(week) || 0,
                        };
                    });
                    const rebuiltTotal = rebuilt.reduce(
                        (sum, row) => sum + (row.commits || 0),
                        0,
                    );
                    if (rebuiltTotal > totalCommits) {
                        payloadWithToken.data = rebuilt;
                        payloadWithToken.warning =
                            "commit-activity-gitflow-cache";
                    }
                }
            }
            if (
                totalCommits === 0 &&
                Array.isArray(payloadWithToken.data) &&
                payloadWithToken.data.length
            ) {
                const gitflowCached = readGitflowSnapshot(
                    "\\\\Dl360\\pubbliche\\TECH\\AyPi\\AGPRESS\\General\\data\\gitflow.json",
                );
                if (gitflowCached && Array.isArray(gitflowCached.commits)) {
                    const commitCounts = new Map<string, number>();
                    gitflowCached.commits.forEach((entry) => {
                        const date = new Date(entry.date);
                        if (Number.isNaN(date.getTime())) return;
                        const key = toDateKey(startOfWeekMonday(date));
                        commitCounts.set(key, (commitCounts.get(key) || 0) + 1);
                    });
                    payloadWithToken.data.forEach((row) => {
                        const rowDate = new Date(`${row.date}T00:00:00Z`);
                        const week = Number.isNaN(rowDate.getTime())
                            ? row.date
                            : toDateKey(startOfWeekMonday(rowDate));
                        row.commits = commitCounts.get(week) || 0;
                    });
                    payloadWithToken.warning = "commit-activity-gitflow-cache";
                }
            }
            if (
                totalCommits === 0 &&
                Array.isArray(payloadWithToken.data) &&
                payloadWithToken.data.length
            ) {
                try {
                    const firstDate = payloadWithToken.data[0]?.date
                        ? new Date(`${payloadWithToken.data[0].date}T00:00:00Z`)
                        : null;
                    const minDate =
                        firstDate && !Number.isNaN(firstDate.getTime())
                            ? firstDate
                            : undefined;
                    const commitList = await fetchGithubCommits(
                        owner,
                        repo,
                        token,
                        5000,
                        minDate,
                    );
                    const commitCounts = new Map<string, number>();
                    commitList.forEach((entry) => {
                        const date = new Date(entry.date);
                        if (Number.isNaN(date.getTime())) return;
                        const key = toDateKey(startOfWeekMonday(date));
                        commitCounts.set(key, (commitCounts.get(key) || 0) + 1);
                    });
                    payloadWithToken.data.forEach((row) => {
                        const rowDate = new Date(`${row.date}T00:00:00Z`);
                        const week = Number.isNaN(rowDate.getTime())
                            ? row.date
                            : toDateKey(startOfWeekMonday(rowDate));
                        row.commits = commitCounts.get(week) || 0;
                    });
                    payloadWithToken.warning =
                        payloadWithToken.warning || "commit-activity-fallback";
                } catch {
                    if (
                        cached &&
                        cached.ok &&
                        cached.data &&
                        cached.data.length
                    ) {
                        return {
                            ...cached,
                            warning: "github-commits-zero",
                        };
                    }
                }
            }
            const refreshedCommits = Array.isArray(payloadWithToken.data)
                ? payloadWithToken.data.reduce(
                      (sum, entry) =>
                          sum +
                          (entry && typeof entry.commits === "number"
                              ? entry.commits
                              : 0),
                      0,
                  )
                : 0;
            if (
                cached &&
                cached.ok &&
                cached.data &&
                cached.data.length &&
                refreshedCommits === 0
            ) {
                return {
                    ...cached,
                    warning: "github-commits-zero",
                };
            }
            writeGitStatsSnapshot(payloadWithToken, targetPath);
            return payloadWithToken;
        } catch (err) {
            if (cached && cached.ok && cached.data && cached.data.length) {
                return {
                    ...cached,
                    warning: "github-fetch-failed",
                    error:
                        err && err.message ? String(err.message) : String(err),
                };
            }
            const payload = {
                ok: false,
                reason: "github-fetch-failed",
                error: err && err.message ? String(err.message) : String(err),
                data: [],
                tags: [],
                tokenPresent,
            };
            writeGitStatsSnapshot(payload, targetPath);
            return payload;
        }
    });

    ipcMain.handle("github-gitflow-get", async (_event, options) => {
        const owner =
            options && options.owner ? String(options.owner) : "AGPress-Tech";
        const repo = options && options.repo ? String(options.repo) : "AyPi";
        const token =
            options && options.token
                ? String(options.token)
                : process.env.GITHUB_TOKEN ||
                  process.env.GH_TOKEN ||
                  readSharedGithubToken();
        const maxCommits =
            options && options.maxCommits ? Number(options.maxCommits) : 400;
        const targetPath =
            options && options.persistPath
                ? String(options.persistPath)
                : undefined;
        const force = !!(options && options.force);
        const maxCacheMinutes =
            options && Number.isFinite(Number(options.maxCacheMinutes))
                ? Number(options.maxCacheMinutes)
                : 30;
        const tokenPresent = !!token;
        try {
            const cached = readGitflowSnapshot(targetPath);
            if (!force && cached && cached.fetchedAt) {
                try {
                    const last = new Date(cached.fetchedAt);
                    if (
                        !Number.isNaN(last.getTime()) &&
                        isYoungerThanMinutes(last, maxCacheMinutes)
                    ) {
                        return cached;
                    }
                } catch (_err) {
                    // ignore
                }
            }
            const tags = await fetchGithubTags(owner, repo, token);
            const oldestTagDate = tags.reduce<Date | null>((acc, tag) => {
                const date = tag?.date ? new Date(tag.date) : null;
                if (!date || Number.isNaN(date.getTime())) return acc;
                if (!acc || date < acc) return date;
                return acc;
            }, null);
            const commits = await fetchGithubCommits(
                owner,
                repo,
                token,
                maxCommits,
                oldestTagDate || undefined,
            );
            const payload = {
                ok: true,
                tokenPresent,
                commits,
                tags,
            };
            writeGitflowSnapshot(payload, targetPath);
            return payload;
        } catch (err) {
            const cached = readGitflowSnapshot(targetPath);
            if (cached && cached.ok) {
                return {
                    ...cached,
                    warning: "github-fetch-failed",
                    error:
                        err && err.message ? String(err.message) : String(err),
                };
            }
            const payload = {
                ok: false,
                reason: "github-fetch-failed",
                error: err && err.message ? String(err.message) : String(err),
                tokenPresent,
                commits: [],
                tags: [],
            };
            writeGitflowSnapshot(payload, targetPath);
            return payload;
        }
    });

    registerBatchRenameIpc();

    ipcMain.on("open-file-list-window", (_event, payload) => {
        openFileListWindow(mainWindow, {
            theme:
                payload && payload.theme === "bluearchive"
                    ? "bluearchive"
                    : "standard",
        });
    });
    ipcMain.on("open-batch-rename-window", (_event, payload) => {
        openBatchRenameWindow(mainWindow, {
            theme:
                payload && payload.theme === "bluearchive"
                    ? "bluearchive"
                    : "standard",
        });
    });
    ipcMain.on("open-attrezzaggio-window", () => {
        openTransferAttrezzaggioWindow(mainWindow);
    });
    ipcMain.on("attrezzaggio-window-close-response", (event, payload) => {
        if (
            !isWindowAlive(transferAttrezzaggioWindow) ||
            transferAttrezzaggioWindow?.webContents !== event.sender
        ) {
            return;
        }
        transferAttrezzaggioClosePromptPending = false;
        if (!payload?.confirmed) return;
        allowTransferAttrezzaggioWindowClose = true;
        transferAttrezzaggioWindow?.close();
    });

    registerAttrezzaggioPdfPreviewIpc({
        ipcMain,
        getIconPath: () => APP_ICON_PATH,
    });

    registerAttrezzaggioDataIpc(ipcMain, requestAypiBackend);
    registerProductionPlannerIpc(ipcMain, requestAypiBackend);
    ipcMain.on("open-qr-generator-window", (_event, payload) => {
        openQrGeneratorWindow(mainWindow, {
            theme:
                payload && payload.theme === "bluearchive"
                    ? "bluearchive"
                    : "standard",
        });
    });

    ipcMain.on("open-compare-folders-window", (_event, payload) => {
        openCompareFoldersWindow(null, null, {
            theme:
                payload && payload.theme === "bluearchive"
                    ? "bluearchive"
                    : "standard",
        });
    });

    ipcMain.on("open-hierarchy-window", (_event, payload) => {
        openHierarchyWindow(mainWindow, {
            theme:
                payload && payload.theme === "bluearchive"
                    ? "bluearchive"
                    : "standard",
        });
    });

    ipcMain.on("open-infographics-window", () => {
        openInfographicsWindow(mainWindow);
    });

    ipcMain.on("open-gitflow-window", (_event, payload) => {
        const force = !!(payload && payload.force);
        openGitflowWindow(mainWindow, { force });
    });

    ipcMain.on("open-timer-window", (_event, payload) => {
        openTimerWindow(mainWindow, {
            theme: payload && payload.theme === "bluearchive" ? "bluearchive" : "standard",
        });
    });

    ipcMain.on("open-production-planner-window", () => {
        openProductionPlannerWindow();
    });

    ipcMain.on("open-production-planner-analysis-window", () => {
        openProductionPlannerAnalysisWindow();
    });

    ipcMain.on("open-ferie-permessi-window", async (_event, payload) => {
        const theme =
            payload && payload.theme === "bluearchive"
                ? "bluearchive"
                : "standard";
        await guardServerAndOpenModule(mainWindow, feriePermessiWindow, () =>
            openFeriePermessiWindow(mainWindow, { theme }),
        );
    });

    ipcMain.on("open-product-manager-window", async (_event, payload) => {
        const theme =
            payload && payload.theme === "bluearchive"
                ? "bluearchive"
                : interfaceIconTheme;
        await guardServerAndOpenModule(mainWindow, productManagerWindow, () =>
            openProductManagerWindow(mainWindow, { theme }),
        );
    });

    ipcMain.on("open-product-manager-cart-window", async (_event, payload) => {
        const theme =
            payload && payload.theme === "bluearchive"
                ? "bluearchive"
                : interfaceIconTheme;
        await guardServerAndOpenModule(
            mainWindow,
            productManagerCartWindow,
            () => openProductManagerCartWindow(mainWindow, { theme }),
        );
    });

    ipcMain.on(
        "open-product-manager-interventions-window",
        async (_event, payload) => {
            const theme =
                payload && payload.theme === "bluearchive"
                    ? "bluearchive"
                    : interfaceIconTheme;
            await guardServerAndOpenModule(
                mainWindow,
                productManagerInterventionsWindow,
                () =>
                    openProductManagerInterventionsWindow(mainWindow, {
                        theme,
                    }),
            );
        },
    );
    ipcMain.handle("open-product-manager-interventions-window", async () => {
        await guardServerAndOpenModule(
            mainWindow,
            productManagerInterventionsWindow,
            () =>
                openProductManagerInterventionsWindow(mainWindow, {
                    theme: interfaceIconTheme,
                }),
        );
        return { ok: true };
    });

    ipcMain.on("open-ticket-support-window", async (_event, payload) => {
        const theme =
            payload && payload.theme === "bluearchive"
                ? "bluearchive"
                : interfaceIconTheme;
        await guardServerAndOpenModule(mainWindow, ticketSupportWindow, () =>
            openTicketSupportWindow(mainWindow, {
                theme,
                showSplash: true,
            }),
        );
    });

    ipcMain.on(
        "open-ticket-support-admin-window",
        async (_event, payload) => {
            const theme =
                payload && payload.theme === "bluearchive"
                    ? "bluearchive"
                    : interfaceIconTheme;
            await guardServerAndOpenModule(
                mainWindow,
                ticketSupportAdminWindow,
                () => openTicketSupportAdminWindow(mainWindow, { theme }),
            );
        },
    );

    ipcMain.on("open-assignees-manager-window", () => {
        openAssigneesManagerWindow(mainWindow);
    });

    ipcMain.on("pm-open-calendar-assignees", (_event, payload) => {
        openAssigneesManagerWindow(mainWindow, {
            theme:
                payload && payload.theme === "bluearchive"
                    ? "bluearchive"
                    : "standard",
        });
    });

    ipcMain.on("pm-open-calendar-admins", (_event, payload) => {
        openAdminManagerWindow(mainWindow, {
            theme:
                payload && payload.theme === "bluearchive"
                    ? "bluearchive"
                    : "standard",
        });
    });

    ipcMain.on("open-admin-manager-window", () => {
        openAdminManagerWindow(mainWindow);
    });

    ipcMain.on("open-ferie-permessi-hours-window", () => {
        openFeriePermessiHoursWindow(mainWindow);
    });

    ipcMain.on("open-ferie-permessi-analysis-window", () => {
        openFeriePermessiAnalysisWindow(mainWindow);
    });

    ipcMain.on("hierarchy-open-batch-rename", (event, payload) => {
        const folder = payload?.folder;
        openBatchRenameWindow(mainWindow, { theme: interfaceIconTheme });

        if (batchRenameWindow && !batchRenameWindow.isDestroyed() && folder) {
            batchRenameWindow.webContents.once("did-finish-load", () => {
                batchRenameWindow.webContents.send(
                    "batch-rename-set-root",
                    folder,
                );
            });
            batchRenameWindow.webContents.send("batch-rename-set-root", folder);
        }
    });

    ipcMain.on("hierarchy-compare-folder-A", (event, payload) => {
        openCompareFoldersWindow("A", payload?.folder, {
            theme: interfaceIconTheme,
        });
    });

    ipcMain.on("hierarchy-compare-folder-B", (event, payload) => {
        openCompareFoldersWindow("B", payload?.folder, {
            theme: interfaceIconTheme,
        });
    });

    registerHierarchyReportIpc(mainWindow, {
        buildHtml: buildHierarchyReportHtml,
        buildCss: buildHierarchyReportCss,
        buildJs: buildHierarchyReportJs,
    });
}

export {
    setupFileManager,
    openTimerWindow,
    applyInterfaceIconToWindow,
    getInterfaceIconPath,
    setInterfaceIconTheme,
};
