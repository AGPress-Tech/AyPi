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
        calendar.removeAllEvents();
        const approved = (data.requests || []).filter((req) => req.status === "approved");
        approved.forEach((request) => {
            calendar.addEvent(buildEventFromRequest(request));
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
