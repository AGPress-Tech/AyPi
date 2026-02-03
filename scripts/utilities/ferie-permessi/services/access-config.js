const fs = require("fs");

const { CONFIG_PATH } = require("../config/paths");
const { ensureFolderFor } = require("./storage");

const DEFAULT_ACCESS_CONFIG = {
    version: 1,
    operations: {
        create: {
            ferie: false,
            permesso: false,
            straordinari: false,
            mutua: true,
            speciale: true,
            retribuito: true,
        },
        pending: {
            access: true,
            approve: true,
            reject: true,
        },
        editApproved: true,
        deleteApproved: true,
        filters: {
            ferie: false,
            permesso: false,
            straordinari: true,
            mutua: true,
            speciale: true,
            retribuito: true,
        },
        manageAccess: true,
        daysAccess: true,
        export: true,
    },
};

function toBool(value, fallback) {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    if (typeof value === "string") {
        const trimmed = value.trim().toLowerCase();
        if (trimmed === "true" || trimmed === "1" || trimmed === "on" || trimmed === "si") return true;
        if (trimmed === "false" || trimmed === "0" || trimmed === "off" || trimmed === "no") return false;
    }
    return fallback;
}

function normalizeAccessConfig(raw) {
    const base = JSON.parse(JSON.stringify(DEFAULT_ACCESS_CONFIG));
    const src = raw && typeof raw === "object" ? raw : {};
    const ops = src.operations && typeof src.operations === "object" ? src.operations : {};

    const create = ops.create && typeof ops.create === "object" ? ops.create : {};
    const pending = ops.pending && typeof ops.pending === "object" ? ops.pending : {};
    const filters = ops.filters && typeof ops.filters === "object" ? ops.filters : {};

    base.operations.create.ferie = toBool(create.ferie, base.operations.create.ferie);
    base.operations.create.permesso = toBool(create.permesso, base.operations.create.permesso);
    base.operations.create.straordinari = toBool(create.straordinari, base.operations.create.straordinari);
    base.operations.create.mutua = toBool(create.mutua, base.operations.create.mutua);
    base.operations.create.speciale = toBool(create.speciale, base.operations.create.speciale);
    base.operations.create.retribuito = toBool(create.retribuito, base.operations.create.retribuito);

    base.operations.pending.access = toBool(pending.access, base.operations.pending.access);
    base.operations.pending.approve = toBool(pending.approve, base.operations.pending.approve);
    base.operations.pending.reject = toBool(pending.reject, base.operations.pending.reject);

    base.operations.editApproved = toBool(ops.editApproved, base.operations.editApproved);
    base.operations.deleteApproved = toBool(ops.deleteApproved, base.operations.deleteApproved);

    base.operations.filters.ferie = toBool(filters.ferie, base.operations.filters.ferie);
    base.operations.filters.permesso = toBool(filters.permesso, base.operations.filters.permesso);
    base.operations.filters.straordinari = toBool(filters.straordinari, base.operations.filters.straordinari);
    base.operations.filters.mutua = toBool(filters.mutua, base.operations.filters.mutua);
    base.operations.filters.speciale = toBool(filters.speciale, base.operations.filters.speciale);
    base.operations.filters.retribuito = toBool(filters.retribuito, base.operations.filters.retribuito);

    base.operations.manageAccess = toBool(ops.manageAccess, base.operations.manageAccess);
    base.operations.daysAccess = toBool(ops.daysAccess, base.operations.daysAccess);
    base.operations.export = toBool(ops.export, base.operations.export);

    return base;
}

function loadAccessConfig() {
    try {
        if (!CONFIG_PATH || !fs.existsSync(CONFIG_PATH)) {
            return normalizeAccessConfig(null);
        }
        const raw = fs.readFileSync(CONFIG_PATH, "utf8");
        if (!raw) return normalizeAccessConfig(null);
        const parsed = JSON.parse(raw);
        return normalizeAccessConfig(parsed);
    } catch (err) {
        console.error("Errore caricamento config calendario:", err);
        return normalizeAccessConfig(null);
    }
}

function saveAccessConfig(config) {
    try {
        ensureFolderFor(CONFIG_PATH);
        const normalized = normalizeAccessConfig(config);
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(normalized, null, 2), "utf8");
        return normalized;
    } catch (err) {
        console.error("Errore salvataggio config calendario:", err);
        return normalizeAccessConfig(config);
    }
}

module.exports = {
    DEFAULT_ACCESS_CONFIG,
    normalizeAccessConfig,
    loadAccessConfig,
    saveAccessConfig,
};
