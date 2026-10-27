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
    const mesRequest = async (
        pathname: string,
        options?: Parameters<BackendRequest>[1],
    ) => {
        try {
            return { ok: true, data: await request(pathname, options) };
        } catch (error) {
            return { ok: false, error: errorMessage(error) };
        }
    };

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

    ipcMain.handle("mes-orders-list", async (_event, payload) => {
        const search = String(payload?.search || "").trim();
        const query = `?search=${encodeURIComponent(search)}&limit=500`;
        const first = await mesRequest(`/api/mes/orders${query}&offset=0`);
        if (!first.ok) return first;
        const rows = [...first.data.rows];
        for (let offset = rows.length; offset < first.data.total; offset = rows.length) {
            const page = await mesRequest(`/api/mes/orders${query}&offset=${offset}`);
            if (!page.ok) return page;
            if (!page.data.rows.length) break;
            rows.push(...page.data.rows);
        }
        return { ...first, data: { ...first.data, rows } };
    });

    ipcMain.handle("mes-order-save", (_event, payload) =>
        mesRequest(`/api/mes/orders/${encodeURIComponent(String(payload?.orderId || ""))}/editor`, {
            method: "PUT", body: payload?.body,
        }));
    ipcMain.handle("mes-phase-delete", (_event, payload) =>
        mesRequest(`/api/mes/phases/${encodeURIComponent(String(payload?.phaseId || ""))}`, {
            method: "DELETE", body: { baseRevision: payload?.baseRevision },
        }));

    ipcMain.handle("mes-assignees-list", () => mesRequest("/api/shared/assignees"));

    ipcMain.handle("mes-order-get", (_event, payload) =>
        mesRequest(`/api/mes/orders/${encodeURIComponent(String(payload?.orderId || ""))}`));

    ipcMain.handle("mes-order-create", (_event, payload) =>
        mesRequest("/api/mes/orders", { method: "POST", body: payload }));

    ipcMain.handle("mes-order-update", (_event, payload) =>
        mesRequest(`/api/mes/orders/${encodeURIComponent(String(payload?.orderId || ""))}`, {
            method: "PUT",
            body: payload?.body,
        }));

    ipcMain.handle("mes-phase-create", (_event, payload) =>
        mesRequest(`/api/mes/orders/${encodeURIComponent(String(payload?.orderId || ""))}/phases`, {
            method: "POST",
            body: payload?.body,
        }));

    ipcMain.handle("mes-phase-update", (_event, payload) =>
        mesRequest(`/api/mes/phases/${encodeURIComponent(String(payload?.phaseId || ""))}`, {
            method: "PUT",
            body: payload?.body,
        }));

    ipcMain.handle("mes-activation-preview", (_event, payload) => {
        const machineId = encodeURIComponent(String(payload?.machineId || ""));
        const phaseId = encodeURIComponent(String(payload?.phaseId || ""));
        return mesRequest(`/api/mes/machines/activation-preview?machineId=${machineId}&phaseId=${phaseId}`);
    });

    ipcMain.handle("mes-sessions-list", (_event, payload) => {
        const machineId = String(payload?.machineId || "").trim();
        const query = machineId ? `?machineId=${encodeURIComponent(machineId)}` : "";
        return mesRequest(`/api/mes/sessions${query}`);
    });

    ipcMain.handle("mes-acquisition-status", () =>
        mesRequest("/api/mes/acquisition/status"));

    ipcMain.handle("mes-session-start", (_event, payload) =>
        mesRequest("/api/mes/sessions", {
            method: "POST", body: payload,
            headers: payload?.operatorName ? { "x-aypi-user": String(payload.operatorName) } : undefined,
        }));

    ipcMain.handle("mes-session-action", (_event, payload) =>
        mesRequest(`/api/mes/sessions/${encodeURIComponent(String(payload?.sessionId || ""))}/actions`, {
            method: "POST",
            body: payload?.body,
        }));

    ipcMain.handle("mes-session-setup-start", (_event, payload) =>
        mesRequest(`/api/mes/sessions/${encodeURIComponent(String(payload?.sessionId || ""))}/setup`, {
            method: "POST",
            body: payload?.body,
        }));

    ipcMain.handle("mes-session-adjustment", (_event, payload) =>
        mesRequest(`/api/mes/sessions/${encodeURIComponent(String(payload?.sessionId || ""))}/adjustments`, {
            method: "POST", body: payload?.body,
        }));

    ipcMain.handle("mes-session-operator", (_event, payload) =>
        mesRequest(`/api/mes/sessions/${encodeURIComponent(String(payload?.sessionId || ""))}/operator`, {
            method: "POST", body: payload?.body,
            headers: payload?.body?.operatorNames?.[0] ? { "x-aypi-user": String(payload.body.operatorNames[0]) } : undefined,
        }));

    ipcMain.handle("mes-setup-reconcile", (_event, payload) =>
        mesRequest(`/api/mes/sessions/${encodeURIComponent(String(payload?.sessionId || ""))}/setup-reconciliation`, {
            method: "POST",
            body: payload?.body,
        }));
}
