import type { IpcMain } from "electron";

export type ProductManagerSession = Record<string, unknown> | null;

export function createProductManagerSessionState() {
    let session: ProductManagerSession = null;
    let forceLogout = false;

    return {
        get() {
            return session;
        },
        set(payload: unknown) {
            session =
                payload && typeof payload === "object"
                    ? (payload as Record<string, unknown>)
                    : null;
            return session;
        },
        clear(options?: { forceLogout?: boolean }) {
            session = null;
            if (options?.forceLogout) {
                forceLogout = true;
            }
        },
        consumeForceLogout() {
            const pending = forceLogout;
            forceLogout = false;
            return pending;
        },
    };
}

export type ProductManagerSessionState = ReturnType<
    typeof createProductManagerSessionState
>;

export function registerProductManagerSessionIpc(
    ipcMain: IpcMain,
    state: ProductManagerSessionState,
    onChange: (session: ProductManagerSession) => void,
) {
    ipcMain.handle("pm-session-get", async () => state.get());

    ipcMain.handle("pm-session-set", async (_event, payload) => {
        onChange(state.set(payload));
        return true;
    });

    ipcMain.handle("pm-session-clear", async () => {
        state.clear();
        onChange(null);
        return true;
    });
}
