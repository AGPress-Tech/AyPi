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
    const { setupFileManager } = require(path.join(__dirname, "..", "dist-ts", "modules", "fileManager.js"));
    setupFileManager(window);

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
        await window.webContents.executeJavaScript(`new Promise(resolve => {
            document.querySelector('[data-page="programmi"]')?.click();
            document.dispatchEvent(new MouseEvent('mousemove', { clientX: 220, clientY: 180 }));
            document.dispatchEvent(new MouseEvent('mousemove', { clientX: 250, clientY: 195 }));
            setTimeout(resolve, 620);
        })`);
        await window.webContents.executeJavaScript(
            `document.getElementById("footerClock")?.click()`,
        );
        const namePromptOpened = await window.webContents.executeJavaScript(`new Promise(resolve => {
            document.getElementById("spineAssistantPlayer")?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
            setTimeout(() => resolve(document.getElementById("nameBackdrop")?.getAttribute("aria-hidden") === "false"), 80);
        })`);
        await window.webContents.executeJavaScript(`new Promise(resolve => {
            const input = document.getElementById("personalName");
            if (input) input.value = "Andrea";
            document.getElementById("nameForm")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
            setTimeout(resolve, 100);
        })`);
        window.webContents.send("admin-hotkey");
        await new Promise(resolve => setTimeout(resolve, 120));
        const adminPromptOpened = await window.webContents.executeJavaScript(
            `document.getElementById("adminBackdrop")?.getAttribute("aria-hidden") === "false"`,
        );
        await window.webContents.executeJavaScript(`new Promise(resolve => {
            const input = document.getElementById("adminPassword");
            if (input) input.value = "AGPress";
            document.getElementById("adminForm")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
            setTimeout(resolve, 180);
        })`);
        const adminEnabled = await window.webContents.executeJavaScript(
            `require("electron").ipcRenderer.invoke("admin-is-enabled")`,
        );
        const result = await window.webContents.executeJavaScript(`({
            assistantClass: document.getElementById("assistant")?.className || "",
            assistantLabel: document.getElementById("assistantLabel")?.textContent || "",
            canvasCount: document.querySelectorAll("#spineAssistantPlayer canvas").length,
            playerText: document.getElementById("spineAssistantPlayer")?.textContent || "",
            timerOpen: document.getElementById("timerBackdrop")?.getAttribute("aria-hidden") === "false",
            menuItems: Array.from(document.querySelectorAll("#quickMenu button")).map(button => button.id),
            transitionedPage: document.getElementById("heroTitle")?.textContent || "",
            trailCanvas: Boolean(document.querySelector(".mouse-trail-canvas")),
            namePromptOpened: ${namePromptOpened},
            personalName: localStorage.getItem("aypi-bluearchive-personal-name-v1"),
            adminPromptOpened: ${adminPromptOpened},
            adminEnabled: ${adminEnabled}
        })`);
        console.log(`PLANA_RESULT=${JSON.stringify(result)}`);
        const planaReady = result.assistantClass.includes("ready")
            && result.assistantLabel.includes("PLANA")
            && result.canvasCount > 0;
        const menuReady = result.menuItems.join(",") === "menuExcel,menuWebsite,menuQuit";
        const transitionReady = result.transitionedPage.includes("Programmi");
        const ok = aronaReady && planaReady && result.timerOpen && menuReady && transitionReady
            && result.adminPromptOpened && result.adminEnabled && result.namePromptOpened
            && result.personalName === "Andrea";
        app.exit(ok ? 0 : 1);
    }, 9000);
});
