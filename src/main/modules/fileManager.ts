// Gestione finestre e IPC lato main per AyPi

import { ipcMain, dialog, shell, BrowserWindow, app } from "electron";
import type { OpenDialogOptions, OpenDialogSyncOptions } from "electron";
import path from "path";
import { exec, execSync, execFileSync } from "child_process";
import https from "https";
import fs from "fs";
import log from "electron-log";
import { NETWORK_PATHS } from "../config/paths";
import { ADDRESS_DEFAULTS } from "../config/addresses";

const WINDOW_WEB_PREFERENCES = {
    nodeIntegration: true,
    contextIsolation: false,
};

const APP_ICON_PATH = path.join(__dirname, "..", "assets", "app-icon.png");
let fpBaseConfigPath: string | null = null;
function getFpBaseConfigPath() {
    if (!fpBaseConfigPath) {
        fpBaseConfigPath = path.join(app.getPath("userData"), "ferie-permessi-base.json");
    }
    return fpBaseConfigPath;
}
const ADDRESS_BOOK_DIR = "\\\\Dl360\\pubbliche\\TECH\\AyPi\\addresses";
const ADDRESS_BOOK_PATH = path.join(ADDRESS_BOOK_DIR, "aypi-addresses.json");

type AddressEntry = {
    path: string;
    kind?: "file" | "directory";
    id?: string;
};

type AddressBook = {
    version: number;
    updatedAt: string;
    items: Record<string, AddressEntry>;
};

let addressBookCache: AddressBook | null = null;
let adminEnabled = false;

function ensureAddressBookDir() {
    try {
        if (!fs.existsSync(ADDRESS_BOOK_DIR)) {
            fs.mkdirSync(ADDRESS_BOOK_DIR, { recursive: true });
        }
    } catch (err) {
        log.warn("[addresses] impossibile creare cartella:", ADDRESS_BOOK_DIR, err);
    }
}

function buildDefaultAddressBook() {
    return {
        version: 1,
        updatedAt: new Date().toISOString(),
        items: JSON.parse(JSON.stringify(ADDRESS_DEFAULTS)),
    };
}

function loadAddressBook() {
    if (addressBookCache) return addressBookCache;

    const defaults = buildDefaultAddressBook();
    ensureAddressBookDir();

    if (!fs.existsSync(ADDRESS_BOOK_PATH)) {
        addressBookCache = defaults;
        try {
            fs.writeFileSync(ADDRESS_BOOK_PATH, JSON.stringify(addressBookCache, null, 2), "utf8");
        } catch (err) {
            log.warn("[addresses] impossibile salvare file iniziale:", err);
        }
        return addressBookCache;
    }

    try {
        const raw = fs.readFileSync(ADDRESS_BOOK_PATH, "utf8");
        const parsed = JSON.parse(raw);
        const items = parsed && typeof parsed === "object" ? parsed.items || {} : {};
        const merged = buildDefaultAddressBook();

        Object.keys(items || {}).forEach((key) => {
            const entry = items[key];
            if (!entry || typeof entry !== "object") return;
            if (typeof entry.path === "string" && entry.path.trim()) {
                merged.items[key] = {
                    path: entry.path.trim(),
                    kind: entry.kind || merged.items[key]?.kind || "file",
                    id: entry.id || merged.items[key]?.id,
                };
            }
        });

        addressBookCache = {
            version: parsed && parsed.version ? parsed.version : 1,
            updatedAt: parsed && parsed.updatedAt ? parsed.updatedAt : merged.updatedAt,
            items: merged.items,
        };
    } catch (err) {
        log.warn("[addresses] errore lettura, uso default:", err);
        addressBookCache = defaults;
    }

    try {
        fs.writeFileSync(ADDRESS_BOOK_PATH, JSON.stringify(addressBookCache, null, 2), "utf8");
    } catch (err) {
        log.warn("[addresses] impossibile salvare file dopo merge:", err);
    }

    return addressBookCache;
}

function saveAddressBook(book) {
    addressBookCache = book;
    ensureAddressBookDir();
    try {
        fs.writeFileSync(ADDRESS_BOOK_PATH, JSON.stringify(book, null, 2), "utf8");
        return true;
    } catch (err) {
        log.warn("[addresses] errore salvataggio:", err);
        return false;
    }
}

function getAddressEntry(key) {
    const book = loadAddressBook();
    if (!book || !book.items) return null;
    return book.items[key] || null;
}

function updateAddressEntry(key, nextPath) {
    if (!key || typeof nextPath !== "string" || !nextPath.trim()) return null;
    const book = loadAddressBook();
    const entry = book.items[key] || { path: "", kind: "file" };
    const updated = {
        path: nextPath.trim(),
        kind: entry.kind || "file",
        id: entry.id,
    };
    book.items[key] = updated;
    book.updatedAt = new Date().toISOString();
    saveAddressBook(book);
    return updated;
}

function openFilePath(mainWindow: BrowserWindow, filePath: string) {
    const testFile = NETWORK_PATHS.dl360ServerCheck;

    fs.access(testFile, fs.constants.F_OK, (err) => {
        if (err) {
            log.warn("Server non raggiungibile:", err.message);
            dialog.showMessageBox(mainWindow, {
                type: "warning",
                buttons: ["Ok"],
                title: "Server Non Raggiungibile",
                message: "Il server DL360 non \u00e8 disponibile. Verificare la connessione.",
            });
            return;
        }

        fs.stat(filePath, (statErr, stats) => {
            if (statErr) {
                dialog.showMessageBox(mainWindow, {
                    type: "warning",
                    buttons: ["Ok"],
                    title: "Percorso Non Trovato",
                    message: "Il file o la cartella non \u00e8 disponibile. Controllare e riprovare.",
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
                                type: "warning",
                                buttons: ["Apri in sola lettura", "Annulla"],
                                title: "File in Uso",
                                message: "Vuoi aprirlo in sola lettura?",
                            }).then(result => {
                                if (result.response === 0) {
                                    shell.openPath(filePath);
                                }
                            });
                        } else {
                            dialog.showMessageBox(mainWindow, {
                                type: "error",
                                buttons: ["Ok"],
                                title: "Errore",
                                message: "Errore nell'apertura del file.",
                            });
                        }
                    }
                });
            }
        });
    });
}

function getDefaultFpBaseDir(): string {
    try {
        return path.dirname(NETWORK_PATHS.feriePermessiData);
    } catch (err) {
        return "\\\\Dl360\\pubbliche\\TECH\\AyPi\\AGPRESS";
    }
}

function loadFpBaseDir(): string | null {
    try {
        const configPath = getFpBaseConfigPath();
        if (!fs.existsSync(configPath)) return null;
        const raw = fs.readFileSync(configPath, "utf8");
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.baseDir === "string" && parsed.baseDir.trim()) {
            return parsed.baseDir.trim();
        }
        return null;
    } catch (err) {
        log.warn("[ferie-permessi] impossibile leggere base dir:", err);
        return null;
    }
}

function saveFpBaseDir(baseDir: string) {
    try {
        const payload = { baseDir };
        const configPath = getFpBaseConfigPath();
        fs.writeFileSync(configPath, JSON.stringify(payload, null, 2), "utf8");
    } catch (err) {
        log.warn("[ferie-permessi] impossibile salvare base dir:", err);
    }
}

function ensureFpFiles(baseDir: string) {
    if (!baseDir) return;
    if (!fs.existsSync(baseDir)) {
        fs.mkdirSync(baseDir, { recursive: true });
    }
    const calendarDir = path.join(baseDir, "AyPi Calendar");
    const calendarYearsDir = path.join(calendarDir, "Calendar Years");
    const purchasingDir = path.join(baseDir, "AyPi Purchasing");
    const generalDir = path.join(baseDir, "General");
    const ganttDir = path.join(baseDir, "AyPi Gantt");
    const ticketDir = path.join(baseDir, "AyPi Ticket");

    [
        calendarDir,
        calendarYearsDir,
        purchasingDir,
        path.join(purchasingDir, "products"),
        path.join(purchasingDir, "requests"),
        generalDir,
        ganttDir,
        ticketDir,
    ].forEach((dirPath) => {
        try {
            if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
        } catch (err) {
            log.warn("[ferie-permessi] impossibile creare cartella:", dirPath, err);
        }
    });

    const isJsonEmpty = (filePath) => {
        try {
            if (!fs.existsSync(filePath)) return true;
            const raw = fs.readFileSync(filePath, "utf8");
            if (!raw || !raw.trim()) return true;
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) return parsed.length === 0;
            if (parsed && typeof parsed === "object") return Object.keys(parsed).length === 0;
            return false;
        } catch (err) {
            return false;
        }
    };

    const copyFileIfNeeded = (sourcePath, targetPath) => {
        try {
            if (!sourcePath || !targetPath) return;
            if (!fs.existsSync(sourcePath)) return;
            if (!isJsonEmpty(targetPath)) return;
            const targetDir = path.dirname(targetPath);
            if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
            fs.copyFileSync(sourcePath, targetPath);
        } catch (err) {
            log.warn("[ferie-permessi] impossibile migrare file:", sourcePath, "->", targetPath, err);
        }
    };

    const copyDirectoryContent = (sourceDir, targetDir) => {
        try {
            if (!sourceDir || !targetDir) return;
            if (!fs.existsSync(sourceDir)) return;
            if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
            const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
            entries.forEach((entry) => {
                const src = path.join(sourceDir, entry.name);
                const dst = path.join(targetDir, entry.name);
                if (entry.isDirectory()) {
                    copyDirectoryContent(src, dst);
                    return;
                }
                if (entry.isFile() && !fs.existsSync(dst)) {
                    fs.copyFileSync(src, dst);
                }
            });
        } catch (err) {
            log.warn("[ferie-permessi] impossibile migrare cartella:", sourceDir, "->", targetDir, err);
        }
    };

    // Migrazione iniziale legacy -> nuova struttura (senza sovrascrivere dati gia' presenti)
    copyFileIfNeeded(path.join(baseDir, "config-calendar.json"), path.join(calendarDir, "config-calendar.json"));
    copyFileIfNeeded(path.join(baseDir, "ferie-permessi.json"), path.join(calendarDir, "ferie-permessi.json"));
    copyFileIfNeeded(path.join(baseDir, "ferie-permessi-requests.json"), path.join(calendarDir, "ferie-permessi-requests.json"));
    copyFileIfNeeded(path.join(baseDir, "ferie-permessi-holidays.json"), path.join(calendarDir, "ferie-permessi-holidays.json"));
    copyFileIfNeeded(path.join(baseDir, "ferie-permessi-balances.json"), path.join(calendarDir, "ferie-permessi-balances.json"));
    copyFileIfNeeded(path.join(baseDir, "ferie-permessi-closures.json"), path.join(calendarDir, "ferie-permessi-closures.json"));
    copyFileIfNeeded(path.join(baseDir, "otp-mail.json"), path.join(generalDir, "otp-mail.json"));
    copyFileIfNeeded(path.join(baseDir, "amministrazione-assignees.json"), path.join(generalDir, "amministrazione-assignees.json"));
    copyFileIfNeeded(path.join(baseDir, "ferie-permessi-admins.json"), path.join(generalDir, "ferie-permessi-admins.json"));
    copyFileIfNeeded(path.join(baseDir, "amministrazione-obiettivi.json"), path.join(ganttDir, "amministrazione-obiettivi.json"));
    copyDirectoryContent(path.join(baseDir, "Calendar Years"), calendarYearsDir);
    // Rimuove i file legacy di Purchasing (Product Manager).
    const productManagerDir = path.join(baseDir, "Product Manager");
    if (fs.existsSync(productManagerDir)) {
        try {
            fs.rmSync(productManagerDir, { recursive: true, force: true });
        } catch (err) {
            log.warn("[ferie-permessi] impossibile rimuovere legacy Product Manager:", productManagerDir, err);
        }
    }
}

function resolveGitRepoRoot() {
    const candidates = [
        process.cwd(),
        app.getAppPath(),
    ];

    for (const start of candidates) {
        let current = start;
        for (let i = 0; i < 8; i += 1) {
            if (fs.existsSync(path.join(current, ".git"))) {
                return current;
            }
            const parent = path.dirname(current);
            if (!parent || parent === current) break;
            current = parent;
        }
    }

    return "";
}

function getGitDailyStats(repoRoot: string) {
    try {
        execSync("git --version", { stdio: "ignore" });
    } catch (err) {
        return { ok: false, reason: "git-not-found", data: [], tags: [] };
    }

    try {
        const raw = execFileSync(
            "git",
            ["-C", repoRoot, "log", "--numstat", "--date=iso", "--pretty=format:@@@%H|%ad"],
            { encoding: "utf8" }
        );

        const map = new Map<string, { date: string; additions: number; deletions: number; commits: number }>();
        let currentDate = "";

        raw.split(/\r?\n/).forEach((line) => {
            if (!line.trim()) return;
            if (line.startsWith("@@@")) {
                const parts = line.replace("@@@", "").split("|");
                const datePart = parts[1] || "";
                const date = new Date(datePart);
                if (Number.isNaN(date.getTime())) {
                    currentDate = "";
                    return;
                }
                const key = date.toISOString().slice(0, 10);
                currentDate = key;
                if (!map.has(key)) {
                    map.set(key, { date: key, additions: 0, deletions: 0, commits: 0 });
                }
                map.get(key)!.commits += 1;
                return;
            }

            if (!currentDate) return;
            const parts = line.split("\t");
            if (parts.length < 2) return;
            const additions = parseInt(parts[0], 10);
            const deletions = parseInt(parts[1], 10);
            const safeAdd = Number.isFinite(additions) ? additions : 0;
            const safeDel = Number.isFinite(deletions) ? deletions : 0;
            const entry = map.get(currentDate);
            if (!entry) return;
            entry.additions += safeAdd;
            entry.deletions += safeDel;
        });

        const data = Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));

        let tags: { name: string; date: string }[] = [];
        try {
            const rawTags = execFileSync(
                "git",
                ["-C", repoRoot, "for-each-ref", "refs/tags", "--sort=creatordate", "--format=%(refname:short)|%(creatordate:iso)"],
                { encoding: "utf8" }
            );
            tags = rawTags
                .split(/\r?\n/)
                .map((line) => line.trim())
                .filter(Boolean)
                .map((line) => {
                    const [name, date] = line.split("|");
                    return { name, date };
                })
                .filter((entry) => entry.name && entry.date);
        } catch (_err) {
            tags = [];
        }

        return { ok: true, data, tags };
    } catch (err) {
        return { ok: false, reason: "git-log-failed", data: [], tags: [] };
    }
}

function getCachedGitStats() {
    try {
        const appPath = app.getAppPath();
        const cachedPath = path.join(appPath, "pages", "utilities", "git-stats.json");
        if (!fs.existsSync(cachedPath)) return null;
        const raw = fs.readFileSync(cachedPath, "utf8");
        const parsed = JSON.parse(raw);
        if (!parsed || !Array.isArray(parsed.data)) return null;
        return parsed;
    } catch (err) {
        return null;
    }
}

function writeGitStatsSnapshot(payload, targetPath?: string) {
    const fallbackPath = "\\\\Dl360\\pubbliche\\TECH\\AyPi\\AGPRESS\\General\\git-stats.json";
    const outputPath = targetPath && typeof targetPath === "string" ? targetPath : fallbackPath;
    try {
        const dir = path.dirname(outputPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2), "utf8");
        return { ok: true, path: outputPath };
    } catch (err) {
        log.warn("[git-stats] write snapshot failed:", err);
        return { ok: false, path: outputPath, error: err?.message || String(err) };
    }
}

function readGitStatsSnapshot(targetPath?: string) {
    const fallbackPath = "\\\\Dl360\\pubbliche\\TECH\\AyPi\\AGPRESS\\General\\git-stats.json";
    const inputPath = targetPath && typeof targetPath === "string" ? targetPath : fallbackPath;
    try {
        if (!fs.existsSync(inputPath)) return null;
        const raw = fs.readFileSync(inputPath, "utf8");
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? parsed : null;
    } catch (err) {
        return null;
    }
}

function isSameDay(a: Date, b: Date) {
    return a.getFullYear() === b.getFullYear()
        && a.getMonth() === b.getMonth()
        && a.getDate() === b.getDate();
}

function fetchJson(url: string, token?: string): Promise<any> {
    return new Promise((resolve, reject) => {
        const headers: Record<string, string> = {
            "User-Agent": "AyPi",
            Accept: "application/vnd.github+json",
        };
        if (token) {
            headers.Authorization = `Bearer ${token}`;
        }
        const req = https.get(url, { headers }, (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (chunk) => chunks.push(chunk));
            res.on("end", () => {
                const raw = Buffer.concat(chunks).toString("utf8");
                if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        resolve(JSON.parse(raw));
                    } catch (err) {
                        reject(err);
                    }
                } else if (res.statusCode === 202) {
                    resolve({ __pending: true });
                } else {
                    reject(new Error(`HTTP ${res.statusCode || 0}: ${raw}`));
                }
            });
        });
        req.on("error", reject);
        req.end();
    });
}

async function fetchGithubStats(owner: string, repo: string, token?: string) {
    const base = `https://api.github.com/repos/${owner}/${repo}`;
    const retry = async (url: string, attempts = 4) => {
        for (let i = 0; i < attempts; i += 1) {
            const res = await fetchJson(url, token);
            if (res && res.__pending) {
                await new Promise((resolve) => setTimeout(resolve, 800));
                continue;
            }
            return res;
        }
        return [];
    };

    const [codeFrequency, commitActivity, tags] = await Promise.all([
        retry(`${base}/stats/code_frequency`),
        retry(`${base}/stats/commit_activity`),
        fetchJson(`${base}/tags?per_page=100`, token),
    ]);

    const commitsByWeek = new Map<number, number>();
    (Array.isArray(commitActivity) ? commitActivity : []).forEach((entry) => {
        if (!entry || typeof entry.week !== "number") return;
        commitsByWeek.set(entry.week, entry.total || 0);
    });

    const data = (Array.isArray(codeFrequency) ? codeFrequency : []).map((entry) => {
        const week = entry[0];
        const additions = entry[1] || 0;
        const deletions = Math.abs(entry[2] || 0);
        return {
            date: new Date(week * 1000).toISOString().slice(0, 10),
            additions,
            deletions,
            commits: commitsByWeek.get(week) || 0,
        };
    });

    const tagList = Array.isArray(tags) ? tags.slice(0, 50) : [];
    const tagDetails = await Promise.all(
        tagList.map(async (tag) => {
            const sha = tag?.commit?.sha;
            if (!sha) return null;
            try {
                const commit = await fetchJson(`${base}/commits/${sha}`, token);
                const date = commit?.commit?.author?.date;
                return date ? { name: tag.name, date } : null;
            } catch {
                return null;
            }
        }),
    );

    const tagPayload = tagDetails.filter(Boolean);

    return {
        ok: true,
        fetchedAt: new Date().toISOString(),
        data,
        tags: tagPayload,
    };
}

function resolveFpBaseDirSync(senderWin?: BrowserWindow | null) {
    let baseDir = loadFpBaseDir() || getDefaultFpBaseDir();
    const baseExists = baseDir && fs.existsSync(baseDir);

    if (baseExists) {
        ensureFpFiles(baseDir);
        return baseDir;
    }

    const dialogOptions: OpenDialogSyncOptions = {
        title: "Seleziona la cartella dati AyPi Calendar",
        properties: ["openDirectory", "createDirectory"],
    };
    const result = senderWin
        ? dialog.showOpenDialogSync(senderWin, dialogOptions)
        : dialog.showOpenDialogSync(dialogOptions);

    if (result && result.length) {
        baseDir = result[0];
        ensureFpFiles(baseDir);
        saveFpBaseDir(baseDir);
        const infoOptions = {
            type: "info" as const,
            buttons: ["OK"],
            title: "AyPi Calendar",
            message: "Percorso dati configurato.",
            detail: `Percorso selezionato:\n${baseDir}\n\nNota: otp-mail.json non viene creato automaticamente. Se manca, il sistema usa il fallback locale.`,
        };
        if (senderWin && !senderWin.isDestroyed()) {
            dialog.showMessageBoxSync(senderWin, infoOptions);
        } else {
            dialog.showMessageBoxSync(infoOptions);
        }
        return baseDir;
    }

    // fallback to default (even if missing) to avoid blocking startup
    return getDefaultFpBaseDir();
}

function animateResize(mainWindow: BrowserWindow, targetWidth: number, targetHeight: number, duration = 100) {
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

function isWindowAlive(win: BrowserWindow | null | undefined): win is BrowserWindow {
    return !!win && !win.isDestroyed();
}

function showMainWindow(mainWindow: BrowserWindow) {
    if (!isWindowAlive(mainWindow)) return;
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

let batchRenameWindow: BrowserWindow | null = null;
let qrGeneratorWindow: BrowserWindow | null = null;
let compareFoldersWindow: BrowserWindow | null = null;
let hierarchyWindow: BrowserWindow | null = null;
let timerWindow: BrowserWindow | null = null;
let infographicsWindow: BrowserWindow | null = null;
let amministrazioneWindow: BrowserWindow | null = null;
let feriePermessiWindow: BrowserWindow | null = null;
let feriePermessiHoursWindow: BrowserWindow | null = null;
let productManagerWindow: BrowserWindow | null = null;
let productManagerCartWindow: BrowserWindow | null = null;
let productManagerInterventionsWindow: BrowserWindow | null = null;
let ticketSupportWindow: BrowserWindow | null = null;
let ticketSupportAdminWindow: BrowserWindow | null = null;
let assigneesManagerWindow: BrowserWindow | null = null;
let adminManagerWindow: BrowserWindow | null = null;
let productManagerSession: Record<string, unknown> | null = null;
let productManagerForceLogout = false;
let feriePermessiSplashShown = false;
let productManagerSplashShown = false;
let isAppQuitting = false;
let lastFolderDialogPath: string | null = null;
let lastFolderDialogClosedAt = 0;

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

    infographicsWindow.loadFile(path.join(__dirname, "..", "pages", "utilities", "infographics.html"));
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

function openAmministrazioneWindow(mainWindow) {
    if (isWindowAlive(amministrazioneWindow)) {
        showWindow(amministrazioneWindow);
        return;
    }

    amministrazioneWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        parent: mainWindow,
        modal: false,
        webPreferences: WINDOW_WEB_PREFERENCES,
        icon: APP_ICON_PATH,
    });

    amministrazioneWindow.loadFile(path.join(__dirname, "..", "pages", "utilities", "amministrazione.html"));
    amministrazioneWindow.setMenu(null);

    amministrazioneWindow.once("ready-to-show", () => {
        if (!amministrazioneWindow.isDestroyed()) {
            amministrazioneWindow.maximize();
        }
    });

    amministrazioneWindow.on("closed", () => {
        amministrazioneWindow = null;
        showMainWindow(mainWindow);
    });
}

function openFeriePermessiWindow(mainWindow) {
    if (isWindowAlive(feriePermessiWindow)) {
        showWindow(feriePermessiWindow);
        return;
    }

    const shouldShowSplash = !feriePermessiSplashShown;
    feriePermessiSplashShown = true;

    feriePermessiWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        parent: mainWindow,
        modal: false,
        webPreferences: WINDOW_WEB_PREFERENCES,
        icon: APP_ICON_PATH,
        show: false,
        backgroundColor: "#f6f8fc",
    });

    feriePermessiWindow.maximize();
    feriePermessiWindow.loadFile(
        path.join(__dirname, "..", "pages", "utilities", "ferie-permessi.html"),
        { query: { fpSplash: shouldShowSplash ? "1" : "0" } }
    );
    feriePermessiWindow.setMenu(null);

    feriePermessiWindow.once("ready-to-show", () => {
        if (!feriePermessiWindow.isDestroyed()) {
            feriePermessiWindow.show();
        }
    });

    feriePermessiWindow.on("closed", () => {
        feriePermessiWindow = null;
        showMainWindow(mainWindow);
    });
}

function openProductManagerWindow(mainWindow) {
    if (isWindowAlive(productManagerWindow)) {
        productManagerWindow.reload();
        showWindow(productManagerWindow);
        return;
    }
    if (!hasAnyProductOrTicketWindow()) {
        productManagerSession = null;
        productManagerForceLogout = true;
    }

    productManagerWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: WINDOW_WEB_PREFERENCES,
        icon: APP_ICON_PATH,
        show: false,
        backgroundColor: "#f4f2ef",
    });

    productManagerWindow.maximize();
    const shouldShowSplash = !productManagerSplashShown;
    productManagerSplashShown = true;
    productManagerWindow.loadFile(
        path.join(__dirname, "..", "pages", "utilities", "product-manager.html"),
        { query: { pmSplash: shouldShowSplash ? "1" : "0" } }
    );
    productManagerWindow.setMenu(null);

    productManagerWindow.once("ready-to-show", () => {
        if (!productManagerWindow.isDestroyed()) {
            productManagerWindow.show();
        }
    });
    productManagerWindow.webContents.once("did-finish-load", () => {
        if (!productManagerWindow.isDestroyed()) {
            productManagerWindow.webContents.send("pm-force-logout", productManagerForceLogout);
            productManagerForceLogout = false;
        }
    });

    productManagerWindow.on("closed", () => {
        productManagerWindow = null;
        if (!hasAnyProductOrTicketWindow()) {
            productManagerSession = null;
            productManagerForceLogout = true;
        }
    });
}

function openProductManagerCartWindow(mainWindow) {
    if (isWindowAlive(productManagerCartWindow)) {
        productManagerCartWindow.reload();
        showWindow(productManagerCartWindow);
        return;
    }
    if (!hasAnyProductOrTicketWindow()) {
        productManagerSession = null;
        productManagerForceLogout = true;
    }

    productManagerCartWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: WINDOW_WEB_PREFERENCES,
        icon: APP_ICON_PATH,
        show: false,
        backgroundColor: "#f4f2ef",
    });

    productManagerCartWindow.maximize();
    productManagerCartWindow.loadFile(
        path.join(__dirname, "..", "pages", "utilities", "product-manager-cart.html")
    );
    productManagerCartWindow.setMenu(null);

    productManagerCartWindow.once("ready-to-show", () => {
        if (!productManagerCartWindow.isDestroyed()) {
            productManagerCartWindow.show();
        }
    });

    productManagerCartWindow.webContents.once("did-finish-load", () => {
        if (!productManagerCartWindow.isDestroyed()) {
            productManagerCartWindow.webContents.send("pm-force-logout", productManagerForceLogout);
            productManagerForceLogout = false;
        }
    });

    productManagerCartWindow.on("closed", () => {
        productManagerCartWindow = null;
        if (!hasAnyProductOrTicketWindow()) {
            productManagerSession = null;
            productManagerForceLogout = true;
        }
    });

}

function openProductManagerInterventionsWindow(mainWindow) {
    if (isWindowAlive(productManagerInterventionsWindow)) {
        productManagerInterventionsWindow.reload();
        showWindow(productManagerInterventionsWindow);
        return;
    }
    if (!hasAnyProductOrTicketWindow()) {
        productManagerSession = null;
        productManagerForceLogout = true;
    }

    productManagerInterventionsWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: WINDOW_WEB_PREFERENCES,
        icon: APP_ICON_PATH,
        show: false,
        backgroundColor: "#f4f2ef",
    });

    productManagerInterventionsWindow.maximize();
    productManagerInterventionsWindow.loadFile(
        path.join(__dirname, "..", "pages", "utilities", "product-manager-interventions.html")
    );
    productManagerInterventionsWindow.setMenu(null);

    productManagerInterventionsWindow.once("ready-to-show", () => {
        if (!productManagerInterventionsWindow.isDestroyed()) {
            showWindow(productManagerInterventionsWindow);
        }
    });

    productManagerInterventionsWindow.webContents.once("did-finish-load", () => {
        if (!productManagerInterventionsWindow.isDestroyed()) {
            productManagerInterventionsWindow.webContents.send("pm-force-logout", productManagerForceLogout);
            productManagerForceLogout = false;
        }
    });

    productManagerInterventionsWindow.on("closed", () => {
        productManagerInterventionsWindow = null;
        if (!hasAnyProductOrTicketWindow()) {
            productManagerSession = null;
            productManagerForceLogout = true;
        }
    });
}

function openFeriePermessiHoursWindow(mainWindow) {
    if (isWindowAlive(feriePermessiHoursWindow)) {
        showWindow(feriePermessiHoursWindow);
        return;
    }

    feriePermessiHoursWindow = new BrowserWindow({
        width: 1000,
        height: 720,
        parent: mainWindow,
        modal: false,
        webPreferences: WINDOW_WEB_PREFERENCES,
        icon: APP_ICON_PATH,
    });

    feriePermessiHoursWindow.loadFile(
        path.join(__dirname, "..", "pages", "utilities", "ferie-permessi-hours.html")
    );
    feriePermessiHoursWindow.setMenu(null);

    feriePermessiHoursWindow.once("ready-to-show", () => {
        if (!feriePermessiHoursWindow.isDestroyed()) {
            feriePermessiHoursWindow.show();
        }
    });

    feriePermessiHoursWindow.on("closed", () => {
        feriePermessiHoursWindow = null;
        showMainWindow(mainWindow);
    });
}

function openTicketSupportWindow(mainWindow) {
    if (isWindowAlive(ticketSupportWindow)) {
        ticketSupportWindow.reload();
        showWindow(ticketSupportWindow);
        return;
    }

    if (!hasAnyProductOrTicketWindow()) {
        productManagerSession = null;
        productManagerForceLogout = true;
    }

    ticketSupportWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: WINDOW_WEB_PREFERENCES,
        icon: APP_ICON_PATH,
        show: false,
        backgroundColor: "#f4f7fb",
    });

    ticketSupportWindow.maximize();
    ticketSupportWindow.loadFile(
        path.join(__dirname, "..", "pages", "utilities", "ticket-support.html")
    );
    ticketSupportWindow.setMenu(null);

    ticketSupportWindow.once("ready-to-show", () => {
        if (!ticketSupportWindow.isDestroyed()) {
            ticketSupportWindow.show();
        }
    });

    ticketSupportWindow.webContents.once("did-finish-load", () => {
        if (!ticketSupportWindow.isDestroyed()) {
            ticketSupportWindow.webContents.send("pm-force-logout", productManagerForceLogout);
            productManagerForceLogout = false;
        }
    });

    ticketSupportWindow.on("closed", () => {
        ticketSupportWindow = null;
        if (!hasAnyProductOrTicketWindow()) {
            productManagerSession = null;
            productManagerForceLogout = true;
        }
        if (isWindowAlive(ticketSupportAdminWindow)) {
            showWindow(ticketSupportAdminWindow);
        }
    });
}

function openTicketSupportAdminWindow(mainWindow) {
    if (isWindowAlive(ticketSupportAdminWindow)) {
        ticketSupportAdminWindow.reload();
        showWindow(ticketSupportAdminWindow);
        return;
    }

    if (!hasAnyProductOrTicketWindow()) {
        productManagerSession = null;
        productManagerForceLogout = true;
    }

    ticketSupportAdminWindow = new BrowserWindow({
        width: 1280,
        height: 840,
        webPreferences: WINDOW_WEB_PREFERENCES,
        icon: APP_ICON_PATH,
        show: false,
        backgroundColor: "#f6f8fc",
    });

    ticketSupportAdminWindow.maximize();
    ticketSupportAdminWindow.loadFile(
        path.join(__dirname, "..", "pages", "utilities", "ticket-support-admin.html"),
        { query: { tsView: "admin" } }
    );
    ticketSupportAdminWindow.setMenu(null);

    ticketSupportAdminWindow.once("ready-to-show", () => {
        if (!ticketSupportAdminWindow.isDestroyed()) {
            ticketSupportAdminWindow.show();
        }
    });

    ticketSupportAdminWindow.webContents.once("did-finish-load", () => {
        if (!ticketSupportAdminWindow.isDestroyed()) {
            ticketSupportAdminWindow.webContents.send("pm-force-logout", productManagerForceLogout);
            productManagerForceLogout = false;
        }
    });

    ticketSupportAdminWindow.on("closed", () => {
        ticketSupportAdminWindow = null;
        if (!hasAnyProductOrTicketWindow()) {
            productManagerSession = null;
            productManagerForceLogout = true;
        }
        if (isWindowAlive(ticketSupportWindow)) {
            showWindow(ticketSupportWindow);
        } else {
            openTicketSupportWindow(mainWindow);
        }
    });
}

function openAssigneesManagerWindow(mainWindow) {
    if (isWindowAlive(assigneesManagerWindow)) {
        showWindow(assigneesManagerWindow);
        return;
    }

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
        path.join(__dirname, "..", "pages", "utilities", "assignees-manager.html")
    );
    assigneesManagerWindow.setMenu(null);

    assigneesManagerWindow.once("ready-to-show", () => {
        if (!assigneesManagerWindow.isDestroyed()) {
            showWindow(assigneesManagerWindow);
        }
    });

    assigneesManagerWindow.on("closed", () => {
        assigneesManagerWindow = null;
    });
}

function openAdminManagerWindow(mainWindow) {
    if (isWindowAlive(adminManagerWindow)) {
        showWindow(adminManagerWindow);
        return;
    }

    adminManagerWindow = new BrowserWindow({
        width: 980,
        height: 760,
        webPreferences: WINDOW_WEB_PREFERENCES,
        icon: APP_ICON_PATH,
        show: false,
        backgroundColor: "#f5f7fb",
    });

    adminManagerWindow.loadFile(
        path.join(__dirname, "..", "pages", "utilities", "admin-manager.html")
    );
    adminManagerWindow.setMenu(null);

    adminManagerWindow.once("ready-to-show", () => {
        if (!adminManagerWindow.isDestroyed()) {
            showWindow(adminManagerWindow);
        }
    });

    adminManagerWindow.on("closed", () => {
        adminManagerWindow = null;
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

    loadAddressBook();
    ipcMain.on("resize-calcolatore", () => {
        animateResize(mainWindow, 750, 750, 100);
    });

    ipcMain.on("resize-normale", () => {
        animateResize(mainWindow, 750, 550, 100);
    });

    ipcMain.on("open-file", (event, filePath) => {
        if (!filePath) return;
        openFilePath(mainWindow, filePath);
    });

    ipcMain.on("open-external", (_event, url) => {
        if (typeof url !== "string" || !url.trim()) return;
        shell.openExternal(url.trim());
    });

    ipcMain.on("open-address", (event, payload) => {
        const key = payload && payload.key ? String(payload.key) : "";
        if (!key) return;
        const entry = getAddressEntry(key);
        if (!entry || !entry.path) {
            dialog.showMessageBox(mainWindow, {
                type: "warning",
                buttons: ["Ok"],
                title: "Percorso Non Trovato",
                message: "Il percorso configurato non \u00e8 disponibile.",
            });
            return;
        }
        openFilePath(mainWindow, entry.path);
    });

    ipcMain.handle("addresses-reconfigure", async (event, payload) => {
        const key = payload && payload.key ? String(payload.key) : "";
        if (!key) return { canceled: true };
        const entry = getAddressEntry(key);
        const kind = entry && entry.kind === "directory" ? "directory" : "file";

        const senderWin = BrowserWindow.fromWebContents(event.sender);
        const win = isWindowAlive(senderWin) ? senderWin : mainWindow;

        const dialogOptions: OpenDialogOptions = {
            title: "Seleziona il percorso da associare",
            properties: [kind === "directory" ? "openDirectory" : "openFile", "dontAddToRecent"],
        };
        const result = await dialog.showOpenDialog(win, dialogOptions);

        if (result.canceled || !result.filePaths || !result.filePaths[0]) {
            return { canceled: true };
        }

        const chosen = result.filePaths[0];
        const updated = updateAddressEntry(key, chosen);

        dialog.showMessageBox(win, {
            type: "info",
            buttons: ["Ok"],
            title: "Percorso aggiornato",
            message: "Percorso aggiornato con successo.",
            detail: chosen,
        });

        return { canceled: false, updated };
    });

    ipcMain.handle("admin-auth", async (_event, payload) => {
        const password = typeof payload === "string" ? payload : (payload && payload.password) ? String(payload.password) : "";
        if (password === "AGPress") {
            adminEnabled = true;
            return { ok: true };
        }
        return { ok: false };
    });

    ipcMain.handle("admin-is-enabled", async () => {
        return adminEnabled;
    });

    ipcMain.handle("admin-disable", async () => {
        adminEnabled = false;
        return { ok: true };
    });

    ipcMain.handle("select-root-folder", async (event) => {
        const t0 = Date.now();
        const senderWin = BrowserWindow.fromWebContents(event.sender);
        const mainWin = isWindowAlive(mainWindow) ? mainWindow : null;
        const win = isWindowAlive(senderWin) ? senderWin : mainWin;

        const now = Date.now();
        if (now - lastFolderDialogClosedAt < 300) {
            await new Promise(resolve => setTimeout(resolve, 300));
        }

        const getSafeLocalPath = () => {
            if (process.platform === "win32") {
                if (!app.isPackaged) {
                    try {
                        return app.getPath("home");
                    } catch {
                        return "C:\\";
                    }
                }
                return "C:\\";
            }
            try {
                return app.getPath("home");
            } catch {
                return undefined;
            }
        };

        if (!lastFolderDialogPath) {
            lastFolderDialogPath = getSafeLocalPath();
        }

        const dialogOptions: OpenDialogOptions = {
            title: "Seleziona la cartella",
            defaultPath: (app.isPackaged ? getSafeLocalPath() : lastFolderDialogPath) || undefined,
            properties: ["openDirectory", "dontAddToRecent"],
        };

        // In build (packaged) evita parent modal: su alcuni PC crea un blocco lungo dopo annulla.
        const isWindows = process.platform === "win32";
        const useParentWindow = !isWindows && !app.isPackaged;

        if (isWindows) {
            try {
                app.clearRecentDocuments();
            } catch (err) {
                log.warn("[select-root-folder] clearRecentDocuments failed:", err);
            }
        }
        log.info("[select-root-folder] open dialog", {
            packaged: app.isPackaged,
            hasParent: !!(win && useParentWindow),
            defaultPath: dialogOptions.defaultPath,
        });
        const result = useParentWindow && win
            ? await dialog.showOpenDialog(win, dialogOptions)
            : await dialog.showOpenDialog(dialogOptions);

        lastFolderDialogClosedAt = Date.now();
        log.info("[select-root-folder] dialog closed", {
            canceled: !!result.canceled,
            hasPath: !!(result.filePaths && result.filePaths[0]),
            ms: Date.now() - t0,
        });

        if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
            if (!lastFolderDialogPath) {
                lastFolderDialogPath = getSafeLocalPath();
            }
            return null;
        }
        const chosen = result.filePaths[0];
        if (chosen && !chosen.startsWith("\\\\")) {
            lastFolderDialogPath = chosen;
        } else {
            lastFolderDialogPath = getSafeLocalPath();
        }
        return chosen;
    });

    ipcMain.on("folder-picker-log", (_event, payload) => {
        try {
            log.info("[folder-picker]", payload || {});
        } catch (err) {
            log.warn("[folder-picker] log failed", err);
        }
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

    ipcMain.on("fp-get-base-dir", (event) => {
        const senderWin = BrowserWindow.fromWebContents(event.sender);
        const baseDir = resolveFpBaseDirSync(senderWin);
        event.returnValue = baseDir;
    });

    ipcMain.handle("pm-session-get", async () => {
        return productManagerSession;
    });

    ipcMain.handle("pm-session-set", async (_event, payload) => {
        productManagerSession = payload && typeof payload === "object" ? payload : null;
        broadcastProductManagerSession(productManagerSession);
        return true;
    });

    ipcMain.handle("pm-session-clear", async () => {
        productManagerSession = null;
        broadcastProductManagerSession(null);
        return true;
    });

    ipcMain.handle("pm-select-image", async () => {
        const win = BrowserWindow.getFocusedWindow() || mainWindow;
        const dialogOptions: OpenDialogOptions = {
            title: "Seleziona immagine prodotto",
            properties: ["openFile"],
            filters: [{ name: "Immagini", extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp"] }],
        };
        const result = await dialog.showOpenDialog(win, dialogOptions);
        if (result.canceled || !result.filePaths.length) return "";
        return result.filePaths[0];
    });

    ipcMain.handle("show-message-box", async (event, options) => {
        const win = BrowserWindow.getFocusedWindow() || mainWindow;

        return dialog.showMessageBox(win, {
            type: options.type || "none",
            buttons: Array.isArray(options.buttons) && options.buttons.length ? options.buttons : ["OK"],
            title: "AyPi",
            message: options.message || "",
            detail: options.detail || "",
        });
    });

    ipcMain.handle("get-app-version", async () => {
        return app.getVersion();
    });

    ipcMain.handle("git-stats-get", async (_event, options) => {
        const fresh = !!(options && options.fresh);
        const targetPath = options && options.persistPath ? String(options.persistPath) : undefined;

        if (!fresh) {
            const cached = getCachedGitStats();
            if (cached && cached.ok && cached.data && cached.data.length) {
                return cached;
            }
        }

        const repoRoot = resolveGitRepoRoot();
        if (!repoRoot) {
            const payload = { ok: false, reason: "repo-not-found", data: [], tags: [] };
            writeGitStatsSnapshot(payload, targetPath);
            return payload;
        }
        const payload = getGitDailyStats(repoRoot);
        writeGitStatsSnapshot(payload, targetPath);
        return payload;
    });

    ipcMain.handle("github-stats-get", async (_event, options) => {
        const owner = (options && options.owner) ? String(options.owner) : "AGPress-Tech";
        const repo = (options && options.repo) ? String(options.repo) : "AyPi";
        const token = options && options.token ? String(options.token) : process.env.GITHUB_TOKEN;
        const targetPath = options && options.persistPath ? String(options.persistPath) : undefined;
        const cached = readGitStatsSnapshot(targetPath);
        if (cached && cached.fetchedAt) {
            try {
                const last = new Date(cached.fetchedAt);
                if (!Number.isNaN(last.getTime()) && isSameDay(last, new Date())) {
                    return cached;
                }
            } catch (_err) {
                // ignore
            }
        }
        try {
            const payload = await fetchGithubStats(owner, repo, token);
            writeGitStatsSnapshot(payload, targetPath);
            return payload;
        } catch (err) {
            const payload = { ok: false, reason: "github-fetch-failed", data: [], tags: [] };
            writeGitStatsSnapshot(payload, targetPath);
            return payload;
        }
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

    ipcMain.on("open-infographics-window", () => {
        openInfographicsWindow(mainWindow);
    });

    ipcMain.on("open-timer-window", () => {
        openTimerWindow(mainWindow);
    });

      ipcMain.on("open-amministrazione-window", () => {
          openAmministrazioneWindow(mainWindow);
      });

      ipcMain.on("open-ferie-permessi-window", () => {
          openFeriePermessiWindow(mainWindow);
      });

      ipcMain.on("open-product-manager-window", () => {
          openProductManagerWindow(mainWindow);
      });

      ipcMain.on("open-product-manager-cart-window", () => {
          openProductManagerCartWindow(mainWindow);
      });

      ipcMain.on("open-product-manager-interventions-window", () => {
          openProductManagerInterventionsWindow(mainWindow);
      });
      ipcMain.handle("open-product-manager-interventions-window", () => {
          openProductManagerInterventionsWindow(mainWindow);
          return { ok: true };
      });

      ipcMain.on("open-ticket-support-window", () => {
          openTicketSupportWindow(mainWindow);
      });

      ipcMain.on("open-ticket-support-admin-window", () => {
          openTicketSupportAdminWindow(mainWindow);
      });

      ipcMain.on("open-assignees-manager-window", () => {
          openAssigneesManagerWindow(mainWindow);
      });

      ipcMain.on("pm-open-calendar-assignees", () => {
          openAssigneesManagerWindow(mainWindow);
      });

      ipcMain.on("pm-open-calendar-admins", () => {
          openAdminManagerWindow(mainWindow);
      });

      ipcMain.on("open-admin-manager-window", () => {
          openAdminManagerWindow(mainWindow);
      });

      ipcMain.on("open-ferie-permessi-hours-window", () => {
          openFeriePermessiHoursWindow(mainWindow);
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

export { setupFileManager, openTimerWindow };
