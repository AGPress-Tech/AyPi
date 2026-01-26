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
        const root = document.getElementById("fp-calendar");
        if (root) {
            root.querySelectorAll(".fp-holiday-name").forEach((node) => node.remove());
        }
        calendar.removeAllEvents();
        const approved = (data.requests || []).filter((req) => req.status === "approved");
        approved.forEach((request) => {
            if (typeof shouldIncludeRequest === "function" && !shouldIncludeRequest(request)) {
                return;
            }
            calendar.addEvent(buildEventFromRequest(request));
        });

        const holidays = Array.isArray(data.holidays) ? data.holidays : [];
        holidays.forEach((entry) => {
            const date = typeof entry === "string" ? entry : entry?.date;
            const name = typeof entry === "string" ? "" : entry?.name;
            if (!date) return;
            calendar.addEvent({
                id: `holiday-${date}`,
                title: name || "Festivita",
                start: date,
                end: addDaysToDateString(date, 1),
                allDay: true,
                display: "background",
                className: "fp-holiday-bg",
                interactive: false,
                extendedProps: { isHoliday: true },
            });
            if (name) {
                const root = document.querySelector(`#fp-calendar [data-date='${date}']`);
                if (!root) return;
                if (root.querySelector(".fp-holiday-name")) return;
                const label = document.createElement("div");
                label.className = "fp-holiday-name";
                label.textContent = name;
                root.appendChild(label);
            }
        });
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
        applyCalendarListStyles(document);
        applyCalendarListHoverStyles(document);
    }

    return { renderAll, renderCalendar, buildEventFromRequest, addDaysToDateString };
}

module.exports = { createRenderer };
