const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");

ipcMain.on("fp-get-backend-base-url", (event) => {
    event.returnValue =
        process.env.AYPI_BACKEND_URL || "http://192.168.1.240:3000";
});
ipcMain.handle("pm-session-get", async () => null);
ipcMain.handle("pm-session-set", async () => true);
ipcMain.handle("pm-session-clear", async () => true);

app.whenReady().then(async () => {
    const window = new BrowserWindow({
        show: false,
        width: 800,
        height: 900,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
        },
    });
    const pagePath = path.join(
        __dirname,
        "..",
        "dist-ts",
        "pages",
        "utilities",
        "product-manager.html",
    );

    await window.loadFile(pagePath, {
        query: { theme: "bluearchive" },
    });
    await new Promise((resolve) => setTimeout(resolve, 2500));

    const result = await window.webContents.executeJavaScript(`(() => {
        const card = document.querySelector(".pm-catalog-card");
        if (!card) return { ok: false, reason: "catalog-empty" };
        const inspect = (element) => {
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            return {
                className: element.className,
                text: element.textContent.trim().slice(0, 100),
                display: style.display,
                overflow: style.overflow,
                visibility: style.visibility,
                opacity: style.opacity,
                width: Math.round(rect.width),
                height: Math.round(rect.height),
                cssHeight: style.height,
                minHeight: style.minHeight,
                maxHeight: style.maxHeight,
                alignSelf: style.alignSelf,
                alignContent: style.alignContent,
                gridAutoRows: style.gridAutoRows,
                gridTemplateRows: style.gridTemplateRows,
            };
        };
        const grid = document.querySelector(".pm-catalog-grid");
        const image = card.querySelector(".pm-catalog-image");
        const title = card.querySelector(".pm-catalog-title");
        const description = card.querySelector(".pm-catalog-desc");
        const tags = card.querySelector(".pm-tag-list");
        const link = card.querySelector(".pm-link:not(.is-hidden)");
        const actions = card.querySelector(".pm-catalog-actions");
        const elements = {
            grid,
            card,
            image,
            title,
            description,
            tags,
            link,
            actions,
        };
        const layout = Object.fromEntries(
            Object.entries(elements).map(([key, element]) => [
                key,
                element ? inspect(element) : null,
            ]),
        );
        const isVisible = (element) => {
            if (!element) return false;
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            return (
                rect.width > 0 &&
                rect.height > 0 &&
                style.display !== "none" &&
                style.visibility !== "hidden" &&
                style.opacity !== "0"
            );
        };
        const required = [title, actions];
        const optionalWithContent = [
            ...card.querySelectorAll(
                ".pm-catalog-desc, .pm-tag-list, .pm-link:not(.is-hidden)",
            ),
        ].filter((element) => element.textContent.trim());
        const visible =
            required.every(isVisible) &&
            optionalWithContent.every(isVisible) &&
            card.getBoundingClientRect().height >
                image.getBoundingClientRect().height;
        return { ok: visible, layout };
    })()`);

    console.log(JSON.stringify(result, null, 2));
    app.exit(result.ok ? 0 : 1);
}).catch((error) => {
    console.error(error);
    app.exit(1);
});
