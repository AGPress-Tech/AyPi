import { logger } from "../../shared/logging/logger";
import {
    buildContext,
    diffCollections,
    type ActionContext,
} from "../../shared/logging/audit";
import { createOperationQueue } from "../../shared/ops/queue";
import {
    createProductManagerBackup,
    loadProductManagerBootstrap,
    listProductManagerBackups,
    restoreProductManagerBackup,
    saveCatalogImage,
    saveProductManagerCatalog,
    saveProductManagerCategories,
    saveProductManagerInterventions,
    saveProductManagerInterventionTypes,
    saveProductManagerRequests,
} from "./repository";

const enqueue = createOperationQueue("product-manager");

function summarizeArray(items: any[] | null | undefined) {
    return Array.isArray(items) ? items : [];
}

function logArraySave(options: {
    message: string;
    event: string;
    entityLabel: string;
    before: any[];
    after: any[];
    context?: ActionContext;
    fieldLabels?: Record<string, string>;
    keyOf?: (item: any, index: number) => string;
}) {
    const meta = buildContext(options.context);
    const diff = diffCollections({
        before: options.before,
        after: options.after,
        entityLabel: options.entityLabel,
        fieldLabels: options.fieldLabels,
        keyOf: options.keyOf,
    });
    logger.info(options.message, {
        ...meta,
        event: options.event,
        module: "purchasing",
        category: "data",
        beforeCount: options.before.length,
        afterCount: options.after.length,
        added: diff.added,
        removed: diff.removed,
        updated: diff.updated,
        changes: diff.changes,
        changeSummary: diff.changeSummary,
    });
}

export function getProductManagerBootstrap() {
    return loadProductManagerBootstrap();
}

export function getProductManagerBackups() {
    return listProductManagerBackups();
}

export function runProductManagerBackup(context?: ActionContext) {
    const meta = buildContext(context);
    return enqueue("createBackup", () => {
        const result = createProductManagerBackup();
        logger.info("Purchasing backup created", {
            ...meta,
            event: "purchasing_backup_created",
            module: "purchasing",
            category: "backup",
            restored: result?.name || "",
            outcome: "success",
        });
        return result;
    });
}

export function runProductManagerRestore(name: string, context?: ActionContext) {
    const meta = buildContext(context);
    return enqueue("restoreBackup", () => {
        const result = restoreProductManagerBackup(name);
        logger.info("Purchasing backup restored", {
            ...meta,
            event: "purchasing_backup_restored",
            module: "purchasing",
            category: "backup",
            restored: result?.restored || name,
            outcome: "success",
        });
        return result;
    });
}

export function saveRequests(payload: any[], context?: ActionContext) {
    return enqueue("saveRequests", () => {
        const before = summarizeArray(loadProductManagerBootstrap().requests);
        const after = summarizeArray(saveProductManagerRequests(payload));
        logArraySave({
            message: "Purchasing requests saved",
            event: "purchasing_save_requests",
            entityLabel: "Richiesta",
            before,
            after,
            context,
            fieldLabels: {
                status: "Stato",
                description: "Descrizione",
                assignee: "Assegnatario",
                requester: "Richiedente",
                supplier: "Fornitore",
                quantity: "Quantita",
                note: "Note",
            },
        });
        return after;
    });
}

export function saveInterventions(payload: any[], context?: ActionContext) {
    return enqueue("saveInterventions", () => {
        const before = summarizeArray(loadProductManagerBootstrap().interventions);
        const after = summarizeArray(saveProductManagerInterventions(payload));
        logArraySave({
            message: "Purchasing interventions saved",
            event: "purchasing_save_interventions",
            entityLabel: "Intervento",
            before,
            after,
            context,
            fieldLabels: {
                status: "Stato",
                description: "Descrizione",
                assignee: "Assegnatario",
                supplier: "Fornitore",
                note: "Note",
            },
        });
        return after;
    });
}

export function saveCatalog(payload: any[], context?: ActionContext) {
    return enqueue("saveCatalog", () => {
        const before = summarizeArray(loadProductManagerBootstrap().catalog);
        const after = summarizeArray(saveProductManagerCatalog(payload));
        logArraySave({
            message: "Purchasing catalog saved",
            event: "purchasing_save_catalog",
            entityLabel: "Catalogo",
            before,
            after,
            context,
            fieldLabels: {
                name: "Nome",
                description: "Descrizione",
                supplier: "Fornitore",
                price: "Prezzo",
                category: "Categoria",
            },
        });
        return after;
    });
}

export function saveCategories(payload: any[], context?: ActionContext) {
    return enqueue("saveCategories", () => {
        const before = summarizeArray(loadProductManagerBootstrap().categories);
        const after = summarizeArray(saveProductManagerCategories(payload));
        logArraySave({
            message: "Purchasing categories saved",
            event: "purchasing_save_categories",
            entityLabel: "Categoria",
            before,
            after,
            context,
        });
        return after;
    });
}

export function saveInterventionTypes(payload: any[], context?: ActionContext) {
    return enqueue("saveInterventionTypes", () => {
        const before = summarizeArray(loadProductManagerBootstrap().interventionTypes);
        const after = summarizeArray(saveProductManagerInterventionTypes(payload));
        logArraySave({
            message: "Purchasing intervention types saved",
            event: "purchasing_save_intervention_types",
            entityLabel: "Tipo intervento",
            before,
            after,
            context,
        });
        return after;
    });
}

export function saveCatalogImageEntry(
    payload: {
        catalogId?: string;
        fileName?: string;
        dataBase64?: string;
    },
    context?: ActionContext,
) {
    const meta = buildContext(context);
    return enqueue("saveCatalogImage", () => {
        const result = saveCatalogImage(payload);
        logger.info("Purchasing catalog image saved", {
            ...meta,
            event: "purchasing_save_catalog_image",
            module: "purchasing",
            category: "data",
            changes: [
                {
                    label: "Immagine catalogo",
                    before: String(payload.fileName || "-"),
                    after: String(result?.imageFile || "-"),
                },
            ],
            changeSummary: `Immagine catalogo: ${String(payload.fileName || "-")} -> ${String(result?.imageFile || "-")}`,
        });
        return result;
    });
}
