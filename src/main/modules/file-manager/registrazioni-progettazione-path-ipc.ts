import fs from "fs";
import path from "path";
import type { BrowserWindow, Dialog, IpcMain, Shell } from "electron";

export function registerRegistrazioniProgettazionePathIpc(options: {
    ipcMain: IpcMain;
    dialog: Dialog;
    shell: Shell;
    getParentWindow: () => BrowserWindow | null;
}) {
    const { ipcMain, dialog, shell, getParentWindow } = options;

    ipcMain.handle("registrazioni-progettazione-select-linked-paths", async () => {
        const parent = getParentWindow();
        const choice = await dialog.showMessageBox(parent || undefined, {
            type: "question",
            title: "Collega percorso",
            message: "Che tipo di percorso vuoi collegare?",
            detail: "Il file o la cartella non verranno copiati. Il collegamento funzionerà finché il percorso originale rimane raggiungibile.",
            buttons: ["File", "Cartella", "Annulla"],
            defaultId: 0,
            cancelId: 2,
            noLink: true,
        });
        if (choice.response === 2) return { ok: true, paths: [] };
        const result = await dialog.showOpenDialog(parent || undefined, {
            title: choice.response === 0 ? "Seleziona uno o più file" : "Seleziona una cartella",
            properties: choice.response === 0
                ? ["openFile", "multiSelections"]
                : ["openDirectory"],
        });
        return { ok: true, paths: result.canceled ? [] : result.filePaths };
    });

    ipcMain.handle("registrazioni-progettazione-open-linked-path", async (_event, payload) => {
        const targetPath = String(payload?.path || "").trim();
        if (!targetPath) return { ok: false, error: "Percorso mancante." };
        if (!fs.existsSync(targetPath)) {
            return { ok: false, error: "Il percorso originale non è più disponibile o non è raggiungibile." };
        }
        const error = await shell.openPath(path.resolve(targetPath));
        return error ? { ok: false, error } : { ok: true };
    });
}
