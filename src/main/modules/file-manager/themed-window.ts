import type { BrowserWindow } from "electron";

const waiting = new WeakSet<BrowserWindow>();

/** Non mostrare il documento precedente mentre una finestra cambia tema/pagina. */
export function revealThemedWindow(win: BrowserWindow, maximize = false) {
    if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return;
    const contents = win.webContents;
    if (!contents.isLoadingMainFrame()) {
        // On Windows maximize() can reveal even a window created with show:false.
        // Wait until the themed document (including its splash) has loaded.
        if (maximize && !win.isMaximized()) win.maximize();
        win.show();
        win.focus();
        return;
    }
    win.hide();
    if (waiting.has(win)) return;
    waiting.add(win);
    const cleanup = () => {
        waiting.delete(win);
        contents.removeListener("did-finish-load", finish);
        contents.removeListener("did-fail-load", failed);
        win.removeListener("closed", cleanup);
    };
    const finish = () => {
        cleanup();
        // Lascia comporre il nuovo tema prima di rendere visibile la finestra.
        setTimeout(() => revealThemedWindow(win, maximize), 34);
    };
    const failed = (
        _event: unknown,
        _code: number,
        _description: string,
        _url: string,
        mainFrame: boolean,
    ) => {
        if (mainFrame) finish();
    };
    contents.once("did-finish-load", finish);
    contents.on("did-fail-load", failed);
    win.once("closed", cleanup);
}
