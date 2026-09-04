import path from "path";
import { backendConfig } from "../../config";
import { getSqliteDatabase, runSqliteTransaction } from "../../shared/db/sqlite";
import { ensureAgpressDailyBackup } from "../../shared/storage/agpress-backups";
import { createAttachmentStore } from "../../shared/storage/attachment-store";
import { parseJson, serializeJson } from "../../shared/storage/json-codec";

const STORAGE_DIR = backendConfig.modules.registrazioniProgettazioneStampi.dir;
const ATTACHMENTS_DIR = path.join(STORAGE_DIR, "_attachments");
const TABLE = "registrazioni_progettazione_stampi";
const attachments = createAttachmentStore(ATTACHMENTS_DIR);

function ensureSchema() {
    getSqliteDatabase().exec(`
        CREATE TABLE IF NOT EXISTS ${TABLE} (
            code TEXT PRIMARY KEY,
            descrizione TEXT,
            tipologia TEXT,
            codice_articolo TEXT,
            completato INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT,
            payload_json TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_${TABLE}_codice_articolo ON ${TABLE}(codice_articolo);
        CREATE INDEX IF NOT EXISTS idx_${TABLE}_updated_at ON ${TABLE}(updated_at);
    `);
}

function text(value: unknown) {
    return String(value || "").trim();
}

function yesNo(value: unknown) {
    const normalized = text(value).toLowerCase();
    return normalized === "si" || normalized === "no" ? normalized : "";
}

function normalizeWorkflowAttachments(items: unknown) {
    const source = Array.isArray(items) ? items : [];
    const normalized = attachments.normalize(source);
    return normalized.map((item) => {
        const original = source.find((candidate) => String(candidate?.id || "") === item.id);
        return {
            ...item,
            workflowKey: text(original?.workflowKey),
        };
    });
}

export function normalizeRegistrazioneStampi(raw: any) {
    const item = raw && typeof raw === "object" ? raw : {};
    const data = text(item.data);
    const emessoDa = text(item.emessoDa);
    return {
        code: text(item.code || item.progettoNumero),
        progettoNumero: text(item.progettoNumero || item.code),
        descrizioneProgetto: text(item.descrizioneProgetto),
        tipologia: text(item.tipologia),
        nuovoProgetto: yesNo(item.nuovoProgetto),
        origineProgetto: ["interno", "cliente"].includes(text(item.origineProgetto))
            ? text(item.origineProgetto)
            : "",
        personalizzazioneCliente: yesNo(item.personalizzazioneCliente),
        revisioneVecchioProgetto: yesNo(item.revisioneVecchioProgetto),
        codiceArticolo: text(item.codiceArticolo),
        dimensioneStampo: text(item.dimensioneStampo),
        materialePrevisto: text(item.materialePrevisto),
        pesoStampato: text(item.pesoStampato),
        requisitiUniEn12420: yesNo(item.requisitiUniEn12420),
        requisitiBrevetto: yesNo(item.requisitiBrevetto),
        consegnaRichiestaCliente: text(item.consegnaRichiestaCliente),
        sviluppoDaUltimareEntro: text(item.sviluppoDaUltimareEntro),
        dataTermineEffettiva: text(item.dataTermineEffettiva),
        dfmeaPfmea: Array.isArray(item.dfmeaPfmea)
            ? item.dfmeaPfmea.map(text).filter(Boolean)
            : [],
        dfmeaPfmeaNote: text(item.dfmeaPfmeaNote),
        rischioAlto: text(item.rischioAlto),
        rischioMedio: text(item.rischioMedio),
        rischioBasso: text(item.rischioBasso),
        rischioProgetto: ["alto", "medio", "basso"].includes(text(item.rischioProgetto))
            ? text(item.rischioProgetto)
            : "",
        note: text(item.note),
        fasiSuccessive:
            item.fasiSuccessive && typeof item.fasiSuccessive === "object"
                ? item.fasiSuccessive
                : {},
        data,
        emessoDa,
        completato: Boolean(data && emessoDa),
        attachments: normalizeWorkflowAttachments(item.attachments),
        newAttachments: Array.isArray(item.newAttachments) ? item.newAttachments : [],
        createdAt: text(item.createdAt),
        updatedAt: text(item.updatedAt),
    };
}

function rowToItem(row: unknown[]) {
    return normalizeRegistrazioneStampi(parseJson(row?.[0], {}));
}

export function listRegistrazioniStampi() {
    ensureSchema();
    const result = getSqliteDatabase().exec(`
        SELECT payload_json FROM ${TABLE}
        ORDER BY COALESCE(updated_at, code) DESC, code ASC
    `);
    return (result?.[0]?.values || []).map(rowToItem);
}

export function loadRegistrazioneStampi(code: string) {
    ensureSchema();
    const result = getSqliteDatabase().exec(
        `SELECT payload_json FROM ${TABLE} WHERE code = ?`,
        [text(code)],
    );
    const raw = result?.[0]?.values?.[0]?.[0];
    return raw ? normalizeRegistrazioneStampi(parseJson(raw, {})) : null;
}

export function saveRegistrazioneStampi(payload: any) {
    ensureSchema();
    ensureAgpressDailyBackup("auto", 30);
    const normalized = normalizeRegistrazioneStampi(payload);
    const previousCode = text(payload?.previousCode);
    const current = loadRegistrazioneStampi(normalized.code) ||
        (previousCode ? loadRegistrazioneStampi(previousCode) : null);
    const retained = normalizeWorkflowAttachments(normalized.attachments);
    const retainedIds = new Set(retained.map((item) => item.id));
    const removed = normalizeWorkflowAttachments(current?.attachments)
        .filter((item) => !retainedIds.has(item.id));
    const added = attachments.saveNew(normalized.newAttachments).map((item, index) => ({
        ...item,
        workflowKey: text(normalized.newAttachments?.[index]?.workflowKey),
    }));
    const now = new Date().toISOString();
    const next = {
        ...normalized,
        attachments: [...retained, ...added],
        newAttachments: [],
        createdAt: normalized.createdAt || current?.createdAt || now,
        updatedAt: now,
    };

    runSqliteTransaction((database) => {
        if (previousCode && previousCode !== next.code) {
            database.run(`DELETE FROM ${TABLE} WHERE code = ?`, [previousCode]);
        }
        database.run(
            `INSERT OR REPLACE INTO ${TABLE}
                (code, descrizione, tipologia, codice_articolo, completato, updated_at, payload_json)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                next.code,
                next.descrizioneProgetto || null,
                next.tipologia || null,
                next.codiceArticolo || null,
                next.completato ? 1 : 0,
                next.updatedAt,
                serializeJson(next),
            ],
        );
    });
    attachments.remove(removed);
    return next;
}

export function deleteRegistrazioneStampi(code: string) {
    ensureSchema();
    const current = loadRegistrazioneStampi(code);
    if (!current) return false;
    ensureAgpressDailyBackup("auto", 30);
    runSqliteTransaction((database) => {
        database.run(`DELETE FROM ${TABLE} WHERE code = ?`, [text(code)]);
    });
    attachments.remove(current.attachments);
    return true;
}

export function resolveRegistrazioneStampiAttachment(storedName: string) {
    return attachments.resolvePath(storedName);
}
