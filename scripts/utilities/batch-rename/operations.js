const { ipcRenderer } = require("electron");
const fs = require("fs");
const path = require("path");
const { state } = require("./state");
const { getTransformsConfigFromUI } = require("./transforms");
const { setStatus } = require("./ui/status");

async function handleApply(showInfo, showWarning) {
    const toRename = state.previewData.filter((x) => x.status === "rename");
    if (toRename.length === 0) {
        await showWarning("Non ci sono elementi da rinominare/spostare.");
        return;
    }

    const conflicts = state.previewData.filter((x) => x.status === "conflict" || x.status === "error").length;
    if (conflicts > 0) {
        await showWarning("Ci sono conflitti o errori. Risolvili prima di procedere.");
        return;
    }

    const transformsConfig = getTransformsConfigFromUI();
    const specialCfg = transformsConfig.special || { enabled: false };

    const now = new Date();
    const timestampSafe = now.toISOString().replace(/[:]/g, "-").replace(/\.\d+Z$/, "Z");

    const logDir = path.join(state.rootFolder, "AyPi_BatchRename_Logs");
    try {
        fs.mkdirSync(logDir, { recursive: true });
    } catch (err) {
        console.error("Impossibile creare la cartella di log:", logDir, err);
    }

    const logCsvPath = path.join(logDir, `batch-rename-log-${timestampSafe}.csv`);
    const undoScriptPath = path.join(logDir, `batch-rename-undo-${timestampSafe}.bat`);

    let ok = 0;
    let fail = 0;

    const fileOps = [];
    const dirOps = [];

    const operations = [];

    for (const item of toRename) {
        const source = item.fullPath;
        const targetDir = item.targetDir || item.dir || path.dirname(source);
        const target = item.targetFullPath || path.join(targetDir, item.newName);
        const kind = item.operationKind || "rename";

        const op = {
            source,
            target,
            isDirectory: item.isDirectory,
            kind: kind === "copy" && item.isDirectory ? "move" : kind,
        };

        if (item.isDirectory) {
            dirOps.push(op);
        } else {
            fileOps.push(op);
        }
    }

    const sortedDirOps = dirOps.sort((a, b) => {
        const depthA = a.source.split(path.sep).length;
        const depthB = b.source.split(path.sep).length;
        return depthB - depthA;
    });

    const allOps = [...fileOps, ...sortedDirOps];

    for (const op of allOps) {
        try {
            const parentDir = path.dirname(op.target);
            if (!fs.existsSync(parentDir)) {
                fs.mkdirSync(parentDir, { recursive: true });
            }

            if (op.kind === "copy" && !op.isDirectory) {
                fs.copyFileSync(op.source, op.target);
            } else {
                fs.renameSync(op.source, op.target);
            }

            if (specialCfg.enabled && !op.isDirectory) {
                try {
                    const stats = fs.statSync(op.target);
                    let atime = stats.atime;
                    let mtime = stats.mtime;

                    if (specialCfg.setAtimeNow) {
                        atime = now;
                    }
                    if (specialCfg.setMtimeNow) {
                        mtime = now;
                    }

                    if (specialCfg.setAtimeNow || specialCfg.setMtimeNow) {
                        fs.utimesSync(op.target, atime, mtime);
                    }

                    if (specialCfg.attrReadOnly) {
                        const newMode = stats.mode & ~0o222;
                        fs.chmodSync(op.target, newMode);
                    }

                    if (specialCfg.attrHidden && process.platform === "win32") {
                        try {
                            await ipcRenderer.invoke("batch-rename-set-hidden", {
                                path: op.target,
                                hidden: true,
                            });
                        } catch (hiddenErr) {
                            console.warn("Impossibile impostare attributo nascosto per:", op.target, hiddenErr);
                        }
                    }
                } catch (attrErr) {
                    console.warn("Impossibile applicare attributi speciali a:", op.target, attrErr);
                }
            }

            ok++;
            operations.push({
                from: op.source,
                to: op.target,
                isDirectory: op.isDirectory,
                kind: op.kind,
            });
        } catch (err) {
            console.error("Errore applicando operazione:", op.source, "->", op.target, err);
            fail++;
        }
    }

    state.lastRenameOperations = operations;

    try {
        const lines = [];
        lines.push("from,to,isDirectory,kind");
        for (const op of operations) {
            const fromEsc = `"${op.from.replace(/\"/g, '""')}"`;
            const toEsc = `"${op.to.replace(/\"/g, '""')}"`;
            lines.push(`${fromEsc},${toEsc},${op.isDirectory ? "1" : "0"},${op.kind}`);
        }
        fs.writeFileSync(logCsvPath, lines.join("\r\n"), "utf8");
    } catch (err) {
        console.error("Errore scrivendo il log CSV:", err);
    }

    try {
        const batLines = [];
        batLines.push("@echo off");
        batLines.push("REM Script di undo generato da AyPi - Batch Rename");
        batLines.push(`REM Data: ${now.toString()}`);
        batLines.push("");

        for (const op of operations.slice().reverse()) {
            if (op.kind === "copy" && !op.isDirectory) {
                batLines.push(`if exist "${op.to}" del "${op.to}"`);
            } else {
                const src = op.to;
                const dst = op.from;
                batLines.push(`if exist "${src}" ren "${src}" "${path.basename(dst)}"`);
            }
        }

        fs.writeFileSync(undoScriptPath, batLines.join("\r\n"), "utf8");
    } catch (err) {
        console.error("Errore scrivendo il file di undo:", err);
    }

    const btnUndoLast = document.getElementById("btnUndoLast");
    if (btnUndoLast) {
        btnUndoLast.disabled = !state.lastRenameOperations || state.lastRenameOperations.length === 0;
    }

    await showInfo(
        "Rinomina completata.",
        `Rinomine riuscite: ${ok}\nRinomine fallite: ${fail}\n\nLog:\n${logCsvPath}\nUndo script:\n${undoScriptPath}`
    );

    setStatus("Rinomina completata. E' stato creato un log e uno script di undo.");
}

async function handleOpenFolder(showWarning, showError) {
    if (
        state.selectedIndex === null ||
        state.selectedIndex < 0 ||
        state.selectedIndex >= state.previewData.length
    ) {
        await showWarning("Seleziona prima una riga nell'anteprima.");
        return;
    }

    const item = state.previewData[state.selectedIndex];
    const dir = path.dirname(item.fullPath);

    if (!dir) {
        await showError("Impossibile determinare la cartella del file selezionato.");
        return;
    }

    ipcRenderer.send("open-file", dir);
}

async function handleUndoLast(showInfo, showWarning) {
    if (!state.lastRenameOperations || state.lastRenameOperations.length === 0) {
        await showWarning("Non ci sono operazioni da annullare.");
        return;
    }

    const ops = state.lastRenameOperations.slice();

    let ok = 0;
    let fail = 0;

    const copyOps = ops.filter((o) => o.kind === "copy" && !o.isDirectory);
    const nonCopyOps = ops.filter((o) => o.kind !== "copy");

    const fileOps = nonCopyOps.filter((o) => !o.isDirectory);
    const dirOps = nonCopyOps.filter((o) => o.isDirectory).sort((a, b) => {
        const depthA = a.to.split(path.sep).length;
        const depthB = b.to.split(path.sep).length;
        return depthB - depthA;
    });

    for (const op of copyOps) {
        try {
            if (fs.existsSync(op.to)) {
                fs.unlinkSync(op.to);
                ok++;
            }
        } catch (err) {
            console.error("Errore durante l'undo (copia):", op.to, err);
            fail++;
        }
    }

    for (const op of [...fileOps, ...dirOps]) {
        const src = op.to;
        const dst = op.from;

        try {
            if (fs.existsSync(src)) {
                fs.renameSync(src, dst);
                ok++;
            } else {
                console.warn("Percorso non trovato durante l'undo:", src);
                fail++;
            }
        } catch (err) {
            console.error("Errore durante l'undo:", src, "->", dst, err);
            fail++;
        }
    }

    state.lastRenameOperations = null;

    const btnUndoLast = document.getElementById("btnUndoLast");
    if (btnUndoLast) {
        btnUndoLast.disabled = true;
    }

    await showInfo("Undo completato.", `Ripristini riusciti: ${ok}\nRipristini falliti: ${fail}`);

    setStatus("Ultima operazione annullata (dove possibile).");
}

module.exports = {
    handleApply,
    handleOpenFolder,
    handleUndoLast,
};
