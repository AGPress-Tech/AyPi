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

function calculateHours(request) {
    if (!request) return 0;
    if (request.allDay) {
        const startDate = request.start ? new Date(`${request.start}T00:00:00`) : null;
        const endDate = request.end ? new Date(`${request.end}T00:00:00`) : startDate;
        if (!startDate || !endDate) return 0;
        const days = Math.floor((endDate - startDate) / 86400000) + 1;
        return days * 8;
    }
    const start = request.start ? new Date(request.start) : null;
    const end = request.end ? new Date(request.end) : null;
    if (!start || !end) return 0;
    const diffHours = (end - start) / 3600000;
    const hours = Math.max(0, Math.round(diffHours * 100) / 100);
    const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate());
    const days = Math.floor((endDay - startDay) / 86400000) + 1;
    const maxHours = Math.max(1, days) * 8;
    return Math.min(hours, maxHours);
}

module.exports = { getRequestDates, calculateHours };
