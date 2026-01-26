const fs = require("fs");
const { DATA_PATH } = require("../config/paths");
const { ensureFolderFor } = require("./storage");
const { calculateHours } = require("../utils/requests");

const DEFAULT_INITIAL_HOURS = 100;
const MONTHLY_ACCRUAL_HOURS = 16;

function isBalanceNeutral(request) {
    return request && (request.type === "straordinari" || request.type === "mutua");
}

function getMonthKey(date = new Date()) {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    return `${yyyy}-${mm}`;
}

function parseMonthKey(key) {
    if (!key || typeof key !== "string") return null;
    const [yearStr, monthStr] = key.split("-");
    const year = Number(yearStr);
    const month = Number(monthStr);
    if (!Number.isFinite(year) || !Number.isFinite(month)) return null;
    if (month < 1 || month > 12) return null;
    return { year, month };
}

function monthDiff(fromKey, toKey) {
    const from = parseMonthKey(fromKey);
    const to = parseMonthKey(toKey);
    if (!from || !to) return 0;
    const fromTotal = from.year * 12 + (from.month - 1);
    const toTotal = to.year * 12 + (to.month - 1);
    return Math.max(0, toTotal - fromTotal);
}

function getEmployeeKey(employee, department) {
    const name = (employee || "").trim();
    const dept = (department || "").trim();
    if (!name && !dept) return null;
    return `${dept}|${name}`;
}

function listEmployees(assigneeGroups) {
    const rows = [];
    const groups = assigneeGroups || {};
    Object.keys(groups).forEach((department) => {
        const employees = Array.isArray(groups[department]) ? groups[department] : [];
        employees.forEach((employee) => {
            const key = getEmployeeKey(employee, department);
            if (!key) return;
            rows.push({ key, employee, department });
        });
    });
    return rows;
}

function getApprovedHoursForEmployee(requests, employee, department) {
    if (!Array.isArray(requests)) return 0;
    const key = getEmployeeKey(employee, department);
    if (!key) return 0;
    return requests.reduce((total, req) => {
        if (!req || req.status !== "approved") return total;
        if (req.type === "straordinari") return total;
        const reqKey = getEmployeeKey(req.employee, req.department);
        if (reqKey !== key) return total;
        const hours = Number(req.balanceHours);
        if (Number.isFinite(hours) && hours > 0) {
            return total + hours;
        }
        const computed = Math.max(0, Math.round(calculateHours(req) * 100) / 100);
        return total + computed;
    }, 0);
}

function normalizeBalances(payload, assigneeGroups, options = {}) {
    const initialHours = options.initialHours ?? DEFAULT_INITIAL_HOURS;
    const monthlyAccrual = options.monthlyAccrual ?? MONTHLY_ACCRUAL_HOURS;
    const currentMonth = getMonthKey();

    const nextPayload = payload && typeof payload === "object" ? payload : { requests: [] };
    const currentBalances = nextPayload.balances && typeof nextPayload.balances === "object"
        ? nextPayload.balances
        : {};
    const nextBalances = { ...currentBalances };
    let changed = false;

    const employees = listEmployees(assigneeGroups);
    const activeKeys = new Set(employees.map((row) => row.key));

    if (!assigneeGroups || employees.length === 0) {
        if (!nextPayload.balances) {
            nextPayload.balances = nextBalances;
            changed = true;
        }
        return { payload: nextPayload, changed };
    }

    Object.keys(nextBalances).forEach((key) => {
        if (!activeKeys.has(key)) {
            delete nextBalances[key];
            changed = true;
        }
    });

    employees.forEach((row) => {
        const existing = nextBalances[row.key];
        if (!existing) {
            const approvedHours = getApprovedHoursForEmployee(nextPayload.requests, row.employee, row.department);
            nextBalances[row.key] = {
                hoursAvailable: Math.round((initialHours - approvedHours) * 100) / 100,
                lastAccrualMonth: currentMonth,
                monthlyAccrualHours: monthlyAccrual,
                employee: row.employee,
                department: row.department,
            };
            changed = true;
            return;
        }
        if (existing.monthlyAccrualHours == null) {
            existing.monthlyAccrualHours = monthlyAccrual;
            changed = true;
        }
        const lastMonth = existing.lastAccrualMonth || currentMonth;
        const diff = monthDiff(lastMonth, currentMonth);
        if (diff > 0) {
            const hours = Number(existing.hoursAvailable) || 0;
            const perMonth = Number(existing.monthlyAccrualHours);
            const perMonthSafe = Number.isFinite(perMonth) ? perMonth : monthlyAccrual;
            existing.hoursAvailable = hours + diff * perMonthSafe;
            existing.lastAccrualMonth = currentMonth;
            changed = true;
        }
        if (existing.employee !== row.employee || existing.department !== row.department) {
            existing.employee = row.employee;
            existing.department = row.department;
            changed = true;
        }
    });

    if (!nextPayload.balances || changed) {
        nextPayload.balances = nextBalances;
    }

    return { payload: nextPayload, changed };
}

function ensureBalanceEntry(payload, key) {
    if (!key) return null;
    if (!payload.balances) payload.balances = {};
    if (!payload.balances[key]) {
        payload.balances[key] = {
            hoursAvailable: DEFAULT_INITIAL_HOURS,
            lastAccrualMonth: getMonthKey(),
            monthlyAccrualHours: MONTHLY_ACCRUAL_HOURS,
        };
    }
    return payload.balances[key];
}

function applyBalanceForApproval(payload, request) {
    if (!payload || !request) return payload;
    if (request.balanceAppliedAt) return payload;

    const key = getEmployeeKey(request.employee, request.department);
    if (!key) return payload;

    if (isBalanceNeutral(request)) {
        request.balanceHours = 0;
        request.balanceAppliedAt = new Date().toISOString();
        return payload;
    }

    const hours = Math.max(0, Math.round(calculateHours(request) * 100) / 100);
    const entry = ensureBalanceEntry(payload, key);
    entry.hoursAvailable = (Number(entry.hoursAvailable) || 0) - hours;
    request.balanceHours = hours;
    request.balanceAppliedAt = new Date().toISOString();
    return payload;
}

function getBalanceImpact(payload, request) {
    if (!request || !payload) {
        return { negative: false, hoursBefore: 0, hoursAfter: 0, hoursDelta: 0 };
    }
    const key = getEmployeeKey(request.employee, request.department);
    if (!key) {
        return { negative: false, hoursBefore: 0, hoursAfter: 0, hoursDelta: 0 };
    }
    if (isBalanceNeutral(request)) {
        const entry = payload.balances ? payload.balances[key] : null;
        const hoursBefore = entry ? Number(entry.hoursAvailable) || 0 : DEFAULT_INITIAL_HOURS;
        return { negative: false, hoursBefore, hoursAfter: hoursBefore, hoursDelta: 0 };
    }
    const hoursDelta = Math.max(0, Math.round(calculateHours(request) * 100) / 100);
    const entry = payload.balances ? payload.balances[key] : null;
    const hoursBefore = entry ? Number(entry.hoursAvailable) || 0 : DEFAULT_INITIAL_HOURS;
    const hoursAfter = Math.round((hoursBefore - hoursDelta) * 100) / 100;
    return { negative: hoursAfter < 0, hoursBefore, hoursAfter, hoursDelta };
}

function applyMissingRequestDeductions(payload) {
    if (!payload || !Array.isArray(payload.requests)) {
        return { payload, changed: false };
    }
    let changed = false;
    payload.requests.forEach((req) => {
        if (!req || req.status !== "approved") return;
        if (req.balanceAppliedAt) return;
        if (isBalanceNeutral(req)) {
            req.balanceHours = 0;
            req.balanceAppliedAt = new Date().toISOString();
            changed = true;
            return;
        }
        applyBalanceForApproval(payload, req);
        changed = true;
    });
    return { payload, changed };
}

function applyBalanceForDeletion(payload, request) {
    if (!payload || !request) return payload;
    const key = getEmployeeKey(request.employee, request.department);
    if (!key) return payload;
    const hours = Number(request.balanceHours) || 0;
    if (hours <= 0) return payload;
    const entry = ensureBalanceEntry(payload, key);
    entry.hoursAvailable = (Number(entry.hoursAvailable) || 0) + hours;
    return payload;
}

function applyBalanceForUpdate(payload, existingRequest, nextRequest) {
    if (!payload || !existingRequest || !nextRequest) return payload;

    const wasApproved = existingRequest.status === "approved";
    const isApproved = nextRequest.status === "approved";
    if (!wasApproved && !isApproved) return payload;

    const oldKey = getEmployeeKey(existingRequest.employee, existingRequest.department);
    const newKey = getEmployeeKey(nextRequest.employee, nextRequest.department);

    const oldHours = Number(existingRequest.balanceHours) || 0;
    const newHours = isBalanceNeutral(nextRequest)
        ? 0
        : Math.max(0, Math.round(calculateHours(nextRequest) * 100) / 100);

    if (!isApproved) {
        if (wasApproved && oldHours > 0 && oldKey) {
            const entry = ensureBalanceEntry(payload, oldKey);
            entry.hoursAvailable = (Number(entry.hoursAvailable) || 0) + oldHours;
        }
        nextRequest.balanceHours = 0;
        nextRequest.balanceAppliedAt = null;
        return payload;
    }

    if (!oldKey || !newKey) return payload;

    if (oldKey !== newKey) {
        if (oldHours > 0) {
            const entry = ensureBalanceEntry(payload, oldKey);
            entry.hoursAvailable = (Number(entry.hoursAvailable) || 0) + oldHours;
        }
        const entry = ensureBalanceEntry(payload, newKey);
        entry.hoursAvailable = (Number(entry.hoursAvailable) || 0) - newHours;
    } else {
        const delta = newHours - oldHours;
        if (delta !== 0) {
            const entry = ensureBalanceEntry(payload, newKey);
            entry.hoursAvailable = (Number(entry.hoursAvailable) || 0) - delta;
        }
    }

    nextRequest.balanceHours = newHours;
    nextRequest.balanceAppliedAt = new Date().toISOString();
    return payload;
}

function loadPayload() {
    try {
        if (!fs.existsSync(DATA_PATH)) {
            return { requests: [], balances: {} };
        }
        const raw = fs.readFileSync(DATA_PATH, "utf8");
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.requests)) {
            return {
                requests: parsed.requests || [],
                balances: parsed.balances || {},
            };
        }
        if (Array.isArray(parsed)) {
            return { requests: parsed, balances: {} };
        }
        return { requests: [], balances: {} };
    } catch (err) {
        console.error("Errore caricamento dati ferie:", err);
        return { requests: [], balances: {} };
    }
}

function savePayload(payload) {
    try {
        ensureFolderFor(DATA_PATH);
        fs.writeFileSync(DATA_PATH, JSON.stringify(payload, null, 2), "utf8");
        return true;
    } catch (err) {
        console.error("Errore salvataggio ferie:", err);
        return false;
    }
}

module.exports = {
    DEFAULT_INITIAL_HOURS,
    MONTHLY_ACCRUAL_HOURS,
    getMonthKey,
    getEmployeeKey,
    listEmployees,
    normalizeBalances,
    applyMissingRequestDeductions,
    getBalanceImpact,
    applyBalanceForApproval,
    applyBalanceForDeletion,
    applyBalanceForUpdate,
    loadPayload,
    savePayload,
};
