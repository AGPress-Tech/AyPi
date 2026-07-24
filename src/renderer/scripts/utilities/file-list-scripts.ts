require("../shared/dev-guards");
import { ipcRenderer } from "electron";
import fs from "fs";
import path from "path";
import * as XLSX from "xlsx";
import { initBlueArchivePointerEffects } from "../shared/bluearchive-pointer-effects";
import { makeSplashSkippable } from "../shared/skippable-splash";

const { showInfo, showWarning, showError } = require("../shared/dialogs");
const IS_BLUE_ARCHIVE_FILE_LIST =
    new URLSearchParams(window.location.search).get("theme") === "bluearchive";

if (IS_BLUE_ARCHIVE_FILE_LIST) {
    document.body.classList.add("bluearchive-file-list");
}
initBlueArchivePointerEffects(IS_BLUE_ARCHIVE_FILE_LIST);

type FileRow = {
    name: string;
    relativePath: string;
    fullPath: string;
    size: number;
    modifiedAt: number;
};

let selectedRoot = "";
let rows: FileRow[] = [];

function formatBytes(value: number) {
    if (!Number.isFinite(value) || value <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    const index = Math.min(
        units.length - 1,
        Math.floor(Math.log(value) / Math.log(1024)),
    );
    return `${(value / 1024 ** index).toLocaleString("it-IT", {
        maximumFractionDigits: index === 0 ? 0 : 1,
    })} ${units[index]}`;
}

function runSplash() {
    if (!IS_BLUE_ARCHIVE_FILE_LIST) return;
    const splash = document.getElementById("baFileListSplash");
    if (!splash) return;
    splash.setAttribute("aria-hidden", "false");
    const splashController = makeSplashSkippable(splash, {
        fadeClass: "is-leaving",
    });
    window.setTimeout(() => {
        if (!splashController.isFinished()) splash.classList.add("is-leaving");
    }, 1800);
    window.setTimeout(splashController.finish, 2200);
}

window.addEventListener("DOMContentLoaded", () => {
    runSplash();
    const selectedFolder = document.getElementById("selectedFolder");
    const includeSubfolders = document.getElementById(
        "includeSubfolders",
    ) as HTMLInputElement | null;
    const btnSelectFolder = document.getElementById(
        "btnSelectFolder",
    ) as HTMLButtonElement | null;
    const btnScan = document.getElementById(
        "btnScan",
    ) as HTMLButtonElement | null;
    const btnExport = document.getElementById(
        "btnExport",
    ) as HTMLButtonElement | null;
    const table = document.getElementById(
        "fileListTable",
    ) as HTMLTableElement | null;
    const tbody = table?.querySelector("tbody");
    const emptyState = document.getElementById("emptyState");
    const statusLine = document.getElementById("statusLine");

    function setStatus(message: string) {
        if (!statusLine) return;
        const dot = statusLine.querySelector("i");
        statusLine.textContent = "";
        if (dot) statusLine.appendChild(dot);
        statusLine.append(message);
    }

    function updateStats(folderCount: number, errorCount: number) {
        const totalSize = rows.reduce((sum, item) => sum + item.size, 0);
        const values: Record<string, string> = {
            statFiles: String(rows.length),
            statFolders: String(folderCount),
            statSize: formatBytes(totalSize),
            statErrors: String(errorCount),
        };
        Object.entries(values).forEach(([id, value]) => {
            const element = document.getElementById(id);
            if (element) element.textContent = value;
        });
    }

    function renderRows() {
        if (!tbody || !table) return;
        tbody.innerHTML = "";
        rows.forEach((item) => {
            const tr = document.createElement("tr");
            [
                item.name,
                item.relativePath,
                formatBytes(item.size),
                new Date(item.modifiedAt).toLocaleString("it-IT"),
            ].forEach((value) => {
                const td = document.createElement("td");
                td.textContent = value;
                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        });
        table.hidden = rows.length === 0;
        if (emptyState) emptyState.hidden = rows.length > 0;
        if (btnExport) btnExport.disabled = rows.length === 0;
    }

    function scanFolder() {
        if (!selectedRoot) return;
        const nextRows: FileRow[] = [];
        let folderCount = 0;
        let errorCount = 0;
        const recursive = includeSubfolders?.checked !== false;

        function walk(currentPath: string) {
            folderCount += 1;
            let entries: fs.Dirent[];
            try {
                entries = fs.readdirSync(currentPath, { withFileTypes: true });
            } catch {
                errorCount += 1;
                return;
            }
            entries.forEach((entry) => {
                const fullPath = path.join(currentPath, entry.name);
                if (entry.isDirectory()) {
                    if (recursive) walk(fullPath);
                    return;
                }
                if (!entry.isFile()) return;
                try {
                    const stat = fs.statSync(fullPath);
                    nextRows.push({
                        name: entry.name,
                        relativePath: path.relative(selectedRoot, fullPath),
                        fullPath: path.resolve(fullPath),
                        size: stat.size,
                        modifiedAt: stat.mtimeMs,
                    });
                } catch {
                    errorCount += 1;
                }
            });
        }

        setStatus("Analisi in corso...");
        walk(selectedRoot);
        rows = nextRows.sort((left, right) =>
            left.relativePath.localeCompare(right.relativePath, "it", {
                numeric: true,
                sensitivity: "base",
            }),
        );
        updateStats(folderCount, errorCount);
        renderRows();
        setStatus(
            rows.length
                ? `Indice completato: ${rows.length} file`
                : "Nessun file trovato",
        );
    }

    btnSelectFolder?.addEventListener("click", async () => {
        const folder = await ipcRenderer.invoke("select-root-folder");
        if (!folder) return;
        selectedRoot = String(folder);
        rows = [];
        if (selectedFolder) {
            selectedFolder.textContent = selectedRoot;
            selectedFolder.setAttribute("title", selectedRoot);
        }
        if (btnScan) btnScan.disabled = false;
        if (btnExport) btnExport.disabled = true;
        setStatus("Cartella selezionata");
        scanFolder();
    });

    btnScan?.addEventListener("click", scanFolder);
    includeSubfolders?.addEventListener("change", () => {
        if (selectedRoot) scanFolder();
    });

    btnExport?.addEventListener("click", async () => {
        if (!rows.length) {
            await showWarning("Nessun file da esportare.");
            return;
        }
        const outputPath = await ipcRenderer.invoke("select-output-file", {
            defaultName: "lista_file.xlsx",
        });
        if (!outputPath) return;
        try {
            const exportRows = rows.map((item) => ({
                "Nome file": item.name,
                "Percorso relativo": item.relativePath,
                "Percorso completo": item.fullPath,
            }));
            const workbook = XLSX.utils.book_new();
            const worksheet = XLSX.utils.json_to_sheet(exportRows);
            XLSX.utils.book_append_sheet(workbook, worksheet, "File");
            XLSX.writeFile(workbook, outputPath);
            setStatus("Esportazione Excel completata");
            await showInfo("File Excel creato con successo.", outputPath);
        } catch (error) {
            await showError(
                "Errore durante l'esportazione Excel.",
                error instanceof Error ? error.message : String(error),
            );
        }
    });

    document.getElementById("btnClose")?.addEventListener("click", () => {
        window.close();
    });
});

export {};
