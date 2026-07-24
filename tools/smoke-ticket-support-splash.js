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
    const before = await window.webContents.executeJavaScript(`(() => {
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
    const interaction = await window.webContents.executeJavaScript(`(() => {
        const isBlueArchive = ${JSON.stringify(theme)} === "bluearchive";
        const splash = document.getElementById(
            isBlueArchive ? "tsBlueArchiveSplash" : "ts-standard-splash"
        );
        if (!splash) return { clicked: false };
        const x = Math.round(window.innerWidth / 2);
        const y = Math.round(window.innerHeight / 2);
        splash.dispatchEvent(new MouseEvent("mousemove", {
            bubbles: true,
            clientX: x - 20,
            clientY: y - 10,
        }));
        splash.dispatchEvent(new MouseEvent("mousemove", {
            bubbles: true,
            clientX: x,
            clientY: y,
        }));
        splash.dispatchEvent(new MouseEvent("mousedown", {
            bubbles: true,
            button: 0,
            clientX: x,
            clientY: y,
        }));
        splash.dispatchEvent(new MouseEvent("click", {
            bubbles: true,
            button: 0,
            clientX: x,
            clientY: y,
        }));
        const layer = document.querySelector(".fp-ba-pointer-layer");
        return {
            clicked: true,
            skipClass: splash.classList.contains("is-splash-skipping"),
            fading:
                splash.classList.contains("is-fading") ||
                splash.classList.contains("is-leaving"),
            ringVisible: Boolean(document.querySelector(".fp-ba-click-ring")),
            pointerLayerZ: layer ? Number(getComputedStyle(layer).zIndex) : 0,
            splashZ: Number(getComputedStyle(splash).zIndex) || 0,
        };
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 420));
    const after = await window.webContents.executeJavaScript(`(() => {
        const isBlueArchive = ${JSON.stringify(theme)} === "bluearchive";
        const splash = document.getElementById(
            isBlueArchive ? "tsBlueArchiveSplash" : "ts-standard-splash"
        );
        return {
            exists: Boolean(splash),
            hidden:
                !splash ||
                splash.dataset.hidden === "1" ||
                splash.getAttribute("aria-hidden") === "true",
        };
    })()`);
    return { before, interaction, after };
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
        result.before.exists &&
        result.before.ariaHidden === "false" &&
        Number(result.before.opacity) > 0.95 &&
        result.before.display !== "none" &&
        result.before.contentDisplay !== "none" &&
        result.before.contentWidth > 0 &&
        result.before.contentHeight > 0;
    const skipped = (result) =>
        result.interaction.clicked &&
        result.interaction.skipClass &&
        result.interaction.fading &&
        result.after.hidden;
    const blueArchiveEffects =
        blueArchive.interaction.ringVisible &&
        blueArchive.interaction.pointerLayerZ >
            blueArchive.interaction.splashZ;
    const ok =
        isVisible(standard) &&
        isVisible(blueArchive) &&
        skipped(standard) &&
        skipped(blueArchive) &&
        blueArchiveEffects;

    console.log(JSON.stringify({ ok, standard, blueArchive }, null, 2));
    app.exit(ok ? 0 : 1);
});
