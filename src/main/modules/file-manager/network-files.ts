import { BrowserWindow, dialog, shell } from "electron";
import { exec } from "child_process";
import fs from "fs";
import log from "electron-log";
import { NETWORK_PATHS } from "../../config/paths";

let lastReachabilityCheckAt = 0;
let lastReachable = true;
let inFlightCheck: Promise<boolean> | null = null;

export function openNetworkFile(
    mainWindow: BrowserWindow,
    filePath: string,
) {
    fs.access(NETWORK_PATHS.dl360ServerCheck, fs.constants.F_OK, (error) => {
        if (error) {
            log.warn("Server non raggiungibile:", error.message);
            dialog.showMessageBox(mainWindow, {
                type: "warning",
                buttons: ["Ok"],
                title: "Server Non Raggiungibile",
                message:
                    "Il server DL360 non è disponibile. Verificare la connessione.",
            });
            return;
        }

        fs.stat(filePath, (statError, stats) => {
            if (statError) {
                dialog.showMessageBox(mainWindow, {
                    type: "warning",
                    buttons: ["Ok"],
                    title: "Percorso Non Trovato",
                    message:
                        "Il file o la cartella non è disponibile. Controllare e riprovare.",
                });
                return;
            }

            if (stats.isDirectory()) {
                shell.openPath(filePath);
                return;
            }

            exec(`start "" "${filePath}"`, (openError) => {
                if (!openError) return;
                if (
                    openError.message.includes(
                        "utilizzato da un altro processo",
                    )
                ) {
                    dialog
                        .showMessageBox(mainWindow, {
                            type: "warning",
                            buttons: ["Apri in sola lettura", "Annulla"],
                            title: "File in Uso",
                            message: "Vuoi aprirlo in sola lettura?",
                        })
                        .then((result) => {
                            if (result.response === 0) {
                                shell.openPath(filePath);
                            }
                        });
                    return;
                }
                dialog.showMessageBox(mainWindow, {
                    type: "error",
                    buttons: ["Ok"],
                    title: "Errore",
                    message: "Errore nell'apertura del file.",
                });
            });
        });
    });
}

export async function isDl360ServerReachable(timeoutMs = 5000) {
    const now = Date.now();
    if (now - lastReachabilityCheckAt < 3000) return lastReachable;
    if (inFlightCheck) return inFlightCheck;

    inFlightCheck = (async () => {
        const accessPromise = fs.promises
            .access(NETWORK_PATHS.dl360ServerCheck, fs.constants.F_OK)
            .then(() => true)
            .catch(() => false);
        const timeoutPromise = new Promise<boolean>((resolve) => {
            setTimeout(() => resolve(false), timeoutMs);
        });
        const reachable = await Promise.race([accessPromise, timeoutPromise]);
        lastReachabilityCheckAt = Date.now();
        lastReachable = reachable;
        return reachable;
    })();

    try {
        return await inFlightCheck;
    } finally {
        inFlightCheck = null;
    }
}
