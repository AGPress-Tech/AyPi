const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");

ipcMain.on("fp-get-backend-base-url", (event) => {
    event.returnValue = "http://127.0.0.1:9";
});
ipcMain.handle("pm-session-get", async () => null);
ipcMain.handle("pm-session-set", async () => true);
ipcMain.handle("pm-session-clear", async () => true);
ipcMain.handle("show-message-box", async () => ({ response: 0 }));

const cases = [
    ["batch-rename.html", "baBatchRenameSplash", { theme: "bluearchive" }],
    ["compare-folders.html", "baCompareSplash", { theme: "bluearchive" }],
    ["hierarchy.html", "baHierarchySplash", { theme: "bluearchive" }],
    ["file-list.html", "baFileListSplash", { theme: "bluearchive" }],
    ["qr-generator.html", "baQrSplash", { theme: "bluearchive" }],
    [
        "ferie-permessi.html",
        "fp-calendar-splash",
        { theme: "bluearchive", fpSplash: "1" },
    ],
    [
        "product-manager.html",
        "baPurchasingSplash",
        { theme: "bluearchive", pmSplash: "1" },
    ],
    [
        "ticket-support.html",
        "tsBlueArchiveSplash",
        { theme: "bluearchive", tsSplash: "1" },
    ],
];

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
    const results = [];

    for (const [file, id, query] of cases) {
        await window.loadFile(
            path.join(
                __dirname,
                "..",
                "dist-ts",
                "pages",
                "utilities",
                file,
            ),
            { query },
        );
        await delay(550);
        const interaction = await window.webContents.executeJavaScript(`(() => {
            const splash = document.getElementById(${JSON.stringify(id)});
            if (!splash) return { found: false };
            const x = Math.round(window.innerWidth / 2);
            const y = Math.round(window.innerHeight / 2);
            splash.dispatchEvent(new MouseEvent("mousemove", {
                bubbles: true, clientX: x - 20, clientY: y - 10
            }));
            splash.dispatchEvent(new MouseEvent("mousemove", {
                bubbles: true, clientX: x, clientY: y
            }));
            splash.dispatchEvent(new MouseEvent("mousedown", {
                bubbles: true, button: 0, clientX: x, clientY: y
            }));
            splash.dispatchEvent(new MouseEvent("click", {
                bubbles: true, button: 0, clientX: x, clientY: y
            }));
            const layer = document.querySelector(".fp-ba-pointer-layer");
            return {
                found: true,
                skippable: splash.classList.contains("is-splash-skippable"),
                skipping: splash.classList.contains("is-splash-skipping"),
                ring: Boolean(document.querySelector(".fp-ba-click-ring")),
                pointerLayerZ: layer ? Number(getComputedStyle(layer).zIndex) : 0,
                splashZ: Number(getComputedStyle(splash).zIndex) || 0,
            };
        })()`);
        await delay(420);
        const completion = await window.webContents.executeJavaScript(`(() => {
            const splash = document.getElementById(${JSON.stringify(id)});
            return {
                completed:
                    !splash ||
                    splash.dataset.hidden === "1" ||
                    splash.getAttribute("aria-hidden") === "true",
                calendarReady:
                    ${JSON.stringify(id)} !== "fp-calendar-splash" ||
                    document.body.classList.contains("fp-calendar-ready"),
            };
        })()`);
        results.push({ file, id, interaction, completion });
    }

    await window.loadFile(
        path.join(__dirname, "..", "dist-ts", "pages", "index.html"),
    );
    await delay(250);
    const startupInteraction = await window.webContents.executeJavaScript(`(() => {
        const splash = document.getElementById("splash");
        if (!splash) return { found: false };
        const x = Math.round(window.innerWidth / 2);
        const y = Math.round(window.innerHeight / 2);
        splash.dispatchEvent(new MouseEvent("mousedown", {
            bubbles: true, button: 0, clientX: x, clientY: y
        }));
        splash.dispatchEvent(new MouseEvent("click", {
            bubbles: true, button: 0, clientX: x, clientY: y
        }));
        return {
            found: true,
            skipping: splash.classList.contains("is-splash-skipping"),
            ring: Boolean(document.querySelector(".fp-ba-click-ring")),
        };
    })()`);
    await delay(450);
    const startupCompletion = window.webContents
        .getURL()
        .endsWith("/moduli.html");

    const utilitySplashesOk = results.every(
        ({ interaction, completion }) =>
            interaction.found &&
            interaction.skippable &&
            interaction.skipping &&
            interaction.ring &&
            interaction.pointerLayerZ > interaction.splashZ &&
            completion.completed &&
            completion.calendarReady,
    );
    const startupOk =
        startupInteraction.found &&
        startupInteraction.skipping &&
        startupInteraction.ring &&
        startupCompletion;
    const ok = utilitySplashesOk && startupOk;
    console.log(
        JSON.stringify(
            { ok, results, startupInteraction, startupCompletion },
            null,
            2,
        ),
    );
    app.exit(ok ? 0 : 1);
});
