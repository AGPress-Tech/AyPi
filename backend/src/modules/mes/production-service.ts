import { randomUUID } from "crypto";
import type { ActionContext } from "../../shared/logging/audit";
import { buildContext } from "../../shared/logging/audit";
import { logger } from "../../shared/logging/logger";
import { createOperationQueue } from "../../shared/ops/queue";
import {
    createMesOrder,
    createMesPhase,
    listMesOrders,
    loadMesOrderDetail,
    updateMesOrder,
    updateMesPhase,
} from "./production-repository";
import type { MesOrderDraft, MesPhaseDraft } from "./types";

const enqueue = createOperationQueue("mes-production");

export function getMesOrders(options: Parameters<typeof listMesOrders>[0]) {
    return listMesOrders(options);
}

export function getMesOrder(orderId: string) {
    return loadMesOrderDetail(orderId);
}

export function addMesOrder(
    order: MesOrderDraft,
    phases: MesPhaseDraft[],
    context?: ActionContext,
) {
    const meta = buildContext(context);
    return enqueue("createOrder", () => {
        const result = createMesOrder({
            order: { ...order, orderId: randomUUID() },
            phases: phases.map((phase) => ({ ...phase, phaseId: randomUUID() })),
            actor: meta.actor,
            requestId: meta.requestId,
            now: new Date().toISOString(),
            auditIds: Array.from({ length: phases.length + 1 }, () => randomUUID()),
        });
        logger.info("MES order created", {
            ...meta, event: "mes_order_created", category: "data", module: "mes",
            orderId: result.orderId, orderNumber: result.orderNumber, phases: result.phases.length,
        });
        return result;
    });
}

export function editMesOrder(orderId: string, order: MesOrderDraft, baseRevision: number, context?: ActionContext) {
    const meta = buildContext(context);
    return enqueue("updateOrder", () => updateMesOrder({
        orderId, draft: order, baseRevision, actor: meta.actor, requestId: meta.requestId,
        now: new Date().toISOString(), auditId: randomUUID(),
    }));
}

export function addMesPhase(orderId: string, phase: MesPhaseDraft, context?: ActionContext) {
    const meta = buildContext(context);
    return enqueue("createPhase", () => createMesPhase({
        orderId, phase: { ...phase, phaseId: randomUUID() }, actor: meta.actor,
        requestId: meta.requestId, now: new Date().toISOString(), auditId: randomUUID(),
    }));
}

export function editMesPhase(phaseId: string, phase: MesPhaseDraft, baseRevision: number, context?: ActionContext) {
    const meta = buildContext(context);
    return enqueue("updatePhase", () => updateMesPhase({
        phaseId, draft: phase, baseRevision, actor: meta.actor, requestId: meta.requestId,
        now: new Date().toISOString(), auditId: randomUUID(),
    }));
}

