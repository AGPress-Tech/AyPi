import { logger } from "../../shared/logging/logger";
import {
    buildChangeSummary,
    buildChanges,
    buildContext,
    diffCollections,
    type ActionContext,
} from "../../shared/logging/audit";
import { createOperationQueue } from "../../shared/ops/queue";
import {
    deleteHaasItem,
    listHaasItems,
    loadHaasItem,
    resolveHaasAttachmentPath,
    saveHaasItem,
} from "./repository";

const enqueue = createOperationQueue("haas-attrezzaggio");

export function getHaasItems() {
    return listHaasItems();
}

export function getHaasItem(code: string) {
    return loadHaasItem(code);
}

function summarizeHaasHeader(item: any) {
    return {
        code: String(item?.code || "").trim(),
        codiceArticolo: String(item?.codiceArticolo || "").trim(),
        denominazioneArticolo: String(item?.denominazioneArticolo || "").trim(),
        numeroProgramma: String(item?.numeroProgramma || "").trim(),
        macchina: String(item?.macchina || "").trim(),
        metodo: String(item?.metodo || "").trim(),
        cicloLavoro: String(item?.cicloLavoro || "").trim(),
        note: String(item?.note || "").trim(),
        attachmentsCount: Array.isArray(item?.attachments) ? item.attachments.length : 0,
    };
}

function summarizeUtensiliRows(item: any) {
    return Array.isArray(item?.utensili)
        ? item.utensili.map((row: any, index: number) => ({
              key: String(row?.t || "").trim() || `row-${index + 1}`,
              t: String(row?.t || "").trim(),
              ciclo: String(row?.ciclo || "").trim(),
              mandrinoCodice: String(row?.mandrinoCodice || "").trim(),
              mandrinoRiduz: String(row?.mandrinoRiduz || "").trim(),
              mandrinoLunghezza: String(row?.mandrinoLunghezza || "").trim(),
              codiceUtensile: String(row?.codiceUtensile || "").trim(),
              locazione: String(row?.locazione || "").trim(),
              sporgenzaUtensile: String(row?.sporgenzaUtensile || "").trim(),
              diametroGambo: String(row?.diametroGambo || "").trim(),
          }))
        : [];
}

export function saveHaas(code: string, payload: any, context?: ActionContext) {
    const meta = buildContext(context);
    return enqueue("saveItem", () => {
        const beforeItem = loadHaasItem(code);
        const saved = saveHaasItem({
            ...payload,
            code,
        });
        const headerChanges = buildChanges(
            summarizeHaasHeader(beforeItem),
            summarizeHaasHeader(saved),
            {
                codiceArticolo: "Codice articolo",
                denominazioneArticolo: "Denominazione articolo",
                numeroProgramma: "Numero programma",
                macchina: "Macchina",
                metodo: "Metodo",
                cicloLavoro: "Ciclo di lavoro",
                note: "Note",
                attachmentsCount: "Numero allegati",
            },
        );
        const utensiliDiff = diffCollections({
            before: summarizeUtensiliRows(beforeItem),
            after: summarizeUtensiliRows(saved),
            entityLabel: "Utensile HAAS",
            keyOf: (item) => String(item?.key || "").trim(),
            fieldLabels: {
                ciclo: "Ciclo di lavorazione",
                mandrinoCodice: "Tipo mandrino",
                mandrinoRiduz: "ER Weldon",
                mandrinoLunghezza: "Lunghezza",
                codiceUtensile: "Codice utensile",
                locazione: "Locazione",
                sporgenzaUtensile: "Sporgenza utensile",
                diametroGambo: "Diametro gambo",
            },
        });
        const changes = [...headerChanges, ...utensiliDiff.changes];
        logger.info("HAAS item saved", {
            ...meta,
            event: "haas_item_saved",
            module: "attrezzaggio",
            category: "data",
            code,
            beforeTools: summarizeUtensiliRows(beforeItem).length,
            afterTools: summarizeUtensiliRows(saved).length,
            added: utensiliDiff.added,
            removed: utensiliDiff.removed,
            updated: utensiliDiff.updated + headerChanges.length,
            changes,
            changeSummary: buildChangeSummary(changes) || `Scheda HAAS ${code} salvata`,
        });
        return saved;
    });
}

export function getHaasAttachmentPath(storedName: string) {
    return resolveHaasAttachmentPath(storedName);
}

export function removeHaas(code: string, context?: ActionContext) {
    const meta = buildContext(context);
    return enqueue("deleteItem", () => {
        const beforeItem = loadHaasItem(code);
        const ok = deleteHaasItem(code);
        if (ok) {
            logger.info("HAAS item deleted", {
                ...meta,
                event: "haas_item_deleted",
                module: "attrezzaggio",
                category: "data",
                code,
                changes: [
                    {
                        label: "Scheda HAAS rimossa",
                        before: String(beforeItem?.code || code),
                        after: "-",
                    },
                ],
                changeSummary: `Scheda HAAS rimossa: ${String(beforeItem?.code || code)}`,
            });
        }
        return ok;
    });
}
