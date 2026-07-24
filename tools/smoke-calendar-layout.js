const { app, BrowserWindow, ipcMain } = require("electron");
const http = require("http");
const path = require("path");

const today = new Date();
const month = String(today.getMonth() + 1).padStart(2, "0");
const year = today.getFullYear();
const day = `${year}-${month}-10`;
const employees = Array.from({ length: 12 }, (_, index) => `Dipendente ${index + 1}`);
const payload = {
    requests: employees.map((employee, index) => ({
        id: `request-${index + 1}`,
        employee,
        department: "Reparto A",
        type: index % 3 === 0 ? "mutua" : index % 2 === 0 ? "permesso" : "ferie",
        status: "approved",
        start: day,
        end: day,
        allDay: true,
    })),
    balances: {},
    holidays: [],
    closures: [],
};

const server = http.createServer((request, response) => {
    response.setHeader("Content-Type", "application/json");
    if (request.url === "/api/shared/assignees") {
        response.end(JSON.stringify({ groups: { "Reparto A": employees } }));
        return;
    }
    if (request.url === "/api/ferie-permessi/payload") {
        response.end(JSON.stringify(payload));
        return;
    }
    if (
        request.url === "/api/ferie-permessi" ||
        request.url === "/api/ferie-permessi/"
    ) {
        response.end(JSON.stringify(payload));
        return;
    }
    response.end(JSON.stringify({}));
});

ipcMain.handle("show-message-box", async () => ({ response: 0 }));

async function loadPage(window, name, query) {
    await window.loadFile(
        path.join(__dirname, "..", "dist-ts", "pages", "utilities", name),
        { query },
    );
}

app.whenReady().then(async () => {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();
    ipcMain.on("fp-get-backend-base-url", (event) => {
        event.returnValue =
            `http://127.0.0.1:${port}/api/ferie-permessi`;
    });

    const window = new BrowserWindow({
        show: false,
        width: 1536,
        height: 860,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
        },
    });

    await loadPage(window, "ferie-permessi.html", {
        theme: "bluearchive",
        fpSplash: "0",
    });
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await window.webContents.executeJavaScript(`(() => {
        ["fp-filter-ferie", "fp-filter-permesso"].forEach(id => {
            const input = document.getElementById(id);
            input.checked = true;
            input.dispatchEvent(new Event("change", { bubbles: true }));
        });
    })()`);
    await new Promise((resolve) => setTimeout(resolve, 150));
    const calendar = await window.webContents.executeJavaScript(`(() => {
        const filters = document.querySelector(".fp-filters-legend");
        const harness = document.querySelector("#fp-calendar .fc-view-harness");
        const header = document.querySelector(".fp-header");
        const toolbar = document.querySelector(".fc-header-toolbar");
        const toolbarButtons = [...toolbar.querySelectorAll(".fc-button")];
        const prevButton = toolbar.querySelector(".fc-prev-button");
        const prevIcon = prevButton.querySelector(".fc-icon");
        const inactiveViewButton = toolbar.querySelector(".fc-timeGridWeek-button");
        const firstToolbarButtonStyle = getComputedStyle(toolbarButtons[0]);
        const toolbarStyle = getComputedStyle(toolbar);
        const currentTimelineStyle = getComputedStyle(
            toolbar.querySelector(".fc-toolbar-chunk:nth-child(2)"),
            "::before"
        );
        const headerRect = header.getBoundingClientRect();
        const filtersRect = filters.getBoundingClientRect();
        const prevButtonRect = prevButton.getBoundingClientRect();
        const prevIconRect = prevIcon.getBoundingClientRect();
        const ambient = getComputedStyle(document.body, "::before");
        const paletteItem = document.querySelector(".fp-legend__item");
        paletteItem.click();
        const editor = document.getElementById("fp-legend-editor");
        const editorRect = editor.getBoundingClientRect();
        const moreLink = document.querySelector(".fc-daygrid-more-link");
        const crowdedDay = moreLink?.closest(".fc-daygrid-day");
        const visibleCrowdedDayEvents = crowdedDay
            ? [...crowdedDay.querySelectorAll(".fc-daygrid-event-harness")].filter(
                  row => {
                      const style = getComputedStyle(row);
                      const rect = row.getBoundingClientRect();
                      return (
                          style.display !== "none" &&
                          style.visibility !== "hidden" &&
                          rect.width > 0 &&
                          rect.height > 0
                      );
                  }
              ).length
            : 0;
        const activeViewButton = document.querySelector(
            ".fc-button-primary.fc-button-active"
        );
        const calendarScrollers = [...document.querySelectorAll(
            "#fp-calendar .fc-scroller"
        )].map(scroller => ({
            className: scroller.className,
            clientHeight: scroller.clientHeight,
            scrollHeight: scroller.scrollHeight,
            overflowY: getComputedStyle(scroller).overflowY,
        }));
        const quickCommandButtons = [
            "fp-pending-toggle",
            "fp-manage-open",
            "fp-days-manage",
            "fp-export-open",
        ].map(id => document.getElementById(id));
        const pendingBadge = document.getElementById("fp-pending-badge");
        document.getElementById("fp-settings").click();
        const settingsModal = document.getElementById("fp-settings-modal");
        const settingsCard = settingsModal.querySelector(".fp-export-card");
        const settingsButtons = [...settingsModal.querySelectorAll(
            ".fp-export-section .fp-btn"
        )].filter(button => getComputedStyle(button).display !== "none");
        const settingsButtonRects = settingsButtons.map(button =>
            button.getBoundingClientRect()
        );
        const settingsIconRect = settingsButtons[0]
            .querySelector(".fp-btn__icon")
            .getBoundingClientRect();
        return {
            viewportWidth: window.innerWidth,
            compactToolbarMedia: matchMedia("(min-width: 1101px)").matches,
            filtersFit: filters.scrollWidth <= filters.clientWidth,
            filtersHeight: Math.round(filters.getBoundingClientRect().height),
            filtersTopOffset: Math.round(filtersRect.top - headerRect.top),
            filterControlsHeight: Math.round(
                document.querySelector(".fp-calendar-filters")
                    .getBoundingClientRect().height
            ),
            legendHeight: Math.round(
                document.querySelector(".fp-legend").getBoundingClientRect().height
            ),
            headerTitleHeight: Math.round(
                document.querySelector(".fp-header__title")
                    .getBoundingClientRect().height
            ),
            headerActionsHeight: Math.round(
                document.querySelector(".fp-header__actions")
                    .getBoundingClientRect().height
            ),
            viewAnimated: harness.classList.contains("fp-view-transition"),
            ambientAnimation: ambient.animationName,
            displayOverflow: getComputedStyle(filters).overflow,
            colorPickerVisible:
                getComputedStyle(editor).display !== "none" &&
                editorRect.width > 0 &&
                editorRect.height > 0,
            paletteItemActive: paletteItem.classList.contains("is-editing"),
            crowdedDayEventRows:
                crowdedDay?.querySelectorAll(".fc-daygrid-event-harness").length || 0,
            visibleCrowdedDayEvents,
            moreLinkVisible: Boolean(moreLink),
            visibleCrowdedDayRows:
                visibleCrowdedDayEvents + (moreLink ? 1 : 0),
            activeViewColor: activeViewButton
                ? getComputedStyle(activeViewButton).color
                : "",
            toolbarStyled:
                getComputedStyle(toolbar).borderLeftWidth === "4px",
            toolbarHeight: Math.round(toolbar.getBoundingClientRect().height),
            toolbarComputed: {
                minHeight: toolbarStyle.minHeight,
                padding: toolbarStyle.padding,
                marginBottom: toolbarStyle.marginBottom,
            },
            toolbarButtonHeights: toolbarButtons.map(button =>
                Math.round(button.getBoundingClientRect().height)
            ),
            toolbarButtonComputed: {
                minHeight: firstToolbarButtonStyle.minHeight,
                padding: firstToolbarButtonStyle.padding,
                fontSize: firstToolbarButtonStyle.fontSize,
            },
            navigationIconCenterDelta: {
                x: Math.abs(
                    prevButtonRect.left +
                        prevButtonRect.width / 2 -
                        (prevIconRect.left + prevIconRect.width / 2)
                ),
                y: Math.abs(
                    prevButtonRect.top +
                        prevButtonRect.height / 2 -
                        (prevIconRect.top + prevIconRect.height / 2)
                ),
            },
            navigationButtonColor: getComputedStyle(prevButton).color,
            inactiveViewButtonColor: getComputedStyle(inactiveViewButton).color,
            toolbarTitle:
                document.querySelector(".fc-toolbar-title")?.textContent || "",
            currentTimelineFontSize: currentTimelineStyle.fontSize,
            totalEvents: document.querySelectorAll(".fc-event").length,
            headerHeight: Math.round(
                headerRect.height
            ),
            bodyHeight: Math.round(
                document.querySelector(".fp-body").getBoundingClientRect().height
            ),
            calendarCardHeight: Math.round(
                document.querySelector(".fp-calendar").getBoundingClientRect().height
            ),
            calendarScrollers,
            quickCommands: {
                accents: quickCommandButtons.map(button =>
                    getComputedStyle(button)
                        .getPropertyValue("--fp-quick-accent")
                        .trim()
                ),
                darkButtonCount: quickCommandButtons.filter(
                    button =>
                        getComputedStyle(button).color ===
                        "rgb(255, 255, 255)"
                ).length,
                badgeBackground: getComputedStyle(pendingBadge).backgroundImage,
                badgeColor: getComputedStyle(pendingBadge).color,
                badgePosition: {
                    top: getComputedStyle(pendingBadge).top,
                    right: getComputedStyle(pendingBadge).right,
                },
            },
            settingsMenu: {
                visible:
                    !settingsModal.classList.contains("is-hidden") &&
                    settingsCard.getBoundingClientRect().width > 0,
                actionCount: settingsButtons.length,
                columns: new Set(
                    settingsButtonRects.map(rect => Math.round(rect.left))
                ).size,
                cardWidth: Math.round(
                    settingsCard.getBoundingClientRect().width
                ),
                buttonMinHeight: Math.min(
                    ...settingsButtonRects.map(rect => Math.round(rect.height))
                ),
                iconSize: Math.round(settingsIconRect.width),
                routeLabel: getComputedStyle(
                    settingsButtons[0],
                    "::after"
                ).content,
                consoleLabel: getComputedStyle(
                    settingsModal.querySelector(".fp-assignees-header"),
                    "::before"
                ).content,
                backdropFilter: getComputedStyle(settingsModal).backdropFilter,
                cardBackground: getComputedStyle(settingsCard).backgroundImage,
                titleColor: getComputedStyle(
                    settingsModal.querySelector("#fp-settings-title")
                ).color,
                consoleLabelColor: getComputedStyle(
                    settingsModal.querySelector(".fp-assignees-header"),
                    "::before"
                ).color,
                actionColor: getComputedStyle(settingsButtons[0]).color,
                actionBackground: getComputedStyle(settingsButtons[0])
                    .backgroundColor,
                actionBorderColor: getComputedStyle(settingsButtons[0])
                    .borderColor,
                actionAccents: settingsButtons.map(button =>
                    getComputedStyle(button)
                        .getPropertyValue("--fp-settings-accent")
                        .trim()
                ),
                darkActionCount: settingsButtons.filter(
                    button =>
                        getComputedStyle(button).color ===
                        "rgb(255, 255, 255)"
                ).length,
                routeColor: getComputedStyle(
                    settingsButtons[0],
                    "::after"
                ).color,
                iconColor: getComputedStyle(
                    settingsButtons[0].querySelector(".fp-btn__icon")
                ).color,
            },
        };
    })()`);

    await loadPage(window, "ferie-permessi-analysis.html", {
        theme: "bluearchive",
    });
    await window.webContents.executeJavaScript(
        `new Promise(resolve => {
            const done = () => document.getElementById("fpa-bars-canvas") && resolve();
            if (done()) return;
            const timer = setInterval(() => {
                if (!done()) return;
                clearInterval(timer);
            }, 50);
            setTimeout(() => { clearInterval(timer); resolve(); }, 4000);
        })`,
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    const analysis = await window.webContents.executeJavaScript(`(() => {
        const bars = document.getElementById("fpa-bars-chart");
        const canvas = document.getElementById("fpa-bars-canvas");
        const daily = document.getElementById("fpa-daily-table");
        const employee = document.getElementById("fpa-employee-table");
        const dates = document.querySelector(".fpa-grid2");
        const dateInputs = [...dates.querySelectorAll("input")];
        const inspectTable = element => ({
            overflowY: getComputedStyle(element).overflowY,
            scrollable: element.scrollHeight > element.clientHeight,
        });
        return {
            dateInputWidths: dateInputs.map(input =>
                Math.round(input.getBoundingClientRect().width)
            ),
            barsNoHorizontalScroll: bars.scrollWidth <= bars.clientWidth,
            canvasFits: canvas.getBoundingClientRect().width <= bars.clientWidth,
            daily: inspectTable(daily),
            employee: inspectTable(employee),
        };
    })()`);

    const ok =
        calendar.filtersFit &&
        calendar.viewAnimated &&
        calendar.ambientAnimation !== "none" &&
        calendar.displayOverflow === "visible" &&
        calendar.colorPickerVisible &&
        calendar.paletteItemActive &&
        calendar.moreLinkVisible &&
        calendar.visibleCrowdedDayRows === 3 &&
        calendar.activeViewColor === "rgb(255, 255, 255)" &&
        calendar.toolbarStyled &&
        calendar.toolbarHeight >= 58 &&
        calendar.toolbarButtonHeights.every(height => height >= 38) &&
        calendar.navigationIconCenterDelta.x <= 1 &&
        calendar.navigationIconCenterDelta.y <= 1 &&
        calendar.navigationButtonColor === "rgb(23, 77, 115)" &&
        calendar.inactiveViewButtonColor === "rgb(23, 77, 115)" &&
        calendar.currentTimelineFontSize === "9px" &&
        calendar.headerHeight >= 116 &&
        calendar.filtersHeight >= 100 &&
        calendar.calendarCardHeight <= 640 &&
        calendar.calendarScrollers
            .filter(scroller =>
                scroller.className.includes("fc-scroller-liquid-absolute")
            )
            .every(scroller =>
                scroller.overflowY === "hidden" &&
                scroller.scrollHeight <= scroller.clientHeight + 1
            ) &&
        new Set(calendar.quickCommands.accents).size === 4 &&
        calendar.quickCommands.accents.includes("#2dc8ee") &&
        calendar.quickCommands.accents.includes("#288ff0") &&
        calendar.quickCommands.accents.includes("#8cdaf4") &&
        calendar.quickCommands.accents.includes("#17243d") &&
        calendar.quickCommands.darkButtonCount === 1 &&
        calendar.quickCommands.badgeBackground.includes("rgb(255, 114, 150)") &&
        calendar.quickCommands.badgeColor === "rgb(255, 255, 255)" &&
        calendar.quickCommands.badgePosition.top === "-3px" &&
        calendar.quickCommands.badgePosition.right === "-3px" &&
        calendar.settingsMenu.visible &&
        calendar.settingsMenu.actionCount === 6 &&
        calendar.settingsMenu.columns === 2 &&
        calendar.settingsMenu.cardWidth >= 740 &&
        calendar.settingsMenu.buttonMinHeight >= 57 &&
        calendar.settingsMenu.iconSize >= 39 &&
        calendar.settingsMenu.iconSize <= 42 &&
        calendar.settingsMenu.routeLabel.includes("ROUTE 0") &&
        calendar.settingsMenu.consoleLabel.includes("CONTROL CONSOLE") &&
        calendar.settingsMenu.backdropFilter.includes("blur") &&
        calendar.settingsMenu.cardBackground.includes(
            "rgba(255, 255, 255, 0.98)"
        ) &&
        calendar.settingsMenu.titleColor === "rgb(23, 59, 91)" &&
        calendar.settingsMenu.consoleLabelColor === "rgb(22, 142, 234)" &&
        calendar.settingsMenu.actionColor === "rgb(23, 36, 61)" &&
        calendar.settingsMenu.actionBackground ===
            "rgba(255, 255, 255, 0.9)" &&
        calendar.settingsMenu.actionBorderColor ===
            "rgba(31, 114, 168, 0.16)" &&
        new Set(calendar.settingsMenu.actionAccents).size === 4 &&
        calendar.settingsMenu.actionAccents.includes("#2dc8ee") &&
        calendar.settingsMenu.actionAccents.includes("#288ff0") &&
        calendar.settingsMenu.actionAccents.includes("#8cdaf4") &&
        calendar.settingsMenu.actionAccents.includes("#17243d") &&
        calendar.settingsMenu.darkActionCount === 2 &&
        calendar.settingsMenu.routeColor === "rgb(145, 160, 177)" &&
        calendar.settingsMenu.iconColor === "rgb(45, 200, 238)" &&
        analysis.dateInputWidths.every((width) => width <= 116) &&
        analysis.barsNoHorizontalScroll &&
        analysis.canvasFits &&
        analysis.daily.overflowY === "scroll" &&
        analysis.daily.scrollable &&
        analysis.employee.overflowY === "scroll" &&
        analysis.employee.scrollable;
    console.log(JSON.stringify({ ok, calendar, analysis }, null, 2));
    server.close();
    app.exit(ok ? 0 : 1);
});
