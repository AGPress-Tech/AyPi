const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");

let legacyDialogCalls = 0;

ipcMain.on("mostra-robot-popup", () => {
    legacyDialogCalls += 1;
});
ipcMain.handle("ping-robot-dialog", async () => {
    legacyDialogCalls += 1;
    return null;
});
ipcMain.handle(
    "robot-status-custom",
    async (_event, robotId) =>
        new Promise((resolve) =>
            setTimeout(
                () =>
                    resolve({
                        ok: true,
                        robotId,
                        ip: "192.168.1.153",
                        program: "P21160-A",
                        state: "Produzione automatica",
                        counter: "1280",
                        cycleTime: "4.8",
                        details: "Linea operativa",
                    }),
                180,
            ),
        ),
);
ipcMain.handle(
    "ping-robot-custom",
    async (_event, robotId) =>
        new Promise((resolve) =>
            setTimeout(
                () =>
                    resolve({
                        ok: true,
                        robotId,
                        ip: "192.168.1.152",
                        reachable: true,
                        summary: "Persi = 0 (0% persi)",
                        expectedMac: "00:03:1d:11:62:da",
                        detectedMac: "00:03:1d:11:62:da",
                        macConflict: false,
                    }),
                180,
            ),
        ),
);

app.whenReady()
    .then(async () => {
        const window = new BrowserWindow({
            show: false,
            width: 1440,
            height: 900,
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false,
                backgroundThrottling: false,
            },
        });
        await window.loadFile(
            path.join(
                __dirname,
                "..",
                "dist-ts",
                "pages",
                "bluearchive-preview.html",
            ),
        );
        await new Promise((resolve) => setTimeout(resolve, 500));
        await window.webContents.executeJavaScript(
            `document.getElementById("startupSequence")?.click()`,
        );
        await new Promise((resolve) => setTimeout(resolve, 560));
        await window.webContents.executeJavaScript(
            `document.querySelector('[data-page="robot"]').click()`,
        );
        await new Promise((resolve) => setTimeout(resolve, 380));

        const statusLoading = await window.webContents.executeJavaScript(`(() => {
            const card = [...document.querySelectorAll(".module-card")]
                .find(item => item.textContent.includes("21D500"));
            card.click();
            return (
                document.getElementById("robotConsoleBackdrop").getAttribute("aria-hidden") === "false" &&
                !document.getElementById("robotConsoleLoading").hidden
            );
        })()`);
        await new Promise((resolve) => setTimeout(resolve, 260));
        const statusResult = await window.webContents.executeJavaScript(`(() => ({
            visible: !document.getElementById("robotConsoleResult").hidden,
            status: document.getElementById("robotResultStatus").textContent.trim(),
            cards: document.querySelectorAll("#robotResultGrid .robot-result-card").length,
            nativeCardsHidden: document.getElementById("robotConsoleSelector").hidden,
        }))()`);

        await window.webContents.executeJavaScript(
            `document.getElementById("robotConsoleDone").click()`,
        );
        const selector = await window.webContents.executeJavaScript(`(() => {
            const card = [...document.querySelectorAll(".module-card")]
                .find(item => item.textContent.includes("Verifica Connessioni"));
            card.click();
            const choices = [...document.querySelectorAll(".robot-choice")];
            return {
                visible: !document.getElementById("robotConsoleSelector").hidden,
                count: choices.length,
                backgrounds: choices.map(item => getComputedStyle(item).backgroundImage),
                heights: choices.map(item => Math.round(item.getBoundingClientRect().height)),
            };
        })()`);
        const pingLoading = await window.webContents.executeJavaScript(`(() => {
            document.querySelector('[data-robot-ping="21D600"]').click();
            return !document.getElementById("robotConsoleLoading").hidden;
        })()`);
        await new Promise((resolve) => setTimeout(resolve, 260));
        const pingResult = await window.webContents.executeJavaScript(`(() => ({
            visible: !document.getElementById("robotConsoleResult").hidden,
            status: document.getElementById("robotResultStatus").textContent.trim(),
            robot: document.getElementById("robotResultRobot").textContent.trim(),
            backVisible: !document.getElementById("robotConsoleBack").hidden,
            ariaHidden: document.getElementById("robotConsoleBackdrop").getAttribute("aria-hidden"),
            backdropOpacity: getComputedStyle(document.getElementById("robotConsoleBackdrop")).opacity,
            panelWidth: Math.round(document.querySelector(".robot-console").getBoundingClientRect().width),
            panelHeight: Math.round(document.querySelector(".robot-console").getBoundingClientRect().height),
        }))()`);
        await window.webContents.executeJavaScript(
            `document.getElementById("startupSequence")?.remove()`,
        );
        await new Promise((resolve) => setTimeout(resolve, 80));

        const ok =
            statusLoading &&
            statusResult.visible &&
            statusResult.status === "ONLINE" &&
            statusResult.cards >= 4 &&
            statusResult.nativeCardsHidden &&
            selector.visible &&
            selector.count === 3 &&
            new Set(selector.backgrounds).size >= 2 &&
            selector.heights.every((height) => height >= 140) &&
            pingLoading &&
            pingResult.visible &&
            pingResult.status === "ONLINE" &&
            pingResult.robot === "21D600" &&
            pingResult.backVisible &&
            pingResult.ariaHidden === "false" &&
            pingResult.panelWidth >= 700 &&
            pingResult.panelHeight >= 400 &&
            legacyDialogCalls === 0;

        console.log(
            JSON.stringify(
                {
                    ok,
                    statusLoading,
                    statusResult,
                    selector,
                    pingLoading,
                    pingResult,
                    legacyDialogCalls,
                },
                null,
                2,
            ),
        );
        window.destroy();
        app.exit(ok ? 0 : 1);
    })
    .catch((error) => {
        console.error(error);
        app.exit(1);
    });
