const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");

ipcMain.handle("get-app-version", () => "test");
ipcMain.handle("theme-auth", (_event, password) => ({
    ok: password === "BlueArchive" || password === "AGPress",
}));

app.whenReady().then(async () => {
    const window = new BrowserWindow({
        show: false,
        width: 1100,
        height: 760,
        webPreferences: { nodeIntegration: true, contextIsolation: false },
    });
    const page = (name) => path.join(__dirname, "..", "dist-ts", "pages", name);

    await window.loadFile(page("moduli.html"));
    window.webContents.send("theme-hotkey");
    await new Promise((resolve) => setTimeout(resolve, 100));
    const standardPrompt = await window.webContents.executeJavaScript(
        `document.getElementById("aypi-theme-overlay")?.style.display === "flex"`,
    );

    await window.loadFile(page("bluearchive-preview.html"));
    window.webContents.send("theme-hotkey");
    await new Promise((resolve) => setTimeout(resolve, 100));
    const bluePrompt = await window.webContents.executeJavaScript(
        `document.getElementById("themeBackdrop")?.getAttribute("aria-hidden") === "false"`,
    );

    console.log(JSON.stringify({ standardPrompt, bluePrompt }));
    app.exit(standardPrompt && bluePrompt ? 0 : 1);
});
