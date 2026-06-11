import { calculateHours } from "./hours";
import type {
    AssigneesPayload,
    BalanceEntry,
    ClosureLike,
    FpPayload,
    HolidayLike,
    RequestLike,
} from "./types";

export const DEFAULT_INITIAL_HOURS = 100;
export const MONTHLY_ACCRUAL_HOURS = 16;

function normalizeIdentityValue(value: unknown) {
    return String(value || "")
        .trim()
        .replace(/\s+/g, " ")
        .toLocaleLowerCase("it-IT");
}

function isBalanceNeutral(request: RequestLike | null | undefined) {
    return (
        request &&
        (request.type === "straordinari" ||
            request.type === "mutua" ||
            request.type === "infortunio" ||
            request.type === "retribuito" ||
            request.type === "giustificato")
    );
}

function isSpeciale(request: RequestLike | null | undefined) {
    return request && request.type === "speciale";
}

function getMonthKey(date = new Date()) {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    return `${yyyy}-${mm}`;
}

function parseMonthKey(key: string) {
    if (!key || typeof key !== "string") return null;
    const [yearStr, monthStr] = key.split("-");
    const year = Number(yearStr);
    const month = Number(monthStr);
    if (!Number.isFinite(year) || !Number.isFinite(month)) return null;
    if (month < 1 || month > 12) return null;
    return { year, month };
}

function monthDiff(fromKey: string, toKey: string) {
    const from = parseMonthKey(fromKey);
    const to = parseMonthKey(toKey);
    if (!from || !to) return 0;
    const fromTotal = from.year * 12 + (from.month - 1);
    const toTotal = to.year * 12 + (to.month - 1);
    return Math.max(0, toTotal - fromTotal);
}

function dateToKey(date: Date) {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
}

function isWeekend(date: Date) {
    const day = date.getDay();
    return day === 0 || day === 6;
}

function buildHolidaySet(holidays: HolidayLike[] | null | undefined) {
    if (!Array.isArray(holidays)) return new Set<string>();
    const dates = holidays
        .map((value) => {
            if (typeof value === "string") return value;
            if (value && typeof value.date === "string") return value.date;
            return null;
        })
        .filter(Boolean) as string[];
    return new Set(dates);
}

type NormalizedClosure = { start: string; end: string; name: string };

function normalizeClosures(
    closures: ClosureLike[] | null | undefined,
): NormalizedClosure[] {
    if (!Array.isArray(closures)) return [];
    return closures
        .map((item) => {
            if (!item) return null;
            if (typeof item === "string") {
                return { start: item, end: item, name: "" };
            }
            const start = typeof item.start === "string" ? item.start : "";
            const end = typeof item.end === "string" ? item.end : start;
            return { start, end: end || start, name: item.name || "" };
        })
        .filter((item): item is NormalizedClosure => !!item && !!item.start);
}

function buildClosureEligibleSet(
    closures: ClosureLike[] | null | undefined,
    holidays: HolidayLike[] | null | undefined,
) {
    const holidaySet = buildHolidaySet(holidays);
    const dates = new Set<string>();
    normalizeClosures(closures).forEach((closure) => {
        const startDate = new Date(closure.start);
        const endDate = new Date(closure.end || closure.start);
        if (
            Number.isNaN(startDate.getTime()) ||
            Number.isNaN(endDate.getTime())
        )
            return;
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

function calculateSpecialeBonusHours(
    request: RequestLike,
    holidays: HolidayLike[] | null | undefined,
    closures: ClosureLike[] | null | undefined,
) {
    if (!isSpeciale(request)) return 0;
    const closureSet = buildClosureEligibleSet(closures, holidays);
    if (!closureSet.size) return 0;
    const totalHours = Math.max(
        0,
        Math.round(calculateHours(request, holidays, closures) * 100) / 100,
    );
    if (request.allDay) {
        const startDate = request.start
            ? new Date(`${request.start}T00:00:00`)
            : null;
        const endDate = request.end
            ? new Date(`${request.end}T00:00:00`)
            : startDate;
        if (!startDate || !endDate) return 0;
        const rangeStart = startDate <= endDate ? startDate : endDate;
        const rangeEnd = startDate <= endDate ? endDate : startDate;
        let days = 0;
        const current = new Date(rangeStart);
        while (current <= rangeEnd) {
            if (closureSet.has(dateToKey(current))) days += 1;
            current.setDate(current.getDate() + 1);
        }
        return days * 8;
    }
    const start = request.start ? new Date(request.start) : null;
    if (!start) return 0;
    return closureSet.has(dateToKey(start)) ? totalHours : 0;
}

function getRequestBalanceHours(request: RequestLike, payload: FpPayload) {
    if (isBalanceNeutral(request)) return 0;
    if (isSpeciale(request)) {
        const bonus = calculateSpecialeBonusHours(
            request,
            payload.holidays,
            payload.closures,
        );
        return bonus > 0 ? -bonus : 0;
    }
    return Math.max(
        0,
        Math.round(
            calculateHours(request, payload.holidays, payload.closures) * 100,
        ) / 100,
    );
}

function countClosureDaysForMonth(
    closures: ClosureLike[] | null | undefined,
    holidays: HolidayLike[] | null | undefined,
    monthKey: string,
    cutoffDate: Date | null,
) {
    const monthInfo = parseMonthKey(monthKey);
    if (!monthInfo) return 0;
    const holidaySet = buildHolidaySet(holidays);
    const cutoffKey = cutoffDate ? dateToKey(cutoffDate) : null;
    const dates = new Set<string>();
    normalizeClosures(closures).forEach((closure) => {
        const startDate = new Date(closure.start);
        const endDate = new Date(closure.end || closure.start);
        if (
            Number.isNaN(startDate.getTime()) ||
            Number.isNaN(endDate.getTime())
        )
            return;
        const rangeStart = startDate <= endDate ? startDate : endDate;
        const rangeEnd = startDate <= endDate ? endDate : startDate;
        const current = new Date(rangeStart);
        while (current <= rangeEnd) {
            if (
                current.getFullYear() === monthInfo.year &&
                current.getMonth() + 1 === monthInfo.month
            ) {
                const key = dateToKey(current);
                if (!cutoffKey || key <= cutoffKey) {
                    if (!isWeekend(current) && !holidaySet.has(key)) {
                        dates.add(key);
                    }
                }
            }
            current.setDate(current.getDate() + 1);
        }
    });
    return dates.size;
}

export function getEmployeeKey(
    employee: RequestLike["employee"],
    department?: string | null,
) {
    const name =
        typeof employee === "string"
            ? employee.trim()
            : employee && typeof employee === "object"
              ? String(employee.name || "").trim()
              : "";
    const dept = (department || "").trim();
    if (!name && !dept) return null;
    return `${dept}|${name}`;
}

function extractEmployeeNameFromKey(key: string | null | undefined) {
    if (!key || typeof key !== "string") return "";
    const separatorIndex = key.indexOf("|");
    if (separatorIndex < 0) return key.trim();
    return key.slice(separatorIndex + 1).trim();
}

function listBalanceEntries(
    balances: Record<string, BalanceEntry> | null | undefined,
) {
    return Object.entries(balances || {}).map(([key, entry]) => ({ key, entry }));
}

function buildAssigneeEmailMap(assignees: AssigneesPayload | null | undefined) {
    const emails = assignees?.emails || {};
    const map = new Map<string, string>();
    Object.keys(emails).forEach((key) => {
        const email = String(emails[key] || "").trim().toLocaleLowerCase("it-IT");
        if (!email) return;
        map.set(key, email);
    });
    return map;
}

function findBalanceKeyByAlias(
    balances: Record<string, BalanceEntry> | null | undefined,
    key: string | null,
) {
    if (!key) return null;
    const entries = listBalanceEntries(balances);
    for (const { key: balanceKey, entry } of entries) {
        if (!Array.isArray(entry?.previousKeys)) continue;
        if (entry.previousKeys.includes(key)) return balanceKey;
    }
    return null;
}

function findBalanceKeyByEmployeeName(
    balances: Record<string, BalanceEntry> | null | undefined,
    employeeName: string,
    ignoredKeys?: Set<string>,
) {
    const target = normalizeIdentityValue(employeeName);
    if (!target) return null;
    const entries = listBalanceEntries(balances).filter(({ key }) => !ignoredKeys?.has(key));
    const matches = entries.filter(({ key, entry }) => {
        const candidateName = entry?.employee || extractEmployeeNameFromKey(key);
        return normalizeIdentityValue(candidateName) === target;
    });
    if (matches.length !== 1) return null;
    return matches[0].key;
}

function findBalanceKeyByEmail(
    balances: Record<string, BalanceEntry> | null | undefined,
    email: string,
    ignoredKeys?: Set<string>,
) {
    const target = normalizeIdentityValue(email);
    if (!target) return null;
    const entries = listBalanceEntries(balances).filter(({ key }) => !ignoredKeys?.has(key));
    const matches = entries.filter(({ entry }) => {
        return normalizeIdentityValue(entry?.employeeEmail) === target;
    });
    if (matches.length !== 1) return null;
    return matches[0].key;
}

function resolveBalanceKey(
    balances: Record<string, BalanceEntry> | null | undefined,
    key: string | null,
) {
    if (!key) return null;
    if (balances && balances[key]) return key;
    const aliasKey = findBalanceKeyByAlias(balances, key);
    if (aliasKey) return aliasKey;
    const employeeName = extractEmployeeNameFromKey(key);
    return findBalanceKeyByEmployeeName(balances, employeeName);
}

function listEmployees(assignees: AssigneesPayload | null | undefined) {
    const rows: Array<{ key: string; employee: string; department: string }> = [];
    const groups = assignees?.groups || {};
    Object.keys(groups).forEach((department) => {
        const employees = Array.isArray(groups[department]) ? groups[department] : [];
        employees.forEach((employee) => {
            const key = getEmployeeKey(employee, department);
            if (!key) return;
            rows.push({ key, employee: String(employee), department });
        });
    });
    return rows;
}

function getApprovedHoursForEmployee(
    requests: RequestLike[] | null | undefined,
    employee: string,
    department: string,
    holidays: HolidayLike[] | null | undefined,
    closures: ClosureLike[] | null | undefined,
) {
    if (!Array.isArray(requests)) return 0;
    const key = getEmployeeKey(employee, department);
    if (!key) return 0;
    return requests.reduce((total, req) => {
        if (!req || req.status !== "approved") return total;
        if (isBalanceNeutral(req)) return total;
        if (getEmployeeKey(req.employee, req.department) !== key) return total;
        const hours = Number(req.balanceHours);
        if (Number.isFinite(hours) && hours !== 0) return total + hours;
        if (isSpeciale(req)) {
            const bonus = calculateSpecialeBonusHours(req, holidays, closures);
            if (bonus > 0) return total - bonus;
        }
        return (
            total +
            Math.max(
                0,
                Math.round(calculateHours(req, holidays, closures) * 100) / 100,
            )
        );
    }, 0);
}

export function normalizeBalances(
    payload: FpPayload,
    assignees: AssigneesPayload | null | undefined,
) {
    const currentMonth = getMonthKey();
    const today = new Date();
    const cutoff = new Date(
        today.getFullYear(),
        today.getMonth(),
        today.getDate(),
    );
    cutoff.setDate(cutoff.getDate() - 1);
    const closureHours =
        countClosureDaysForMonth(
            payload.closures,
            payload.holidays,
            currentMonth,
            cutoff,
        ) * 8;
    const nextBalances: Record<string, BalanceEntry> = {
        ...(payload.balances || {}),
    };
    const employees = listEmployees(assignees);
    const activeKeys = new Set(employees.map((row) => row.key));
    const claimedKeys = new Set<string>();
    const assigneeEmails = buildAssigneeEmailMap(assignees);

    employees.forEach((row) => {
        const rowEmail = assigneeEmails.get(row.key) || "";
        let resolvedKey = nextBalances[row.key] ? row.key : null;
        if (!resolvedKey && rowEmail) {
            resolvedKey = findBalanceKeyByEmail(nextBalances, rowEmail, claimedKeys);
        }
        if (!resolvedKey) {
            resolvedKey = findBalanceKeyByEmployeeName(
                nextBalances,
                row.employee,
                claimedKeys,
            );
        }

        if (resolvedKey && resolvedKey !== row.key && nextBalances[resolvedKey]) {
            const movedEntry = nextBalances[resolvedKey];
            const previousKeys = new Set<string>([
                ...(Array.isArray(movedEntry.previousKeys) ? movedEntry.previousKeys : []),
                resolvedKey,
            ]);
            nextBalances[row.key] = {
                ...movedEntry,
                employee: row.employee,
                department: row.department,
                employeeEmail: rowEmail || movedEntry.employeeEmail || "",
                inactive: false,
                previousKeys: Array.from(previousKeys).filter(
                    (value) => value && value !== row.key,
                ),
            };
            delete nextBalances[resolvedKey];
            resolvedKey = row.key;
        }

        const existing = resolvedKey ? nextBalances[resolvedKey] : null;
        if (!existing) {
            const approvedHours = getApprovedHoursForEmployee(
                payload.requests,
                row.employee,
                row.department,
                payload.holidays,
                payload.closures,
            );
            nextBalances[row.key] = {
                hoursAvailable:
                    Math.round((DEFAULT_INITIAL_HOURS - approvedHours) * 100) / 100,
                lastAccrualMonth: currentMonth,
                monthlyAccrualHours: MONTHLY_ACCRUAL_HOURS,
                employee: row.employee,
                department: row.department,
                employeeEmail: rowEmail,
                closureAppliedMonth: currentMonth,
                closureAppliedHours: closureHours,
                inactive: false,
                previousKeys: [],
            };
            if (closureHours > 0) {
                nextBalances[row.key].hoursAvailable =
                    Math.round(
                        (nextBalances[row.key].hoursAvailable - closureHours) * 100,
                    ) / 100;
            }
            claimedKeys.add(row.key);
            return;
        }
        if (existing.monthlyAccrualHours == null) {
            existing.monthlyAccrualHours = MONTHLY_ACCRUAL_HOURS;
        }
        const diff = monthDiff(existing.lastAccrualMonth || currentMonth, currentMonth);
        if (diff > 0) {
            existing.hoursAvailable =
                (Number(existing.hoursAvailable) || 0) +
                diff * (Number(existing.monthlyAccrualHours) || MONTHLY_ACCRUAL_HOURS);
            existing.lastAccrualMonth = currentMonth;
        }
        existing.employee = row.employee;
        existing.department = row.department;
        existing.employeeEmail = rowEmail || existing.employeeEmail || "";
        existing.inactive = false;
        existing.previousKeys = Array.isArray(existing.previousKeys)
            ? Array.from(
                  new Set(
                      existing.previousKeys.filter(
                          (value) => value && value !== resolvedKey,
                      ),
                  ),
              )
            : [];
        if (existing.closureAppliedMonth !== currentMonth) {
            existing.closureAppliedMonth = currentMonth;
            existing.closureAppliedHours = 0;
        }
        const prevApplied = Number(existing.closureAppliedHours) || 0;
        if (closureHours !== prevApplied) {
            existing.hoursAvailable =
                Math.round(
                    ((Number(existing.hoursAvailable) || 0) -
                        (closureHours - prevApplied)) *
                        100,
                ) / 100;
            existing.closureAppliedHours = closureHours;
        }
        if (resolvedKey) claimedKeys.add(resolvedKey);
    });

    Object.keys(nextBalances).forEach((key) => {
        if (activeKeys.has(key)) return;
        nextBalances[key].inactive = true;
    });

    payload.balances = nextBalances;
    return payload;
}

function ensureBalanceEntry(payload: FpPayload, key: string | null) {
    if (!key) return null;
    if (!payload.balances) payload.balances = {};
    const resolvedKey = resolveBalanceKey(payload.balances, key) || key;
    if (!payload.balances[resolvedKey]) {
        payload.balances[resolvedKey] = {
            hoursAvailable: DEFAULT_INITIAL_HOURS,
            lastAccrualMonth: getMonthKey(),
            monthlyAccrualHours: MONTHLY_ACCRUAL_HOURS,
            inactive: false,
            previousKeys: [],
        };
    }
    return payload.balances[resolvedKey];
}

export function getBalanceImpact(payload: FpPayload, request: RequestLike) {
    const key = getEmployeeKey(request.employee, request.department);
    const resolvedKey = key ? resolveBalanceKey(payload.balances, key) : null;
    const entry = resolvedKey && payload.balances ? payload.balances[resolvedKey] : null;
    const hoursBefore = entry
        ? Number(entry.hoursAvailable) || 0
        : DEFAULT_INITIAL_HOURS;
    const hoursDelta = isBalanceNeutral(request)
        ? 0
        : getRequestBalanceHours(request, payload);
    const hoursAfter = Math.round((hoursBefore - hoursDelta) * 100) / 100;
    return { negative: hoursAfter < 0, hoursBefore, hoursAfter, hoursDelta };
}

export function applyBalanceForApproval(payload: FpPayload, request: RequestLike) {
    if (request.balanceAppliedAt) return payload;
    const key = getEmployeeKey(request.employee, request.department);
    if (!key) return payload;
    if (isBalanceNeutral(request)) {
        request.balanceHours = 0;
        request.balanceAppliedAt = new Date().toISOString();
        return payload;
    }
    const entry = ensureBalanceEntry(payload, key);
    if (!entry) return payload;
    const hours = getRequestBalanceHours(request, payload);
    entry.hoursAvailable = (Number(entry.hoursAvailable) || 0) - hours;
    request.balanceHours = hours;
    request.balanceAppliedAt = new Date().toISOString();
    return payload;
}

export function applyBalanceForDeletion(payload: FpPayload, request: RequestLike) {
    const key = getEmployeeKey(request.employee, request.department);
    if (!key) return payload;
    const entry = ensureBalanceEntry(payload, key);
    if (!entry) return payload;
    entry.hoursAvailable = (Number(entry.hoursAvailable) || 0) + (Number(request.balanceHours) || 0);
    return payload;
}

export function applyBalanceForUpdate(
    payload: FpPayload,
    existingRequest: RequestLike,
    nextRequest: RequestLike,
) {
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
            if (entry) entry.hoursAvailable = (Number(entry.hoursAvailable) || 0) + oldHours;
        }
        nextRequest.balanceHours = 0;
        nextRequest.balanceAppliedAt = null;
        return payload;
    }

    if (!oldKey || !newKey) return payload;
    if (oldKey !== newKey) {
        if (oldHours !== 0) {
            const oldEntry = ensureBalanceEntry(payload, oldKey);
            if (oldEntry) oldEntry.hoursAvailable = (Number(oldEntry.hoursAvailable) || 0) + oldHours;
        }
        const newEntry = ensureBalanceEntry(payload, newKey);
        if (newEntry) newEntry.hoursAvailable = (Number(newEntry.hoursAvailable) || 0) - newHours;
    } else {
        const entry = ensureBalanceEntry(payload, newKey);
        if (entry) {
            entry.hoursAvailable = (Number(entry.hoursAvailable) || 0) - (newHours - oldHours);
        }
    }

    nextRequest.balanceHours = newHours;
    nextRequest.balanceAppliedAt = new Date().toISOString();
    return payload;
}

export function applyMissingRequestDeductions(payload: FpPayload) {
    payload.requests.forEach((request) => {
        if (!request || request.status !== "approved") return;
        if (request.balanceAppliedAt) return;
        applyBalanceForApproval(payload, request);
    });
    return payload;
}
