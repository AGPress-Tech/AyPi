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
    deleteTransferItem,
    listTransferItems,
    loadTransferItem,
    resolveTransferAttachmentPath,
    saveTransferItem,
} from "./repository";

const enqueue = createOperationQueue("transfer-attrezzaggio");

export function getTransferItems() {
    return listTransferItems();
}

export function getTransferItem(code: string) {
    return loadTransferItem(code);
}

function summarizeTransferHeader(item: any) {
    return {
        code: String(item?.code || "").trim(),
        codiceArticolo: String(item?.codiceArticolo || "").trim(),
        fase: String(item?.fase || "").trim(),
        codiceMacchina: String(item?.codiceMacchina || "").trim(),
        metodoVariante: String(item?.metodoVariante || "").trim(),
        lavorazione: String(item?.lavorazione || "").trim(),
        cicloLavorazione: String(item?.cicloLavorazione || "").trim(),
        spessori: String(item?.spessori || "").trim(),
        vitiRondelle: String(item?.vitiRondelle || "").trim(),
        spine: String(item?.spine || "").trim(),
        programmaRobot: String(item?.programmaRobot || "").trim(),
        mani: String(item?.mani || "").trim(),
        morsetti: String(item?.morsetti || "").trim(),
        note: String(item?.note || "").trim(),
        attachmentsCount: Array.isArray(item?.attachments) ? item.attachments.length : 0,
    };
}

function summarizeUtensiliRows(item: any) {
    return Array.isArray(item?.utensili)
        ? item.utensili.map((row: any, index: number) => ({
              key: String(row?.nrUnita || "").trim() || `row-${index + 1}`,
              nrUnita: String(row?.nrUnita || "").trim(),
              iso: String(row?.iso || "").trim(),
              descrizione: String(row?.descrizione || "").trim(),
              col1: String(row?.col1 || "").trim(),
              col2: String(row?.col2 || "").trim(),
              col3: String(row?.col3 || "").trim(),
              col4: String(row?.col4 || "").trim(),
              col5: String(row?.col5 || "").trim(),
              col6: String(row?.col6 || "").trim(),
              col7: String(row?.col7 || "").trim(),
              col8: String(row?.col8 || "").trim(),
              col10: String(row?.col10 || "").trim(),
              col12: String(row?.col12 || "").trim(),
              col13: String(row?.col13 || "").trim(),
              col14: String(row?.col14 || "").trim(),
          }))
        : [];
}

export function saveTransfer(code: string, payload: any, context?: ActionContext) {
    const meta = buildContext(context);
    return enqueue("saveItem", () => {
        const beforeItem = loadTransferItem(code);
        const saved = saveTransferItem({
            ...payload,
            code,
        });
        const headerChanges = buildChanges(
            summarizeTransferHeader(beforeItem),
            summarizeTransferHeader(saved),
            {
                codiceArticolo: "Codice articolo",
                fase: "Fase",
                codiceMacchina: "Codice macchina",
                metodoVariante: "Metodo/Variante",
                spessori: "Spessori",
                vitiRondelle: "Viti/Rondelle",
                spine: "Spine",
                programmaRobot: "Programma Robot",
                mani: "Mani",
                morsetti: "Morsetti",
                lavorazione: "Lavorazione",
                cicloLavorazione: "Tempo ciclo",
                note: "Note",
                attachmentsCount: "Numero allegati",
            },
        );
        const utensiliDiff = diffCollections({
            before: summarizeUtensiliRows(beforeItem),
            after: summarizeUtensiliRows(saved),
            entityLabel: "Utensile",
            keyOf: (item) => String(item?.key || "").trim(),
            fieldLabels: {
                iso: "ISO",
                descrizione: "Descrizione lavorazione",
                col1: "Utensile",
                col2: "Attacco base",
                col3: "Adattatore",
                col4: "Testa multipla",
                col5: "Pulegge",
                col6: "Commutatore",
                col7: "Arresto positivo",
                col8: "Sosta fine corsa",
                col10: "Regolatore avanzamento 1",
                col12: "Regolatore avanzamento 2",
                col13: "Posizione cartesiana unita",
                col14: "Posizione angolare unita",
            },
        });
        const changes = [...headerChanges, ...utensiliDiff.changes];
        logger.info("Transfer item saved", {
            ...meta,
            event: "transfer_item_saved",
            module: "transfer",
            category: "data",
            code,
            beforeTools: summarizeUtensiliRows(beforeItem).length,
            afterTools: summarizeUtensiliRows(saved).length,
            added: utensiliDiff.added,
            removed: utensiliDiff.removed,
            updated: utensiliDiff.updated + headerChanges.length,
            changes,
            changeSummary:
                buildChangeSummary(changes) ||
                `Scheda ${code} salvata`,
        });
        return saved;
    });
}

export function getTransferAttachmentPath(storedName: string) {
    return resolveTransferAttachmentPath(storedName);
}

export function removeTransfer(code: string, context?: ActionContext) {
    const meta = buildContext(context);
    return enqueue("deleteItem", () => {
        const beforeItem = loadTransferItem(code);
        const ok = deleteTransferItem(code);
        if (ok) {
            logger.info("Transfer item deleted", {
                ...meta,
                event: "transfer_item_deleted",
                module: "transfer",
                category: "data",
                code,
                changes: [
                    {
                        label: "Scheda attrezzaggio rimossa",
                        before: String(beforeItem?.code || code),
                        after: "-",
                    },
                ],
                changeSummary: `Scheda attrezzaggio rimossa: ${String(beforeItem?.code || code)}`,
            });
        }
        return ok;
    });
}
