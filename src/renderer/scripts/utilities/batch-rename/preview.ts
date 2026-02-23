// @ts-nocheck
require("../../shared/dev-guards");
import fs from "fs";
import path from "path";
import { state } from "./state";
import { applyTransformPipeline } from "./transforms";

function buildPreviewWithCopyMove(items, transformsConfig, rootPath) {
    state.previewData = [];
    const usedTargets = new Map();

    const originalKeySet = new Set(
        items.map((it) => it.fullPath.toLowerCase()),
    );

    let globalNumberIndex = 0;
    const perFolderIndex = new Map();
    const perExtensionIndex = new Map();
    const perFolderExtensionIndex = new Map();

    items.forEach((item, index) => {
        const fullPath = item.fullPath;
        const sourceDir = item.dir;
        const oldName = item.name;

        let newName = oldName;
        let status = "unchanged";
        let error = null;

        let targetDir = sourceDir;
        let operationKind = "rename";

        const copyCfg = transformsConfig.copyMove;
        const hasDest =
            copyCfg &&
            copyCfg.enabled &&
            typeof copyCfg.destPath === "string" &&
            copyCfg.destPath.trim() !== "";

        if (hasDest) {
            const destBase = copyCfg.destPath.trim();
            targetDir = destBase;
            operationKind =
                copyCfg.copyNotMove && !item.isDirectory ? "copy" : "move";

            if (copyCfg.keepFolders && rootPath) {
                try {
                    const rel = path.relative(rootPath, sourceDir);
                    if (rel && rel !== "." && !rel.startsWith("..")) {
                        targetDir = path.join(destBase, rel);
                    }
                } catch (e) {
                    // fallback: mantieni destBase
                }
            }
        }

        let numberingIndex = null;
        if (transformsConfig.numbering.enabled) {
            const resetPerFolder = !!transformsConfig.numbering.resetPerFolder;
            const resetPerExtension =
                !!transformsConfig.numbering.resetPerExtension;
            if (resetPerFolder && resetPerExtension) {
                const key = `${sourceDir.toLowerCase()}|${(item.ext || "").toLowerCase()}`;
                const current = perFolderExtensionIndex.get(key) || 0;
                numberingIndex = current;
                perFolderExtensionIndex.set(key, current + 1);
            } else if (resetPerFolder) {
                const key = sourceDir.toLowerCase();
                const current = perFolderIndex.get(key) || 0;
                numberingIndex = current;
                perFolderIndex.set(key, current + 1);
            } else if (resetPerExtension) {
                const key = (item.ext || "").toLowerCase();
                const current = perExtensionIndex.get(key) || 0;
                numberingIndex = current;
                perExtensionIndex.set(key, current + 1);
            } else {
                numberingIndex = globalNumberIndex;
                globalNumberIndex += 1;
            }
        }

        try {
            newName = applyTransformPipeline(
                item,
                index,
                numberingIndex,
                transformsConfig,
            );
        } catch (e) {
            newName = oldName;
            status = "error";
            error = e.message || String(e);
        }

        const targetFullPath = path.join(targetDir, newName);

        const sourceKey = fullPath.toLowerCase();
        const targetKey = targetFullPath.toLowerCase();

        const hasChanges =
            !error && (newName !== oldName || targetKey !== sourceKey);

        if (hasChanges) {
            const existsOnDisk = fs.existsSync(targetFullPath);
            const targetIsSameFile = targetKey === sourceKey;
            const targetUsedByOthers = usedTargets.has(targetKey);
            const targetIsOtherOriginal =
                !targetIsSameFile && originalKeySet.has(targetKey);
            const targetIsExternalExisting =
                existsOnDisk &&
                !targetIsSameFile &&
                !originalKeySet.has(targetKey);

            if (
                targetUsedByOthers ||
                targetIsOtherOriginal ||
                targetIsExternalExisting
            ) {
                status = "conflict";
                error =
                    "Esiste gia un elemento con lo stesso percorso di destinazione.";
            } else {
                status = "rename";
                usedTargets.set(targetKey, true);
            }
        }

        state.previewData.push({
            fullPath,
            dir: sourceDir,
            oldName,
            newName,
            status,
            error,
            isDirectory: item.isDirectory,
            isFile: item.isFile,
            stats: item.stats,
            targetDir,
            targetFullPath,
            operationKind,
        });
    });
}

function buildPreview(items, transformsConfig) {
    state.previewData = [];
    const usedTargets = new Map();

    const originalKeySet = new Set(
        items.map((it) => it.fullPath.toLowerCase()),
    );

    let globalNumberIndex = 0;
    const perFolderIndex = new Map();
    const perExtensionIndex = new Map();
    const perFolderExtensionIndex = new Map();

    items.forEach((item, index) => {
        const fullPath = item.fullPath;
        const dir = item.dir;
        const oldName = item.name;

        let newName = oldName;
        let status = "unchanged";
        let error = null;

        let numberingIndex = null;
        if (transformsConfig.numbering.enabled) {
            const resetPerFolder = !!transformsConfig.numbering.resetPerFolder;
            const resetPerExtension =
                !!transformsConfig.numbering.resetPerExtension;
            if (resetPerFolder && resetPerExtension) {
                const key = `${dir.toLowerCase()}|${(item.ext || "").toLowerCase()}`;
                const current = perFolderExtensionIndex.get(key) || 0;
                numberingIndex = current;
                perFolderExtensionIndex.set(key, current + 1);
            } else if (resetPerFolder) {
                const key = dir.toLowerCase();
                const current = perFolderIndex.get(key) || 0;
                numberingIndex = current;
                perFolderIndex.set(key, current + 1);
            } else if (resetPerExtension) {
                const key = (item.ext || "").toLowerCase();
                const current = perExtensionIndex.get(key) || 0;
                numberingIndex = current;
                perExtensionIndex.set(key, current + 1);
            } else {
                numberingIndex = globalNumberIndex;
                globalNumberIndex += 1;
            }
        }

        try {
            newName = applyTransformPipeline(
                item,
                index,
                numberingIndex,
                transformsConfig,
            );
        } catch (e) {
            newName = oldName;
            status = "error";
            error = e.message || String(e);
        }

        if (!error && newName !== oldName) {
            const targetFullPath = path.join(dir, newName);

            const sourceKey = fullPath.toLowerCase();
            const targetKey = targetFullPath.toLowerCase();

            const existsOnDisk = fs.existsSync(targetFullPath);
            const targetIsSameFile = targetKey === sourceKey;
            const targetUsedByOthers = usedTargets.has(targetKey);
            const targetIsOtherOriginal =
                !targetIsSameFile && originalKeySet.has(targetKey);
            const targetIsExternalExisting =
                existsOnDisk &&
                !targetIsSameFile &&
                !originalKeySet.has(targetKey);

            if (
                targetUsedByOthers ||
                targetIsOtherOriginal ||
                targetIsExternalExisting
            ) {
                status = "conflict";
                error = "Esiste gia un file con lo stesso nome.";
            } else {
                status = "rename";
                usedTargets.set(targetKey, true);
            }
        }

        state.previewData.push({
            fullPath,
            dir,
            oldName,
            newName,
            status,
            error,
            isDirectory: item.isDirectory,
            isFile: item.isFile,
            stats: item.stats,
        });
    });
}

function renderPreviewTable() {
    const tbody = document.querySelector("#previewTable tbody");
    tbody.innerHTML = "";
    state.selectedIndex = null;

    state.previewData.forEach((item, index) => {
        const tr = document.createElement("tr");
        tr.classList.add(`status-${item.status}`);
        tr.dataset.index = index;

        const tdOld = document.createElement("td");
        tdOld.textContent = item.oldName;

        const tdNew = document.createElement("td");
        tdNew.textContent = item.newName;

        const tdStatus = document.createElement("td");
        if (item.status === "rename") {
            tdStatus.textContent = "Da rinominare";
        } else if (item.status === "unchanged") {
            tdStatus.textContent = "Invariato";
        } else if (item.status === "conflict") {
            tdStatus.textContent = `Conflitto: ${item.error}`;
        } else if (item.status === "error") {
            tdStatus.textContent = `Errore: ${item.error}`;
        }

        const tdInfo = document.createElement("td");
        const typeLabel = item.isDirectory ? "Cartella" : "File";
        const opLabel =
            item.operationKind === "copy"
                ? "Copia"
                : item.operationKind === "move"
                  ? "Sposta"
                  : "Rinomina";
        const sizeLabel = item.isDirectory ? "-" : `${item.stats.size} B`;
        const mtimeLabel =
            item.stats && item.stats.mtime
                ? new Date(item.stats.mtime).toLocaleString()
                : "";

        const shortTargetDir = item.targetDir || item.dir || "";
        tdInfo.textContent = `${typeLabel} (${opLabel}) | ${sizeLabel} | ${mtimeLabel}`;
        tdInfo.title = shortTargetDir ? `Destinazione: ${shortTargetDir}` : "";

        tr.appendChild(tdOld);
        tr.appendChild(tdNew);
        tr.appendChild(tdStatus);
        tr.appendChild(tdInfo);
        tbody.appendChild(tr);

        tr.addEventListener("click", () => {
            const rows = tbody.querySelectorAll("tr");
            rows.forEach((r) => r.classList.remove("row-selected"));

            tr.classList.add("row-selected");
            state.selectedIndex = index;

            const btnOpenFolder = document.getElementById("btnOpenFolder");
            if (btnOpenFolder) {
                btnOpenFolder.disabled = false;
            }
        });
    });

    const btnOpenFolder = document.getElementById("btnOpenFolder");
    if (btnOpenFolder) {
        btnOpenFolder.disabled = state.previewData.length === 0;
    }
}

export {
    buildPreviewWithCopyMove,
    buildPreview,
    renderPreviewTable,
};


