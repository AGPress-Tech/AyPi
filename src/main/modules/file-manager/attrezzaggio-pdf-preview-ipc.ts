import { app, BrowserWindow, shell } from "electron";
import type { IpcMain } from "electron";
import fs from "fs";
import path from "path";
import log from "electron-log";

const WEB_PREFERENCES = {
    nodeIntegration: true,
    contextIsolation: false,
};

let activePreviewPath: string | null = null;

function getPreviewDirectory() {
    return path.join(app.getPath("temp"), "aypi-attrezzaggio-preview");
}

function removePreviewFile(filePath?: string | null) {
    if (!filePath) return;
    try {
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    } catch (error) {
        log.warn(
            "[attrezzaggio-pdf] impossibile rimuovere file temp:",
            filePath,
            error,
        );
    }
}

export function sanitizeAttrezzaggioPreviewFileName(name: string) {
    return (
        String(name || "scheda-attrezzaggio")
            .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 80) || "scheda-attrezzaggio"
    );
}

function cleanupOldPreviewFiles(maxAgeMs = 24 * 60 * 60 * 1000) {
    const tempDirectory = getPreviewDirectory();
    if (!fs.existsSync(tempDirectory)) return;

    const now = Date.now();
    for (const entry of fs.readdirSync(tempDirectory, {
        withFileTypes: true,
    })) {
        if (!entry.isFile()) continue;
        const filePath = path.join(tempDirectory, entry.name);
        if (activePreviewPath && filePath === activePreviewPath) continue;
        try {
            const stats = fs.statSync(filePath);
            if (now - stats.mtimeMs > maxAgeMs) {
                fs.unlinkSync(filePath);
            }
        } catch (error) {
            log.warn(
                "[attrezzaggio-pdf] impossibile pulire file temp:",
                filePath,
                error,
            );
        }
    }
}

async function waitForPreviewAssets(window: BrowserWindow) {
    await window.webContents.executeJavaScript(
        `
        new Promise((resolve) => {
            const settle = () => setTimeout(resolve, 200);
            const images = Array.from(document.images || []);
            const waits = images.map((img) => {
                if (img.complete) return Promise.resolve();
                return new Promise((done) => {
                    const finish = () => done();
                    img.addEventListener("load", finish, { once: true });
                    img.addEventListener("error", finish, { once: true });
                    setTimeout(finish, 5000);
                });
            });
            Promise.all(waits)
                .catch(() => undefined)
                .then(() => {
                    if (document.fonts && document.fonts.ready) {
                        document.fonts.ready.then(settle).catch(settle);
                    } else {
                        settle();
                    }
                });
        });
        `,
        true,
    );
}

type PreviewPayload = {
    html: string;
    title?: string;
    pageSize?: "A3" | "A4";
    landscape?: boolean;
};

export async function createAttrezzaggioPreviewPdf(
    payload: PreviewPayload,
    iconPath: string,
) {
    const tempDirectory = getPreviewDirectory();
    fs.mkdirSync(tempDirectory, { recursive: true });
    cleanupOldPreviewFiles();

    const renderWindow = new BrowserWindow({
        show: false,
        width: 1400,
        height: 1000,
        webPreferences: WEB_PREFERENCES,
        icon: iconPath,
    });

    try {
        await renderWindow.loadURL(
            `data:text/html;charset=utf-8,${encodeURIComponent(payload.html)}`,
        );
        await waitForPreviewAssets(renderWindow);
        const pdfBuffer = await renderWindow.webContents.printToPDF({
            printBackground: true,
            landscape: !!payload.landscape,
            pageSize: payload.pageSize || "A4",
            preferCSSPageSize: true,
        });
        const fileName = `${Date.now()}-${sanitizeAttrezzaggioPreviewFileName(
            payload.title || "scheda-attrezzaggio",
        )}.pdf`;
        const filePath = path.join(tempDirectory, fileName);
        fs.writeFileSync(filePath, pdfBuffer);
        return filePath;
    } finally {
        if (!renderWindow.isDestroyed()) {
            renderWindow.destroy();
        }
    }
}

export async function openAttrezzaggioPdfPreview(pdfPath: string) {
    const previousPath = activePreviewPath;
    activePreviewPath = pdfPath;
    if (previousPath && previousPath !== pdfPath) {
        removePreviewFile(previousPath);
    }
    const openResult = await shell.openPath(pdfPath);
    if (openResult) throw new Error(openResult);
}

type PreviewRegistrarDependencies = {
    ipcMain: IpcMain;
    getIconPath: () => string;
    createPdf?: (payload: PreviewPayload, iconPath: string) => Promise<string>;
    openPreview?: (pdfPath: string) => Promise<void>;
    logger?: Pick<typeof log, "error">;
};

export function registerAttrezzaggioPdfPreviewIpc({
    ipcMain,
    getIconPath,
    createPdf = createAttrezzaggioPreviewPdf,
    openPreview = openAttrezzaggioPdfPreview,
    logger = log,
}: PreviewRegistrarDependencies) {
    ipcMain.handle("attrezzaggio-preview-pdf", async (_event, payload) => {
        try {
            const html = String(payload?.html || "");
            if (!html.trim()) {
                return { ok: false, error: "Contenuto PDF mancante." };
            }
            const pdfPath = await createPdf(
                {
                    html,
                    title: String(
                        payload?.title || "scheda-attrezzaggio",
                    ),
                    pageSize: payload?.pageSize === "A3" ? "A3" : "A4",
                    landscape: !!payload?.landscape,
                },
                getIconPath(),
            );
            await openPreview(pdfPath);
            return { ok: true };
        } catch (error) {
            logger.error("[attrezzaggio-pdf] errore anteprima:", error);
            return {
                ok: false,
                error:
                    error instanceof Error
                        ? error.message
                        : String(error),
            };
        }
    });
}
