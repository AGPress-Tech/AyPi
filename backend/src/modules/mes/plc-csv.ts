import { createHash } from "crypto";
import type {
    MachineCounterEvent,
    PlcCsvImportIssue,
    PlcCsvParseResult,
} from "./types";

const REQUIRED_HEADERS = [
    "timestamp_locale",
    "macchina",
    "mac",
    "frame_id",
    "byte_sdu",
    "bit",
    "impulso_sessione",
    "pezzi_sessione",
    "moltiplicatore",
];

function parseDelimitedRows(input: string, delimiter = ";") {
    const rows: string[][] = [];
    let row: string[] = [];
    let value = "";
    let quoted = false;

    for (let index = 0; index < input.length; index += 1) {
        const char = input[index];
        if (quoted) {
            if (char === '"' && input[index + 1] === '"') {
                value += '"';
                index += 1;
            } else if (char === '"') {
                quoted = false;
            } else {
                value += char;
            }
            continue;
        }
        if (char === '"') {
            quoted = true;
        } else if (char === delimiter) {
            row.push(value);
            value = "";
        } else if (char === "\n") {
            row.push(value.replace(/\r$/, ""));
            rows.push(row);
            row = [];
            value = "";
        } else {
            value += char;
        }
    }
    if (value || row.length) {
        row.push(value.replace(/\r$/, ""));
        rows.push(row);
    }
    return rows;
}

function integer(value: unknown) {
    const parsed = Number(String(value ?? "").trim());
    return Number.isInteger(parsed) ? parsed : null;
}

function normalizedHeader(value: string) {
    return String(value || "")
        .replace(/^\uFEFF/, "")
        .trim()
        .toLowerCase();
}

function eventId(parts: Array<string | number>) {
    return createHash("sha256").update(parts.join("\u001f"), "utf8").digest("hex");
}

export function parsePlcImpulseCsv(options: {
    csv: string;
    sourceSessionId: string;
    sourceFile: string;
    receivedAt?: string;
    firstDataRow?: number;
}): PlcCsvParseResult {
    const rows = parseDelimitedRows(options.csv);
    if (!rows.length) throw new Error("Il CSV è vuoto.");

    const headers = rows[0].map(normalizedHeader);
    const missing = REQUIRED_HEADERS.filter((header) => !headers.includes(header));
    if (missing.length) {
        throw new Error(`Intestazioni CSV mancanti: ${missing.join(", ")}.`);
    }
    const indexes = new Map(headers.map((header, index) => [header, index]));
    const receivedAt = options.receivedAt || new Date().toISOString();
    const events: MachineCounterEvent[] = [];
    const issues: PlcCsvImportIssue[] = [];
    let totalRows = 0;

    rows.slice(1).forEach((columns, offset) => {
        const rowNumber = offset + Math.max(2, options.firstDataRow || 2);
        if (!columns.some((column) => String(column || "").trim())) return;
        totalRows += 1;
        const get = (name: string) => String(columns[indexes.get(name)!] ?? "").trim();
        const machineId = get("macchina");
        const timestamp = get("timestamp_locale");
        const multiplier = integer(get("moltiplicatore"));
        const sourcePulse = integer(get("impulso_sessione"));
        const sourcePieces = integer(get("pezzi_sessione"));
        const byte = integer(get("byte_sdu"));
        const bit = integer(get("bit"));
        const occurredAtMs = Date.parse(timestamp);

        let issue = "";
        if (!machineId) issue = "Codice macchina mancante.";
        else if (!timestamp || !Number.isFinite(occurredAtMs)) issue = "Timestamp non valido.";
        else if (!multiplier || multiplier < 1) issue = "Moltiplicatore non valido.";
        else if (!sourcePulse || sourcePulse < 1) issue = "Contatore impulsi non valido.";
        else if (!sourcePieces || sourcePieces < 1) issue = "Contatore pezzi non valido.";
        else if (byte === null || byte < 0) issue = "Byte del segnale non valido.";
        else if (bit === null || bit < 0 || bit > 7) issue = "Bit del segnale non valido.";
        if (issue) {
            if (issues.length < 100) issues.push({ row: rowNumber, message: issue });
            return;
        }

        const raw: Record<string, string> = {};
        headers.forEach((header, index) => {
            raw[header] = String(columns[index] ?? "");
        });
        const normalizedTimestamp = new Date(occurredAtMs).toISOString();
        const id = eventId([
            "PLC_CSV",
            options.sourceSessionId,
            options.sourceFile,
            rowNumber,
            normalizedTimestamp,
            machineId,
            sourcePulse!,
            sourcePieces!,
            multiplier!,
            get("mac"),
            get("frame_id"),
            byte!,
            bit!,
        ]);
        events.push({
            eventId: id,
            source: "PLC_CSV",
            sourceSessionId: options.sourceSessionId,
            sourcePosition: `${options.sourceFile}:${rowNumber}`,
            machineId,
            occurredAt: normalizedTimestamp,
            receivedAt,
            // Il reader scrive una riga per ogni fronte di salita: ogni riga
            // rappresenta quindi un singolo impulso, indipendente dal cumulativo.
            pulseDelta: 1,
            pieceDelta: multiplier!,
            multiplier: multiplier!,
            signal: {
                mac: get("mac").toLowerCase(),
                frameId: get("frame_id").toUpperCase(),
                byte: byte!,
                bit: bit!,
            },
            raw,
        });
    });

    return {
        events,
        totalRows,
        rejectedRows: totalRows - events.length,
        issues,
    };
}

