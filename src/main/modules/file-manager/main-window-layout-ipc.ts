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
        animateResize(mainWindow, 1360, 820, 140);
    });

    ipcMain.on("resize-normale", () => {
        // Entrambe le interfacce principali condividono ora le proporzioni
        // della shell Blue Archive. Blue Archive conserva comunque i bounds
        // scelti dall'utente quando la propria interfaccia è già attiva.
        if (usesPersistentLayout(mainWindow)) return;
        animateResize(mainWindow, 1360, 820, 140);
    });
}
