import type {
    BrowserWindow,
    Dialog,
    IpcMain,
    OpenDialogOptions,
    Shell,
} from "electron";
import {
    getAddressEntry,
    loadAddressBook,
    updateAddressEntry,
} from "./address-book";
import { openNetworkFile } from "./network-files";

type AddressEntry = {
    path?: string;
    kind?: string;
};

type AddressBookAdapter = {
    load: () => unknown;
    get: (key: string) => AddressEntry | null;
    update: (key: string, path: string) => unknown;
};

type FileNavigationDependencies = {
    ipcMain: IpcMain;
    dialog: Dialog;
    shell: Pick<Shell, "openExternal">;
    browserWindow: Pick<typeof BrowserWindow, "fromWebContents">;
    mainWindow: BrowserWindow;
    addressBook?: AddressBookAdapter;
    openFile?: (mainWindow: BrowserWindow, filePath: string) => unknown;
};

const defaultAddressBook: AddressBookAdapter = {
    load: loadAddressBook,
    get: getAddressEntry,
    update: updateAddressEntry,
};

function isWindowAlive(
    window: BrowserWindow | null | undefined,
): window is BrowserWindow {
    return !!window && !window.isDestroyed();
}

export function registerFileNavigationIpc({
    ipcMain,
    dialog,
    shell,
    browserWindow,
    mainWindow,
    addressBook = defaultAddressBook,
    openFile = openNetworkFile,
}: FileNavigationDependencies) {
    addressBook.load();

    ipcMain.on("open-file", (_event, filePath) => {
        if (!filePath) return;
        openFile(mainWindow, filePath);
    });

    ipcMain.on("open-external", (_event, url) => {
        if (typeof url !== "string" || !url.trim()) return;
        shell.openExternal(url.trim());
    });

    ipcMain.on("open-address", (_event, payload) => {
        const key = payload?.key ? String(payload.key) : "";
        if (!key) return;

        const entry = addressBook.get(key);
        if (!entry?.path) {
            dialog.showMessageBox(mainWindow, {
                type: "warning",
                buttons: ["Ok"],
                title: "Percorso Non Trovato",
                message: "Il percorso configurato non è disponibile.",
            });
            return;
        }
        openFile(mainWindow, entry.path);
    });

    ipcMain.handle("addresses-reconfigure", async (event, payload) => {
        const key = payload?.key ? String(payload.key) : "";
        if (!key) return { canceled: true };

        const entry = addressBook.get(key);
        const kind = entry?.kind === "directory" ? "directory" : "file";
        const senderWindow = browserWindow.fromWebContents(event.sender);
        const window = isWindowAlive(senderWindow)
            ? senderWindow
            : mainWindow;
        const dialogOptions: OpenDialogOptions = {
            title: "Seleziona il percorso da associare",
            properties: [
                kind === "directory" ? "openDirectory" : "openFile",
                "dontAddToRecent",
            ],
        };
        const result = await dialog.showOpenDialog(window, dialogOptions);

        if (result.canceled || !result.filePaths?.[0]) {
            return { canceled: true };
        }

        const chosenPath = result.filePaths[0];
        const updated = addressBook.update(key, chosenPath);
        dialog.showMessageBox(window, {
            type: "info",
            buttons: ["Ok"],
            title: "Percorso aggiornato",
            message: "Percorso aggiornato con successo.",
            detail: chosenPath,
        });

        return { canceled: false, updated };
    });
}
