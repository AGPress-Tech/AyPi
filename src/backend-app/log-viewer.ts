import fs from "fs";
import path from "path";

export type LogViewerFilters = {
    level?: string;
    search?: string;
    file?: string;
    source?: string;
    remoteAddress?: string;
    module?: string;
    requestId?: string;
    user?: string;
    limit?: number;
};

export type LogViewerCursor = {
    fileIndex: number;
    offsets: Record<string, number>;
};

function pad(value: number) {
    return String(value).padStart(2, "0");
}

function getTodayLogFileName(date = new Date()) {
    const yyyy = date.getFullYear();
    const mm = pad(date.getMonth() + 1);
    const dd = pad(date.getDate());
    return `${yyyy}-${mm}-${dd}.log`;
}

type ParsedLogEntry = {
    timestamp: string;
    level: string;
    message: string;
    detailsText: string;
    details: unknown;
    fileName: string;
    filePath: string;
    source: "backend" | "tray";
    remoteAddress: string;
    module: string;
    requestId: string;
    user: string;
    category: string;
    raw: string;
};

type ViewerField = {
    label: string;
    value: string;
    tone?: "neutral" | "accent" | "warn" | "error";
};

type ViewerChange = {
    label: string;
    before: string;
    after: string;
};

type ViewerCategory = {
    key: string;
    label: string;
    icon: string;
    tone: "accent" | "warn" | "error" | "neutral";
};

type LogSource = "backend" | "tray";

type LogFileDescriptor = {
    fileName: string;
    filePath: string;
    source: LogSource;
};

function tryParseJson(raw: string) {
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

function splitMessageAndDetails(value: string) {
    const startIndex = value.indexOf(" {");
    if (startIndex < 0) {
        return {
            message: value.trim(),
            detailsText: "",
            details: null,
        };
    }
    const message = value.slice(0, startIndex).trim();
    const detailsText = value.slice(startIndex + 1).trim();
    const details = tryParseJson(detailsText);
    if (details === null) {
        return {
            message: value.trim(),
            detailsText: "",
            details: null,
        };
    }
    return {
        message,
        detailsText,
        details,
    };
}

function inferModule(
    message: string,
    source: "backend" | "tray",
    details: unknown,
) {
    if (source === "tray") return "tray";
    const data =
        details && typeof details === "object"
            ? (details as Record<string, unknown>)
            : {};
    const explicitModule = String(data.module || "")
        .trim()
        .toLowerCase();
    if (explicitModule) return explicitModule;
    const url = String(data.url || "").toLowerCase();
    const scope = String(data.scope || "").toLowerCase();
    const operationName = String(data.operationName || "").toLowerCase();
    const filePath = String(data.filePath || "").toLowerCase();
    const msg = String(message || "").toLowerCase();

    const combined = `${url} ${scope} ${operationName} ${filePath} ${msg}`;
    if (combined.includes("ferie-permessi") || combined.includes(" fp ")) {
        return "calendar";
    }
    if (combined.includes("product-manager") || combined.includes("purchasing")) {
        return "purchasing";
    }
    if (combined.includes("ticket-support") || combined.includes("ticket")) {
        return "ticket";
    }
    if (combined.includes("transfer-attrezzaggio") || combined.includes("attrezz")) {
        return "transfer";
    }
    if (combined.includes("/api/shared/") || combined.includes("shared")) {
        return "shared";
    }
    return "core";
}

function inferCategory(
    message: string,
    source: "backend" | "tray",
    details: unknown,
) {
    if (source === "tray") return "tray";
    const data =
        details && typeof details === "object"
            ? (details as Record<string, unknown>)
            : {};
    const explicitCategory = String(data.category || "")
        .trim()
        .toLowerCase();
    if (explicitCategory) return explicitCategory;
    const method = String(data.method || "").toUpperCase();
    const statusCode = Number(data.statusCode || 0);
    const filePath = String(data.filePath || "").toLowerCase();
    const url = String(data.url || "").toLowerCase();
    const scope = String(data.scope || "").toLowerCase();
    const msg = String(message || "").toLowerCase();

    if (msg.includes("failed") || statusCode >= 400 || data.detail) return "error";
    if (msg.includes("file write") || filePath) return "storage";
    if (msg.includes("backup") || msg.includes("restore") || filePath.includes("backup")) {
        return "backup";
    }
    if (msg.includes("verify") || msg.includes("admin") || url.includes("/admins")) {
        return "auth";
    }
    if (msg.includes("queue") || scope) return "queue";
    if (msg.includes("http request") || method || url) return "http";
    if (msg.includes("backend listening") || msg.includes("backend stopped")) return "lifecycle";
    return "data";
}

function getCategoryMeta(category: string): ViewerCategory {
    switch (category) {
        case "http":
            return { key: category, label: "HTTP", icon: "⇄", tone: "accent" };
        case "queue":
            return { key: category, label: "Coda", icon: "≋", tone: "accent" };
        case "storage":
            return { key: category, label: "Storage", icon: "🗂", tone: "neutral" };
        case "backup":
            return { key: category, label: "Backup", icon: "⟲", tone: "warn" };
        case "auth":
            return { key: category, label: "Auth", icon: "🔐", tone: "accent" };
        case "lifecycle":
            return { key: category, label: "Stato", icon: "●", tone: "neutral" };
        case "error":
            return { key: category, label: "Errore", icon: "⚠", tone: "error" };
        case "tray":
            return { key: category, label: "Tray", icon: "▣", tone: "neutral" };
        default:
            return { key: category, label: "Dato", icon: "•", tone: "neutral" };
    }
}

function parseLogLine(
    line: string,
    fileName: string,
    filePath: string,
    source: LogSource,
): ParsedLogEntry | null {
    const match = /^\[([^\]]+)\]\s+\[([A-Z]+)\]\s+(.*)$/.exec(line.trim());
    if (!match) return null;
    const [, timestamp, level, tail] = match;
    const parts = splitMessageAndDetails(tail);
    const data =
        parts.details && typeof parts.details === "object"
            ? (parts.details as Record<string, unknown>)
            : {};
    return {
        timestamp,
        level,
        message: parts.message,
        detailsText: parts.detailsText,
        details: parts.details,
        fileName,
        filePath,
        source,
        remoteAddress: String(data.remoteAddress || "").trim(),
        module: inferModule(parts.message, source, parts.details),
        requestId: String(data.requestId || "").trim(),
        user: String(data.user || data.actor || "").trim(),
        category: inferCategory(parts.message, source, parts.details),
        raw: line,
    };
}

function readBackendLogFiles(logDir: string) {
    if (!fs.existsSync(logDir)) return [];
    return fs
        .readdirSync(logDir)
        .filter((name) => name.toLowerCase().endsWith(".log"))
        .sort()
        .map((name) => path.join(logDir, name));
}

function buildLogFileDescriptors(logDir: string, trayDebugLogPath: string) {
    const backendFiles = readBackendLogFiles(logDir)
        .sort((a, b) => path.basename(b).localeCompare(path.basename(a)))
        .map(
            (filePath): LogFileDescriptor => ({
                fileName: path.basename(filePath),
                filePath,
                source: "backend",
            }),
        );
    const trayFiles = fs.existsSync(trayDebugLogPath)
        ? ([
              {
                  fileName: path.basename(trayDebugLogPath),
                  filePath: trayDebugLogPath,
                  source: "tray",
              },
          ] as LogFileDescriptor[])
        : [];
    return [...trayFiles, ...backendFiles];
}

function normalizeFilters(filters: LogViewerFilters = {}) {
    return {
        level: String(filters.level || "").trim().toUpperCase(),
        search: String(filters.search || "").trim().toLowerCase(),
        file: String(filters.file || "").trim(),
        source: String(filters.source || "").trim().toLowerCase(),
        remoteAddress: String(filters.remoteAddress || "").trim().toLowerCase(),
        module: String(filters.module || "").trim().toLowerCase(),
        requestId: String(filters.requestId || "").trim().toLowerCase(),
        user: String(filters.user || "").trim().toLowerCase(),
        limit: Math.max(50, Math.min(Number(filters.limit) || 250, 1000)),
    };
}

function matchesFilters(
    entry: ParsedLogEntry,
    filters: ReturnType<typeof normalizeFilters>,
) {
    if (filters.level && entry.level !== filters.level) return false;
    if (filters.file && entry.fileName !== filters.file) return false;
    if (filters.source && entry.source !== filters.source) return false;
    if (
        filters.remoteAddress &&
        !entry.remoteAddress.toLowerCase().includes(filters.remoteAddress)
    ) {
        return false;
    }
    if (filters.module && entry.module !== filters.module) return false;
    if (
        filters.requestId &&
        !entry.requestId.toLowerCase().includes(filters.requestId)
    ) {
        return false;
    }
    if (filters.user && !entry.user.toLowerCase().includes(filters.user)) {
        return false;
    }
    if (!filters.search) return true;
    const haystack = [
        entry.timestamp,
        entry.level,
        entry.message,
        entry.detailsText,
        entry.fileName,
        entry.source,
        entry.remoteAddress,
        entry.module,
        entry.requestId,
        entry.user,
        entry.category,
    ]
        .join(" ")
        .toLowerCase();
    return haystack.includes(filters.search);
}

function readLogEntriesBatchFromFile(
    descriptor: LogFileDescriptor,
    filters: ReturnType<typeof normalizeFilters>,
    startOffset: number | undefined,
    limit: number,
) {
    if (!fs.existsSync(descriptor.filePath) || limit <= 0) {
        return { entries: [] as ParsedLogEntry[], nextOffset: 0, done: true };
    }

    const stat = fs.statSync(descriptor.filePath);
    const fileSize = stat.size;
    let offset =
        typeof startOffset === "number" && Number.isFinite(startOffset)
            ? Math.max(0, Math.min(startOffset, fileSize))
            : fileSize;
    if (offset <= 0) {
        return { entries: [] as ParsedLogEntry[], nextOffset: 0, done: true };
    }

    const fileDescriptor = fs.openSync(descriptor.filePath, "r");
    const entries: ParsedLogEntry[] = [];
    const chunkSize = 64 * 1024;
    let remainder = "";

    try {
        while (offset > 0 && entries.length < limit) {
            const readSize = Math.min(chunkSize, offset);
            offset -= readSize;
            const buffer = Buffer.alloc(readSize);
            fs.readSync(fileDescriptor, buffer, 0, readSize, offset);
            const text = buffer.toString("utf8") + remainder;
            const lines = text.split(/\r?\n/);
            remainder = lines.shift() || "";

            for (let index = lines.length - 1; index >= 0; index -= 1) {
                const entry = parseLogLine(
                    lines[index],
                    descriptor.fileName,
                    descriptor.filePath,
                    descriptor.source,
                );
                if (!entry || !matchesFilters(entry, filters)) continue;
                entries.push(entry);
                if (entries.length >= limit) break;
            }
        }

        if (offset === 0 && remainder.trim() && entries.length < limit) {
            const entry = parseLogLine(
                remainder,
                descriptor.fileName,
                descriptor.filePath,
                descriptor.source,
            );
            if (entry && matchesFilters(entry, filters)) {
                entries.push(entry);
            }
        }
    } finally {
        fs.closeSync(fileDescriptor);
    }

    return {
        entries,
        nextOffset: offset,
        done: offset <= 0,
    };
}

function toDisplayValue(value: unknown) {
    if (value === null || value === undefined) return "";
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") {
        return String(value);
    }
    return JSON.stringify(value);
}

function pushField(
    fields: ViewerField[],
    label: string,
    value: unknown,
    tone: ViewerField["tone"] = "neutral",
) {
    const normalized = toDisplayValue(value).trim();
    if (!normalized) return;
    fields.push({ label, value: normalized, tone });
}

function normalizeViewerChanges(value: unknown) {
    if (!Array.isArray(value)) return [] as ViewerChange[];
    return value
        .map((item) => {
            if (!item || typeof item !== "object") return null;
            const row = item as Record<string, unknown>;
            const label = toDisplayValue(row.label).trim();
            const before = toDisplayValue(row.before).trim();
            const after = toDisplayValue(row.after).trim();
            if (!label || (!before && !after)) return null;
            return { label, before: before || "-", after: after || "-" };
        })
        .filter((item): item is ViewerChange => !!item);
}

function buildHttpOperationLabel(method: string, url: string) {
    const normalizedMethod = String(method || "").toUpperCase();
    const normalizedUrl = String(url || "").toLowerCase();

    if (normalizedUrl === "/health") {
        return "Controllo stato backend";
    }

    if (normalizedUrl.includes("/api/ferie-permessi/payload")) {
        if (normalizedMethod === "GET") return "Lettura stato Ferie e Permessi";
        if (normalizedMethod === "PUT") return "Sostituzione payload Ferie e Permessi";
    }
    if (normalizedUrl.includes("/api/ferie-permessi/requests/") && normalizedUrl.endsWith("/approve")) {
        return "Approvazione richiesta Ferie e Permessi";
    }
    if (normalizedUrl.includes("/api/ferie-permessi/requests/") && normalizedUrl.endsWith("/reject")) {
        return "Rifiuto richiesta Ferie e Permessi";
    }
    if (normalizedUrl.includes("/api/ferie-permessi/requests/")) {
        if (normalizedMethod === "PUT") return "Modifica richiesta Ferie e Permessi";
        if (normalizedMethod === "DELETE") return "Eliminazione richiesta Ferie e Permessi";
    }
    if (normalizedUrl.includes("/api/ferie-permessi/requests")) {
        if (normalizedMethod === "POST") return "Creazione richiesta Ferie e Permessi";
    }
    if (normalizedUrl.includes("/api/ferie-permessi/holidays/")) {
        if (normalizedMethod === "PUT") return "Modifica festivita";
        if (normalizedMethod === "DELETE") return "Eliminazione festivita";
    }
    if (normalizedUrl.includes("/api/ferie-permessi/holidays")) {
        if (normalizedMethod === "POST") return "Creazione festivita";
    }
    if (normalizedUrl.includes("/api/ferie-permessi/closures")) {
        if (normalizedMethod === "POST") return "Creazione chiusura";
        if (normalizedMethod === "PUT") return "Modifica chiusura";
        if (normalizedMethod === "DELETE") return "Eliminazione chiusura";
    }
    if (normalizedUrl.includes("/api/ferie-permessi/backups/") && normalizedUrl.endsWith("/restore")) {
        return "Ripristino backup Ferie e Permessi";
    }
    if (normalizedUrl.includes("/api/ferie-permessi/backups")) {
        if (normalizedMethod === "GET") return "Lettura lista backup Ferie e Permessi";
        if (normalizedMethod === "POST") return "Creazione backup Ferie e Permessi";
    }

    if (normalizedUrl.includes("/api/product-manager/bootstrap")) {
        return "Lettura bootstrap Purchasing";
    }
    if (normalizedUrl.includes("/api/product-manager/backups/") && normalizedUrl.endsWith("/restore")) {
        return "Ripristino backup Purchasing";
    }
    if (normalizedUrl.includes("/api/product-manager/backups")) {
        if (normalizedMethod === "GET") return "Lettura lista backup Purchasing";
        if (normalizedMethod === "POST") return "Creazione backup Purchasing";
    }
    if (normalizedUrl.includes("/api/product-manager/requests")) {
        return "Salvataggio richieste Purchasing";
    }
    if (normalizedUrl.includes("/api/product-manager/interventions")) {
        return "Salvataggio interventi Purchasing";
    }
    if (normalizedUrl.includes("/api/product-manager/catalog-image/")) {
        return "Lettura immagine catalogo Purchasing";
    }
    if (normalizedUrl.includes("/api/product-manager/catalog-image")) {
        return "Salvataggio immagine catalogo Purchasing";
    }
    if (normalizedUrl.includes("/api/product-manager/catalog")) {
        return "Salvataggio catalogo Purchasing";
    }
    if (normalizedUrl.includes("/api/product-manager/categories")) {
        return "Salvataggio categorie Purchasing";
    }
    if (normalizedUrl.includes("/api/product-manager/intervention-types")) {
        return "Salvataggio tipi intervento Purchasing";
    }

    if (normalizedUrl.includes("/api/ticket-support/store")) {
        if (normalizedMethod === "GET") return "Lettura archivio ticket";
        if (normalizedMethod === "PUT") return "Salvataggio archivio ticket";
    }
    if (normalizedUrl.includes("/api/ticket-support/categories")) {
        if (normalizedMethod === "GET") return "Lettura categorie ticket";
        if (normalizedMethod === "PUT") return "Salvataggio categorie ticket";
    }
    if (normalizedUrl.includes("/api/ticket-support/backups/") && normalizedUrl.endsWith("/restore")) {
        return "Ripristino backup ticket";
    }
    if (normalizedUrl.includes("/api/ticket-support/backups")) {
        if (normalizedMethod === "GET") return "Lettura lista backup ticket";
        if (normalizedMethod === "POST") return "Creazione backup ticket";
    }

    if (normalizedUrl.includes("/api/transfer-attrezzaggio/items/")) {
        if (normalizedMethod === "GET") return "Lettura scheda attrezzaggio transfer";
        if (normalizedMethod === "PUT") return "Salvataggio scheda attrezzaggio transfer";
        if (normalizedMethod === "DELETE") return "Eliminazione scheda attrezzaggio transfer";
    }
    if (normalizedUrl.includes("/api/transfer-attrezzaggio/items")) {
        return "Lettura lista schede attrezzaggio transfer";
    }

    if (normalizedUrl.includes("/api/shared/admins/verify")) {
        return "Verifica credenziali amministratore";
    }
    if (normalizedUrl.includes("/api/shared/admins/names")) {
        return "Lettura nomi amministratori";
    }
    if (normalizedUrl.includes("/api/shared/admins")) {
        if (normalizedMethod === "GET") return "Lettura amministratori";
        if (normalizedMethod === "PUT") return "Salvataggio amministratori";
    }
    if (normalizedUrl.includes("/api/shared/assignees")) {
        if (normalizedMethod === "GET") return "Lettura assegnatari";
        if (normalizedMethod === "PUT") return "Salvataggio assegnatari";
    }

    return "";
}

function buildStructuredOperationSummary(
    message: string,
    data: Record<string, unknown>,
) {
    const event = String(data.event || "").toLowerCase();
    const method = String(data.method || "").toUpperCase();
    const url = String(data.url || "");
    const filePath = String(data.filePath || "");
    const operationName = String(data.operationName || "");
    const scope = String(data.scope || "");

    if (
        event === "http_request_started" ||
        event === "http_request_completed" ||
        event === "http_request_failed"
    ) {
        const label = buildHttpOperationLabel(method, url) || `${method} ${url}`.trim();
        if (event === "http_request_started") return `${label} in corso`;
        if (event === "http_request_failed") return `${label} fallita`;
        if (Number(data.statusCode || 0) >= 400) return `${label} completata con warning`;
        return `${label} completata`;
    }

    if (event === "queue_operation_completed" && scope && operationName) {
        return `Coda completata: ${scope} / ${operationName}`;
    }
    if (event === "file_write" && filePath) {
        return "Scrittura file completata";
    }
    if (event === "file_delete" && filePath) {
        return "Eliminazione file completata";
    }
    if (event === "backend_listening" && data.host && data.port) {
        return `Backend avviato su ${data.host}:${data.port}`;
    }
    if (event === "backend_stopped") {
        return "Backend fermato";
    }

    return message;
}

function interpretDetails(message: string, details: unknown) {
    const fields: ViewerField[] = [];
    const data =
        details && typeof details === "object"
            ? (details as Record<string, unknown>)
            : null;

    if (!data) {
        return {
            summary: message,
            fields,
            changes: [] as ViewerChange[],
        };
    }

    pushField(fields, "Request ID", data.requestId, "accent");
    pushField(fields, "Evento", data.event, "accent");
    pushField(fields, "Modulo", data.module, "accent");
    pushField(fields, "Categoria", data.category);
    pushField(fields, "Utente", data.user || data.actor);
    pushField(fields, "Client", data.client);
    pushField(fields, "Metodo", data.method, "accent");
    pushField(fields, "URL", data.url, "accent");
    pushField(fields, "Stato HTTP", data.statusCode);
    pushField(fields, "Durata ms", data.durationMs);
    pushField(fields, "IP remoto", data.remoteAddress);
    pushField(fields, "Operazione", data.operationName);
    pushField(fields, "Scope", data.scope);
    pushField(fields, "File", data.filePath);
    pushField(fields, "Host", data.host);
    pushField(fields, "Porta", data.port);
    pushField(fields, "Directory calendar", data.calendarDir);
    pushField(fields, "Directory general", data.generalDir);
    pushField(fields, "Directory log", data.logDir);
    pushField(fields, "Richieste", data.requests);
    pushField(fields, "Saldi", data.balances);
    pushField(fields, "Festivita", data.holidays);
    pushField(fields, "Chiusure", data.closures);
    pushField(fields, "Dettaglio errore", data.detail, "error");
    pushField(fields, "Ripristinato", data.restored, "warn");
    pushField(fields, "Esito", data.outcome, "warn");
    pushField(fields, "Righe", data.recordCount);
    const changes = normalizeViewerChanges(data.changes);
    const balanceChange =
        data.balanceChange && typeof data.balanceChange === "object"
            ? (data.balanceChange as Record<string, unknown>)
            : null;
    if (balanceChange) {
        const employee = toDisplayValue(balanceChange.employee).trim() || "dipendente";
        changes.push({
            label: `Saldo ore ${employee}`,
            before: toDisplayValue(balanceChange.beforeHours).trim() || "-",
            after: toDisplayValue(balanceChange.afterHours).trim() || "-",
        });
        pushField(fields, "Delta ore", balanceChange.deltaHours, "warn");
    }

    let summary = buildStructuredOperationSummary(message, data);
    const changeSummary = toDisplayValue(data.changeSummary).trim();
    if (summary !== message) {
        if (changeSummary) {
            summary = `${summary}: ${changeSummary}`;
        }
        return {
            summary,
            fields,
            changes,
        };
    }
    if (message === "HTTP request started" && data.method && data.url) {
        summary = `Richiesta in ingresso ${data.method} ${data.url}`;
    } else if (message === "HTTP request completed" && data.method && data.url) {
        summary = `Richiesta completata ${data.method} ${data.url}`;
    } else if (message === "HTTP request failed" && data.method && data.url) {
        summary = `Richiesta fallita ${data.method} ${data.url}`;
    } else if (message === "FP payload read") {
        summary = "Lettura stato Ferie e Permessi";
    } else if (message === "Queue operation completed" && data.scope && data.operationName) {
        summary = `Operazione completata: ${data.scope} / ${data.operationName}`;
    } else if (message === "File write" && data.filePath) {
        summary = `Scrittura file completata`;
    } else if (message === "AyPi backend listening" && data.host && data.port) {
        summary = `Backend avviato su ${data.host}:${data.port}`;
    } else if (message === "AyPi backend stopped") {
        summary = "Backend fermato";
    } else if (message === "startBackend.started" && data.url) {
        summary = `Tray ha avviato il backend su ${data.url}`;
    }
    if (changeSummary) {
        summary = `${summary}: ${changeSummary}`;
    }

    return {
        summary,
        fields,
        changes,
    };
}

function normalizeTimelineItems(entries: ParsedLogEntry[]) {
    const groupsMap = new Map<string, ParsedLogEntry[]>();
    entries.forEach((entry) => {
        if (!entry.requestId) return;
        if (!groupsMap.has(entry.requestId)) groupsMap.set(entry.requestId, []);
        groupsMap.get(entry.requestId)?.push(entry);
    });
    return Array.from(groupsMap.entries())
        .map(([requestId, rows]) => {
            const sorted = [...rows].sort((a, b) =>
                String(a.timestamp).localeCompare(String(b.timestamp)),
            );
            const first = sorted[0];
            const last = sorted[sorted.length - 1];
            const users = Array.from(
                new Set(sorted.map((item) => item.user).filter(Boolean)),
            );
            const modules = Array.from(
                new Set(sorted.map((item) => item.module).filter(Boolean)),
            );
            return {
                requestId,
                startedAt: first?.timestamp || "",
                finishedAt: last?.timestamp || "",
                count: sorted.length,
                user: users.join(", "),
                modules,
                entries: sorted.map((entry) => ({
                    timestamp: entry.timestamp,
                    level: entry.level,
                    source: entry.source,
                    module: entry.module,
                    category: getCategoryMeta(entry.category),
                    message: entry.message,
                    interpreted: interpretDetails(entry.message, entry.details),
                    remoteAddress: entry.remoteAddress,
                    fileName: entry.fileName,
                })),
            };
        })
        .sort((a, b) => String(b.finishedAt).localeCompare(String(a.finishedAt)));
}

export function loadLogViewerData(
    logDir: string,
    trayDebugLogPath: string,
    filters: LogViewerFilters = {},
    cursor?: LogViewerCursor | null,
) {
    const normalizedFilters = normalizeFilters(filters);
    const allDescriptors = buildLogFileDescriptors(logDir, trayDebugLogPath);
    const descriptors = allDescriptors.filter(
        (descriptor) => {
            if (
                normalizedFilters.file &&
                descriptor.fileName !== normalizedFilters.file
            ) {
                return false;
            }
            if (
                normalizedFilters.source &&
                descriptor.source !== normalizedFilters.source
            ) {
                return false;
            }
            return true;
        },
    );
    const effectiveCursor: LogViewerCursor = cursor
        ? {
              fileIndex: Math.max(0, Number(cursor.fileIndex) || 0),
              offsets: cursor.offsets || {},
          }
        : {
              fileIndex: 0,
              offsets: {},
          };
    const entries: ParsedLogEntry[] = [];
    let fileIndex = effectiveCursor.fileIndex;
    const offsets = { ...effectiveCursor.offsets };

    while (fileIndex < descriptors.length && entries.length < normalizedFilters.limit) {
        const descriptor = descriptors[fileIndex];
        const batch = readLogEntriesBatchFromFile(
            descriptor,
            normalizedFilters,
            offsets[descriptor.filePath],
            normalizedFilters.limit - entries.length,
        );
        entries.push(...batch.entries);
        offsets[descriptor.filePath] = batch.nextOffset;
        if (batch.done) {
            fileIndex += 1;
            continue;
        }
        break;
    }

    const todayFile = getTodayLogFileName();
    const availableFiles = allDescriptors
        .map((descriptor) => descriptor.fileName)
        .filter((value, index, items) => items.indexOf(value) === index);
    const defaultFile = availableFiles.includes(todayFile)
        ? todayFile
        : availableFiles.find((file) => file !== path.basename(trayDebugLogPath)) || "";
    const stats = {
        total: entries.length,
        info: entries.filter((entry) => entry.level === "INFO").length,
        warn: entries.filter((entry) => entry.level === "WARN").length,
        error: entries.filter((entry) => entry.level === "ERROR").length,
    };
    const nextCursor =
        fileIndex < descriptors.length
            ? {
                  fileIndex,
                  offsets,
              }
            : null;

    const normalizedEntries = entries.map((entry) => ({
        timestamp: entry.timestamp,
        level: entry.level,
        message: entry.message,
        detailsText: entry.detailsText,
        details:
            entry.details && typeof entry.details === "object"
                ? JSON.stringify(entry.details, null, 2)
                : "",
        interpreted: interpretDetails(entry.message, entry.details),
        fileName: entry.fileName,
        source: entry.source,
        remoteAddress: entry.remoteAddress,
        module: entry.module,
        requestId: entry.requestId,
        user: entry.user,
        category: getCategoryMeta(entry.category),
    }));

    return {
        files: availableFiles,
        todayFile,
        defaultFile,
        stats,
        entries: normalizedEntries,
        modules: [
            "attrezzaggio",
            "calendar",
            "core",
            "purchasing",
            "shared",
            "ticket",
            "transfer",
            "tray",
        ],
        remoteAddresses: [],
        users: [],
        groups: normalizeTimelineItems(entries),
        hasMore: !!nextCursor,
        nextCursor,
        logDir,
        trayDebugLogPath,
    };
}

export function buildLogViewerHtml() {
    return `<!doctype html>
<html lang="it">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>AyPi Backend Logger</title>
  <style>
    :root {
      --bg: #eef2f7;
      --panel: #ffffff;
      --border: #d7deea;
      --text: #1f2937;
      --muted: #5b6678;
      --accent: #2563eb;
      --accent-soft: #dbeafe;
      --warn: #b45309;
      --warn-soft: #fef3c7;
      --error: #b91c1c;
      --error-soft: #fee2e2;
      --shadow: 0 14px 32px rgba(15, 23, 42, 0.08);
      --font: "Segoe UI", Tahoma, sans-serif;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: var(--font);
      background:
        radial-gradient(circle at top left, rgba(37, 99, 235, 0.08), transparent 24%),
        linear-gradient(180deg, #f6f9fc 0%, var(--bg) 100%);
      color: var(--text);
    }
    .app-shell {
      max-width: 1680px;
      margin: 0 auto;
      padding: 28px;
    }
    .hero {
      display: grid;
      grid-template-columns: 1.5fr 1fr;
      gap: 18px;
      align-items: stretch;
      margin-bottom: 20px;
    }
    .hero-card, .stats-card, .panel {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 18px;
      box-shadow: var(--shadow);
    }
    .hero-card {
      padding: 24px 26px;
    }
    .hero-kicker {
      font-size: 12px;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: var(--accent);
      font-weight: 700;
      margin-bottom: 10px;
    }
    h1 {
      margin: 0 0 10px;
      font-size: 30px;
      line-height: 1.1;
    }
    .hero-copy {
      color: var(--muted);
      max-width: 70ch;
      line-height: 1.55;
      margin: 0 0 14px;
    }
    .path-list {
      display: grid;
      gap: 8px;
      font-size: 13px;
      color: var(--muted);
    }
    .path-list code {
      display: block;
      font-size: 12px;
      color: var(--text);
      background: #f8fafc;
      border: 1px solid #e5eaf3;
      border-radius: 10px;
      padding: 7px 9px;
      margin-top: 4px;
      overflow-wrap: anywhere;
    }
    .stats-card {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 1px;
      overflow: hidden;
    }
    .stat {
      padding: 22px;
      background: #fff;
    }
    .stat-label {
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--muted);
      margin-bottom: 8px;
      font-weight: 700;
    }
    .stat-value {
      font-size: 28px;
      font-weight: 700;
    }
    .controls {
      display: grid;
      grid-template-columns: 1.1fr 0.65fr 0.75fr 0.8fr 0.9fr 0.95fr 0.95fr 1fr;
      gap: 14px;
      align-items: end;
      padding: 18px;
      margin-bottom: 18px;
    }
    .field {
      display: grid;
      gap: 7px;
    }
    .field label {
      font-size: 12px;
      font-weight: 700;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    .field input, .field select {
      height: 42px;
      border: 1px solid #c8d2e3;
      background: #fff;
      border-radius: 10px;
      padding: 0 12px;
      font-size: 14px;
      color: var(--text);
      outline: none;
    }
    .field input:focus, .field select:focus {
      border-color: #7aa4ff;
      box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.12);
    }
    .btn {
      height: 42px;
      min-width: 120px;
      border-radius: 10px;
      border: 1px solid #bdd0f8;
      background: linear-gradient(180deg, #ffffff 0%, #edf4ff 100%);
      color: #1d4ed8;
      font-weight: 700;
      cursor: pointer;
      padding: 0 16px;
    }
    .btn.primary {
      background: linear-gradient(180deg, #3b82f6 0%, #1d4ed8 100%);
      border-color: #1d4ed8;
      color: #fff;
    }
    .view-switch {
      display: inline-flex;
      gap: 8px;
      align-items: center;
    }
    .view-pill {
      height: 42px;
      min-width: 110px;
      border-radius: 999px;
      border: 1px solid #c8d2e3;
      background: #fff;
      color: var(--muted);
      font-weight: 700;
      cursor: pointer;
      padding: 0 16px;
    }
    .view-pill.active {
      background: linear-gradient(180deg, #3b82f6 0%, #1d4ed8 100%);
      border-color: #1d4ed8;
      color: #fff;
    }
    .toolbar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 0 2px 12px;
      color: var(--muted);
      font-size: 13px;
    }
    .table-panel {
      overflow: hidden;
    }
    .timeline-panel {
      padding: 18px;
      display: grid;
      gap: 14px;
    }
    .timeline-card {
      border: 1px solid #e0e7f2;
      border-radius: 16px;
      padding: 16px;
      background: linear-gradient(180deg, #ffffff 0%, #f9fbff 100%);
    }
    .timeline-head {
      display: flex;
      justify-content: space-between;
      gap: 18px;
      align-items: start;
      margin-bottom: 12px;
    }
    .timeline-title {
      font-size: 17px;
      font-weight: 800;
      margin: 0 0 6px;
    }
    .timeline-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .meta-chip {
      border: 1px solid #dde6f2;
      background: #fff;
      border-radius: 999px;
      padding: 5px 10px;
      font-size: 12px;
      color: var(--muted);
      font-weight: 700;
    }
    .timeline-list {
      display: grid;
      gap: 10px;
      border-left: 2px solid #dbe4f2;
      padding-left: 16px;
      margin-left: 8px;
    }
    .timeline-entry {
      position: relative;
      border: 1px solid #e7edf7;
      border-radius: 12px;
      background: #fff;
      padding: 12px 12px 12px 14px;
    }
    .timeline-entry::before {
      content: "";
      position: absolute;
      left: -24px;
      top: 16px;
      width: 10px;
      height: 10px;
      border-radius: 999px;
      background: #94a3b8;
      border: 2px solid #fff;
      box-shadow: 0 0 0 2px #dbe4f2;
    }
    .timeline-row {
      display: flex;
      gap: 10px;
      align-items: center;
      flex-wrap: wrap;
      margin-bottom: 8px;
    }
    .category-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      min-height: 28px;
      padding: 4px 9px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.04em;
      border: 1px solid #dbe4f2;
      background: #f8fafc;
      color: #334155;
    }
    .category-badge.is-accent {
      background: #eff6ff;
      border-color: #bfdbfe;
      color: #1d4ed8;
    }
    .category-badge.is-warn {
      background: #fff7ed;
      border-color: #fed7aa;
      color: #b45309;
    }
    .category-badge.is-error {
      background: #fef2f2;
      border-color: #fecaca;
      color: #b91c1c;
    }
    .hidden {
      display: none !important;
    }
    .table-wrap {
      overflow: auto;
      max-height: calc(100vh - 330px);
    }
    table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      min-width: 1100px;
      background: #fff;
    }
    thead th {
      position: sticky;
      top: 0;
      z-index: 1;
      background: #f7f9fc;
      color: #445064;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      border-bottom: 1px solid var(--border);
      padding: 12px;
      text-align: left;
    }
    tbody td {
      padding: 11px 12px;
      border-bottom: 1px solid #edf1f7;
      vertical-align: top;
      font-size: 13px;
      line-height: 1.45;
    }
    tbody tr:hover {
      background: #f8fbff;
    }
    .col-time { width: 180px; }
    .col-level { width: 96px; }
    .col-source { width: 88px; }
    .col-module { width: 120px; }
    .col-file { width: 150px; }
    .col-details { width: 460px; }
    .level-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 72px;
      padding: 4px 8px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.08em;
    }
    .level-INFO { background: var(--accent-soft); color: var(--accent); }
    .level-WARN { background: var(--warn-soft); color: var(--warn); }
    .level-ERROR { background: var(--error-soft); color: var(--error); }
    .muted { color: var(--muted); }
    .message-main {
      font-weight: 700;
      margin-bottom: 6px;
    }
    .field-grid {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .field-chip {
      display: inline-flex;
      flex-direction: column;
      gap: 3px;
      padding: 7px 9px;
      border-radius: 10px;
      border: 1px solid #e4eaf4;
      background: #f8fafc;
      min-width: 110px;
      max-width: 100%;
    }
    .field-chip.is-accent {
      background: #eff6ff;
      border-color: #bfdbfe;
    }
    .field-chip.is-warn {
      background: #fff7ed;
      border-color: #fed7aa;
    }
    .field-chip.is-error {
      background: #fef2f2;
      border-color: #fecaca;
    }
    .field-label {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--muted);
      font-weight: 700;
    }
    .field-value {
      font-size: 12px;
      color: var(--text);
      word-break: break-word;
    }
    .mono {
      font-family: Consolas, "Courier New", monospace;
      white-space: pre-wrap;
      word-break: break-word;
      background: #f8fafc;
      border: 1px solid #e8edf5;
      border-radius: 10px;
      padding: 10px;
      margin-top: 8px;
      font-size: 12px;
    }
    .empty {
      padding: 40px;
      text-align: center;
      color: var(--muted);
    }
  </style>
</head>
<body>
  <div class="app-shell">
    <section class="hero">
      <div class="hero-card">
        <div class="hero-kicker">AyPi Backend</div>
        <h1>Logger interattivo</h1>
        <p class="hero-copy">
          Vista leggibile dei log server con filtri, contatori e dettaglio strutturato. I dati arrivano direttamente dai file log del backend e dal log tecnico della tray app.
        </p>
        <div class="path-list">
          <div>
            Cartella log backend
            <code id="backendLogPath">-</code>
          </div>
          <div>
            Log tray
            <code id="trayLogPath">-</code>
          </div>
        </div>
      </div>
      <div class="stats-card">
        <div class="stat">
          <div class="stat-label">Totale filtrato</div>
          <div class="stat-value" id="statTotal">0</div>
        </div>
        <div class="stat">
          <div class="stat-label">Info</div>
          <div class="stat-value" id="statInfo">0</div>
        </div>
        <div class="stat">
          <div class="stat-label">Warn</div>
          <div class="stat-value" id="statWarn">0</div>
        </div>
        <div class="stat">
          <div class="stat-label">Error</div>
          <div class="stat-value" id="statError">0</div>
        </div>
      </div>
    </section>

    <section class="panel controls">
      <div class="field">
        <label for="search">Ricerca</label>
        <input id="search" type="text" placeholder="Messaggio, file, dettaglio..." />
      </div>
      <div class="field">
        <label for="level">Livello</label>
        <select id="level">
          <option value="">Tutti</option>
          <option value="INFO">Info</option>
          <option value="WARN">Warn</option>
          <option value="ERROR">Error</option>
        </select>
      </div>
      <div class="field">
        <label for="source">Sorgente</label>
        <select id="source">
          <option value="">Tutte</option>
          <option value="backend">Backend</option>
          <option value="tray">Tray</option>
        </select>
      </div>
      <div class="field">
        <label for="module">Modulo</label>
        <select id="module">
          <option value="">Tutti</option>
        </select>
      </div>
      <div class="field">
        <label for="remoteAddress">IP remoto</label>
        <input id="remoteAddress" type="text" placeholder="Es. 192.168.1.23" />
      </div>
      <div class="field">
        <label for="requestId">Request ID</label>
        <input id="requestId" type="text" placeholder="Es. req_..." />
      </div>
      <div class="field">
        <label for="user">Utente</label>
        <input id="user" type="text" placeholder="Es. guest, Admin..." />
      </div>
      <div class="field">
        <label for="file">File log</label>
        <select id="file">
          <option value="">Tutti</option>
        </select>
      </div>
    </section>

    <div class="toolbar">
      <div id="resultSummary">0 righe mostrate</div>
      <div class="view-switch">
        <button class="view-pill active" id="tableViewBtn">Tabella</button>
        <button class="view-pill" id="timelineViewBtn">Timeline</button>
        <button class="btn" id="resetBtn">Reset</button>
        <button class="btn primary" id="refreshBtn">Aggiorna</button>
      </div>
    </div>

    <section class="panel table-panel" id="tablePanel">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th class="col-time">Timestamp</th>
              <th class="col-level">Livello</th>
              <th class="col-source">Sorgente</th>
              <th class="col-module">Modulo</th>
              <th class="col-file">File</th>
              <th>Messaggio</th>
              <th class="col-details">Dettaglio interpretato</th>
            </tr>
          </thead>
          <tbody id="logTableBody">
            <tr><td colspan="6" class="empty">Caricamento log...</td></tr>
          </tbody>
        </table>
      </div>
    </section>
    <section class="panel timeline-panel hidden" id="timelinePanel">
      <div id="timelineBody" class="empty">Caricamento timeline...</div>
    </section>
  </div>
  <script>
    const { ipcRenderer } = require("electron");
    const searchEl = document.getElementById("search");
    const levelEl = document.getElementById("level");
    const sourceEl = document.getElementById("source");
    const moduleEl = document.getElementById("module");
    const remoteAddressEl = document.getElementById("remoteAddress");
    const requestIdEl = document.getElementById("requestId");
    const userEl = document.getElementById("user");
    const fileEl = document.getElementById("file");
    const bodyEl = document.getElementById("logTableBody");
    const timelineBodyEl = document.getElementById("timelineBody");
    const tablePanelEl = document.getElementById("tablePanel");
    const timelinePanelEl = document.getElementById("timelinePanel");
    const tableWrapEl = tablePanelEl.querySelector(".table-wrap");
    const summaryEl = document.getElementById("resultSummary");
    const backendLogPathEl = document.getElementById("backendLogPath");
    const trayLogPathEl = document.getElementById("trayLogPath");
    const statTotalEl = document.getElementById("statTotal");
    const statInfoEl = document.getElementById("statInfo");
    const statWarnEl = document.getElementById("statWarn");
    const statErrorEl = document.getElementById("statError");
    const refreshBtn = document.getElementById("refreshBtn");
    const resetBtn = document.getElementById("resetBtn");
    const tableViewBtn = document.getElementById("tableViewBtn");
    const timelineViewBtn = document.getElementById("timelineViewBtn");
    let currentView = "timeline";
    let defaultsApplied = false;
    let observer = null;
    const state = {
      entries: [],
      groups: [],
      cursor: null,
      hasMore: false,
      loading: false,
      firstLoadComplete: false,
    };

    function setView(nextView) {
      currentView = nextView === "timeline" ? "timeline" : "table";
      tablePanelEl.classList.toggle("hidden", currentView !== "table");
      timelinePanelEl.classList.toggle("hidden", currentView !== "timeline");
      tableViewBtn.classList.toggle("active", currentView === "table");
      timelineViewBtn.classList.toggle("active", currentView === "timeline");
      attachInfiniteObserver();
    }

    function escapeHtml(value) {
      return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }

    function currentFilters() {
      return {
        search: searchEl.value || "",
        level: levelEl.value || "",
        source: sourceEl.value || "",
        module: moduleEl.value || "",
        remoteAddress: remoteAddressEl.value || "",
        requestId: requestIdEl.value || "",
        user: userEl.value || "",
        file: fileEl.value || "",
        limit: 250,
      };
    }

    function renderChangesBlock(changes) {
      if (!Array.isArray(changes) || !changes.length) return "";
      return '<div class="field-grid" style="margin-top:10px;">' + changes.map((change) => \`
        <div class="field-chip is-warn" style="grid-column: span 2;">
          <div class="field-label">\${escapeHtml(change.label || "Modifica")}</div>
          <div class="field-value">\${escapeHtml(change.before || "-")} → \${escapeHtml(change.after || "-")}</div>
        </div>
      \`).join("") + "</div>";
    }

    function entryRowMarkup(entry) {
      const interpreted = entry.interpreted || { summary: entry.message || "", fields: [] };
      const fieldsBlock = Array.isArray(interpreted.fields) && interpreted.fields.length
        ? '<div class="field-grid">' + interpreted.fields.map((field) => \`
            <div class="field-chip \${field.tone ? "is-" + escapeHtml(field.tone) : ""}">
              <div class="field-label">\${escapeHtml(field.label)}</div>
              <div class="field-value">\${escapeHtml(field.value)}</div>
            </div>
          \`).join("") + "</div>"
        : '<span class="muted">Nessun campo strutturato</span>';
      const changesBlock = renderChangesBlock(interpreted.changes);
      const rawBlock = entry.detailsText
        ? \`<details style="margin-top:8px;"><summary class="muted" style="cursor:pointer;">Mostra JSON raw</summary><div class="mono">\${escapeHtml(entry.details || entry.detailsText)}</div></details>\`
        : "";
      return \`
        <tr>
          <td class="mono">\${escapeHtml(entry.timestamp)}</td>
          <td><span class="level-badge level-\${escapeHtml(entry.level)}">\${escapeHtml(entry.level)}</span></td>
          <td>\${escapeHtml(entry.source)}</td>
          <td>\${escapeHtml(entry.module || "-")}</td>
          <td>\${escapeHtml(entry.fileName)}</td>
          <td>
            <div class="timeline-row" style="margin-bottom:6px;">
              <span class="category-badge is-\${escapeHtml(entry.category?.tone || "neutral")}">\${escapeHtml(entry.category?.icon || "•")} \${escapeHtml(entry.category?.label || entry.category?.key || "")}</span>
              \${entry.requestId ? '<span class="meta-chip">Req: ' + escapeHtml(entry.requestId) + "</span>" : ""}
              \${entry.user ? '<span class="meta-chip">Utente: ' + escapeHtml(entry.user) + "</span>" : ""}
            </div>
            <div class="message-main">\${escapeHtml(interpreted.summary || entry.message)}</div>
            <div class="muted">\${escapeHtml(entry.message)}\${entry.remoteAddress ? " • IP " + escapeHtml(entry.remoteAddress) : ""}</div>
          </td>
          <td>\${fieldsBlock}\${changesBlock}\${rawBlock}</td>
        </tr>
      \`;
    }

    function groupCardMarkup(group) {
      const meta = [
        group.user ? '<span class="meta-chip">Utente: ' + escapeHtml(group.user) + "</span>" : "",
        group.startedAt ? '<span class="meta-chip">Inizio: ' + escapeHtml(group.startedAt) + "</span>" : "",
        group.finishedAt ? '<span class="meta-chip">Fine: ' + escapeHtml(group.finishedAt) + "</span>" : "",
        group.count ? '<span class="meta-chip">Eventi: ' + escapeHtml(group.count) + "</span>" : "",
        Array.isArray(group.modules) && group.modules.length ? '<span class="meta-chip">Moduli: ' + escapeHtml(group.modules.join(", ")) + "</span>" : "",
      ].filter(Boolean).join("");
      const rows = (group.entries || []).map((entry) => {
        const fields = Array.isArray(entry.interpreted?.fields) && entry.interpreted.fields.length
          ? '<div class="field-grid">' + entry.interpreted.fields.slice(0, 8).map((field) => \`
              <div class="field-chip \${field.tone ? "is-" + escapeHtml(field.tone) : ""}">
                <div class="field-label">\${escapeHtml(field.label)}</div>
                <div class="field-value">\${escapeHtml(field.value)}</div>
              </div>\`).join("") + "</div>"
          : "";
        const changesBlock = renderChangesBlock(entry.interpreted?.changes);
        return \`
          <div class="timeline-entry">
            <div class="timeline-row">
              <span class="category-badge is-\${escapeHtml(entry.category?.tone || "neutral")}">\${escapeHtml(entry.category?.icon || "•")} \${escapeHtml(entry.category?.label || entry.category?.key || "")}</span>
              <span class="level-badge level-\${escapeHtml(entry.level)}">\${escapeHtml(entry.level)}</span>
              <span class="meta-chip">\${escapeHtml(entry.timestamp)}</span>
              <span class="meta-chip">\${escapeHtml(entry.module || "-")}</span>
              <span class="meta-chip">\${escapeHtml(entry.source || "-")}</span>
              \${entry.remoteAddress ? '<span class="meta-chip">IP ' + escapeHtml(entry.remoteAddress) + "</span>" : ""}
            </div>
            <div class="message-main">\${escapeHtml(entry.interpreted?.summary || entry.message || "")}</div>
            <div class="muted" style="margin-bottom:8px;">\${escapeHtml(entry.message || "")} • \${escapeHtml(entry.fileName || "")}</div>
            \${fields}
            \${changesBlock}
          </div>\`;
      }).join("");
      return \`
        <article class="timeline-card">
          <div class="timeline-head">
            <div>
              <div class="timeline-title">Request ID: \${escapeHtml(group.requestId)}</div>
              <div class="timeline-meta">\${meta}</div>
            </div>
          </div>
          <div class="timeline-list">\${rows}</div>
        </article>\`;
    }

    function renderLoadMarker() {
      const status = state.hasMore
        ? "Scorri verso il fondo per caricare altre righe..."
        : state.firstLoadComplete
          ? "Fine log raggiunta."
          : "Caricamento...";
      return '<div id="loadMoreSentinel" class="empty" style="padding:18px;">' + escapeHtml(status) + "</div>";
    }

    function renderTable() {
      if (!state.entries.length) {
        bodyEl.innerHTML = '<tr><td colspan="7" class="empty">Nessuna riga compatibile con i filtri.</td></tr>';
        return;
      }
      bodyEl.innerHTML = state.entries.map(entryRowMarkup).join("") + '<tr><td colspan="7" style="padding:0;border-bottom:none;">' + renderLoadMarker() + "</td></tr>";
    }

    function renderTimeline() {
      if (!Array.isArray(state.groups) || !state.groups.length) {
        timelineBodyEl.innerHTML = '<div class="empty">Nessuna richiesta raggruppabile con i filtri correnti.</div>';
        return;
      }
      timelineBodyEl.innerHTML = state.groups.map(groupCardMarkup).join("") + renderLoadMarker();
    }

    function renderSummary() {
      summaryEl.textContent = state.hasMore
        ? \`\${state.entries.length} righe caricate, altre disponibili\`
        : \`\${state.entries.length} righe caricate\`;
    }

    function renderAll() {
      renderSummary();
      renderTable();
      renderTimeline();
      attachInfiniteObserver();
    }

    function mergeGroups(nextGroups) {
      const map = new Map((state.groups || []).map((group) => [group.requestId, group]));
      (nextGroups || []).forEach((group) => {
        const current = map.get(group.requestId);
        if (!current) {
          map.set(group.requestId, group);
          return;
        }
        const mergedEntries = [...(current.entries || []), ...(group.entries || [])]
          .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
        const modules = Array.from(new Set([...(current.modules || []), ...(group.modules || [])]));
        map.set(group.requestId, {
          ...current,
          ...group,
          startedAt: current.startedAt && group.startedAt ? [current.startedAt, group.startedAt].sort()[0] : (current.startedAt || group.startedAt || ""),
          finishedAt: current.finishedAt && group.finishedAt ? [current.finishedAt, group.finishedAt].sort().reverse()[0] : (current.finishedAt || group.finishedAt || ""),
          count: mergedEntries.length,
          modules,
          entries: mergedEntries,
        });
      });
      state.groups = Array.from(map.values()).sort((a, b) => String(b.finishedAt).localeCompare(String(a.finishedAt)));
    }

    function applyPayload(payload, { append = false } = {}) {
      backendLogPathEl.textContent = payload.logDir || "-";
      trayLogPathEl.textContent = payload.trayDebugLogPath || "-";

      if (!append) {
        const currentFile = fileEl.value;
        const currentModule = moduleEl.value;
        fileEl.innerHTML = '<option value="">Tutti</option>' + (payload.files || [])
          .map((file) => \`<option value="\${escapeHtml(file)}">\${escapeHtml(file)}</option>\`)
          .join("");
        if ((payload.files || []).includes(currentFile)) {
          fileEl.value = currentFile;
        }
        moduleEl.innerHTML = '<option value="">Tutti</option>' + (payload.modules || [])
          .map((item) => \`<option value="\${escapeHtml(item)}">\${escapeHtml(item)}</option>\`)
          .join("");
        if ((payload.modules || []).includes(currentModule)) {
          moduleEl.value = currentModule;
        }
        if (!defaultsApplied && !fileEl.value && payload.defaultFile && (payload.files || []).includes(payload.defaultFile)) {
          fileEl.value = payload.defaultFile;
          defaultsApplied = true;
          return false;
        }
        state.entries = payload.entries || [];
        state.groups = payload.groups || [];
      } else {
        state.entries = [...state.entries, ...(payload.entries || [])];
        mergeGroups(payload.groups || []);
      }

      state.cursor = payload.nextCursor || null;
      state.hasMore = !!payload.hasMore;
      state.firstLoadComplete = true;
      statTotalEl.textContent = String(state.entries.length);
      statInfoEl.textContent = String(state.entries.filter((entry) => entry.level === "INFO").length);
      statWarnEl.textContent = String(state.entries.filter((entry) => entry.level === "WARN").length);
      statErrorEl.textContent = String(state.entries.filter((entry) => entry.level === "ERROR").length);
      renderAll();
      return true;
    }

    async function loadLogs({ append = false } = {}) {
      if (state.loading) return;
      state.loading = true;
      try {
        const payload = await ipcRenderer.invoke(
          "backend-log-viewer:list",
          currentFilters(),
          append ? state.cursor : null,
        );
        const applied = applyPayload(payload, { append });
        if (applied === false) {
          state.loading = false;
          return loadLogs({ append: false });
        }
      } finally {
        state.loading = false;
      }
    }

    async function loadMoreLogs() {
      if (!state.hasMore || !state.cursor || state.loading) return;
      return loadLogs({ append: true });
    }

    function attachInfiniteObserver() {
      if (observer) {
        observer.disconnect();
        observer = null;
      }
      const sentinel = document.getElementById("loadMoreSentinel");
      if (!sentinel || !state.hasMore) return;
      const root = currentView === "table" ? tableWrapEl : null;
      observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          loadMoreLogs().catch(console.error);
        }
      }, {
        root,
        rootMargin: "0px 0px 240px 0px",
        threshold: 0,
      });
      observer.observe(sentinel);
    }

    let timer = null;
    function scheduleRefresh() {
      if (timer) clearInterval(timer);
      timer = setInterval(() => {
        const activeScroller = currentView === "table" ? tableWrapEl : document.documentElement;
        const scrollTop = currentView === "table" ? activeScroller.scrollTop : window.scrollY;
        if (scrollTop > 120 || state.loading) return;
        loadLogs({ append: false }).catch((error) => {
          console.error("Log refresh failed", error);
        });
      }, 15000);
    }

    [searchEl, levelEl, sourceEl, moduleEl, remoteAddressEl, requestIdEl, userEl, fileEl].forEach((node) => {
      node.addEventListener("input", () => loadLogs({ append: false }).catch(console.error));
      node.addEventListener("change", () => loadLogs({ append: false }).catch(console.error));
    });
    refreshBtn.addEventListener("click", () => loadLogs({ append: false }).catch(console.error));
    tableViewBtn.addEventListener("click", () => setView("table"));
    timelineViewBtn.addEventListener("click", () => setView("timeline"));
    resetBtn.addEventListener("click", () => {
      searchEl.value = "";
      levelEl.value = "";
      sourceEl.value = "";
      moduleEl.value = "";
      remoteAddressEl.value = "";
      requestIdEl.value = "";
      userEl.value = "";
      fileEl.value = "";
      defaultsApplied = false;
      state.entries = [];
      state.groups = [];
      state.cursor = null;
      state.hasMore = false;
      state.firstLoadComplete = false;
      loadLogs({ append: false }).catch(console.error);
    });

    setView("timeline");
    loadLogs({ append: false }).catch((error) => {
      bodyEl.innerHTML = '<tr><td colspan="7" class="empty">Errore caricamento log.</td></tr>';
      timelineBodyEl.innerHTML = '<div class="empty">Errore caricamento timeline.</div>';
      console.error(error);
    });
    scheduleRefresh();
  </script>
</body>
</html>`;
}
