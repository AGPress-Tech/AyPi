const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");

ipcMain.on("fp-get-backend-base-url", (event) => {
    event.returnValue = "http://127.0.0.1:9";
});
ipcMain.handle("pm-session-get", async () => null);
ipcMain.handle("pm-session-set", async () => true);
ipcMain.handle("pm-session-clear", async () => true);
ipcMain.handle("show-message-box", async () => ({ response: 0 }));

async function inspectSplash(window, theme) {
    const pagePath = path.join(
        __dirname,
        "..",
        "dist-ts",
        "pages",
        "utilities",
        "ticket-support.html",
    );
    await window.loadFile(pagePath, {
        query: { theme, tsSplash: "1" },
    });
    await new Promise((resolve) => setTimeout(resolve, 500));
    return window.webContents.executeJavaScript(`(() => {
        const isBlueArchive = ${JSON.stringify(theme)} === "bluearchive";
        const splash = document.getElementById(
            isBlueArchive ? "tsBlueArchiveSplash" : "ts-standard-splash"
        );
        const content = isBlueArchive
            ? splash?.querySelector(".fp-ba-boot-center")
            : splash?.querySelector("img");
        const splashStyle = splash ? getComputedStyle(splash) : null;
        const contentStyle = content ? getComputedStyle(content) : null;
        const rect = content?.getBoundingClientRect();
        return {
            exists: Boolean(splash),
            ariaHidden: splash?.getAttribute("aria-hidden"),
            opacity: splashStyle?.opacity,
            display: splashStyle?.display,
            contentDisplay: contentStyle?.display,
            contentWidth: Math.round(rect?.width || 0),
            contentHeight: Math.round(rect?.height || 0),
        };
    })()`);
}

app.whenReady().then(async () => {
    const window = new BrowserWindow({
        show: false,
        width: 1280,
        height: 800,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
        },
    });

    const standard = await inspectSplash(window, "standard");
    const blueArchive = await inspectSplash(window, "bluearchive");
    const isVisible = (result) =>
        result.exists &&
        result.ariaHidden === "false" &&
        Number(result.opacity) > 0.95 &&
        result.display !== "none" &&
        result.contentDisplay !== "none" &&
        result.contentWidth > 0 &&
        result.contentHeight > 0;
    const ok = isVisible(standard) && isVisible(blueArchive);

    console.log(JSON.stringify({ ok, standard, blueArchive }, null, 2));
    app.exit(ok ? 0 : 1);
});
