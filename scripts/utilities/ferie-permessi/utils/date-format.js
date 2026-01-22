function formatDate(value) {
    if (!value) return "";
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleDateString("it-IT");
}

function formatDateTime(value) {
    if (!value) return "";
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const datePart = date.toLocaleDateString("it-IT");
    const timePart = date.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
    return `${datePart} ${timePart}`;
}

function formatDateParts(value) {
    if (!value) return { date: "", time: "" };
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return { date: "", time: "" };
    return {
        date: date.toLocaleDateString("it-IT"),
        time: date.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" }),
    };
}

module.exports = { formatDate, formatDateTime, formatDateParts };
