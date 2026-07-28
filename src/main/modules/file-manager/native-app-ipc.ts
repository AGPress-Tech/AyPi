import type {
    App,
    BrowserWindow,
    Dialog,
    IpcMain,
    OpenDialogOptions,
} from "electron";

type NativeAppDependencies = {
    ipcMain: IpcMain;
    app: App;
    dialog: Dialog;
    browserWindow: Pick<typeof BrowserWindow, "getFocusedWindow">;
    mainWindow: BrowserWindow;
};

export function registerNativeAppIpc({
    ipcMain,
    app,
    dialog,
    browserWindow,
    mainWindow,
}: NativeAppDependencies) {
    ipcMain.handle("pm-select-image", async () => {
        const window = browserWindow.getFocusedWindow() || mainWindow;
        const dialogOptions: OpenDialogOptions = {
            title: "Seleziona immagine prodotto",
            properties: ["openFile"],
            filters: [
                {
                    name: "Immagini",
                    extensions: [
                        "png",
                        "jpg",
                        "jpeg",
                        "webp",
                        "gif",
                        "bmp",
                    ],
                },
            ],
        };
        const result = await dialog.showOpenDialog(window, dialogOptions);
        return result.canceled || !result.filePaths.length
            ? ""
            : result.filePaths[0];
    });

    ipcMain.handle("show-message-box", async (_event, options) => {
        const window = browserWindow.getFocusedWindow() || mainWindow;
        return dialog.showMessageBox(window, {
            type: options.type || "none",
            buttons:
                Array.isArray(options.buttons) && options.buttons.length
                    ? options.buttons
                    : ["OK"],
            title: "AyPi",
            message: options.message || "",
            detail: options.detail || "",
            defaultId:
                typeof options.defaultId === "number" ? options.defaultId : 0,
            cancelId:
                typeof options.cancelId === "number" ? options.cancelId : 0,
            noLink: options.noLink !== false,
            normalizeAccessKeys: true,
        });
    });

    ipcMain.handle("get-app-version", async () => app.getVersion());
}
