const fs = require("fs");

function normalizePriceCad(value) {
    if (value === null || value === undefined) return "";
    const raw = String(value).replace(",", ".").replace(/[^\d.-]/g, "").trim();
    if (!raw) return "";
    const num = Number.parseFloat(raw);
    if (Number.isNaN(num)) return "";
    return num.toFixed(2);
}

function formatPriceCadDisplay(value) {
    const normalized = normalizePriceCad(value);
    if (!normalized) return "";
    return `\u20AC ${normalized}`;
}

function normalizeString(value) {
    if (value === null || value === undefined) return "";
    return String(value).trim();
}

function formatAjvErrors(validator, limit = 12) {
    if (!validator || !Array.isArray(validator.errors) || !validator.errors.length) return "";
    return validator.errors
        .map((err) => {
            const path = err.instancePath || err.dataPath || "";
            return `${path || "root"} ${err.message || "non valido"}`;
        })
        .slice(0, limit)
        .join("\n");
}

function normalizeRequestLine(line) {
    const base = line && typeof line === "object" ? { ...line } : {};
    base.product = normalizeString(base.product);
    base.category = normalizeString(base.category);
    base.quantity = normalizeString(base.quantity);
    base.unit = normalizeString(base.unit);
    base.urgency = normalizeString(base.urgency);
    base.url = normalizeString(base.url);
    base.note = normalizeString(base.note);
    base.interventionType = normalizeString(base.interventionType || base.type);
    base.description = normalizeString(base.description || base.details);
    if (base.priceCad !== undefined) base.priceCad = normalizePriceCad(base.priceCad);
    return base;
}

function unwrapRequestsArray(payload) {
    if (Array.isArray(payload)) return payload;
    if (payload && typeof payload === "object") {
        const candidates = ["requests", "items", "data", "rows", "entries"];
        for (const key of candidates) {
            if (Array.isArray(payload[key])) return payload[key];
        }
    }
    return [];
}

function normalizeRequestsData(payload) {
    const rows = unwrapRequestsArray(payload);
    if (!Array.isArray(rows) || !rows.length) return [];
    return rows
        .map((req) => {
            if (!req || typeof req !== "object") return null;
            const normalized = { ...req };
            normalized.id = normalizeString(normalized.id);
            normalized.createdAt = normalizeString(normalized.createdAt);
            normalized.status = normalizeString(normalized.status);
            normalized.department = normalizeString(normalized.department);
            normalized.employee = normalizeString(normalized.employee);
            normalized.createdBy = normalizeString(normalized.createdBy);
            normalized.adminName = normalizeString(normalized.adminName);
            normalized.notes = normalizeString(normalized.notes);
            let lines = Array.isArray(normalized.lines) ? normalized.lines : null;
            if (!lines) {
                const lineKeys = [
                    "items",
                    "products",
                    "rows",
                    "entries",
                    "records",
                    "righe",
                    "prodotti",
                    "articoli",
                ];
                for (const key of lineKeys) {
                    if (Array.isArray(normalized[key])) {
                        lines = normalized[key];
                        break;
                    }
                }
            }
            if (!Array.isArray(lines)) lines = [];
            normalized.lines = lines.map((line) => normalizeRequestLine(line)).filter(Boolean);
            normalized.history = Array.isArray(normalized.history) ? normalized.history : [];
            return normalized;
        })
        .filter(Boolean);
}

function normalizeCatalogData(payload) {
    if (!Array.isArray(payload)) return [];
    return payload
        .map((item, index) => {
            if (!item || typeof item !== "object") return null;
            const normalized = { ...item };
            const fallbackId = `CAT-${Date.now()}-${index}`;
            normalized.id = normalizeString(normalized.id) || fallbackId;
            normalized.name = normalizeString(normalized.name);
            normalized.description = normalizeString(normalized.description);
            normalized.category = normalizeString(normalized.category);
            normalized.unit = normalizeString(normalized.unit);
            normalized.url = normalizeString(normalized.url);
            normalized.imageUrl = normalizeString(normalized.imageUrl);
            normalized.imageFile = normalizeString(normalized.imageFile);
            normalized.createdAt = normalizeString(normalized.createdAt);
            normalized.updatedAt = normalizeString(normalized.updatedAt);
            return normalized;
        })
        .filter(Boolean);
}

function normalizeCategoriesData(payload) {
    if (!Array.isArray(payload)) return [];
    const cleaned = payload.map((item) => normalizeString(item)).filter(Boolean);
    return Array.from(new Set(cleaned));
}

function normalizeInterventionTypesData(payload) {
    return normalizeCategoriesData(payload);
}

function showAjvReport(label, validator, { showError } = {}) {
    const detail = formatAjvErrors(validator, 24);
    if (detail && typeof showError === "function") {
        showError(`Errori schema AJV (${label}).`, detail);
    }
}

function validateWithAjv(validator, data, label, { showWarning, showError } = {}) {
    if (!validator) return { ok: true, errors: "" };
    const ok = validator(data);
    if (!ok) {
        const detail = formatAjvErrors(validator, 12);
        if (typeof showWarning === "function") {
            showWarning(`Dati ${label} non validi.`, detail);
        }
        showAjvReport(label, validator, { showError });
        return { ok: false, errors: detail };
    }
    return { ok: true, errors: "" };
}

function tryAutoCleanJson(filePath, original, normalized, validator, label, callbacks = {}) {
    try {
        const originalStr = JSON.stringify(original);
        const normalizedStr = JSON.stringify(normalized);
        if (originalStr === normalizedStr) return;
        const result = validateWithAjv(validator, normalized, label, callbacks);
        if (!result.ok) return;
        fs.writeFileSync(filePath, JSON.stringify(normalized, null, 2), "utf8");
    } catch (err) {
        console.error("Errore ripulitura JSON:", err);
    }
}

module.exports = {
    normalizePriceCad,
    formatPriceCadDisplay,
    normalizeString,
    formatAjvErrors,
    normalizeRequestLine,
    normalizeRequestsData,
    normalizeCatalogData,
    normalizeCategoriesData,
    normalizeInterventionTypesData,
    showAjvReport,
    validateWithAjv,
    tryAutoCleanJson,
};
