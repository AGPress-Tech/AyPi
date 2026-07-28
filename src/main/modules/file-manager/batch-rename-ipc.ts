import { app, ipcMain } from "electron";
import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import log from "electron-log";

type BatchRenamePreset = {
    name: string;
    data: unknown;
    updatedAt: string;
};

function getPresetsPath() {
    return path.join(app.getPath("userData"), "batch-rename-presets.json");
}

function loadPresets(): BatchRenamePreset[] {
    try {
        const presetsPath = getPresetsPath();
        if (!fs.existsSync(presetsPath)) return [];
        const data = JSON.parse(fs.readFileSync(presetsPath, "utf8"));
        return Array.isArray(data) ? data : [];
    } catch (err) {
        log.error("[batch-rename] impossibile leggere i preset:", err);
        return [];
    }
}

function savePresets(presets: BatchRenamePreset[]) {
    try {
        fs.writeFileSync(
            getPresetsPath(),
            JSON.stringify(presets, null, 2),
            "utf8",
        );
    } catch (err) {
        log.error("[batch-rename] impossibile salvare i preset:", err);
    }
}

export function registerBatchRenameIpc() {
    ipcMain.handle("batch-rename-load-presets", async () => loadPresets());

    ipcMain.handle("batch-rename-save-preset", async (_event, payload) => {
        const name = String(payload?.name || "").trim();
        const data = payload?.data || null;
        if (!name || !data) return loadPresets();

        const presets = loadPresets();
        const existingIndex = presets.findIndex(
            (preset) => preset?.name === name,
        );
        const entry = { name, data, updatedAt: new Date().toISOString() };
        if (existingIndex >= 0) {
            presets[existingIndex] = entry;
        } else {
            presets.push(entry);
        }
        savePresets(presets);
        return presets;
    });

    ipcMain.handle("batch-rename-delete-preset", async (_event, payload) => {
        const name = String(payload?.name || "").trim();
        if (!name) return loadPresets();
        const presets = loadPresets().filter(
            (preset) => preset?.name !== name,
        );
        savePresets(presets);
        return presets;
    });

    ipcMain.handle("batch-rename-set-hidden", async (_event, payload) => {
        const targetPath = String(payload?.path || "");
        const hidden = !!payload?.hidden;
        if (!targetPath) {
            return { ok: false, error: "Percorso non valido" };
        }
        if (process.platform !== "win32") {
            return {
                ok: false,
                error: "Attributo nascosto supportato solo su Windows",
            };
        }

        return new Promise((resolve) => {
            const flag = hidden ? "+H" : "-H";
            execFile("attrib", [flag, targetPath], (err) => {
                if (err) {
                    log.error(
                        "[batch-rename] errore impostando attributo hidden:",
                        targetPath,
                        err,
                    );
                    resolve({ ok: false, error: err.message || String(err) });
                    return;
                }
                resolve({ ok: true });
            });
        });
    });
}
