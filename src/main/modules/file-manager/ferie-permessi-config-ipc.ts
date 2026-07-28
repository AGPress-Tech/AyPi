import type { IpcMain } from "electron";
import { resolveFpBackendBaseUrl } from "../../config/backend";
import { resolveFpBaseDir } from "./ferie-permessi-paths";

type Logger = {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
};

type FeriePermessiConfigDependencies = {
    ipcMain: IpcMain;
    log: Logger;
    getBaseDir?: () => string;
    getBackendBaseUrl?: () => string;
    writeDebugLog?: (...args: unknown[]) => void;
};

export function registerFeriePermessiConfigIpc({
    ipcMain,
    log,
    getBaseDir = resolveFpBaseDir,
    getBackendBaseUrl = resolveFpBackendBaseUrl,
    writeDebugLog = console.log,
}: FeriePermessiConfigDependencies) {
    ipcMain.on("fp-get-base-dir", (event) => {
        const baseDir = getBaseDir();
        log.info("[ferie-permessi] renderer richiede base dir:", baseDir);
        event.returnValue = baseDir;
    });

    ipcMain.on("fp-get-backend-base-url", (event) => {
        const backendUrl = getBackendBaseUrl();
        log.info("[ferie-permessi] backend base url:", backendUrl);
        event.returnValue = backendUrl;
    });

    ipcMain.on("fp-debug-log", (_event, payload) => {
        try {
            writeDebugLog("[ferie-permessi][renderer]", payload);
        } catch (error) {
            log.warn("[ferie-permessi] debug log fallito:", error);
        }
    });
}
