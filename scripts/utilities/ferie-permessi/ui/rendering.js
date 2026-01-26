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
        if (summaryUi) {
            summaryUi.renderSummary(next);
        }
        if (pendingUi) {
            pendingUi.renderPendingList(next);
        }
        renderCalendar(next);
        const splash = document.getElementById("fp-calendar-splash");
        if (splash && splash.dataset.hidden !== "1") {
            if (splash.dataset.started !== "1") {
                splash.dataset.started = "1";
                splash.classList.remove("is-hidden", "is-fading");
                splash.classList.add("is-visible");
                const fullOpacityMs = 2000;
                const fadeMs = 1200;
                setTimeout(() => {
                    splash.classList.add("is-fading");
                    if (!document.body.classList.contains("fp-calendar-ready")) {
                        document.body.classList.add("fp-calendar-ready");
                    }
                }, fullOpacityMs);
                setTimeout(() => {
                    splash.classList.add("is-hidden");
                    splash.classList.remove("is-visible", "is-fading");
                    splash.dataset.hidden = "1";
                    document.body.classList.add("fp-calendar-ready");
                }, fullOpacityMs + fadeMs);
            }
        }
        applyCalendarListStyles(document);
        applyCalendarListHoverStyles(document);
    }

    return { renderAll, renderCalendar, buildEventFromRequest, addDaysToDateString };
}

module.exports = { createRenderer };
