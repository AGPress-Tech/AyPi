require("../../../shared/dev-guards");

type DateLike = Date | string | number | null | undefined;

function toDate(value: DateLike) {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date;
}

export function formatDate(value: DateLike) {
    if (!value) return "";
    const date = toDate(value);
    if (!date) return "";
    return date.toLocaleDateString("it-IT");
}

export function formatDateTime(value: DateLike) {
    if (!value) return "";
    const date = toDate(value);
    if (!date) return "";
    const datePart = date.toLocaleDateString("it-IT");
    const timePart = date.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
    return `${datePart} ${timePart}`;
}

export function formatDateParts(value: DateLike) {
    if (!value) return { date: "", time: "" };
    const date = toDate(value);
    if (!date) return { date: "", time: "" };
    return {
        date: date.toLocaleDateString("it-IT"),
        time: date.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" }),
    };
}

// Keep CommonJS compatibility for legacy JS callers
if (typeof module !== "undefined" && module.exports && !(globalThis as any).__aypiBundled) {
    if (typeof module !== "undefined" && module.exports && !(globalThis as any).__aypiBundled) module.exports = { formatDate, formatDateTime, formatDateParts };
}


