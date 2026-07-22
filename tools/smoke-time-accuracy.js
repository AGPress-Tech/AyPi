const { app, BrowserWindow } = require("electron");
const path = require("path");

app.whenReady().then(async () => {
    const window = new BrowserWindow({
        show: false,
        width: 1360,
        height: 820,
        webPreferences: { nodeIntegration: true, contextIsolation: false },
    });
    await window.loadFile(path.join(__dirname, "..", "dist-ts", "pages", "bluearchive-preview.html"));
    await window.webContents.executeJavaScript(`(() => {
        document.getElementById("stopwatchToggle")?.click();
        document.querySelector('[data-timer-minutes="1"]')?.click();
        document.getElementById("countdownToggle")?.click();
        window.__accuracyStartedAt = performance.now();
    })()`);
    setTimeout(async () => {
        const result = await window.webContents.executeJavaScript(`({
            realElapsedMs: performance.now() - window.__accuracyStartedAt,
            stopwatch: document.getElementById("stopwatchDisplay")?.textContent,
            countdown: document.getElementById("countdownDisplay")?.textContent
        })`);
        console.log(JSON.stringify(result));
        app.exit(0);
    }, 5200);
});
