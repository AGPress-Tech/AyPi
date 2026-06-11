import {
    applyBalanceForApproval,
    applyBalanceForDeletion,
    applyBalanceForUpdate,
    getEmployeeKey,
    applyMissingRequestDeductions,
    getBalanceImpact,
    normalizeBalances,
} from "./balances";
import {
    createFeriePermessiBackup,
    listFeriePermessiBackups,
    loadAssignees,
    loadFpPayload,
    restoreFeriePermessiBackup,
    saveFpPayload,
} from "./repository";
import { logger } from "../../shared/logging/logger";
import type {
    BalanceEntry,
    ClosureEntry,
    ClosureLike,
    FpPayload,
    HolidayEntry,
    HolidayLike,
    RequestLike,
} from "./types";

type ActionContext = {
    actor?: string;
    requestId?: string;
};

type AuditChange = {
    label: string;
    before: string;
    after: string;
};

export {
    createFeriePermessiBackup,
    listFeriePermessiBackups,
    restoreFeriePermessiBackup,
};

let fpQueue: Promise<unknown> = Promise.resolve();

function queueFpOperation<T>(operationName: string, run: () => T | Promise<T>) {
    const nextRun = fpQueue.then(run, run);
    fpQueue = nextRun.then(
        () => undefined,
        () => undefined,
    );
    return nextRun.finally(() => {
        logger.info("FP queue completed", { operationName });
    });
}

function buildBusinessRequestId() {
    return `fp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function summarizeRequest(request: RequestLike | null | undefined) {
    if (!request) return null;
    return {
        id: request.id || "",
        employee: request.employee || "",
        department: request.department || "",
        type: request.type || "",
        status: request.status || "",
        start: request.start || "",
        end: request.end || "",
        allDay: !!request.allDay,
        balanceHours: Number(request.balanceHours) || 0,
        approvedBy: request.approvedBy || "",
        rejectedBy: request.rejectedBy || "",
        deletedBy: request.deletedBy || "",
        modifiedBy: request.modifiedBy || "",
    };
}

function summarizePayload(payload: FpPayload | null | undefined) {
    return {
        requests: payload?.requests?.length || 0,
        balances: Object.keys(payload?.balances || {}).length,
        holidays: payload?.holidays?.length || 0,
        closures: payload?.closures?.length || 0,
    };
}

function toAuditValue(value: unknown) {
    if (value === null || value === undefined || value === "") return "-";
    if (typeof value === "string") return value.trim() || "-";
    if (typeof value === "number" || typeof value === "boolean") {
        return String(value);
    }
    return JSON.stringify(value);
}

function sameAuditValue(left: unknown, right: unknown) {
    return toAuditValue(left) === toAuditValue(right);
}

function buildChanges(
    before: Record<string, unknown> | null | undefined,
    after: Record<string, unknown> | null | undefined,
    labels: Record<string, string>,
) {
    const rows: AuditChange[] = [];
    Object.keys(labels).forEach((key) => {
        const beforeValue = before?.[key];
        const afterValue = after?.[key];
        if (sameAuditValue(beforeValue, afterValue)) return;
        rows.push({
            label: labels[key],
            before: toAuditValue(beforeValue),
            after: toAuditValue(afterValue),
        });
    });
    return rows;
}

function buildRequestChanges(
    before: Record<string, unknown> | null | undefined,
    after: Record<string, unknown> | null | undefined,
) {
    return buildChanges(before, after, {
        employee: "Dipendente",
        department: "Reparto",
        type: "Tipo richiesta",
        status: "Stato",
        start: "Data inizio",
        end: "Data fine",
        allDay: "Giornata intera",
        balanceHours: "Ore scalate",
        approvedBy: "Approvato da",
        rejectedBy: "Rifiutato da",
        deletedBy: "Eliminato da",
        modifiedBy: "Modificato da",
    });
}

function buildEntryChanges(
    before: Record<string, unknown> | null | undefined,
    after: Record<string, unknown> | null | undefined,
    labels: Record<string, string>,
) {
    return buildChanges(before, after, labels);
}

function findBalanceSnapshot(
    payload: FpPayload | null | undefined,
    request: RequestLike | null | undefined,
) {
    if (!payload?.balances || !request) return null;
    const directKey = getEmployeeKey(request.employee, request.department);
    if (directKey && payload.balances[directKey]) {
        const entry = payload.balances[directKey];
        return {
            key: directKey,
            employee: entry.employee || request.employee || "",
            department: entry.department || request.department || "",
            hoursAvailable: Number(entry.hoursAvailable) || 0,
        };
    }
    const employeeName =
        typeof request.employee === "string"
            ? request.employee.trim()
            : request.employee && typeof request.employee === "object"
              ? String(request.employee.name || "").trim()
              : "";
    const department = String(request.department || "").trim();
    const fallback = Object.entries(payload.balances).find(([, entry]) => {
        const sameEmployee = String(entry?.employee || "").trim() === employeeName;
        const sameDepartment =
            !department || String(entry?.department || "").trim() === department;
        return sameEmployee && sameDepartment;
    });
    if (!fallback) return null;
    const [key, entry] = fallback;
    return {
        key,
        employee: entry.employee || employeeName,
        department: entry.department || department,
        hoursAvailable: Number(entry.hoursAvailable) || 0,
    };
}

function buildBalanceChange(
    beforePayload: FpPayload | null | undefined,
    afterPayload: FpPayload | null | undefined,
    beforeRequest: RequestLike | null | undefined,
    afterRequest: RequestLike | null | undefined,
) {
    const beforeBalance =
        findBalanceSnapshot(beforePayload, beforeRequest) ||
        findBalanceSnapshot(beforePayload, afterRequest);
    const afterBalance =
        findBalanceSnapshot(afterPayload, afterRequest) ||
        findBalanceSnapshot(afterPayload, beforeRequest);
    if (!beforeBalance && !afterBalance) return null;
    const beforeHours = Number(beforeBalance?.hoursAvailable) || 0;
    const afterHours = Number(afterBalance?.hoursAvailable) || 0;
    if (beforeHours === afterHours) return null;
    return {
        employee:
            afterBalance?.employee || beforeBalance?.employee || toAuditValue(afterRequest?.employee),
        department:
            afterBalance?.department ||
            beforeBalance?.department ||
            toAuditValue(afterRequest?.department),
        beforeHours,
        afterHours,
        deltaHours: Math.round((afterHours - beforeHours) * 100) / 100,
    };
}

function buildChangeSummary(changes: AuditChange[] | null | undefined) {
    if (!Array.isArray(changes) || !changes.length) return "";
    return changes
        .slice(0, 4)
        .map((item) => `${item.label}: ${item.before} -> ${item.after}`)
        .join("; ");
}

function cloneBalances(payload: FpPayload): Record<string, BalanceEntry> {
    return Object.fromEntries(
        Object.entries(payload.balances || {}).map(([key, value]) => [
            key,
            { ...(value || {}) } as BalanceEntry,
        ]),
    );
}

function normalizeHolidayEntries(holidays: HolidayLike[] | null | undefined) {
    return (Array.isArray(holidays) ? holidays : [])
        .map((item) => {
            if (typeof item === "string") return { date: item, name: "" };
            if (item && typeof item.date === "string") {
                return { date: item.date, name: item.name || "" };
            }
            return null;
        })
        .filter(Boolean) as HolidayEntry[];
}

function normalizeClosureEntries(closures: ClosureLike[] | null | undefined) {
    return (Array.isArray(closures) ? closures : [])
        .map((item) => {
            if (typeof item === "string") {
                return { start: item, end: item, name: "" };
            }
            if (item && typeof item.start === "string") {
                return {
                    start: item.start,
                    end: item.end || item.start,
                    name: item.name || "",
                };
            }
            return null;
        })
        .filter(Boolean) as ClosureEntry[];
}

function buildClosureKey(entry: ClosureEntry | null | undefined) {
    if (!entry) return "";
    const start = entry.start || "";
    const end = entry.end || entry.start || "";
    return `${start}|${end}`;
}

function buildContext(context?: ActionContext) {
    return {
        actor: context?.actor || "unknown",
        requestId: context?.requestId || "unknown",
    };
}

export async function getPayload(context?: ActionContext) {
    const meta = buildContext(context);
    return queueFpOperation("getPayload", () => {
        const payload = loadFpPayload();
        normalizeBalances(payload, loadAssignees());
        applyMissingRequestDeductions(payload);
        logger.info("FP payload read", {
            ...meta,
            ...summarizePayload(payload),
        });
        return payload;
    });
}

export async function createRequest(input: RequestLike, context?: ActionContext) {
    const meta = buildContext(context);
    return queueFpOperation("createRequest", () => {
        const payload = loadFpPayload();
        normalizeBalances(payload, loadAssignees());
        applyMissingRequestDeductions(payload);
        const before = summarizePayload(payload);
        const now = new Date().toISOString();
        const request: RequestLike = {
            ...input,
            id: input.id || buildBusinessRequestId(),
            createdAt: input.createdAt || now,
            updatedAt: now,
            status: input.status || "pending",
        };
        payload.requests.push(request);
        normalizeBalances(payload, loadAssignees());
        saveFpPayload(payload);
        logger.info("FP create request", {
            ...meta,
            before,
            after: summarizePayload(payload),
            request: summarizeRequest(request),
            changes: [
                {
                    label: "Nuova richiesta",
                    before: "-",
                    after: `${toAuditValue(request.employee)} / ${toAuditValue(request.type)} / ${toAuditValue(request.start)}`,
                },
            ],
        });
        return request;
    });
}

export async function replacePayload(nextPayload: FpPayload, context?: ActionContext) {
    const meta = buildContext(context);
    return queueFpOperation("replacePayload", () => {
        const beforePayload = loadFpPayload();
        normalizeBalances(beforePayload, loadAssignees());
        applyMissingRequestDeductions(beforePayload);
        const before = summarizePayload(beforePayload);
        normalizeBalances(nextPayload, loadAssignees());
        applyMissingRequestDeductions(nextPayload);
        saveFpPayload(nextPayload);
        logger.info("FP replace payload", {
            ...meta,
            before,
            after: summarizePayload(nextPayload),
        });
        return nextPayload;
    });
}

function findRequestIndex(payload: FpPayload, id: string) {
    return (payload.requests || []).findIndex((request) => request.id === id);
}

export async function updateRequest(
    id: string,
    input: RequestLike,
    context?: ActionContext,
) {
    const meta = buildContext(context);
    return queueFpOperation("updateRequest", () => {
        const payload = loadFpPayload();
        normalizeBalances(payload, loadAssignees());
        applyMissingRequestDeductions(payload);
        const index = findRequestIndex(payload, id);
        if (index < 0) return null;
        const existing = payload.requests[index];
        const beforeRequest = summarizeRequest(existing);
        const before = summarizePayload(payload);
        const beforeBalancePayload: FpPayload = {
            ...payload,
            balances: cloneBalances(payload),
        };
        const nextRequest: RequestLike = {
            ...existing,
            ...input,
            id: existing.id,
            updatedAt: new Date().toISOString(),
        };
        applyBalanceForUpdate(payload, existing, nextRequest);
        payload.requests[index] = nextRequest;
        normalizeBalances(payload, loadAssignees());
        saveFpPayload(payload);
        logger.info("FP update request", {
            ...meta,
            before,
            after: summarizePayload(payload),
            beforeRequest,
            afterRequest: summarizeRequest(nextRequest),
            changes: buildRequestChanges(beforeRequest, summarizeRequest(nextRequest)),
            changeSummary: buildChangeSummary(
                buildRequestChanges(beforeRequest, summarizeRequest(nextRequest)),
            ),
            balanceChange: buildBalanceChange(
                beforeBalancePayload,
                payload,
                existing,
                nextRequest,
            ),
        });
        return nextRequest;
    });
}

export async function approveRequest(id: string, context?: ActionContext) {
    const meta = buildContext(context);
    return queueFpOperation("approveRequest", () => {
        const payload = loadFpPayload();
        normalizeBalances(payload, loadAssignees());
        applyMissingRequestDeductions(payload);
        const index = findRequestIndex(payload, id);
        if (index < 0) return null;
        const target = payload.requests[index];
        const beforeRequest = summarizeRequest(target);
        const before = summarizePayload(payload);
        const beforeBalancePayload: FpPayload = {
            ...payload,
            balances: cloneBalances(payload),
        };
        target.status = "approved";
        target.approvedAt = new Date().toISOString();
        target.approvedBy = meta.actor || target.approvedBy || "";
        target.updatedAt = new Date().toISOString();
        applyBalanceForApproval(payload, target);
        normalizeBalances(payload, loadAssignees());
        saveFpPayload(payload);
        const balanceImpact = getBalanceImpact(payload, target);
        logger.info("FP approve request", {
            ...meta,
            before,
            after: summarizePayload(payload),
            beforeRequest,
            afterRequest: summarizeRequest(target),
            balanceImpact,
            changes: buildRequestChanges(beforeRequest, summarizeRequest(target)),
            changeSummary: buildChangeSummary(
                buildRequestChanges(beforeRequest, summarizeRequest(target)),
            ),
            balanceChange: buildBalanceChange(
                beforeBalancePayload,
                payload,
                target,
                target,
            ),
        });
        return { request: target, balanceImpact };
    });
}

export async function rejectRequest(id: string, context?: ActionContext) {
    const meta = buildContext(context);
    return queueFpOperation("rejectRequest", () => {
        const payload = loadFpPayload();
        normalizeBalances(payload, loadAssignees());
        applyMissingRequestDeductions(payload);
        const index = findRequestIndex(payload, id);
        if (index < 0) return null;
        const target = payload.requests[index];
        const beforeRequest = summarizeRequest(target);
        const before = summarizePayload(payload);
        const beforeBalancePayload: FpPayload = {
            ...payload,
            balances: cloneBalances(payload),
        };
        if (target.status === "approved") {
            applyBalanceForDeletion(payload, target);
        }
        target.status = "rejected";
        target.rejectedAt = new Date().toISOString();
        target.rejectedBy = meta.actor || target.rejectedBy || "";
        target.updatedAt = new Date().toISOString();
        target.balanceAppliedAt = null;
        target.balanceHours = 0;
        normalizeBalances(payload, loadAssignees());
        saveFpPayload(payload);
        logger.info("FP reject request", {
            ...meta,
            before,
            after: summarizePayload(payload),
            beforeRequest,
            afterRequest: summarizeRequest(target),
            changes: buildRequestChanges(beforeRequest, summarizeRequest(target)),
            changeSummary: buildChangeSummary(
                buildRequestChanges(beforeRequest, summarizeRequest(target)),
            ),
            balanceChange: buildBalanceChange(
                beforeBalancePayload,
                payload,
                target,
                target,
            ),
        });
        return target;
    });
}

export async function deleteRequest(id: string, context?: ActionContext) {
    const meta = buildContext(context);
    return queueFpOperation("deleteRequest", () => {
        const payload = loadFpPayload();
        normalizeBalances(payload, loadAssignees());
        applyMissingRequestDeductions(payload);
        const index = findRequestIndex(payload, id);
        if (index < 0) return null;
        const target = payload.requests[index];
        const beforeRequest = summarizeRequest(target);
        const before = summarizePayload(payload);
        const beforeBalancePayload: FpPayload = {
            ...payload,
            balances: cloneBalances(payload),
        };
        if (target.status === "approved") {
            applyBalanceForDeletion(payload, target);
        }
        target.status = "deleted";
        target.deletedAt = new Date().toISOString();
        target.deletedBy = meta.actor || target.deletedBy || "";
        target.updatedAt = new Date().toISOString();
        normalizeBalances(payload, loadAssignees());
        saveFpPayload(payload);
        logger.info("FP delete request", {
            ...meta,
            before,
            after: summarizePayload(payload),
            beforeRequest,
            afterRequest: summarizeRequest(target),
            changes: buildRequestChanges(beforeRequest, summarizeRequest(target)),
            changeSummary: buildChangeSummary(
                buildRequestChanges(beforeRequest, summarizeRequest(target)),
            ),
            balanceChange: buildBalanceChange(
                beforeBalancePayload,
                payload,
                target,
                target,
            ),
        });
        return target;
    });
}

export async function createHolidays(
    dates: string[],
    name: string,
    context?: ActionContext,
) {
    const meta = buildContext(context);
    return queueFpOperation("createHolidays", () => {
        const payload = loadFpPayload();
        const before = summarizePayload(payload);
        const existing = normalizeHolidayEntries(payload.holidays);
        const map = new Map(existing.map((item) => [item.date, item]));
        let added = 0;
        dates.forEach((date) => {
            if (!date || map.has(date)) return;
            map.set(date, { date, name: name || "" });
            added += 1;
        });
        payload.holidays = Array.from(map.values()).sort((a, b) =>
            a.date.localeCompare(b.date),
        );
        saveFpPayload(payload);
        logger.info("FP create holidays", {
            ...meta,
            before,
            after: summarizePayload(payload),
            added,
            dates,
            name,
        });
        return { payload, added };
    });
}

export async function deleteHoliday(date: string, context?: ActionContext) {
    const meta = buildContext(context);
    return queueFpOperation("deleteHoliday", () => {
        const payload = loadFpPayload();
        const before = summarizePayload(payload);
        const existing = normalizeHolidayEntries(payload.holidays);
        const removed = existing.some((item) => item.date === date);
        payload.holidays = existing.filter((item) => item.date !== date);
        saveFpPayload(payload);
        logger.info("FP delete holiday", {
            ...meta,
            before,
            after: summarizePayload(payload),
            date,
            removed,
            changes: removed
                ? [{ label: "Festivita rimossa", before: date, after: "-" }]
                : [],
        });
        return { payload, removed };
    });
}

export async function updateHoliday(
    date: string,
    nextDate: string,
    nextName: string,
    context?: ActionContext,
) {
    const meta = buildContext(context);
    return queueFpOperation("updateHoliday", () => {
        const payload = loadFpPayload();
        const before = summarizePayload(payload);
        const existing = normalizeHolidayEntries(payload.holidays);
        const hasConflict = existing.some(
            (item) => item.date === nextDate && item.date !== date,
        );
        let updated = false;
        if (!hasConflict) {
            payload.holidays = existing
                .map((item) => {
                    if (item.date !== date) return item;
                    updated = true;
                    return { date: nextDate, name: nextName || "" };
                })
                .sort((a, b) => a.date.localeCompare(b.date));
            saveFpPayload(payload);
        }
        logger.info("FP update holiday", {
            ...meta,
            before,
            after: summarizePayload(payload),
            date,
            nextDate,
            nextName,
            hasConflict,
            updated,
            changes: updated
                ? buildEntryChanges(
                      { date, name: existing.find((item) => item.date === date)?.name || "" },
                      { date: nextDate, name: nextName || "" },
                      { date: "Data festivita", name: "Nome festivita" },
                  )
                : [],
        });
        return { payload, hasConflict, updated };
    });
}

export async function createClosure(entry: ClosureEntry, context?: ActionContext) {
    const meta = buildContext(context);
    return queueFpOperation("createClosure", () => {
        const payload = loadFpPayload();
        const before = summarizePayload(payload);
        const existing = normalizeClosureEntries(payload.closures);
        const map = new Map(existing.map((item) => [buildClosureKey(item), item]));
        const key = buildClosureKey(entry);
        const added = !!key && !map.has(key);
        if (added) {
            map.set(key, {
                start: entry.start,
                end: entry.end || entry.start,
                name: entry.name || "",
            });
        }
        payload.closures = Array.from(map.values()).sort((a, b) =>
            (a.start || "").localeCompare(b.start || ""),
        );
        saveFpPayload(payload);
        logger.info("FP create closure", {
            ...meta,
            before,
            after: summarizePayload(payload),
            added,
            entry,
            changes: added
                ? [
                      {
                          label: "Nuova chiusura",
                          before: "-",
                          after: `${toAuditValue(entry.start)} -> ${toAuditValue(entry.end || entry.start)} (${toAuditValue(entry.name)})`,
                      },
                  ]
                : [],
        });
        return { payload, added };
    });
}

export async function deleteClosure(entry: ClosureEntry, context?: ActionContext) {
    const meta = buildContext(context);
    return queueFpOperation("deleteClosure", () => {
        const payload = loadFpPayload();
        const before = summarizePayload(payload);
        const key = buildClosureKey(entry);
        const existing = normalizeClosureEntries(payload.closures);
        const removed = existing.some((item) => buildClosureKey(item) === key);
        payload.closures = existing.filter(
            (item) => buildClosureKey(item) !== key,
        );
        saveFpPayload(payload);
        logger.info("FP delete closure", {
            ...meta,
            before,
            after: summarizePayload(payload),
            removed,
            entry,
            changes: removed
                ? [
                      {
                          label: "Chiusura rimossa",
                          before: `${toAuditValue(entry.start)} -> ${toAuditValue(entry.end || entry.start)} (${toAuditValue(entry.name)})`,
                          after: "-",
                      },
                  ]
                : [],
        });
        return { payload, removed };
    });
}

export async function updateClosure(
    entry: ClosureEntry,
    next: ClosureEntry,
    context?: ActionContext,
) {
    const meta = buildContext(context);
    return queueFpOperation("updateClosure", () => {
        const payload = loadFpPayload();
        const before = summarizePayload(payload);
        const existing = normalizeClosureEntries(payload.closures);
        const currentKey = buildClosureKey(entry);
        const nextKey = buildClosureKey(next);
        const hasConflict = existing.some(
            (item) =>
                buildClosureKey(item) === nextKey &&
                buildClosureKey(item) !== currentKey,
        );
        let updated = false;
        if (!hasConflict) {
            payload.closures = existing
                .map((item) => {
                    if (buildClosureKey(item) !== currentKey) return item;
                    updated = true;
                    return {
                        start: next.start,
                        end: next.end || next.start,
                        name: next.name || "",
                    };
                })
                .sort((a, b) => (a.start || "").localeCompare(b.start || ""));
            saveFpPayload(payload);
        }
        logger.info("FP update closure", {
            ...meta,
            before,
            after: summarizePayload(payload),
            entry,
            next,
            hasConflict,
            updated,
            changes: updated
                ? buildEntryChanges(entry, next, {
                      start: "Data inizio chiusura",
                      end: "Data fine chiusura",
                      name: "Nome chiusura",
                  })
                : [],
        });
        return { payload, hasConflict, updated };
    });
}
