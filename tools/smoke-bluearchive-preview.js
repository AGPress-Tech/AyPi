const { app, BrowserWindow } = require("electron");
const path = require("path");

app.whenReady().then(async () => {
    const window = new BrowserWindow({
        show: false,
        width: 1360,
        height: 820,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
        },
    });

    window.webContents.on("console-message", (_event, level, message) => {
        console.log(`[renderer:${level}] ${message}`);
    });
    window.webContents.on("did-fail-load", (_event, code, description) => {
        console.error(`[load:${code}] ${description}`);
    });

    await window.webContents.session.clearStorageData({ storages: ["localstorage"] });
    await window.loadFile(
        path.join(__dirname, "..", "dist-ts", "pages", "bluearchive-preview.html"),
    );

    let aronaReady = false;
    setTimeout(async () => {
        const aronaResult = await window.webContents.executeJavaScript(`({
            assistantClass: document.getElementById("assistant")?.className || "",
            assistantLabel: document.getElementById("assistantLabel")?.textContent || "",
            canvasCount: document.querySelectorAll("#spineAssistantPlayer canvas").length
        })`);
        aronaReady = aronaResult.assistantClass.includes("ready")
            && aronaResult.assistantLabel.includes("ARONA")
            && aronaResult.canvasCount > 0;
        console.log(`ARONA_RESULT=${JSON.stringify(aronaResult)}`);
        await window.webContents.executeJavaScript(
            `document.getElementById("assistantSwitch")?.click()`,
        );
    }, 4200);

    setTimeout(async () => {
        await window.webContents.executeJavaScript(
            `document.getElementById("footerClock")?.click()`,
        );
        const result = await window.webContents.executeJavaScript(`({
            assistantClass: document.getElementById("assistant")?.className || "",
            assistantLabel: document.getElementById("assistantLabel")?.textContent || "",
            canvasCount: document.querySelectorAll("#spineAssistantPlayer canvas").length,
            playerText: document.getElementById("spineAssistantPlayer")?.textContent || "",
            timerOpen: document.getElementById("timerBackdrop")?.getAttribute("aria-hidden") === "false",
            menuItems: Array.from(document.querySelectorAll("#quickMenu button")).map(button => button.id)
        })`);
        console.log(`PLANA_RESULT=${JSON.stringify(result)}`);
        const planaReady = result.assistantClass.includes("ready")
            && result.assistantLabel.includes("PLANA")
            && result.canvasCount > 0;
        const menuReady = result.menuItems.join(",") === "menuExcel,menuWebsite,menuQuit";
        const ok = aronaReady && planaReady && result.timerOpen && menuReady;
        app.exit(ok ? 0 : 1);
    }, 9000);
});
