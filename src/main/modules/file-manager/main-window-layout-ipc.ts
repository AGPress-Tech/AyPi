import type { BrowserWindow, IpcMain } from "electron";

type MainWindowLayoutDependencies = {
    ipcMain: IpcMain;
    mainWindow: BrowserWindow;
    animateResize: (
        window: BrowserWindow,
        width: number,
        height: number,
        duration: number,
    ) => void;
    usesPersistentLayout: (window: BrowserWindow) => boolean;
};

export function registerMainWindowLayoutIpc({
    ipcMain,
    mainWindow,
    animateResize,
    usesPersistentLayout,
}: MainWindowLayoutDependencies) {
    ipcMain.on("resize-calcolatore", () => {
        animateResize(mainWindow, 750, 750, 100);
    });

    ipcMain.on("resize-normale", () => {
        // I moduli legacy ripristinano il vecchio menu; Blue Archive conserva
        // invece bounds e stato della propria interfaccia.
        if (usesPersistentLayout(mainWindow)) return;
        animateResize(mainWindow, 750, 550, 100);
    });
}
