import type {
    App,
    BrowserWindow,
    Dialog,
    IpcMain,
    OpenDialogOptions,
} from "electron";

type Logger = {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
};

type OutputFileOptions = {
    defaultName?: string;
    filters?: Array<{ name: string; extensions: string[] }>;
};

type FilesystemDialogDependencies = {
    ipcMain: IpcMain;
    app: App;
    dialog: Dialog;
    browserWindow: Pick<typeof BrowserWindow, "fromWebContents">;
    mainWindow: BrowserWindow;
    log: Logger;
    platform?: NodeJS.Platform;
};

function isWindowAlive(
    window: BrowserWindow | null | undefined,
): window is BrowserWindow {
    return !!window && !window.isDestroyed();
}

export function registerFilesystemDialogIpc({
    ipcMain,
    app,
    dialog,
    browserWindow,
    mainWindow,
    log,
    platform = process.platform,
}: FilesystemDialogDependencies) {
    let lastFolderDialogPath: string | null | undefined = null;
    let lastFolderDialogClosedAt = 0;

    const getSafeLocalPath = () => {
        if (platform === "win32") {
            if (!app.isPackaged) {
                try {
                    return app.getPath("home");
                } catch {
                    return "C:\\";
                }
            }
            return "C:\\";
        }
        try {
            return app.getPath("home");
        } catch {
            return undefined;
        }
    };

    ipcMain.handle("select-root-folder", async (event) => {
        const startedAt = Date.now();
        const senderWindow = browserWindow.fromWebContents(event.sender);
        const fallbackWindow = isWindowAlive(mainWindow) ? mainWindow : null;
        const window = isWindowAlive(senderWindow)
            ? senderWindow
            : fallbackWindow;

        if (Date.now() - lastFolderDialogClosedAt < 300) {
            await new Promise((resolve) => setTimeout(resolve, 300));
        }

        if (!lastFolderDialogPath) {
            lastFolderDialogPath = getSafeLocalPath();
        }

        const dialogOptions: OpenDialogOptions = {
            title: "Seleziona la cartella",
            defaultPath:
                (app.isPackaged
                    ? getSafeLocalPath()
                    : lastFolderDialogPath) || undefined,
            properties: ["openDirectory", "dontAddToRecent"],
        };

        // In build evita il parent modal su Windows: su alcuni PC il dialogo
        // rimane bloccato a lungo dopo l'annullamento.
        const isWindows = platform === "win32";
        const useParentWindow = !isWindows && !app.isPackaged;

        if (isWindows) {
            try {
                app.clearRecentDocuments();
            } catch (error) {
                log.warn(
                    "[select-root-folder] clearRecentDocuments failed:",
                    error,
                );
            }
        }

        log.info("[select-root-folder] open dialog", {
            packaged: app.isPackaged,
            hasParent: !!(window && useParentWindow),
            defaultPath: dialogOptions.defaultPath,
        });

        const result =
            useParentWindow && window
                ? await dialog.showOpenDialog(window, dialogOptions)
                : await dialog.showOpenDialog(dialogOptions);

        lastFolderDialogClosedAt = Date.now();
        log.info("[select-root-folder] dialog closed", {
            canceled: !!result.canceled,
            hasPath: !!result.filePaths?.[0],
            ms: Date.now() - startedAt,
        });

        if (result.canceled || !result.filePaths?.length) {
            if (!lastFolderDialogPath) {
                lastFolderDialogPath = getSafeLocalPath();
            }
            return null;
        }

        const chosenPath = result.filePaths[0];
        lastFolderDialogPath =
            chosenPath && !chosenPath.startsWith("\\\\")
                ? chosenPath
                : getSafeLocalPath();
        return chosenPath;
    });

    ipcMain.on("folder-picker-log", (_event, payload) => {
        try {
            log.info("[folder-picker]", payload || {});
        } catch (error) {
            log.warn("[folder-picker] log failed", error);
        }
    });

    ipcMain.handle(
        "select-output-file",
        async (event, options?: OutputFileOptions) => {
            const window =
                browserWindow.fromWebContents(event.sender) || mainWindow;
            const result = await dialog.showSaveDialog(window, {
                title: "Seleziona il file di destinazione",
                defaultPath: options?.defaultName || "output.xlsx",
                filters: options?.filters || [
                    { name: "File Excel", extensions: ["xlsx"] },
                ],
            });

            return result.canceled || !result.filePath
                ? null
                : result.filePath;
        },
    );
}
