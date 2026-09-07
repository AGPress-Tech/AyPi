import { logger } from "../../shared/logging/logger";
import { buildContext, type ActionContext } from "../../shared/logging/audit";
import { createOperationQueue } from "../../shared/ops/queue";
import {
    deleteRegistrazioneProgettoSpeciale,
    listRegistrazioniProgettiSpeciali,
    loadRegistrazioneProgettoSpeciale,
    resolveProgettoSpecialeAttachment,
    saveRegistrazioneProgettoSpeciale,
} from "./repository";

const enqueue = createOperationQueue("registrazioni-progetti-speciali");

export const getRegistrazioniProgettiSpeciali = () => listRegistrazioniProgettiSpeciali();
export const getRegistrazioneProgettoSpeciale = (code: string) => loadRegistrazioneProgettoSpeciale(code);
export const getProgettoSpecialeAttachmentPath = (name: string) => resolveProgettoSpecialeAttachment(name);

export function saveRegistrazioneProgettoSpecialeItem(code: string, payload: any, context?: ActionContext) {
    const meta = buildContext(context);
    return enqueue("saveItem", () => {
        const saved = saveRegistrazioneProgettoSpeciale({ ...payload, code, progettoNumero: code });
        logger.info("Registrazione progetto speciale salvata", {
            ...meta,
            event: "registrazione_progetto_speciale_saved",
            module: "registrazioni-progetti-speciali",
            category: "data",
            code,
            completed: saved.completato,
            changeSummary: `Registrazione progetto speciale salvata: ${code}`,
        });
        return saved;
    });
}

export function removeRegistrazioneProgettoSpecialeItem(code: string, context?: ActionContext) {
    const meta = buildContext(context);
    return enqueue("deleteItem", () => {
        const removed = deleteRegistrazioneProgettoSpeciale(code);
        if (removed) {
            logger.info("Registrazione progetto speciale eliminata", {
                ...meta,
                event: "registrazione_progetto_speciale_deleted",
                module: "registrazioni-progetti-speciali",
                category: "data",
                code,
                changeSummary: `Registrazione progetto speciale eliminata: ${code}`,
            });
        }
        return removed;
    });
}
