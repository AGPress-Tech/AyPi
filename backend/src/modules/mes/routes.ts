import type { Router } from "../../shared/http/router";
import { getRequestId, getRequestUser } from "../../shared/http/context";
import { badRequest, notFound } from "../../shared/http/errors";
import { readJsonBody } from "../../shared/http/request";
import { sendJson } from "../../shared/http/response";
import {
    getMesEventSummary,
    getMesAcquisitionStatus,
    getMesImports,
    getMesMachineEvents,
    getMesUnassignedPieces,
    ingestMesCollectorBatch,
    importPlcCsv,
} from "./service";
import {
    addMesOrder,
    addMesPhase,
    editMesOrder,
    editMesPhase,
    getMesOrder,
    getMesOrders,
} from "./production-service";
import {
    activateMesPhase,
    beginMesSetup,
    adjustMesProduction,
    getMesActivationPreview,
    getMesMachineSessions,
    reconcileMesSetup,
    setMesSessionOperator,
    transitionMesSession,
} from "./session-service";
import type {
    MesExecutionStatus,
    MesCollectorBatch,
    MesOrderDraft,
    MesOrderStatus,
    MesOrderType,
    MesPhaseDraft,
    MesPlanningStatus,
    MesPriority,
    MesUnit,
} from "./types";

function requiredText(value: unknown, label: string, maxLength: number) {
    const normalized = String(value || "").trim();
    if (!normalized || normalized.length > maxLength) {
        throw badRequest(`${label} non valido.`);
    }
    return normalized;
}

function optionalIsoDate(value: string | null, label: string) {
    if (!value) return undefined;
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) throw badRequest(`${label} non valida.`);
    return new Date(timestamp).toISOString();
}

function optionalText(value: unknown, maxLength: number) {
    const normalized = String(value || "").trim();
    if (normalized.length > maxLength) throw badRequest("Testo troppo lungo.");
    return normalized;
}

function positiveNumber(value: unknown, label: string) {
    const normalized = Number(value);
    if (!Number.isFinite(normalized) || normalized <= 0) {
        throw badRequest(`${label} deve essere maggiore di zero.`);
    }
    return normalized;
}

function nonNegativeNumber(value: unknown, label: string) {
    if (value === "" || value === null || value === undefined) return 0;
    const normalized = Number(value);
    if (!Number.isFinite(normalized) || normalized < 0) {
        throw badRequest(`${label} deve essere un numero maggiore o uguale a zero.`);
    }
    return normalized;
}

function nonNegativeInteger(value: unknown, label: string) {
    const normalized = Number(value);
    if (!Number.isInteger(normalized) || normalized < 0) {
        throw badRequest(`${label} deve essere un intero maggiore o uguale a zero.`);
    }
    return normalized;
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
    if (!allowed.includes(value as T)) throw badRequest(`${label} non valido.`);
    return value as T;
}

function isoDate(value: unknown, label: string, required = false) {
    const normalized = String(value || "").trim();
    if (!normalized) {
        if (required) throw badRequest(`${label} obbligatoria.`);
        return "";
    }
    const timestamp = Date.parse(normalized);
    if (!Number.isFinite(timestamp)) throw badRequest(`${label} non valida.`);
    return new Date(timestamp).toISOString();
}

const UNITS = ["pz", "kg"] as const;
const PRIORITIES = ["NORMAL", "HIGH", "URGENT"] as const;
const ORDER_STATUSES = ["OPEN", "COMPLETED", "CANCELLED"] as const;
const ORDER_TYPES = ["STAMPING", "MACHINING", "BLANKING"] as const;
const PLANNING_STATUSES = ["BACKLOG", "SCHEDULED", "ARCHIVED"] as const;
const EXECUTION_STATUSES = ["NOT_STARTED", "SETUP", "RUNNING", "PAUSED", "COMPLETED", "CANCELLED"] as const;
const SESSION_MODES = ["PRODUCTION", "SETUP"] as const;
const UNASSIGNED_CHOICES = ["ATTRIBUTE_ALL", "EXCLUDE_ALL", "PARTIAL"] as const;
const SESSION_ACTIONS = ["PAUSE", "COMPLETE"] as const;
const ADJUSTMENT_KINDS = ["GOOD_PIECES_ADD", "GOOD_PIECES_REMOVE", "SCRAP_PIECES_ADD", "SCRAP_PIECES_REMOVE"] as const;

function parseCollectorBatch(value: any): MesCollectorBatch {
    const sentAt = isoDate(value?.sentAt, "Invio pacchetto", true);
    const startedAt = isoDate(value?.startedAt, "Inizio acquisizione", true);
    const stoppedAt = isoDate(value?.stoppedAt, "Fine acquisizione");
    const machineValues = Array.isArray(value?.machines) ? value.machines : [];
    if (machineValues.length > 500) throw badRequest("Il pacchetto contiene troppe macchine.");
    return {
        collectorId: requiredText(value?.collectorId, "Identificativo raccoglitore", 120),
        sourceSessionId: requiredText(value?.sourceSessionId, "Sessione acquisizione", 160),
        batchId: requiredText(value?.batchId, "Identificativo pacchetto", 160),
        mode: enumValue(value?.mode, ["LIVE", "DEMO"] as const, "Modalità acquisizione"),
        startedAt,
        sentAt,
        stoppedAt,
        machines: machineValues.map((machine: any, index: number) => {
            const label = `Macchina ${index + 1}`;
            const cycleValue = machine?.lastCycleSeconds;
            const lastCycleSeconds = cycleValue === null || cycleValue === "" || cycleValue === undefined
                ? null
                : nonNegativeNumber(cycleValue, `${label}: ultimo ciclo`);
            return {
                machineId: requiredText(machine?.machineId, `${label}: codice`, 120),
                machineName: optionalText(machine?.machineName, 200),
                observedAt: isoDate(machine?.observedAt || sentAt, `${label}: osservazione`, true),
                frameAt: isoDate(machine?.frameAt, `${label}: ultimo frame`),
                detected: machine?.detected === true,
                pulses: nonNegativeInteger(machine?.pulses, `${label}: impulsi`),
                pieces: nonNegativeNumber(machine?.pieces, `${label}: pezzi`),
                piecesLastHour: nonNegativeNumber(machine?.piecesLastHour, `${label}: pezzi ultima ora`),
                lastPieceAt: isoDate(machine?.lastPieceAt, `${label}: ultimo pezzo`),
                lastCycleSeconds,
                multiplier: Math.max(1, nonNegativeInteger(machine?.multiplier || 1, `${label}: moltiplicatore`)),
                frameCount: nonNegativeInteger(machine?.frameCount, `${label}: frame`),
                invalidFrames: nonNegativeInteger(machine?.invalidFrames, `${label}: frame non validi`),
            };
        }),
    };
}

function parseOrderDraft(value: any): MesOrderDraft {
    const unit = enumValue(value?.unit, UNITS, "Unità di misura") as MesUnit;
    const targetQuantity = positiveNumber(value?.targetQuantity, "Quantità ordine");
    if (unit === "pz" && !Number.isInteger(targetQuantity)) {
        throw badRequest("La quantità in pezzi deve essere intera.");
    }
    const firstDeliveryAt = isoDate(value?.firstDeliveryAt, "Prima consegna");
    const dueAt = isoDate(value?.dueAt, "Scadenza");
    if (firstDeliveryAt && dueAt && firstDeliveryAt > dueAt) {
        throw badRequest("La prima consegna non può essere successiva alla scadenza.");
    }
    const orderType = enumValue(value?.orderType || "MACHINING", ORDER_TYPES, "Tipo ordine") as MesOrderType;
    const grossWeight = nonNegativeNumber(value?.grossWeight, "Peso lordo");
    const netWeight = nonNegativeNumber(value?.netWeight, "Peso netto");
    return {
        orderNumber: requiredText(value?.orderNumber, "Numero ordine", 100),
        customer: optionalText(value?.customer, 200),
        articleCode: requiredText(value?.articleCode, "Codice articolo", 120),
        targetQuantity,
        unit,
        orderType,
        materialAlloy: optionalText(value?.materialAlloy, 120),
        grossWeight,
        netWeight,
        kilogramsToStamp: orderType === "STAMPING" ? targetQuantity * grossWeight : 0,
        barBundles: optionalText(value?.barBundles, 120),
        materialOwner: optionalText(value?.materialOwner, 120),
        barSize: optionalText(value?.barSize, 120),
        firstDeliveryAt,
        dueAt,
        priority: enumValue(value?.priority || "NORMAL", PRIORITIES, "Priorità") as MesPriority,
        notes: optionalText(value?.notes, 4000),
        status: enumValue(value?.status || "OPEN", ORDER_STATUSES, "Stato ordine") as MesOrderStatus,
    };
}

function parsePhaseDraft(value: any, fallback?: Pick<MesOrderDraft, "articleCode" | "targetQuantity" | "unit">): MesPhaseDraft {
    const unit = enumValue(value?.unit || fallback?.unit, UNITS, "Unità di misura fase") as MesUnit;
    const targetQuantity = positiveNumber(value?.targetQuantity ?? fallback?.targetQuantity, "Quantità fase");
    if (unit === "pz" && !Number.isInteger(targetQuantity)) {
        throw badRequest("La quantità della fase in pezzi deve essere intera.");
    }
    const sequence = nonNegativeInteger(value?.sequence, "Sequenza fase");
    if (sequence < 1) throw badRequest("La sequenza fase deve essere maggiore di zero.");
    const planningStatus = enumValue(value?.planningStatus || "BACKLOG", PLANNING_STATUSES, "Stato pianificazione") as MesPlanningStatus;
    const standardCycleSeconds = positiveNumber(value?.standardCycleSeconds, "Tempo ciclo standard");
    const plannedSetupSeconds = nonNegativeInteger(value?.plannedSetupSeconds, "Tempo attrezzaggio");
    const scheduledStart = isoDate(value?.scheduledStart, "Inizio pianificato");
    let scheduledEnd = isoDate(value?.scheduledEnd, "Fine pianificata");
    if (scheduledStart && !scheduledEnd) {
        scheduledEnd = new Date(
            Date.parse(scheduledStart) + (plannedSetupSeconds + targetQuantity * standardCycleSeconds) * 1000,
        ).toISOString();
    }
    if (scheduledStart && scheduledEnd && scheduledStart >= scheduledEnd) {
        throw badRequest("La fine pianificata deve essere successiva all'inizio.");
    }
    const plannedMachineId = optionalText(value?.plannedMachineId, 120);
    if (planningStatus === "SCHEDULED" && (!plannedMachineId || !scheduledStart)) {
        throw badRequest("Una fase pianificata richiede macchina e data di inizio.");
    }
    return {
        phaseCode: requiredText(value?.phaseCode, "Codice fase", 100),
        sequence,
        articleCode: requiredText(value?.articleCode || fallback?.articleCode, "Codice articolo fase", 120),
        targetQuantity,
        unit,
        standardCycleSeconds,
        plannedSetupSeconds,
        plannedMachineId,
        scheduledStart,
        scheduledEnd,
        planningStatus,
        executionStatus: enumValue(value?.executionStatus || "NOT_STARTED", EXECUTION_STATUSES, "Stato esecuzione") as MesExecutionStatus,
    };
}

function revision(value: unknown) {
    const normalized = Number(value);
    if (!Number.isInteger(normalized) || normalized < 1) throw badRequest("Revisione non valida.");
    return normalized;
}

function actionContext(req: Parameters<typeof getRequestUser>[0]) {
    return { actor: getRequestUser(req), requestId: getRequestId(req) };
}

export function registerMesRoutes(router: Router) {
    router.register("POST", "/api/mes/ingest/batches", async (req, res) => {
        const body: any = (await readJsonBody(req)) || {};
        const result = await ingestMesCollectorBatch(parseCollectorBatch(body), actionContext(req));
        sendJson(res, 200, result);
    });

    router.register("GET", "/api/mes/acquisition/status", async (req, res) => {
        const url = new URL(req.url || "/", "http://localhost");
        const staleAfterSeconds = Math.max(5, Math.min(300, Number(url.searchParams.get("staleAfterSeconds")) || 15));
        sendJson(res, 200, getMesAcquisitionStatus(staleAfterSeconds));
    });

    router.register("POST", "/api/mes/imports/plc-csv", async (req, res) => {
        const body: any = (await readJsonBody(req)) || {};
        const csv = typeof body.csv === "string" ? body.csv : "";
        if (!csv || Buffer.byteLength(csv, "utf8") > 8 * 1024 * 1024) {
            throw badRequest("Contenuto CSV mancante o superiore a 8 MB.");
        }
        const result = await importPlcCsv({
            sourceSessionId: requiredText(body.sourceSessionId, "Sessione sorgente", 240),
            sourceFile: requiredText(body.sourceFile, "Nome file sorgente", 500),
            csv,
            firstDataRow: Number.isInteger(Number(body.firstDataRow))
                ? Math.max(2, Number(body.firstDataRow))
                : 2,
        }, {
            actor: getRequestUser(req),
            requestId: getRequestId(req),
        });
        sendJson(res, 200, result);
    });

    router.register("GET", "/api/mes/events", async (req, res) => {
        const url = new URL(req.url || "/", "http://localhost");
        const limit = Math.max(1, Math.min(1000, Number(url.searchParams.get("limit")) || 100));
        const offset = Math.max(0, Number(url.searchParams.get("offset")) || 0);
        sendJson(res, 200, getMesMachineEvents({
            machineId: String(url.searchParams.get("machineId") || "").trim() || undefined,
            from: optionalIsoDate(url.searchParams.get("from"), "Data iniziale"),
            to: optionalIsoDate(url.searchParams.get("to"), "Data finale"),
            limit,
            offset,
        }));
    });

    router.register("GET", "/api/mes/events/summary", async (_req, res) => {
        sendJson(res, 200, getMesEventSummary());
    });

    router.register("GET", "/api/mes/imports", async (req, res) => {
        const url = new URL(req.url || "/", "http://localhost");
        const limit = Math.max(1, Math.min(200, Number(url.searchParams.get("limit")) || 50));
        sendJson(res, 200, getMesImports(limit));
    });

    router.register("GET", "/api/mes/machines/unassigned", async (_req, res) => {
        sendJson(res, 200, getMesUnassignedPieces());
    });

    router.register("GET", "/api/mes/machines/activation-preview", async (req, res) => {
        const url = new URL(req.url || "/", "http://localhost");
        sendJson(res, 200, getMesActivationPreview(
            requiredText(url.searchParams.get("machineId"), "ID macchina", 120),
            requiredText(url.searchParams.get("phaseId"), "ID fase", 100),
        ));
    });

    router.register("GET", "/api/mes/sessions", async (req, res) => {
        const url = new URL(req.url || "/", "http://localhost");
        sendJson(res, 200, getMesMachineSessions(
            String(url.searchParams.get("machineId") || "").trim() || undefined,
        ));
    });

    router.register("POST", "/api/mes/sessions", async (req, res) => {
        const body: any = (await readJsonBody(req)) || {};
        const choice = body.unassignedChoice
            ? enumValue(body.unassignedChoice, UNASSIGNED_CHOICES, "Scelta pezzi non attribuiti")
            : undefined;
        let attributedPieces: number | undefined;
        if (choice === "PARTIAL") {
            attributedPieces = nonNegativeInteger(body.attributedPieces, "Pezzi da attribuire");
        }
        sendJson(res, 201, await activateMesPhase({
            machineId: requiredText(body.machineId, "ID macchina", 120),
            phaseId: requiredText(body.phaseId, "ID fase", 100),
            mode: enumValue(body.mode || "PRODUCTION", SESSION_MODES, "Modalità sessione"),
            choice,
            attributedPieces,
            reasonCode: optionalText(body.reasonCode, 120),
            note: optionalText(body.note, 1000),
        }, actionContext(req)));
    });

    router.register("POST", "/api/mes/sessions/:sessionId/actions", async (req, res, params) => {
        const body: any = (await readJsonBody(req)) || {};
        sendJson(res, 200, await transitionMesSession({
            sessionId: requiredText(params.sessionId, "ID sessione", 100),
            action: enumValue(body.action, SESSION_ACTIONS, "Azione sessione"),
            baseRevision: revision(body.baseRevision),
            note: optionalText(body.note, 1000),
        }, actionContext(req)));
    });

    router.register("POST", "/api/mes/sessions/:sessionId/adjustments", async (req, res, params) => {
        const body: any = (await readJsonBody(req)) || {};
        sendJson(res, 200, await adjustMesProduction({
            sessionId: requiredText(params.sessionId, "ID sessione", 100),
            baseRevision: revision(body.baseRevision),
            kind: enumValue(body.kind, ADJUSTMENT_KINDS, "Tipo rettifica"),
            quantity: positiveNumber(body.quantity, "Quantità"),
            reasonCode: requiredText(body.reasonCode, "Causale", 120),
            note: optionalText(body.note, 1000),
        }, actionContext(req)));
    });

    router.register("POST", "/api/mes/sessions/:sessionId/operator", async (req, res, params) => {
        const body: any = (await readJsonBody(req)) || {};
        sendJson(res, 200, await setMesSessionOperator({
            sessionId: requiredText(params.sessionId, "ID sessione", 100),
            baseRevision: revision(body.baseRevision),
            operatorNames: (Array.isArray(body.operatorNames) ? body.operatorNames : [body.operatorName])
                .map((value: unknown) => requiredText(value, "Operatore", 120)),
            note: optionalText(body.note, 1000),
        }, actionContext(req)));
    });

    router.register("POST", "/api/mes/sessions/:sessionId/setup", async (req, res, params) => {
        const body: any = (await readJsonBody(req)) || {};
        sendJson(res, 201, await beginMesSetup({
            sessionId: requiredText(params.sessionId, "ID sessione", 100),
            baseRevision: revision(body.baseRevision),
            note: optionalText(body.note, 1000),
        }, actionContext(req)));
    });

    router.register("POST", "/api/mes/sessions/:sessionId/setup-reconciliation", async (req, res, params) => {
        const body: any = (await readJsonBody(req)) || {};
        sendJson(res, 200, await reconcileMesSetup({
            sessionId: requiredText(params.sessionId, "ID sessione", 100),
            baseRevision: revision(body.baseRevision),
            goodPieces: nonNegativeInteger(body.goodPieces, "Pezzi buoni"),
            scrapPieces: nonNegativeInteger(body.scrapPieces, "Scarti o prove"),
            excludedPieces: nonNegativeInteger(body.excludedPieces, "Pezzi esclusi"),
            startProduction: body.startProduction !== false,
            closeOrder: body.closeOrder === true,
            note: optionalText(body.note, 1000),
        }, actionContext(req)));
    });

    router.register("GET", "/api/mes/orders", async (req, res) => {
        const url = new URL(req.url || "/", "http://localhost");
        const statusValue = String(url.searchParams.get("status") || "").trim();
        const status = statusValue
            ? enumValue(statusValue, ORDER_STATUSES, "Stato ordine")
            : undefined;
        sendJson(res, 200, getMesOrders({
            search: String(url.searchParams.get("search") || "").trim() || undefined,
            status,
            limit: Math.max(1, Math.min(500, Number(url.searchParams.get("limit")) || 100)),
            offset: Math.max(0, Number(url.searchParams.get("offset")) || 0),
        }));
    });

    router.register("POST", "/api/mes/orders", async (req, res) => {
        const body: any = (await readJsonBody(req)) || {};
        const order = parseOrderDraft(body.order || body);
        const phaseValues = Array.isArray(body.phases) ? body.phases : [];
        if (!phaseValues.length || phaseValues.length > 100) {
            throw badRequest("Un ordine deve contenere da 1 a 100 fasi.");
        }
        const phases = phaseValues.map((phase: unknown) => parsePhaseDraft(phase, order));
        sendJson(res, 201, await addMesOrder(order, phases, actionContext(req)));
    });

    router.register("GET", "/api/mes/orders/:orderId", async (_req, res, params) => {
        const order = getMesOrder(requiredText(params.orderId, "ID ordine", 100));
        if (!order) throw notFound("Ordine MES non trovato.");
        sendJson(res, 200, order);
    });

    router.register("PUT", "/api/mes/orders/:orderId", async (req, res, params) => {
        const body: any = (await readJsonBody(req)) || {};
        sendJson(res, 200, await editMesOrder(
            requiredText(params.orderId, "ID ordine", 100),
            parseOrderDraft(body.order || body),
            revision(body.baseRevision),
            actionContext(req),
        ));
    });

    router.register("POST", "/api/mes/orders/:orderId/phases", async (req, res, params) => {
        const body: any = (await readJsonBody(req)) || {};
        sendJson(res, 201, await addMesPhase(
            requiredText(params.orderId, "ID ordine", 100),
            parsePhaseDraft(body.phase || body),
            actionContext(req),
        ));
    });

    router.register("PUT", "/api/mes/phases/:phaseId", async (req, res, params) => {
        const body: any = (await readJsonBody(req)) || {};
        sendJson(res, 200, await editMesPhase(
            requiredText(params.phaseId, "ID fase", 100),
            parsePhaseDraft(body.phase || body),
            revision(body.baseRevision),
            actionContext(req),
        ));
    });
}

