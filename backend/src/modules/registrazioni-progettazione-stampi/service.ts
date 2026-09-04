import { logger } from "../../shared/logging/logger";
import { buildContext, type ActionContext } from "../../shared/logging/audit";
import { createOperationQueue } from "../../shared/ops/queue";
import {
    deleteRegistrazioneStampi,
    listRegistrazioniStampi,
    loadRegistrazioneStampi,
    resolveRegistrazioneStampiAttachment,
    saveRegistrazioneStampi,
} from "./repository";

const enqueue = createOperationQueue("registrazioni-progettazione-stampi");

export const getRegistrazioniStampi = () => listRegistrazioniStampi();
export const getRegistrazioneStampi = (code: string) => loadRegistrazioneStampi(code);
export const getRegistrazioneStampiAttachmentPath = (name: string) =>
    resolveRegistrazioneStampiAttachment(name);

export function saveRegistrazioneStampiItem(
    code: string,
    payload: any,
    context?: ActionContext,
) {
    const meta = buildContext(context);
    return enqueue("saveItem", () => {
        const saved = saveRegistrazioneStampi({ ...payload, code, progettoNumero: code });
        logger.info("Registrazione progettazione stampi salvata", {
            ...meta,
            event: "registrazione_progettazione_stampi_saved",
            module: "registrazioni-progettazione-stampi",
            category: "data",
            code,
            completed: saved.completato,
            changeSummary: `Registrazione progettazione stampi salvata: ${code}`,
        });
        return saved;
    });
}

export function removeRegistrazioneStampiItem(code: string, context?: ActionContext) {
    const meta = buildContext(context);
    return enqueue("deleteItem", () => {
        const removed = deleteRegistrazioneStampi(code);
        if (removed) {
            logger.info("Registrazione progettazione stampi eliminata", {
                ...meta,
                event: "registrazione_progettazione_stampi_deleted",
                module: "registrazioni-progettazione-stampi",
                category: "data",
                code,
                changeSummary: `Registrazione progettazione stampi eliminata: ${code}`,
            });
        }
        return removed;
    });
}
