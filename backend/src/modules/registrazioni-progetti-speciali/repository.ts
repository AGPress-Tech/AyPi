import path from "path";
import { backendConfig } from "../../config";
import { getSqliteDatabase, runSqliteTransaction } from "../../shared/db/sqlite";
import { ensureAgpressDailyBackup } from "../../shared/storage/agpress-backups";
import { createAttachmentStore } from "../../shared/storage/attachment-store";
import { parseJson, serializeJson } from "../../shared/storage/json-codec";

const STORAGE_DIR = backendConfig.modules.registrazioniProgettiSpeciali.dir;
const ATTACHMENTS_DIR = path.join(STORAGE_DIR, "_attachments");
const TABLE = "registrazioni_progetti_speciali";
const attachments = createAttachmentStore(ATTACHMENTS_DIR);

function text(value: unknown) {
    return String(value || "").trim();
}

function yesNo(value: unknown) {
    const valueText = text(value).toLowerCase();
    return valueText === "si" || valueText === "no" ? valueText : "";
}

function ensureSchema() {
    getSqliteDatabase().exec(`
        CREATE TABLE IF NOT EXISTS ${TABLE} (
            code TEXT PRIMARY KEY,
            descrizione TEXT,
            richiesto_da TEXT,
            completato INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT,
            payload_json TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_${TABLE}_richiesto_da ON ${TABLE}(richiesto_da);
        CREATE INDEX IF NOT EXISTS idx_${TABLE}_updated_at ON ${TABLE}(updated_at);
    `);
}

function normalizeScopedAttachments(items: unknown) {
    const source = Array.isArray(items) ? items : [];
    return attachments.normalize(source).map((item) => {
        const original = source.find((candidate) => text(candidate?.id) === item.id);
        return { ...item, scopeKey: text(original?.scopeKey) };
    });
}

function normalizePairs(value: unknown) {
    if (!Array.isArray(value)) return [];
    return value.map((pair, index) => ({
        id: text(pair?.id) || `pair-${index + 1}`,
        verifica: pair?.verifica && typeof pair.verifica === "object" ? pair.verifica : {},
        riesame: pair?.riesame && typeof pair.riesame === "object" ? pair.riesame : {},
    }));
}

function normalizeValidations(value: unknown) {
    if (!Array.isArray(value)) return [];
    return value.map((attempt, index) => {
        const legacyNotes = Array.isArray(attempt?.noteRows)
            ? attempt.noteRows.map((row: any) => text(row?.text)).filter(Boolean).join("\n")
            : "";
        return {
            id: text(attempt?.id) || `validation-${index + 1}`,
            answers: attempt?.answers && typeof attempt.answers === "object" ? attempt.answers : {},
            note: text(attempt?.note) || legacyNotes,
            superata: yesNo(attempt?.superata),
            data: text(attempt?.data),
            firmaProgettazione: text(attempt?.firmaProgettazione),
            firmaDirezioneProduzione: text(attempt?.firmaDirezioneProduzione),
            firmaDirezioneCommerciale: text(attempt?.firmaDirezioneCommerciale),
        };
    });
}

function pairComplete(pair: any) {
    const verifica = pair?.verifica || {};
    const riesame = pair?.riesame || {};
    return Boolean(
        verifica.data && verifica.firmaResponsabileTecnico && verifica.firmaRgq &&
        riesame.data && riesame.firmaDirezioneCommerciale &&
        riesame.firmaResponsabileTecnico && riesame.firmaRgq
    );
}

function validationComplete(attempt: any) {
    return Boolean(
        attempt?.superata === "si" && attempt?.data &&
        attempt?.firmaProgettazione && attempt?.firmaDirezioneProduzione &&
        attempt?.firmaDirezioneCommerciale
    );
}

export function normalizeRegistrazioneProgettoSpeciale(raw: any) {
    const item = raw && typeof raw === "object" ? raw : {};
    const coppie = normalizePairs(item.coppieVerificaRiesame);
    const validazioni = normalizeValidations(item.validazioni);
    const baseComplete = Boolean(text(item.data) && text(item.emessoDa));
    return {
        code: text(item.code || item.progettoNumero),
        progettoNumero: text(item.progettoNumero || item.code),
        descrizioneProgetto: text(item.descrizioneProgetto),
        nuovoProgetto: yesNo(item.nuovoProgetto),
        condizioniImpiego: text(item.condizioniImpiego),
        richiestoDa: text(item.richiestoDa),
        pesoStampato: text(item.pesoStampato),
        pesoTornito: text(item.pesoTornito),
        requisitiNormativi: text(item.requisitiNormativi),
        requisitiBrevetto: text(item.requisitiBrevetto),
        validazionePreseriePrevistaPer: text(item.validazionePreseriePrevistaPer),
        inizioProduzionePrevistaPer: text(item.inizioProduzionePrevistaPer),
        dfmeaPfmea: Array.isArray(item.dfmeaPfmea) ? item.dfmeaPfmea.map(text).filter(Boolean) : [],
        dfmeaPfmeaNote: text(item.dfmeaPfmeaNote),
        rischioAlto: text(item.rischioAlto),
        rischioMedio: text(item.rischioMedio),
        rischioBasso: text(item.rischioBasso),
        note: text(item.note),
        supportoEsterno: yesNo(item.supportoEsterno),
        supportoEsternoNote: text(item.supportoEsternoNote),
        caratteristicheGenerali: text(item.caratteristicheGenerali),
        data: text(item.data),
        emessoDa: text(item.emessoDa),
        coppieVerificaRiesame: coppie,
        validazioni,
        completato: Boolean(
            baseComplete && coppie.length > 0 && coppie.every(pairComplete) &&
            validazioni.length > 0 && validationComplete(validazioni[validazioni.length - 1])
        ),
        attachments: normalizeScopedAttachments(item.attachments),
        newAttachments: Array.isArray(item.newAttachments) ? item.newAttachments : [],
        createdAt: text(item.createdAt),
        updatedAt: text(item.updatedAt),
    };
}

export function listRegistrazioniProgettiSpeciali() {
    ensureSchema();
    const result = getSqliteDatabase().exec(`
        SELECT payload_json FROM ${TABLE}
        ORDER BY COALESCE(updated_at, code) DESC, code ASC
    `);
    return (result?.[0]?.values || []).map((row: unknown[]) =>
        normalizeRegistrazioneProgettoSpeciale(parseJson(row?.[0], {})),
    );
}

export function loadRegistrazioneProgettoSpeciale(code: string) {
    ensureSchema();
    const result = getSqliteDatabase().exec(
        `SELECT payload_json FROM ${TABLE} WHERE code = ?`,
        [text(code)],
    );
    const raw = result?.[0]?.values?.[0]?.[0];
    return raw ? normalizeRegistrazioneProgettoSpeciale(parseJson(raw, {})) : null;
}

export function saveRegistrazioneProgettoSpeciale(payload: any) {
    ensureSchema();
    ensureAgpressDailyBackup("auto", 30);
    const normalized = normalizeRegistrazioneProgettoSpeciale(payload);
    const previousCode = text(payload?.previousCode);
    const current = loadRegistrazioneProgettoSpeciale(normalized.code) ||
        (previousCode ? loadRegistrazioneProgettoSpeciale(previousCode) : null);
    const retained = normalizeScopedAttachments(normalized.attachments);
    const retainedIds = new Set(retained.map((item) => item.id));
    const removed = normalizeScopedAttachments(current?.attachments)
        .filter((item) => !retainedIds.has(item.id));
    const added = attachments.saveNew(normalized.newAttachments).map((item, index) => ({
        ...item,
        scopeKey: text(normalized.newAttachments?.[index]?.scopeKey),
    }));
    const now = new Date().toISOString();
    const next = normalizeRegistrazioneProgettoSpeciale({
        ...normalized,
        attachments: [...retained, ...added],
        newAttachments: [],
        createdAt: normalized.createdAt || current?.createdAt || now,
        updatedAt: now,
    });
    runSqliteTransaction((database) => {
        if (previousCode && previousCode !== next.code) {
            database.run(`DELETE FROM ${TABLE} WHERE code = ?`, [previousCode]);
        }
        database.run(
            `INSERT OR REPLACE INTO ${TABLE}
                (code, descrizione, richiesto_da, completato, updated_at, payload_json)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
                next.code,
                next.descrizioneProgetto || null,
                next.richiestoDa || null,
                next.completato ? 1 : 0,
                next.updatedAt,
                serializeJson(next),
            ],
        );
    });
    attachments.remove(removed);
    return next;
}

export function deleteRegistrazioneProgettoSpeciale(code: string) {
    ensureSchema();
    const current = loadRegistrazioneProgettoSpeciale(code);
    if (!current) return false;
    ensureAgpressDailyBackup("auto", 30);
    runSqliteTransaction((database) => {
        database.run(`DELETE FROM ${TABLE} WHERE code = ?`, [text(code)]);
    });
    attachments.remove(current.attachments);
    return true;
}

export function resolveProgettoSpecialeAttachment(storedName: string) {
    return attachments.resolvePath(storedName);
}
