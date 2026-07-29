import type { IpcMain } from "electron";
import log from "electron-log";

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
        log.info("[production-planner] Caricamento stato richiesto dal renderer.");
        try {
            const snapshot = await request("/api/production-planner/state");
            log.info("[production-planner] Stato caricato.", {
                revision: Number(snapshot?.revision) || 0,
                machines: Array.isArray(snapshot?.state?.machines)
                    ? snapshot.state.machines.length
                    : 0,
                jobs: Array.isArray(snapshot?.state?.jobs)
                    ? snapshot.state.jobs.length
                    : 0,
            });
            return { ok: true, snapshot };
        } catch (error) {
            log.error("[production-planner] Caricamento stato fallito.", {
                error: errorMessage(error),
            });
            return { ok: false, error: errorMessage(error) };
        }
    });

    ipcMain.handle("production-planner-check", async () => {
        try {
            const snapshot = await request("/api/production-planner/revision");
            return { ok: true, snapshot };
        } catch (error) {
            log.warn("[production-planner] Controllo revisione fallito.", {
                error: errorMessage(error),
            });
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
            log.info("[production-planner] Stato salvato.", {
                revision: Number(snapshot?.revision) || 0,
                actor,
            });
            return { ok: true, snapshot };
        } catch (error) {
            const message = errorMessage(error);
            log.error("[production-planner] Salvataggio stato fallito.", {
                actor,
                error: message,
            });
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
