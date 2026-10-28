import { randomUUID } from "crypto";
import type { ActionContext } from "../../shared/logging/audit";
import { buildContext } from "../../shared/logging/audit";
import { logger } from "../../shared/logging/logger";
import { createOperationQueue } from "../../shared/ops/queue";
import {
    adjustMachineSessionProduction,
    beginSetupForMachineSession,
    changeMachineSessionState,
    listMachineSessions,
    loadActivationPreview,
    reconcileSetupSession,
    startMachineSession,
    updateMachineSessionOperator,
} from "./session-repository";
import type { MesSessionMode, MesUnassignedChoice } from "./types";

const enqueue = createOperationQueue("mes-sessions");

export function getMesActivationPreview(machineId: string, phaseId: string) {
    return loadActivationPreview(machineId, phaseId);
}

export function getMesMachineSessions(machineId?: string) {
    return listMachineSessions(machineId);
}

export function activateMesPhase(input: {
    machineId: string;
    phaseId: string;
    mode: MesSessionMode;
    piecesPerPulse: number;
    collectionMode?: "PLC" | "MANUAL";
    choice?: MesUnassignedChoice;
    attributedPieces?: number;
    reasonCode?: string;
    note: string;
}, context?: ActionContext) {
    const meta = buildContext(context);
    return enqueue("activatePhase", () => {
        const session = startMachineSession({
            ...input,
            sessionId: randomUUID(),
            transitionId: randomUUID(),
            resolutionId: randomUUID(),
            auditIds: [randomUUID(), randomUUID()],
            now: new Date().toISOString(),
            actor: meta.actor,
            requestId: meta.requestId,
        });
        logger.info("MES machine session started", {
            ...meta, event: "mes_session_started", category: "data", module: "mes",
            sessionId: session.sessionId, phaseId: session.phaseId,
            machineId: session.machineId, mode: session.mode,
        });
        return session;
    });
}

export function transitionMesSession(input: {
    sessionId: string;
    action: "PAUSE" | "COMPLETE";
    baseRevision: number;
    note: string;
}, context?: ActionContext) {
    const meta = buildContext(context);
    return enqueue(`session${input.action}`, () => {
        const session = changeMachineSessionState({
            ...input,
            transitionId: randomUUID(),
            auditId: randomUUID(),
            now: new Date().toISOString(),
            actor: meta.actor,
            requestId: meta.requestId,
        });
        logger.info("MES machine session changed", {
            ...meta, event: "mes_session_changed", category: "data", module: "mes",
            sessionId: session.sessionId, phaseId: session.phaseId,
            machineId: session.machineId, action: input.action, status: session.status,
        });
        return session;
    });
}

export function adjustMesProduction(input: {
    sessionId: string;
    baseRevision: number;
    kind: "GOOD_PIECES_ADD" | "GOOD_PIECES_REMOVE" | "SCRAP_PIECES_ADD" | "SCRAP_PIECES_REMOVE";
    quantity: number;
    reasonCode: string;
    note: string;
}, context?: ActionContext) {
    const meta = buildContext(context);
    return enqueue("adjustProduction", () => adjustMachineSessionProduction({
        ...input, adjustmentId: randomUUID(), auditId: randomUUID(),
        now: new Date().toISOString(), actor: meta.actor, requestId: meta.requestId,
    }));
}

export function setMesSessionOperator(input: {
    sessionId: string;
    baseRevision: number;
    operatorNames: string[];
    note: string;
}, context?: ActionContext) {
    const meta = buildContext(context);
    return enqueue("setOperator", () => updateMachineSessionOperator({
        ...input, auditId: randomUUID(), now: new Date().toISOString(),
        actor: meta.actor, requestId: meta.requestId,
    }));
}

export function beginMesSetup(input: {
    sessionId: string;
    baseRevision: number;
    note: string;
}, context?: ActionContext) {
    const meta = buildContext(context);
    return enqueue("beginSetup", () => beginSetupForMachineSession({
        ...input,
        setupSessionId: randomUUID(),
        closeTransitionId: randomUUID(),
        startTransitionId: randomUUID(),
        auditId: randomUUID(),
        now: new Date().toISOString(),
        actor: meta.actor,
        requestId: meta.requestId,
    }));
}

export function reconcileMesSetup(input: {
    sessionId: string;
    baseRevision: number;
    goodPieces: number;
    scrapPieces: number;
    excludedPieces: number;
    startProduction: boolean;
    closeOrder: boolean;
    note: string;
}, context?: ActionContext) {
    const meta = buildContext(context);
    return enqueue("reconcileSetup", () => reconcileSetupSession({
        ...input,
        reconciliationId: randomUUID(),
        adjustmentId: randomUUID(),
        productionSessionId: randomUUID(),
        closeTransitionId: randomUUID(),
        startTransitionId: randomUUID(),
        auditId: randomUUID(),
        now: new Date().toISOString(),
        actor: meta.actor,
        requestId: meta.requestId,
    }));
}
