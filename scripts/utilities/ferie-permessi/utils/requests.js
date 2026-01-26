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

function countWeekdays(startDate, endDate) {
    if (!startDate || !endDate) return 0;
    const start = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
    const end = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
    if (end < start) return 0;
    let count = 0;
    const current = new Date(start);
    while (current <= end) {
        if (!isWeekend(current)) {
            count += 1;
        }
        current.setDate(current.getDate() + 1);
    }
    return count;
}

function calculateHours(request) {
    if (!request) return 0;
    const isStraordinari = request.type === "straordinari";
    if (request.allDay) {
        const startDate = request.start ? new Date(`${request.start}T00:00:00`) : null;
        const endDate = request.end ? new Date(`${request.end}T00:00:00`) : startDate;
        if (!startDate || !endDate) return 0;
        const days = isStraordinari
            ? Math.floor((endDate - startDate) / 86400000) + 1
            : countWeekdays(startDate, endDate);
        return days * 8;
    }
    const start = request.start ? new Date(request.start) : null;
    const end = request.end ? new Date(request.end) : null;
    if (!start || !end) return 0;
    if (!isStraordinari && (isWeekend(start) || isWeekend(end))) return 0;
    const diffHours = (end - start) / 3600000;
    const hours = Math.max(0, Math.round(diffHours * 100) / 100);
    const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate());
    const days = isStraordinari
        ? Math.floor((endDay - startDay) / 86400000) + 1
        : countWeekdays(startDay, endDay);
    const maxHours = Math.max(1, days) * 8;
    return Math.min(hours, maxHours);
}

module.exports = { getRequestDates, calculateHours };
