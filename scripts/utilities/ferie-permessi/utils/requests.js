function getRequestDates(request) {
    if (!request) return { start: null, end: null };
    if (request.allDay) {
        const start = request.start ? new Date(`${request.start}T00:00:00`) : null;
        const end = request.end
            ? new Date(`${request.end}T23:59:59`)
            : request.start
                ? new Date(`${request.start}T23:59:59`)
                : null;
        return { start, end };
    }
    const start = request.start ? new Date(request.start) : null;
    const end = request.end ? new Date(request.end) : null;
    return { start, end };
}

function isWeekend(date) {
    const day = date.getDay();
    return day === 0 || day === 6;
}

function formatDateKey(date) {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
}

function buildDateSet(items, dateKey = "date") {
    if (!Array.isArray(items)) return new Set();
    const dates = items.map((value) => {
        if (typeof value === "string") return value;
        if (value && typeof value[dateKey] === "string") return value[dateKey];
        return null;
    });
    return new Set(
        dates.filter((value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value))
    );
}

function buildClosureSet(closures) {
    if (!Array.isArray(closures)) return new Set();
    const dates = new Set();
    closures.forEach((item) => {
        if (!item) return;
        const start = typeof item.start === "string" ? item.start : "";
        const end = typeof item.end === "string" ? item.end : start;
        if (!start) return;
        const startDate = new Date(start);
        const endDate = new Date(end || start);
        if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return;
        const rangeStart = startDate <= endDate ? startDate : endDate;
        const rangeEnd = startDate <= endDate ? endDate : startDate;
        const current = new Date(rangeStart);
        while (current <= rangeEnd) {
            const key = formatDateKey(current);
            dates.add(key);
            current.setDate(current.getDate() + 1);
        }
    });
    return dates;
}

function countWeekdays(startDate, endDate, holidaySet, closureSet) {
    if (!startDate || !endDate) return 0;
    const start = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
    const end = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
    if (end < start) return 0;
    let count = 0;
    const current = new Date(start);
    while (current <= end) {
        const key = formatDateKey(current);
        if (
            !isWeekend(current) &&
            !(holidaySet && holidaySet.has(key)) &&
            !(closureSet && closureSet.has(key))
        ) {
            count += 1;
        }
        current.setDate(current.getDate() + 1);
    }
    return count;
}

function calculateHours(request, holidays, closures) {
    if (!request) return 0;
    const isOvertimeLike = request.type === "straordinari" || request.type === "speciale";
    const holidaySet = isOvertimeLike ? null : buildDateSet(holidays, "date");
    const closureSet = isOvertimeLike ? null : buildClosureSet(closures);
    if (request.allDay) {
        const startDate = request.start ? new Date(`${request.start}T00:00:00`) : null;
        const endDate = request.end ? new Date(`${request.end}T00:00:00`) : startDate;
        if (!startDate || !endDate) return 0;
        const days = isOvertimeLike
            ? Math.floor((endDate - startDate) / 86400000) + 1
            : countWeekdays(startDate, endDate, holidaySet, closureSet);
        return days * 8;
    }
    const start = request.start ? new Date(request.start) : null;
    const end = request.end ? new Date(request.end) : null;
    if (!start || !end) return 0;
    if (!isOvertimeLike) {
        const startKey = formatDateKey(start);
        if (
            isWeekend(start) ||
            isWeekend(end) ||
            (holidaySet && holidaySet.has(startKey)) ||
            (closureSet && closureSet.has(startKey))
        ) {
            return 0;
        }
    }
    const diffHours = (end - start) / 3600000;
    const hours = Math.max(0, Math.round(diffHours * 100) / 100);
    const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate());
    const days = isOvertimeLike
        ? Math.floor((endDay - startDay) / 86400000) + 1
        : countWeekdays(startDay, endDay, holidaySet, closureSet);
    const maxHours = Math.max(1, days) * 8;
    return Math.min(hours, maxHours);
}

module.exports = { getRequestDates, calculateHours };
