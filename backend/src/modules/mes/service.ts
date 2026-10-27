import { randomUUID } from "crypto";
import type { ActionContext } from "../../shared/logging/audit";
import { buildContext } from "../../shared/logging/audit";
import { badRequest } from "../../shared/http/errors";
import { logger } from "../../shared/logging/logger";
import { createOperationQueue } from "../../shared/ops/queue";
import { parsePlcImpulseCsv } from "./plc-csv";
import {
    loadAcquisitionStatus,
    loadMachineEvents,
    loadMesEventSummary,
    loadMesImports,
    loadUnassignedPieces,
    storeCollectorBatch,
    storeMachineEvents,
} from "./repository";
import type { MesCollectorBatch, PlcCsvImportPayload } from "./types";

const enqueue = createOperationQueue("mes");

export function ingestMesCollectorBatch(batch: MesCollectorBatch, context?: ActionContext) {
    const meta = buildContext(context);
    return enqueue("ingestCollectorBatch", () => {
        const result = storeCollectorBatch(batch, new Date().toISOString());
        logger.info("MES collector batch ingested", {
            ...meta,
            event: "mes_collector_batch_ingested",
            category: "data",
            module: "mes",
            collectorId: batch.collectorId,
            sourceSessionId: batch.sourceSessionId,
            batchId: batch.batchId,
            duplicate: result.duplicate,
            machinesUpdated: result.machinesUpdated,
        });
        return result;
    });
}

export function getMesAcquisitionStatus(staleAfterSeconds?: number) {
    return loadAcquisitionStatus(staleAfterSeconds);
}

export function importPlcCsv(payload: PlcCsvImportPayload, context?: ActionContext) {
    const meta = buildContext(context);
    return enqueue("importPlcCsv", () => {
        let parsed;
        try {
            parsed = parsePlcImpulseCsv(payload);
        } catch (error) {
            throw badRequest(
                error instanceof Error ? error.message : "CSV PLC non valido.",
            );
        }
        const importedAt = new Date().toISOString();
        const result = storeMachineEvents(parsed.events, {
            importId: randomUUID(),
            source: "PLC_CSV",
            sourceSessionId: payload.sourceSessionId,
            sourceFile: payload.sourceFile,
            totalRows: parsed.totalRows,
            validRows: parsed.events.length,
            insertedEvents: 0,
            duplicateEvents: 0,
            rejectedRows: parsed.rejectedRows,
            issues: parsed.issues,
            importedAt,
        }, meta.actor || "Operatore AyPi");
        logger.info("MES PLC CSV imported", {
            ...meta,
            event: "mes_plc_csv_imported",
            category: "data",
            module: "mes",
            sourceSessionId: result.sourceSessionId,
            sourceFile: result.sourceFile,
            totalRows: result.totalRows,
            insertedEvents: result.insertedEvents,
            duplicateEvents: result.duplicateEvents,
            rejectedRows: result.rejectedRows,
        });
        return result;
    });
}

export function getMesMachineEvents(options: Parameters<typeof loadMachineEvents>[0]) {
    return loadMachineEvents(options);
}

export function getMesEventSummary() {
    return loadMesEventSummary();
}

export function getMesImports(limit?: number) {
    return loadMesImports(limit);
}

export function getMesUnassignedPieces() {
    return loadUnassignedPieces();
}

