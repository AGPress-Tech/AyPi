const fs = require("fs");
const path = require("path");
const {
    DATA_PATH,
    REQUESTS_PATH,
    HOLIDAYS_PATH,
    BALANCES_PATH,
    CLOSURES_PATH,
    LEGACY_DATA_PATH,
    LEGACY_REQUESTS_PATH,
    LEGACY_HOLIDAYS_PATH,
    LEGACY_BALANCES_PATH,
    LEGACY_CLOSURES_PATH,
} = require("../config/paths");
const { ensureFolderFor } = require("./storage");
const { calculateHours } = require("../utils/requests");

const DEFAULT_INITIAL_HOURS = 100;
const MONTHLY_ACCRUAL_HOURS = 16;
const REQUESTS_SHARDS_DIR = path.join(path.dirname(REQUESTS_PATH), "Calendar Years");
const LEGACY_REQUESTS_SHARDS_DIR = path.join(path.dirname(LEGACY_REQUESTS_PATH), "Calendar Years");
const REQUESTS_SHARD_REGEX = /^requests-(\d{4}|undated)\.json$/i;

function isBalanceNeutral(request) {
    return request && (
        request.type === "straordinari" ||
        request.type === "mutua" ||
        request.type === "retribuito" ||
        request.type === "giustificato"
    );
}

function isSpeciale(request) {
    return request && request.type === "speciale";
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

function dateToKey(date) {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
}

function isWeekend(date) {
    const day = date.getDay();
    return day === 0 || day === 6;
}

function buildHolidaySet(holidays) {
    if (!Array.isArray(holidays)) return new Set();
    const dates = holidays.map((value) => {
        if (typeof value === "string") return value;
        if (value && typeof value.date === "string") return value.date;
        return null;
    }).filter(Boolean);
    return new Set(dates);
}

function buildClosureEligibleSet(closures, holidays) {
    const holidaySet = buildHolidaySet(holidays);
    const dates = new Set();
    normalizeClosures(closures).forEach((closure) => {
        const startDate = new Date(closure.start);
        const endDate = new Date(closure.end || closure.start);
        if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return;
        const rangeStart = startDate <= endDate ? startDate : endDate;
        const rangeEnd = startDate <= endDate ? endDate : startDate;
        const current = new Date(rangeStart);
        while (current <= rangeEnd) {
            const key = dateToKey(current);
            if (!isWeekend(current) && !holidaySet.has(key)) {
                dates.add(key);
            }
            current.setDate(current.getDate() + 1);
        }
    });
    return dates;
}

function calculateSpecialeBonusHours(request, holidays, closures) {
    if (!isSpeciale(request)) return 0;
    const closureSet = buildClosureEligibleSet(closures, holidays);
    if (!closureSet.size) return 0;
    const totalHours = Math.max(0, Math.round(calculateHours(request, holidays, closures) * 100) / 100);
    if (request.allDay) {
        const startDate = request.start ? new Date(`${request.start}T00:00:00`) : null;
        const endDate = request.end ? new Date(`${request.end}T00:00:00`) : startDate;
        if (!startDate || !endDate) return 0;
        const rangeStart = startDate <= endDate ? startDate : endDate;
        const rangeEnd = startDate <= endDate ? endDate : startDate;
        let days = 0;
        const current = new Date(rangeStart);
        while (current <= rangeEnd) {
            const key = dateToKey(current);
            if (closureSet.has(key)) {
                days += 1;
            }
            current.setDate(current.getDate() + 1);
        }
        return days * 8;
    }
    const start = request.start ? new Date(request.start) : null;
    if (!start) return 0;
    const startKey = dateToKey(start);
    if (!closureSet.has(startKey)) return 0;
    return totalHours;
}

function getRequestBalanceHours(request, payload) {
    if (isBalanceNeutral(request)) return 0;
    if (isSpeciale(request)) {
        const bonus = calculateSpecialeBonusHours(request, payload.holidays, payload.closures);
        return bonus > 0 ? -bonus : 0;
    }
    return Math.max(0, Math.round(calculateHours(request, payload.holidays, payload.closures) * 100) / 100);
}
function normalizeClosures(closures) {
    if (!Array.isArray(closures)) return [];
    return closures.map((item) => {
        if (!item) return null;
        if (typeof item === "string") {
            return { start: item, end: item, name: "" };
        }
        const start = typeof item.start === "string" ? item.start : "";
        const end = typeof item.end === "string" ? item.end : start;
        return { start, end: end || start, name: item.name || "" };
    }).filter((item) => item && item.start);
}

function countClosureDaysForMonth(closures, holidays, monthKey, cutoffDate) {
    if (!monthKey) return 0;
    const monthInfo = parseMonthKey(monthKey);
    if (!monthInfo) return 0;
    const holidaySet = buildHolidaySet(holidays);
    const cutoffKey = cutoffDate ? dateToKey(cutoffDate) : null;
    const dates = new Set();
    normalizeClosures(closures).forEach((closure) => {
        const startDate = new Date(closure.start);
        const endDate = new Date(closure.end || closure.start);
        if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return;
        const rangeStart = startDate <= endDate ? startDate : endDate;
        const rangeEnd = startDate <= endDate ? endDate : startDate;
        const current = new Date(rangeStart);
        while (current <= rangeEnd) {
            if (
                current.getFullYear() === monthInfo.year &&
                current.getMonth() + 1 === monthInfo.month
            ) {
                const key = dateToKey(current);
                if (cutoffKey && key > cutoffKey) {
                    current.setDate(current.getDate() + 1);
                    continue;
                }
                if (!isWeekend(current) && !holidaySet.has(key)) {
                    dates.add(key);
                }
            }
            current.setDate(current.getDate() + 1);
        }
    });
    return dates.size;
}

function getEmployeeKey(employee, department) {
    const name = typeof employee === "string"
        ? employee.trim()
        : (employee && typeof employee === "object" ? String(employee.name || "").trim() : "");
    const dept = (department || "").trim();
    if (!name && !dept) return null;
    return `${dept}|${name}`;
}

function listEmployees(assigneeGroups) {
    const rows = [];
    const groups = assigneeGroups || {};
    Object.keys(groups).forEach((department) => {
        const employees = Array.isArray(groups[department]) ? groups[department] : [];
        employees.forEach((employeeEntry) => {
            const employee = typeof employeeEntry === "string"
                ? employeeEntry
                : String(employeeEntry?.name || "");
            const key = getEmployeeKey(employee, department);
            if (!key) return;
            rows.push({ key, employee, department });
        });
    });
    return rows;
}

function getApprovedHoursForEmployee(requests, employee, department, holidays, closures) {
    if (!Array.isArray(requests)) return 0;
    const key = getEmployeeKey(employee, department);
    if (!key) return 0;
    return requests.reduce((total, req) => {
        if (!req || req.status !== "approved") return total;
        if (isBalanceNeutral(req)) return total;
        const reqKey = getEmployeeKey(req.employee, req.department);
        if (reqKey !== key) return total;
        const hours = Number(req.balanceHours);
        if (Number.isFinite(hours) && hours !== 0) {
            return total + hours;
        }
        if (isSpeciale(req)) {
            const bonus = calculateSpecialeBonusHours(req, holidays, closures);
            if (bonus > 0) {
                return total - bonus;
            }
        }
        const computed = Math.max(0, Math.round(calculateHours(req, holidays, closures) * 100) / 100);
        return total + computed;
    }, 0);
}

function normalizeBalances(payload, assigneeGroups, options = {}) {
    const initialHours = options.initialHours ?? DEFAULT_INITIAL_HOURS;
    const monthlyAccrual = options.monthlyAccrual ?? MONTHLY_ACCRUAL_HOURS;
    const currentMonth = getMonthKey();
    const nextPayload = payload && typeof payload === "object" ? payload : { requests: [] };
    const today = new Date();
    const cutoff = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    cutoff.setDate(cutoff.getDate() - 1);
    const closureDays = countClosureDaysForMonth(
        nextPayload.closures,
        nextPayload.holidays,
        currentMonth,
        cutoff
    );
    const closureHours = closureDays * 8;
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
            const approvedHours = getApprovedHoursForEmployee(
                nextPayload.requests,
                row.employee,
                row.department,
                nextPayload.holidays,
                nextPayload.closures
            );
            nextBalances[row.key] = {
                hoursAvailable: Math.round((initialHours - approvedHours) * 100) / 100,
                lastAccrualMonth: currentMonth,
                monthlyAccrualHours: monthlyAccrual,
                employee: row.employee,
                department: row.department,
                closureAppliedMonth: currentMonth,
                closureAppliedHours: 0,
            };
            if (closureHours > 0) {
                nextBalances[row.key].hoursAvailable =
                    Math.round((nextBalances[row.key].hoursAvailable - closureHours) * 100) / 100;
                nextBalances[row.key].closureAppliedHours = closureHours;
            }
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

        if (existing.closureAppliedMonth !== currentMonth) {
            existing.closureAppliedMonth = currentMonth;
            existing.closureAppliedHours = 0;
        }
        const prevApplied = Number(existing.closureAppliedHours) || 0;
        if (closureHours !== prevApplied) {
            const delta = closureHours - prevApplied;
            existing.hoursAvailable = Math.round((Number(existing.hoursAvailable) - delta) * 100) / 100;
            existing.closureAppliedHours = closureHours;
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

    const hours = getRequestBalanceHours(request, payload);
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
    const hoursDelta = getRequestBalanceHours(request, payload);
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
        : getRequestBalanceHours(nextRequest, payload);

    if (!isApproved) {
        if (wasApproved && oldHours !== 0 && oldKey) {
            const entry = ensureBalanceEntry(payload, oldKey);
            entry.hoursAvailable = (Number(entry.hoursAvailable) || 0) + oldHours;
        }
        nextRequest.balanceHours = 0;
        nextRequest.balanceAppliedAt = null;
        return payload;
    }

    if (!oldKey || !newKey) return payload;

    if (oldKey !== newKey) {
        if (oldHours !== 0) {
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

function readJsonFile(filePath) {
    if (!filePath || !fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, "utf8");
    if (!raw) return null;
    return JSON.parse(raw);
}

function normalizeRequestsData(value) {
    if (Array.isArray(value)) return value;
    if (value && Array.isArray(value.requests)) return value.requests;
    return [];
}

function normalizeHolidaysData(value) {
    if (Array.isArray(value)) return value;
    if (value && Array.isArray(value.holidays)) return value.holidays;
    return [];
}

function normalizeClosuresData(value) {
    if (Array.isArray(value)) return value;
    if (value && Array.isArray(value.closures)) return value.closures;
    return [];
}

function normalizeBalancesData(value) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
        if (value.balances && typeof value.balances === "object") {
            return value.balances;
        }
        return value;
    }
    return {};
}

function isRequestsManifest(value) {
    return !!(value && typeof value === "object" && !Array.isArray(value) && value.format === "sharded-v1");
}

function readRequestsFromShardsIn(directory) {
    if (!directory || !fs.existsSync(directory)) return null;
    const files = fs.readdirSync(directory)
        .filter((name) => REQUESTS_SHARD_REGEX.test(name))
        .sort();
    if (!files.length) return null;

    const requests = [];
    files.forEach((name) => {
        const filePath = path.join(directory, name);
        const parsed = readJsonFile(filePath);
        const rows = normalizeRequestsData(parsed);
        rows.forEach((row) => requests.push(row));
    });
    return requests;
}

function readRequestsFromShards() {
    const primary = readRequestsFromShardsIn(REQUESTS_SHARDS_DIR);
    const legacy = readRequestsFromShardsIn(LEGACY_REQUESTS_SHARDS_DIR);
    if (primary && legacy) {
        return getLatestShardWriteTimeMs(REQUESTS_SHARDS_DIR) >= getLatestShardWriteTimeMs(LEGACY_REQUESTS_SHARDS_DIR)
            ? primary
            : legacy;
    }
    return primary || legacy;
}

function getLatestShardWriteTimeMs(directory = REQUESTS_SHARDS_DIR) {
    if (!directory || !fs.existsSync(directory)) return 0;
    const files = fs.readdirSync(directory).filter((name) => REQUESTS_SHARD_REGEX.test(name));
    let latest = 0;
    files.forEach((name) => {
        try {
            const stat = fs.statSync(path.join(directory, name));
            const ms = stat && stat.mtimeMs ? Number(stat.mtimeMs) : 0;
            if (Number.isFinite(ms) && ms > latest) latest = ms;
        } catch (err) {
            // ignore stat errors for single shard
        }
    });
    return latest;
}

function toShardKey(request) {
    if (!request || typeof request !== "object") return "undated";
    const candidates = [request.start, request.end, request.createdAt, request.updatedAt];
    for (let i = 0; i < candidates.length; i += 1) {
        const value = candidates[i];
        if (typeof value !== "string" || !value.trim()) continue;
        const trimmed = value.trim();
        const direct = /^(\d{4})/.exec(trimmed);
        if (direct) return direct[1];
        const parsed = new Date(trimmed);
        if (!Number.isNaN(parsed.getTime())) {
            const year = parsed.getFullYear();
            if (year >= 1900 && year <= 2500) return String(year);
        }
    }
    return "undated";
}

function writeRequestsData(requests) {
    const list = normalizeRequestsData(requests);
    const buckets = new Map();
    list.forEach((request) => {
        const key = toShardKey(request);
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(request);
    });

    ensureFolderFor(path.join(REQUESTS_SHARDS_DIR, "index.json"));
    const legacyShardsEnabled = !!(LEGACY_REQUESTS_SHARDS_DIR && fs.existsSync(LEGACY_REQUESTS_SHARDS_DIR));

    const shardFiles = [];
    buckets.forEach((items, key) => {
        const fileName = `requests-${key}.json`;
        shardFiles.push(fileName);
        writeJsonFile(path.join(REQUESTS_SHARDS_DIR, fileName), items);
        if (legacyShardsEnabled) {
            writeJsonFile(path.join(LEGACY_REQUESTS_SHARDS_DIR, fileName), items);
        }
    });

    const expected = new Set(shardFiles);
    [REQUESTS_SHARDS_DIR, ...(legacyShardsEnabled ? [LEGACY_REQUESTS_SHARDS_DIR] : [])].forEach((directory) => {
        const existing = fs.existsSync(directory) ? fs.readdirSync(directory) : [];
        existing.forEach((name) => {
            if (!REQUESTS_SHARD_REGEX.test(name)) return;
            if (expected.has(name)) return;
            fs.unlinkSync(path.join(directory, name));
        });
    });

    writeJsonFile(REQUESTS_PATH, list);
    if (LEGACY_REQUESTS_PATH && fs.existsSync(LEGACY_REQUESTS_PATH)) {
        writeJsonFile(LEGACY_REQUESTS_PATH, list);
    }
}

function syncLegacyRequestsToShards() {
    try {
        if (!LEGACY_REQUESTS_PATH || !fs.existsSync(LEGACY_REQUESTS_PATH)) {
            return { ok: false, reason: "missing_legacy" };
        }
        const parsed = readJsonFile(LEGACY_REQUESTS_PATH);
        if (parsed == null) {
            return { ok: false, reason: "invalid_legacy" };
        }
        const list = normalizeRequestsData(parsed);
        ensureFolderFor(path.join(REQUESTS_SHARDS_DIR, "index.json"));
        const buckets = new Map();
        list.forEach((request) => {
            const key = toShardKey(request);
            if (!buckets.has(key)) buckets.set(key, []);
            buckets.get(key).push(request);
        });

        const shardFiles = [];
        buckets.forEach((items, key) => {
            const fileName = `requests-${key}.json`;
            shardFiles.push(fileName);
            writeJsonFile(path.join(REQUESTS_SHARDS_DIR, fileName), items);
        });

        const expected = new Set(shardFiles);
        const existing = fs.existsSync(REQUESTS_SHARDS_DIR) ? fs.readdirSync(REQUESTS_SHARDS_DIR) : [];
        existing.forEach((name) => {
            if (!REQUESTS_SHARD_REGEX.test(name)) return;
            if (expected.has(name)) return;
            fs.unlinkSync(path.join(REQUESTS_SHARDS_DIR, name));
        });

        writeJsonFile(REQUESTS_PATH, list);
        return { ok: true, count: list.length, shards: shardFiles.length };
    } catch (err) {
        console.error("Errore sync legacy -> shard:", err);
        return { ok: false, reason: err.message || String(err) };
    }
}

function writeJsonFile(filePath, value) {
    if (!filePath) return;
    ensureFolderFor(filePath);
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function getFileMtimeMs(filePath) {
    try {
        if (!filePath || !fs.existsSync(filePath)) return 0;
        const stat = fs.statSync(filePath);
        return Number(stat.mtimeMs) || 0;
    } catch (err) {
        return 0;
    }
}

function loadPayload() {
    try {
        const parsedRequests = readJsonFile(REQUESTS_PATH);
        const parsedLegacyRequests = readJsonFile(LEGACY_REQUESTS_PATH);
        const parsedHolidays = readJsonFile(HOLIDAYS_PATH);
        const parsedLegacyHolidays = readJsonFile(LEGACY_HOLIDAYS_PATH);
        const parsedBalances = readJsonFile(BALANCES_PATH);
        const parsedLegacyBalances = readJsonFile(LEGACY_BALANCES_PATH);
        const parsedClosures = readJsonFile(CLOSURES_PATH);
        const parsedLegacyClosures = readJsonFile(LEGACY_CLOSURES_PATH);
        const requestsFromShards = readRequestsFromShards();
        const requestsFromFiles =
            parsedRequests != null && !isRequestsManifest(parsedRequests)
                ? normalizeRequestsData(parsedRequests)
                : (parsedLegacyRequests != null && !isRequestsManifest(parsedLegacyRequests)
                    ? normalizeRequestsData(parsedLegacyRequests)
                    : null);

        let requests = null;
        if (requestsFromFiles != null && requestsFromShards != null) {
            const filesMs = Math.max(getFileMtimeMs(REQUESTS_PATH), getFileMtimeMs(LEGACY_REQUESTS_PATH));
            const shardsMs = Math.max(
                getLatestShardWriteTimeMs(REQUESTS_SHARDS_DIR),
                getLatestShardWriteTimeMs(LEGACY_REQUESTS_SHARDS_DIR)
            );
            requests = filesMs >= shardsMs ? requestsFromFiles : requestsFromShards;
        } else if (requestsFromFiles != null) {
            requests = requestsFromFiles;
        } else if (requestsFromShards != null) {
            requests = requestsFromShards;
        }

        let holidays = parsedHolidays == null
            ? (parsedLegacyHolidays == null ? null : normalizeHolidaysData(parsedLegacyHolidays))
            : normalizeHolidaysData(parsedHolidays);
        let balances = parsedBalances == null
            ? (parsedLegacyBalances == null ? null : normalizeBalancesData(parsedLegacyBalances))
            : normalizeBalancesData(parsedBalances);
        let closures = parsedClosures == null
            ? (parsedLegacyClosures == null ? null : normalizeClosuresData(parsedLegacyClosures))
            : normalizeClosuresData(parsedClosures);

        const needsLegacy = requests == null || holidays == null || balances == null || closures == null;
        if (needsLegacy && (fs.existsSync(DATA_PATH) || fs.existsSync(LEGACY_DATA_PATH))) {
            const legacyParsed = readJsonFile(DATA_PATH) || readJsonFile(LEGACY_DATA_PATH);
            if (requests == null) {
                requests = normalizeRequestsData(legacyParsed);
            }
            if (holidays == null) {
                holidays = normalizeHolidaysData(legacyParsed);
            }
            if (balances == null) {
                balances = normalizeBalancesData(legacyParsed);
            }
            if (closures == null) {
                closures = normalizeClosuresData(legacyParsed);
            }

            if (requests != null || holidays != null || balances != null || closures != null) {
                if (requests == null) requests = [];
                if (holidays == null) holidays = [];
                if (balances == null) balances = {};
                if (closures == null) closures = [];
            }
        }

        return {
            requests: requests || [],
            balances: balances || {},
            holidays: holidays || [],
            closures: closures || [],
        };
    } catch (err) {
        console.error("Errore caricamento dati ferie:", err);
        return { requests: [], balances: {}, holidays: [], closures: [] };
    }
}

function savePayload(payload) {
    try {
        const requests = normalizeRequestsData(payload);
        const holidays = normalizeHolidaysData(payload);
        const closures = normalizeClosuresData(payload);
        const balances = normalizeBalancesData(payload?.balances ?? payload);
        writeRequestsData(requests);
        writeJsonFile(HOLIDAYS_PATH, holidays);
        if (LEGACY_HOLIDAYS_PATH && fs.existsSync(LEGACY_HOLIDAYS_PATH)) {
            writeJsonFile(LEGACY_HOLIDAYS_PATH, holidays);
        }
        writeJsonFile(BALANCES_PATH, balances);
        if (LEGACY_BALANCES_PATH && fs.existsSync(LEGACY_BALANCES_PATH)) {
            writeJsonFile(LEGACY_BALANCES_PATH, balances);
        }
        writeJsonFile(CLOSURES_PATH, closures);
        if (LEGACY_CLOSURES_PATH && fs.existsSync(LEGACY_CLOSURES_PATH)) {
            writeJsonFile(LEGACY_CLOSURES_PATH, closures);
        }
        writeJsonFile(DATA_PATH, { requests, balances, holidays, closures });
        if (LEGACY_DATA_PATH && fs.existsSync(LEGACY_DATA_PATH)) {
            writeJsonFile(LEGACY_DATA_PATH, { requests, balances, holidays, closures });
        }
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
    syncLegacyRequestsToShards,
};

