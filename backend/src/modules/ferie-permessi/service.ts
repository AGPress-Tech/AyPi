import {
    applyBalanceForApproval,
    applyBalanceForDeletion,
    applyBalanceForUpdate,
    applyMissingRequestDeductions,
    getBalanceImpact,
    normalizeBalances,
} from "./balances";
import { loadAssignees, loadFpPayload, saveFpPayload } from "./repository";
import { logger } from "../../shared/logging/logger";
import type {
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
        });
        return { payload, hasConflict, updated };
    });
}
