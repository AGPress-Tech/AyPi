import { getSqliteDatabase, runSqliteTransaction } from "../../shared/db/sqlite";
import { HttpError } from "../../shared/http/errors";
import { serializeJson } from "../../shared/storage/json-codec";
import { initializeMesSqliteStore } from "./repository";
import type { MesOrder, MesOrderDetail, MesOrderDraft, MesPhase, MesPhaseDraft } from "./types";

function rows(result: any) {
    if (!Array.isArray(result) || !result.length) return [];
    const columns = result[0].columns || [];
    return (result[0].values || []).map((values: unknown[]) =>
        Object.fromEntries(columns.map((column: string, index: number) => [column, values[index]])),
    );
}

function orderFromRow(row: any): MesOrder {
    return {
        orderId: row.order_id,
        orderNumber: row.order_number,
        customer: row.customer,
        articleCode: row.article_code,
        targetQuantity: Number(row.target_quantity) || 0,
        unit: row.unit,
        firstDeliveryAt: row.first_delivery_at,
        dueAt: row.due_at,
        priority: row.priority,
        notes: row.notes,
        status: row.status,
        revision: Number(row.revision) || 1,
        createdAt: row.created_at,
        createdBy: row.created_by,
        updatedAt: row.updated_at,
        updatedBy: row.updated_by,
    };
}

function phaseFromRow(row: any): MesPhase {
    const targetQuantity = Number(row.target_quantity) || 0;
    const standardCycleSeconds = Number(row.standard_cycle_seconds) || 0;
    const plannedSetupSeconds = Number(row.planned_setup_seconds) || 0;
    return {
        phaseId: row.phase_id,
        orderId: row.order_id,
        phaseCode: row.phase_code,
        sequence: Number(row.sequence) || 0,
        articleCode: row.article_code,
        targetQuantity,
        unit: row.unit,
        standardCycleSeconds,
        plannedSetupSeconds,
        plannedMachineId: row.planned_machine_id,
        scheduledStart: row.scheduled_start,
        scheduledEnd: row.scheduled_end,
        planningStatus: row.planning_status,
        executionStatus: row.execution_status,
        revision: Number(row.revision) || 1,
        createdAt: row.created_at,
        createdBy: row.created_by,
        updatedAt: row.updated_at,
        updatedBy: row.updated_by,
        plannedDurationSeconds: plannedSetupSeconds + targetQuantity * standardCycleSeconds,
    };
}

const ORDER_COLUMNS = `order_id, order_number, customer, article_code, target_quantity,
    unit, first_delivery_at, due_at, priority, notes, status, revision,
    created_at, created_by, updated_at, updated_by`;
const PHASE_COLUMNS = `phase_id, order_id, phase_code, sequence, article_code,
    target_quantity, unit, standard_cycle_seconds, planned_setup_seconds,
    planned_machine_id, scheduled_start, scheduled_end, planning_status,
    execution_status, revision, created_at, created_by, updated_at, updated_by`;

function insertAudit(database: any, entry: {
    auditId: string;
    entityType: string;
    entityId: string;
    action: string;
    payload: unknown;
    occurredAt: string;
    actor: string;
    requestId: string;
}) {
    database.run(
        `INSERT INTO mes_audit_log
         (audit_id, entity_type, entity_id, action, payload_json, occurred_at, actor, request_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [entry.auditId, entry.entityType, entry.entityId, entry.action,
            serializeJson(entry.payload), entry.occurredAt, entry.actor, entry.requestId],
    );
}

export function createMesOrder(input: {
    order: MesOrderDraft & { orderId: string };
    phases: Array<MesPhaseDraft & { phaseId: string }>;
    actor: string;
    requestId: string;
    now: string;
    auditIds: string[];
}): MesOrderDetail {
    initializeMesSqliteStore();
    const phaseCodes = new Set(input.phases.map((phase) => phase.phaseCode));
    const phaseSequences = new Set(input.phases.map((phase) => phase.sequence));
    if (phaseCodes.size !== input.phases.length || phaseSequences.size !== input.phases.length) {
        throw new HttpError(409, "Codice o sequenza fase duplicati nell'ordine.", {
            code: "MES_PHASE_CONFLICT",
        });
    }
    return runSqliteTransaction((database) => {
        const duplicate = database.exec(
            "SELECT order_id FROM mes_orders WHERE order_number = ?",
            [input.order.orderNumber],
        );
        if (duplicate?.[0]?.values?.length) {
            throw new HttpError(409, "Esiste già un ordine con questo numero.", {
                code: "MES_ORDER_NUMBER_CONFLICT",
            });
        }
        const order = input.order;
        database.run(
            `INSERT INTO mes_orders (${ORDER_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
            [order.orderId, order.orderNumber, order.customer, order.articleCode,
                order.targetQuantity, order.unit, order.firstDeliveryAt, order.dueAt,
                order.priority, order.notes, order.status, input.now, input.actor,
                input.now, input.actor],
        );
        input.phases.forEach((phase, index) => {
            database.run(
                `INSERT INTO mes_phases (${PHASE_COLUMNS})
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
                [phase.phaseId, order.orderId, phase.phaseCode, phase.sequence,
                    phase.articleCode, phase.targetQuantity, phase.unit,
                    phase.standardCycleSeconds, phase.plannedSetupSeconds,
                    phase.plannedMachineId, phase.scheduledStart, phase.scheduledEnd,
                    phase.planningStatus, phase.executionStatus, input.now, input.actor,
                    input.now, input.actor],
            );
            insertAudit(database, {
                auditId: input.auditIds[index + 1], entityType: "PHASE",
                entityId: phase.phaseId, action: "CREATE", payload: phase,
                occurredAt: input.now, actor: input.actor, requestId: input.requestId,
            });
        });
        insertAudit(database, {
            auditId: input.auditIds[0], entityType: "ORDER", entityId: order.orderId,
            action: "CREATE", payload: order, occurredAt: input.now,
            actor: input.actor, requestId: input.requestId,
        });
        return loadMesOrderDetailFromDatabase(database, order.orderId)!;
    });
}

function loadMesOrderDetailFromDatabase(database: any, orderId: string) {
    const orderRow = rows(database.exec(
        `SELECT ${ORDER_COLUMNS} FROM mes_orders WHERE order_id = ?`, [orderId],
    ))[0];
    if (!orderRow) return null;
    const phases = rows(database.exec(
        `SELECT ${PHASE_COLUMNS} FROM mes_phases WHERE order_id = ? ORDER BY sequence, phase_id`,
        [orderId],
    )).map(phaseFromRow);
    return { ...orderFromRow(orderRow), phases };
}

export function loadMesOrderDetail(orderId: string): MesOrderDetail | null {
    initializeMesSqliteStore();
    return loadMesOrderDetailFromDatabase(getSqliteDatabase(), orderId);
}

export function listMesOrders(options: { search?: string; status?: string; limit: number; offset: number }) {
    initializeMesSqliteStore();
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (options.search) {
        conditions.push("(order_number LIKE ? OR article_code LIKE ? OR customer LIKE ?)");
        const pattern = `%${options.search}%`;
        params.push(pattern, pattern, pattern);
    }
    if (options.status) {
        conditions.push("status = ?");
        params.push(options.status);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const database = getSqliteDatabase();
    const total = Number(database.exec(`SELECT COUNT(*) FROM mes_orders ${where}`, params)?.[0]?.values?.[0]?.[0]) || 0;
    const items = rows(database.exec(
        `SELECT ${ORDER_COLUMNS} FROM mes_orders ${where}
         ORDER BY updated_at DESC, order_number LIMIT ? OFFSET ?`,
        [...params, options.limit, options.offset],
    )).map(orderFromRow);
    if (!items.length) return { total, limit: options.limit, offset: options.offset, rows: [] };
    const placeholders = items.map(() => "?").join(", ");
    const phases = rows(database.exec(
        `SELECT ${PHASE_COLUMNS} FROM mes_phases
         WHERE order_id IN (${placeholders})
         ORDER BY order_id, sequence, phase_id`,
        items.map((item) => item.orderId),
    )).map(phaseFromRow);
    const phasesByOrder = new Map<string, MesPhase[]>();
    phases.forEach((phase) => {
        const group = phasesByOrder.get(phase.orderId) || [];
        group.push(phase);
        phasesByOrder.set(phase.orderId, group);
    });
    return {
        total,
        limit: options.limit,
        offset: options.offset,
        rows: items.map((item) => ({ ...item, phases: phasesByOrder.get(item.orderId) || [] })),
    };
}

export function updateMesOrder(input: {
    orderId: string;
    draft: MesOrderDraft;
    baseRevision: number;
    actor: string;
    requestId: string;
    now: string;
    auditId: string;
}) {
    initializeMesSqliteStore();
    return runSqliteTransaction((database) => {
        const before = loadMesOrderDetailFromDatabase(database, input.orderId);
        if (!before) throw new HttpError(404, "Ordine MES non trovato.");
        if (before.revision !== input.baseRevision) {
            throw new HttpError(409, "L'ordine è stato aggiornato da un altro operatore.", {
                code: "MES_ORDER_REVISION_CONFLICT", details: { currentRevision: before.revision },
            });
        }
        const duplicate = database.exec(
            "SELECT order_id FROM mes_orders WHERE order_number = ? AND order_id <> ?",
            [input.draft.orderNumber, input.orderId],
        );
        if (duplicate?.[0]?.values?.length) throw new HttpError(409, "Esiste già un ordine con questo numero.");
        const nextRevision = before.revision + 1;
        database.run(
            `UPDATE mes_orders SET order_number = ?, customer = ?, article_code = ?,
             target_quantity = ?, unit = ?, first_delivery_at = ?, due_at = ?,
             priority = ?, notes = ?, status = ?, revision = ?, updated_at = ?, updated_by = ?
             WHERE order_id = ?`,
            [input.draft.orderNumber, input.draft.customer, input.draft.articleCode,
                input.draft.targetQuantity, input.draft.unit, input.draft.firstDeliveryAt,
                input.draft.dueAt, input.draft.priority, input.draft.notes,
                input.draft.status, nextRevision, input.now, input.actor, input.orderId],
        );
        insertAudit(database, {
            auditId: input.auditId, entityType: "ORDER", entityId: input.orderId,
            action: "UPDATE", payload: { before, after: input.draft },
            occurredAt: input.now, actor: input.actor, requestId: input.requestId,
        });
        return loadMesOrderDetailFromDatabase(database, input.orderId)!;
    });
}

export function createMesPhase(input: {
    orderId: string;
    phase: MesPhaseDraft & { phaseId: string };
    actor: string;
    requestId: string;
    now: string;
    auditId: string;
}) {
    initializeMesSqliteStore();
    return runSqliteTransaction((database) => {
        if (!loadMesOrderDetailFromDatabase(database, input.orderId)) {
            throw new HttpError(404, "Ordine MES non trovato.");
        }
        const phase = input.phase;
        try {
            database.run(
                `INSERT INTO mes_phases (${PHASE_COLUMNS})
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
                [phase.phaseId, input.orderId, phase.phaseCode, phase.sequence,
                    phase.articleCode, phase.targetQuantity, phase.unit,
                    phase.standardCycleSeconds, phase.plannedSetupSeconds,
                    phase.plannedMachineId, phase.scheduledStart, phase.scheduledEnd,
                    phase.planningStatus, phase.executionStatus, input.now, input.actor,
                    input.now, input.actor],
            );
        } catch (error) {
            if (String(error).includes("UNIQUE constraint failed")) {
                throw new HttpError(409, "Codice o sequenza fase già presenti nell'ordine.");
            }
            throw error;
        }
        insertAudit(database, {
            auditId: input.auditId, entityType: "PHASE", entityId: phase.phaseId,
            action: "CREATE", payload: phase, occurredAt: input.now,
            actor: input.actor, requestId: input.requestId,
        });
        return loadMesOrderDetailFromDatabase(database, input.orderId)!;
    });
}

export function updateMesPhase(input: {
    phaseId: string;
    draft: MesPhaseDraft;
    baseRevision: number;
    actor: string;
    requestId: string;
    now: string;
    auditId: string;
}) {
    initializeMesSqliteStore();
    return runSqliteTransaction((database) => {
        const phaseRow = rows(database.exec(
            `SELECT ${PHASE_COLUMNS} FROM mes_phases WHERE phase_id = ?`, [input.phaseId],
        ))[0];
        if (!phaseRow) throw new HttpError(404, "Fase MES non trovata.");
        const before = phaseFromRow(phaseRow);
        if (before.revision !== input.baseRevision) {
            throw new HttpError(409, "La fase è stata aggiornata da un altro operatore.", {
                code: "MES_PHASE_REVISION_CONFLICT", details: { currentRevision: before.revision },
            });
        }
        const nextRevision = before.revision + 1;
        try {
            database.run(
                `UPDATE mes_phases SET phase_code = ?, sequence = ?, article_code = ?,
                 target_quantity = ?, unit = ?, standard_cycle_seconds = ?,
                 planned_setup_seconds = ?, planned_machine_id = ?, scheduled_start = ?,
                 scheduled_end = ?, planning_status = ?, execution_status = ?, revision = ?,
                 updated_at = ?, updated_by = ? WHERE phase_id = ?`,
                [input.draft.phaseCode, input.draft.sequence, input.draft.articleCode,
                    input.draft.targetQuantity, input.draft.unit,
                    input.draft.standardCycleSeconds, input.draft.plannedSetupSeconds,
                    input.draft.plannedMachineId, input.draft.scheduledStart,
                    input.draft.scheduledEnd, input.draft.planningStatus,
                    input.draft.executionStatus, nextRevision, input.now, input.actor,
                    input.phaseId],
            );
        } catch (error) {
            if (String(error).includes("UNIQUE constraint failed")) {
                throw new HttpError(409, "Codice o sequenza fase già presenti nell'ordine.");
            }
            throw error;
        }
        insertAudit(database, {
            auditId: input.auditId, entityType: "PHASE", entityId: input.phaseId,
            action: "UPDATE", payload: { before, after: input.draft },
            occurredAt: input.now, actor: input.actor, requestId: input.requestId,
        });
        return loadMesOrderDetailFromDatabase(database, before.orderId)!;
    });
}

