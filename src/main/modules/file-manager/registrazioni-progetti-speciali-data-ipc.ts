import type { IpcMain } from "electron";

type BackendRequest = (
    endpoint: string,
    options?: { method?: string; body?: unknown },
) => Promise<any>;

function errorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
}

export function registerRegistrazioniProgettiSpecialiDataIpc(ipcMain: IpcMain, request: BackendRequest) {
    const endpoint = "/api/registrazioni-progetti-speciali/items";
    ipcMain.handle("registrazioni-progetti-speciali-list", async () => {
        try {
            const response = await request(endpoint);
            return { ok: true, items: Array.isArray(response?.items) ? response.items : [] };
        } catch (error) {
            return { ok: false, error: errorMessage(error) };
        }
    });
    ipcMain.handle("registrazioni-progetti-speciali-load", async (_event, payload) => {
        try {
            const code = String(payload?.code || "").trim();
            if (!code) return { ok: false, error: "Numero progetto mancante." };
            const response = await request(`${endpoint}/${encodeURIComponent(code)}`);
            return { ok: true, item: response?.item || null };
        } catch (error) {
            return { ok: false, error: errorMessage(error) };
        }
    });
    ipcMain.handle("registrazioni-progetti-speciali-save", async (_event, payload) => {
        try {
            const code = String(payload?.progettoNumero || "").trim();
            if (!code) return { ok: false, error: "Inserire il numero del progetto." };
            const response = await request(`${endpoint}/${encodeURIComponent(code)}`, {
                method: "PUT", body: { ...payload, code },
            });
            return { ok: true, code, item: response?.item || null };
        } catch (error) {
            return { ok: false, error: errorMessage(error) };
        }
    });
    ipcMain.handle("registrazioni-progetti-speciali-delete", async (_event, payload) => {
        try {
            const code = String(payload?.code || "").trim();
            if (!code) return { ok: false, error: "Numero progetto mancante." };
            await request(`${endpoint}/${encodeURIComponent(code)}`, { method: "DELETE" });
            return { ok: true };
        } catch (error) {
            return { ok: false, error: errorMessage(error) };
        }
    });
}
