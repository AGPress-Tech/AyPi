const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");

ipcMain.on("fp-get-backend-base-url", event => {
    event.returnValue =
        process.env.AYPI_BACKEND_URL || "http://192.168.1.240:3000";
});
ipcMain.handle("pm-session-get", async () => null);
ipcMain.handle("pm-session-set", async () => true);
ipcMain.handle("pm-session-clear", async () => true);

app.whenReady()
    .then(async () => {
        const window = new BrowserWindow({
            show: false,
            width: 1440,
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
            "product-manager.html"
        );

        await window.loadFile(pagePath, {
            query: { theme: "bluearchive" },
        });
        await new Promise(resolve => setTimeout(resolve, 1400));

        const result = await window.webContents.executeJavaScript(`(() => {
            const modal = document.getElementById("pm-settings-modal");
            modal.classList.remove("is-hidden");
            modal.setAttribute("aria-hidden", "false");
            const visibilityOverride = document.createElement("style");
            visibilityOverride.textContent =
                "body.bluearchive-purchasing #pm-settings-modal .fp-export-section:not(:has(> #pm-theme-open)) { display:grid !important }" +
                "body.bluearchive-purchasing #pm-settings-modal #pm-assignees-open," +
                "body.bluearchive-purchasing #pm-settings-modal #pm-admin-open," +
                "body.bluearchive-purchasing #pm-settings-modal #pm-categories-open," +
                "body.bluearchive-purchasing #pm-settings-modal #pm-settings-backup-open { display:flex !important }";
            document.head.appendChild(visibilityOverride);
            document.getElementById("pm-categories-section").classList.remove("is-hidden");
            document.getElementById("pm-backup-section").classList.remove("is-hidden");

            const card = modal.querySelector(".fp-modal__card");
            const header = modal.querySelector(".fp-assignees-header");
            const buttons = [...modal.querySelectorAll(".fp-export-section .fp-btn")];
            const visibleButtons = buttons.filter(
                button => button.getBoundingClientRect().width > 0
            );
            const firstIcon = visibleButtons[0].querySelector(".fp-btn__icon");
            const darkButton = document.getElementById("pm-categories-open");
            const result = {
                visible: card.getBoundingClientRect().width > 0,
                cardWidth: Math.round(card.getBoundingClientRect().width),
                columns: new Set(
                    visibleButtons.map(button =>
                        Math.round(button.getBoundingClientRect().left)
                    )
                ).size,
                buttonMinHeight: Math.min(
                    ...visibleButtons.map(button =>
                        Math.round(button.getBoundingClientRect().height)
                    )
                ),
                visibleButtonIds: visibleButtons.map(button => button.id),
                visibleButtonWidths: visibleButtons.map(button =>
                    Math.round(button.getBoundingClientRect().width)
                ),
                accents: buttons.map(button =>
                    getComputedStyle(button)
                        .getPropertyValue("--pm-settings-accent")
                        .trim()
                ),
                backdropFilter: getComputedStyle(modal).backdropFilter,
                consoleLabel: getComputedStyle(header, "::before").content,
                titleColor: getComputedStyle(
                    document.getElementById("pm-settings-title")
                ).color,
                routeLabel: getComputedStyle(buttons[0], "::after").content,
                iconTransform: getComputedStyle(firstIcon).transform,
                darkBackground: getComputedStyle(darkButton).backgroundImage,
                darkColor: getComputedStyle(darkButton).color,
                bodyClass: document.body.className,
                buttonDisplays: buttons.map(button => ({
                    id: button.id,
                    button: getComputedStyle(button).display,
                    section: getComputedStyle(button.parentElement).display,
                    width: Math.round(button.getBoundingClientRect().width),
                })),
                iconClass: firstIcon.className,
            };
            result.ok =
                result.visible &&
                result.cardWidth >= 740 &&
                result.columns === 2 &&
                result.buttonMinHeight >= 57 &&
                result.visibleButtonIds.length === 4 &&
                !result.visibleButtonIds.includes("pm-theme-open") &&
                new Set(result.visibleButtonWidths).size === 1 &&
                new Set(result.accents).size === 4 &&
                result.accents.includes("#2dc8ee") &&
                result.accents.includes("#288ff0") &&
                result.accents.includes("#8cdaf4") &&
                result.accents.includes("#17243d") &&
                result.backdropFilter.includes("blur") &&
                result.consoleLabel.includes("CONTROL CONSOLE") &&
                result.titleColor === "rgb(23, 59, 91)" &&
                result.routeLabel.includes("ROUTE 0") &&
                result.iconTransform !== "none" &&
                result.darkBackground.includes("rgb(34, 54, 82)") &&
                result.darkColor === "rgb(255, 255, 255)";
            return result;
        })()`);

        console.log(JSON.stringify(result, null, 2));
        app.exit(result.ok ? 0 : 1);
    })
    .catch(error => {
        console.error(error);
        app.exit(1);
    });
