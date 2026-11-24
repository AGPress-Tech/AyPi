import { BrowserWindow, ipcMain } from "electron";
import { requestAypiBackend } from "./file-manager/backend-client";

export function registerBackupsIpc(main: BrowserWindow, getCredential: () => string | null, request = requestAypiBackend) {
    const operations = {
        "backups-get": { path: "/api/backups", method: "GET" },
        "backups-create": { path: "/api/backups", method: "POST" },
        "backups-preview": { path: "/api/backups/preview", method: "POST" },
        "backups-restore": { path: "/api/backups/restore", method: "POST" },
    };
    for (const [channel, operation] of Object.entries(operations)) ipcMain.handle(channel, async (event, payload) => {
        try {
            const password = getCredential();
            if (event.sender !== main.webContents || !password) throw Error("Backups riservati a F2 e password amministratore.");
            if (channel === "backups-restore" && BrowserWindow.getAllWindows().some(window => window !== main && !window.isDestroyed() && (window.isVisible() || window.isMinimized()))) throw Error("Chiudi le finestre dei moduli su questo PC prima di ripristinare.");
            const data = await request(operation.path, { method: operation.method, ...(operation.method === "GET" ? {} : { body: payload || {} }), headers: { "x-aypi-backup-password": password }, timeoutMs: channel === "backups-get" ? 30000 : 30 * 60 * 1000 });
            if (channel === "backups-restore") main.webContents.send("backups-restored", data);
            return { ok: true, data };
        } catch (error) {
            const failure = error as Error & { details?: any; backendMessage?: string };
            return { ok: false, error: failure.backendMessage || failure.message, details: failure.details };
        }
    });
}
