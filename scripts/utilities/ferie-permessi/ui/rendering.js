function createRenderer(options) {
    const {
        document,
        getCalendar,
        setCachedData,
        summaryUi,
        pendingUi,
        applyCalendarListStyles,
        applyCalendarListHoverStyles,
        getTypeColor,
        shouldIncludeRequest,
    } = options || {};

    if (!document) {
        throw new Error("document richiesto.");
    }

    function addDaysToDateString(dateStr, days) {
        if (!dateStr) return dateStr;
        const [year, month, day] = dateStr.split("-").map((v) => parseInt(v, 10));
        if (!year || !month || !day) return dateStr;
        const next = new Date(year, month - 1, day);
        next.setDate(next.getDate() + days);
        const yyyy = next.getFullYear();
        const mm = String(next.getMonth() + 1).padStart(2, "0");
        const dd = String(next.getDate()).padStart(2, "0");
        return `${yyyy}-${mm}-${dd}`;
    }

    function buildEventFromRequest(request) {
        const title = request.employee || "Dipendente";
        const color = getTypeColor(request.type);
        if (request.allDay) {
            const endDate = request.end || request.start;
            return {
                id: request.id,
                title,
                start: request.start,
                end: addDaysToDateString(endDate, 1),
                allDay: true,
                backgroundColor: color,
                borderColor: color,
            };
        }
        return {
            id: request.id,
            title,
            start: request.start,
            end: request.end,
            allDay: false,
            backgroundColor: color,
            borderColor: color,
        };
    }

    function renderCalendar(data) {
        const calendar = getCalendar();
        if (!calendar) return;
        const approved = (data.requests || []).filter((req) => req.status === "approved");
        const holidays = Array.isArray(data.holidays) ? data.holidays : [];
        const closures = Array.isArray(data.closures) ? data.closures : [];
        const renderBatch = () => {
            calendar.removeAllEvents();
            approved.forEach((request) => {
                if (typeof shouldIncludeRequest === "function" && !shouldIncludeRequest(request)) {
                    return;
                }
                calendar.addEvent(buildEventFromRequest(request));
            });
            holidays.forEach((entry) => {
                const date = typeof entry === "string" ? entry : entry?.date;
                const name = typeof entry === "string" ? "" : entry?.name;
                if (!date) return;
                calendar.addEvent({
                    id: `holiday-${date}`,
                    title: "",
                    start: date,
                    end: addDaysToDateString(date, 1),
                    allDay: true,
                    display: "background",
                    className: "fp-holiday-bg",
                    interactive: false,
                    extendedProps: { isHoliday: true, holidayName: name || "" },
                });
            });
            closures.forEach((entry, index) => {
                if (!entry) return;
                const start = typeof entry.start === "string" ? entry.start : "";
                const end = typeof entry.end === "string" ? entry.end : start;
                if (!start) return;
                calendar.addEvent({
                    id: `closure-${start}-${end}-${index}`,
                    title: "",
                    start,
                    end: addDaysToDateString(end || start, 1),
                    allDay: true,
                    display: "background",
                    className: "fp-closure-bg",
                    interactive: false,
                    extendedProps: { isClosure: true, closureName: entry.name || "" },
                });
            });
        };
        if (typeof calendar.batchRendering === "function") {
            calendar.batchRendering(renderBatch);
        } else {
            renderBatch();
        }
    }

    function renderAll(data) {
        const next = data || { requests: [] };
        if (typeof setCachedData === "function") {
            setCachedData(next);
        }
        const splash = document.getElementById("fp-calendar-splash");
        const shouldShowSplash = new URLSearchParams(window.location.search).get("fpSplash") === "1";
        const showModule = () => {
            document.body.classList.remove("fp-splash-active");
            document.body.classList.add("fp-calendar-ready");
        };
        const renderHeavyUi = () => {
            if (summaryUi) {
                summaryUi.renderSummary(next);
            }
            if (pendingUi) {
                pendingUi.renderPendingList(next);
            }
            renderCalendar(next);
            applyCalendarListStyles(document);
            applyCalendarListHoverStyles(document);
        };

        const scheduleRender = () => {
            requestAnimationFrame(() => {
                requestAnimationFrame(renderHeavyUi);
            });
        };

        if (splash && splash.dataset.hidden !== "1") {
            const maxHideMs = 4500;
            setTimeout(() => {
                if (splash.dataset.hidden === "1") return;
                splash.classList.add("is-hidden");
                splash.classList.remove("is-visible", "is-fading");
                splash.dataset.hidden = "1";
                showModule();
            }, maxHideMs);
            const startSplash = () => {
                if (splash.dataset.started === "1") return;
                splash.dataset.started = "1";
                splash.classList.remove("is-hidden", "is-fading");
                splash.classList.add("is-visible");
                const fullOpacityMs = 800;
                const fadeMs = 800;
                setTimeout(() => {
                    splash.classList.add("is-fading");
                    showModule();
                }, fullOpacityMs);
                setTimeout(() => {
                    splash.classList.add("is-hidden");
                    splash.classList.remove("is-visible", "is-fading");
                    splash.dataset.hidden = "1";
                    showModule();
                }, fullOpacityMs + fadeMs);
            };
            if (splash.dataset.checked !== "1") {
                splash.dataset.checked = "1";
                if (!shouldShowSplash) {
                    splash.classList.add("is-hidden");
                    splash.dataset.hidden = "1";
                    showModule();
                    scheduleRender();
                    return;
                }
                startSplash();
                scheduleRender();
                return;
            }
        }
        showModule();
        scheduleRender();
    }

    return { renderAll, renderCalendar, buildEventFromRequest, addDaysToDateString };
}

module.exports = { createRenderer };
