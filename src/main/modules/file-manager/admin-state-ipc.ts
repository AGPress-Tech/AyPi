import type { BrowserWindow, IpcMain } from "electron";

type AdminStateDependencies = {
    ipcMain: IpcMain;
    browserWindow: Pick<typeof BrowserWindow, "getAllWindows">;
    password?: string;
};

export function registerAdminStateIpc({
    ipcMain,
    browserWindow,
    password: expectedPassword = "AGPress",
}: AdminStateDependencies) {
    let enabled = false;

    const broadcastState = () => {
        browserWindow.getAllWindows().forEach((window) => {
            try {
                window.webContents.send("admin-state-changed", { enabled });
            } catch {
                // Una finestra può chiudersi durante il broadcast.
            }
        });
    };

    ipcMain.handle("admin-auth", async (_event, payload) => {
        const password =
            typeof payload === "string"
                ? payload
                : payload?.password
                  ? String(payload.password)
                  : "";
        if (password !== expectedPassword) {
            return { ok: false };
        }

        enabled = true;
        broadcastState();
        return { ok: true };
    });

    ipcMain.handle("admin-is-enabled", async () => enabled);

    ipcMain.handle("admin-disable", async () => {
        enabled = false;
        broadcastState();
        return { ok: true };
    });
}
