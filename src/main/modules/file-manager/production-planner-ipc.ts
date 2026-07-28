import type { IpcMain } from "electron";

type BackendRequest = (
    pathname: string,
    options?: {
        method?: string;
        body?: unknown;
        headers?: Record<string, string>;
    },
) => Promise<any>;

function errorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
}

export function registerProductionPlannerIpc(
    ipcMain: IpcMain,
    request: BackendRequest,
) {
    ipcMain.handle("production-planner-load", async () => {
        try {
            const snapshot = await request("/api/production-planner/state");
            return { ok: true, snapshot };
        } catch (error) {
            return { ok: false, error: errorMessage(error) };
        }
    });

    ipcMain.handle("production-planner-check", async () => {
        try {
            const snapshot = await request("/api/production-planner/revision");
            return { ok: true, snapshot };
        } catch (error) {
            return { ok: false, error: errorMessage(error) };
        }
    });

    ipcMain.handle("production-planner-save", async (_event, payload) => {
        const actor =
            String(payload?.actor || process.env.USERNAME || process.env.USER || "")
                .trim() || "Operatore AyPi";
        try {
            const snapshot = await request("/api/production-planner/state", {
                method: "PUT",
                headers: {
                    "x-aypi-user": actor,
                    "x-aypi-client": "production-planner",
                },
                body: {
                    state: payload?.state,
                    baseRevision: Number(payload?.baseRevision) || 0,
                },
            });
            return { ok: true, snapshot };
        } catch (error) {
            const message = errorMessage(error);
            let latest = null;
            try {
                latest = await request("/api/production-planner/state");
            } catch {
                // Il client manterrà la copia locale finché il backend non torna disponibile.
            }
            return {
                ok: false,
                conflict: message.includes("(409)"),
                error: message,
                latest,
            };
        }
    });
}
