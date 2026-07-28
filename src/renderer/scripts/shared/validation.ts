export function isValidEmail(value: unknown) {
    if (!value) return true;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value));
}

export function isValidItalianPhone(value: unknown) {
    if (!value) return false;
    const trimmed = String(value).trim();
    if (!trimmed.startsWith("+39")) return false;
    const digits = trimmed.replace(/\D/g, "");
    return digits.length >= 11 && digits.length <= 13;
}
