export function isSameDay(left: Date, right: Date) {
    return (
        left.getFullYear() === right.getFullYear() &&
        left.getMonth() === right.getMonth() &&
        left.getDate() === right.getDate()
    );
}

export function isYoungerThanMinutes(date: Date, minutes: number) {
    if (!Number.isFinite(minutes) || minutes <= 0) return false;
    const ageMs = Date.now() - date.getTime();
    return ageMs >= 0 && ageMs <= minutes * 60 * 1000;
}

export function startOfWeekMonday(date: Date) {
    const day = date.getDay();
    const difference = (day + 6) % 7;
    const start = new Date(date);
    start.setDate(date.getDate() - difference);
    start.setHours(0, 0, 0, 0);
    return start;
}

export function toDateKey(date: Date) {
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, "0");
    const day = `${date.getDate()}`.padStart(2, "0");
    return `${year}-${month}-${day}`;
}
