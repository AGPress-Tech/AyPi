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
            "product-manager-cart.html"
        );

        await window.loadFile(pagePath, {
            query: { theme: "bluearchive" },
        });
        await new Promise(resolve => setTimeout(resolve, 1200));

        const result = await window.webContents.executeJavaScript(`(() => {
            const fixture = document.createElement("div");
            fixture.className = "pm-table";
            fixture.style.position = "fixed";
            fixture.style.left = "20px";
            fixture.style.top = "20px";
            fixture.style.width = "1100px";
            fixture.innerHTML = \`
                <div class="pm-table__row">
                    <div class="pm-table__cell">Azioni</div>
                    <div class="pm-table__cell pm-table__cell--product">
                        <div class="pm-product-cell">
                            <div class="pm-product-title">Prodotto test</div>
                            <div class="pm-tag-list">
                                <span class="pm-pill" style="--pm-pill-category-color:#ff1744;background:#ff1744;color:#fff">Urgente</span>
                                <span class="pm-pill" style="--pm-pill-category-color:#00c853;background:#00c853;color:#fff">Ricambio lungo</span>
                            </div>
                        </div>
                    </div>
                    <div class="pm-table__cell">1</div>
                    <div class="pm-table__cell">pz</div>
                    <div class="pm-table__cell">media</div>
                    <div class="pm-table__cell">Mario</div>
                    <div class="pm-table__cell">Note</div>
                    <div class="pm-table__cell">24/07</div>
                    <div class="pm-table__cell">Reparto</div>
                    <div class="pm-table__cell">Link</div>
                    <div class="pm-table__cell">Stato</div>
                    <div class="pm-table__cell">Modifica</div>
                </div>
            \`;
            document.body.appendChild(fixture);

            const cell = fixture.querySelector(".pm-table__cell--product");
            const pills = [...fixture.querySelectorAll(".pm-pill")];
            const cellRect = cell.getBoundingClientRect();
            const pillRects = pills.map(pill => pill.getBoundingClientRect());
            const rowCells = [...fixture.querySelectorAll(".pm-table__cell")];
            const firstStyle = getComputedStyle(pills[0]);
            const result = {
                cellOverflow: getComputedStyle(cell).overflow,
                cellPaddingBottom: getComputedStyle(cell).paddingBottom,
                minimumRowCellHeight: Math.min(
                    ...rowCells.map(item => item.getBoundingClientRect().height)
                ),
                pillBackground: firstStyle.backgroundColor,
                pillColor: firstStyle.color,
                pillsInsideCell: pillRects.every(
                    rect =>
                        rect.top >= cellRect.top &&
                        rect.bottom <= cellRect.bottom + 1
                ),
                pillCount: pills.length,
            };
            result.ok =
                result.cellOverflow === "hidden" &&
                parseFloat(result.cellPaddingBottom) >= 9 &&
                result.minimumRowCellHeight >= 68 &&
                result.pillBackground !== "rgb(255, 23, 68)" &&
                result.pillsInsideCell &&
                result.pillCount === 2;
            fixture.remove();
            return result;
        })()`);

        console.log(JSON.stringify(result, null, 2));
        app.exit(result.ok ? 0 : 1);
    })
    .catch(error => {
        console.error(error);
        app.exit(1);
    });
