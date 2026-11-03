import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { validateDraft, type ProgramDraft } from "./program-draft";
import {
    decodeNative,
    encodeNative,
    extractClonePrograms,
    nativeBytes,
    nativeFile,
    sha256,
    type NativeFile,
} from "./program-native";

export type LibraryEntry = {
    id: string;
    revision: number;
    importedAtMs: number;
    draft?: ProgramDraft;
    original?: NativeFile;
    sourceSha256?: string;
    deletedAtMs?: number;
};
type CloneSource = {
    filename: string;
    capturedAtMs: number;
    base64: string;
    sha256: string;
};
export type ProgramLibrary = {
    format: "aypi-forno-library";
    version: 1;
    revision: number;
    entries: LibraryEntry[];
    sources: CloneSource[];
};
export type LibraryView = {
    revision: number;
    entries: (LibraryEntry & { name: string; originalStatus: string })[];
    sourceCount: number;
    sourceSnapshots: { filename: string; capturedAtMs: number }[];
    deviceWritesEnabled: false;
};
const fail = (message: string): never => {
    throw new Error(message);
};
const canonical = (value: any): string =>
    Array.isArray(value)
        ? "[" + value.map(canonical).join(",") + "]"
        : value && typeof value === "object"
          ? "{" +
            Object.keys(value)
                .sort()
                .map((k) => JSON.stringify(k) + ":" + canonical(value[k]))
                .join(",") +
            "}"
          : JSON.stringify(value);
const safeKeys = (value: any, keys: string[]) => {
    if (
        !value ||
        typeof value !== "object" ||
        Object.keys(value).some((k) => !keys.includes(k))
    )
        fail("Campi archivio non riconosciuti.");
};
const empty = (): ProgramLibrary => ({
    format: "aypi-forno-library",
    version: 1,
    revision: 0,
    entries: [],
    sources: [],
});
function validateEntries(entries: LibraryEntry[], sources: CloneSource[]) {
    if (
        !Array.isArray(entries) ||
        entries.length > 1000 ||
        !Array.isArray(sources) ||
        sources.length > 20
    )
        fail("Dimensione archivio non valida.");
    const sourcePrograms = new Map<string, Set<string>>();
    for (const source of sources) {
        safeKeys(source, ["filename", "capturedAtMs", "base64", "sha256"]);
        if (
            typeof source.filename !== "string" ||
            !/^[^/\\\x00-\x1f]{1,100}\.uic$/i.test(source.filename) ||
            !Number.isSafeInteger(source.capturedAtMs) ||
            typeof source.base64 !== "string" ||
            source.base64.length > 22000000
        )
            fail("Sorgente clone non valida.");
        const bytes = Buffer.from(source.base64, "base64");
        if (
            bytes.toString("base64") !== source.base64 ||
            sha256(bytes) !== source.sha256
        )
            fail("Integrità del clone originale non valida.");
        sourcePrograms.set(
            source.sha256,
            new Set(
                extractClonePrograms(bytes).map(
                    (f) => f.filename + ":" + f.sha256,
                ),
            ),
        );
    }
    for (const entry of entries) {
        safeKeys(entry, [
            "id",
            "revision",
            "importedAtMs",
            "draft",
            "original",
            "sourceSha256",
            "deletedAtMs",
        ]);
        if (
            !/^[a-f0-9-]{36}$/i.test(entry.id) ||
            !Number.isSafeInteger(entry.revision) ||
            entry.revision < 1 ||
            !Number.isSafeInteger(entry.importedAtMs) ||
            (!entry.draft && !entry.original)
        )
            fail("Voce archivio non valida.");
        if (
            entry.deletedAtMs !== undefined &&
            !Number.isSafeInteger(entry.deletedAtMs)
        )
            fail("Cancellazione locale non valida.");
        if (entry.draft) validateDraft(entry.draft);
        if (entry.original) {
            safeKeys(entry.original, ["filename", "base64", "sha256"]);
            extractGzipCheck(entry.original);
        }
        if (
            entry.sourceSha256 &&
            !sources.some((s) => s.sha256 === entry.sourceSha256)
        )
            fail("Clone sorgente mancante nell’archivio.");
        if (
            entry.sourceSha256 &&
            (!entry.original ||
                !sourcePrograms
                    .get(entry.sourceSha256)
                    ?.has(
                        entry.original.filename + ":" + entry.original.sha256,
                    ))
        )
            fail(
                "Il file originale non coincide con il programma nel clone sorgente.",
            );
    }
    if (
        new Set(entries.map((e) => e.id)).size !== entries.length ||
        new Set(sources.map((s) => s.sha256)).size !== sources.length
    )
        fail("Identificatori duplicati nell’archivio.");
}
function checkedRead(file: string): Buffer {
    if (fs.statSync(file).size > 32000000) fail("File archivio troppo grande.");
    return fs.readFileSync(file);
}
export function readLibrary(file: string): ProgramLibrary {
    if (!fs.existsSync(file)) return empty();
    const state = JSON.parse(
        checkedRead(file)
            .toString("utf8")
            .replace(/^\uFEFF/, ""),
    ) as ProgramLibrary;
    safeKeys(state, ["format", "version", "revision", "entries", "sources"]);
    if (
        state.format !== "aypi-forno-library" ||
        state.version !== 1 ||
        !Number.isSafeInteger(state.revision) ||
        state.revision < 0
    )
        fail("Versione archivio locale non gestita.");
    validateEntries(state.entries, state.sources);
    return state;
}
export function writeVerifiedFile(file: string, bytes: Buffer) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + "." + randomUUID() + ".tmp";
    try {
        const fd = fs.openSync(tmp, "wx");
        try {
            fs.writeFileSync(fd, bytes);
            fs.fsyncSync(fd);
        } finally {
            fs.closeSync(fd);
        }
        if (sha256(fs.readFileSync(tmp)) !== sha256(bytes))
            fail("Verifica del file temporaneo non riuscita.");
        fs.renameSync(tmp, file);
        if (sha256(fs.readFileSync(file)) !== sha256(bytes))
            fail("Rilettura del file salvato non riuscita.");
    } finally {
        if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    }
}
function saveLibrary(file: string, state: ProgramLibrary) {
    validateEntries(state.entries, state.sources);
    state.revision++;
    const bytes = Buffer.from(JSON.stringify(state, null, 2) + "\n");
    if (bytes.length > 32000000)
        fail("Archivio oltre il limite di 32 MB: nessuna modifica salvata.");
    writeVerifiedFile(file, bytes);
    return libraryView(state);
}
export function libraryView(state: ProgramLibrary): LibraryView {
    return {
        revision: state.revision,
        sourceCount: state.sources.length,
        sourceSnapshots: state.sources.map((s) => ({
            filename: s.filename,
            capturedAtMs: s.capturedAtMs,
        })),
        deviceWritesEnabled: false,
        entries: state.entries.map((e) => ({
            ...e,
            ...(e.draft ? { draft: validateDraft(e.draft) } : {}),
            name: e.draft?.name || e.original!.filename.replace(/\.uipz$/i, ""),
            originalStatus: e.original
                ? "Originale nativo conservato · SHA-256 verificato"
                : "Programma locale · ripristino su forno non collaudato",
        })),
    };
}
export function archiveDraft(
    file: string,
    draft: unknown,
    sourceId?: string,
): LibraryView {
    const validated = validateDraft(draft),
        state = readLibrary(file),
        source = sourceId
            ? state.entries.find((e) => e.id === sourceId)
            : undefined;
    if (sourceId && !source) fail("Programma originale locale non trovato.");
    state.entries.push({
        id: randomUUID(),
        revision: 1,
        importedAtMs: Date.now(),
        draft: validated,
        ...(source?.original
            ? {
                  original: source.original,
                  ...(source.sourceSha256
                      ? { sourceSha256: source.sourceSha256 }
                      : {}),
              }
            : {}),
    });
    return saveLibrary(file, state);
}
function fromNative(
    original: NativeFile,
    importedAtMs: number,
    sourceSha256?: string,
): LibraryEntry {
    const entry: LibraryEntry = {
        id: randomUUID(),
        revision: 1,
        importedAtMs,
        original,
        ...(sourceSha256 ? { sourceSha256 } : {}),
    };
    try {
        entry.draft = decodeNative(original);
        entry.draft.source = { name: entry.draft.name, readAtMs: importedAtMs };
    } catch {
        /* Conserva integralmente anche i programmi non editabili. */
    }
    return entry;
}
export function buildBackup(state: ProgramLibrary, ids?: string[]) {
    const entries = ids ? selectedEntries(state, ids) : state.entries;
    if (!entries.length)
        fail(
            "Nessun programma da salvare. Importare un clone iTools o file nativi; il solo elenco del forno non è un backup.",
        );
    const used = new Set(entries.map((e) => e.sourceSha256)),
        sources = state.sources.filter((s) => used.has(s.sha256));
    const payload = { entries, sources };
    validateEntries(entries, sources);
    return {
        format: "aypi-forno-backup",
        version: 1,
        createdAtMs: Date.now(),
        payload,
        sha256: sha256(canonical(payload)),
        hardwareRestoreVerified: false,
    };
}
function readBackup(value: any) {
    safeKeys(value, [
        "format",
        "version",
        "createdAtMs",
        "payload",
        "sha256",
        "hardwareRestoreVerified",
    ]);
    if (
        value.format !== "aypi-forno-backup" ||
        value.version !== 1 ||
        !Number.isSafeInteger(value.createdAtMs) ||
        value.hardwareRestoreVerified !== false
    )
        fail(
            "Backup non riconosciuto o dichiarazione di ripristino non valida.",
        );
    safeKeys(value.payload, ["entries", "sources"]);
    if (sha256(canonical(value.payload)) !== value.sha256)
        fail("Integrità SHA-256 del backup non valida.");
    validateEntries(value.payload.entries, value.payload.sources);
    return value.payload as { entries: LibraryEntry[]; sources: CloneSource[] };
}
export function importProgramFiles(file: string, paths: string[]): LibraryView {
    if (!Array.isArray(paths) || !paths.length || paths.length > 100)
        fail("Selezionare da 1 a 100 file.");
    const state = readLibrary(file);
    const stamp = Date.now();
    // Tutti i file sono controllati prima dell'unica scrittura dell'archivio locale.
    for (const sourcePath of paths) {
        const bytes = checkedRead(sourcePath),
            ext = path.extname(sourcePath).toLowerCase();
        if (ext === ".uic") {
            const native = extractClonePrograms(bytes),
                hash = sha256(bytes),
                capturedAtMs = Math.trunc(fs.statSync(sourcePath).mtimeMs);
            if (!state.sources.some((s) => s.sha256 === hash))
                state.sources.push({
                    filename: path.basename(sourcePath),
                    capturedAtMs,
                    base64: bytes.toString("base64"),
                    sha256: hash,
                });
            for (const program of native)
                if (
                    !state.entries.some(
                        (e) =>
                            e.original?.sha256 === program.sha256 &&
                            e.sourceSha256 === hash,
                    )
                )
                    state.entries.push(fromNative(program, capturedAtMs, hash));
        } else if (ext === ".uipz") {
            const native = nativeFile(path.basename(sourcePath), bytes); // Include controllo gzip/CRC anche per file non editabili.
            extractGzipCheck(native);
            state.entries.push(fromNative(native, stamp));
        } else {
            const value = JSON.parse(
                bytes.toString("utf8").replace(/^\uFEFF/, ""),
            );
            if (value.format === "aypi-forno-draft")
                state.entries.push({
                    id: randomUUID(),
                    revision: 1,
                    importedAtMs: stamp,
                    draft: validateDraft(value),
                });
            else {
                const backup = readBackup(value);
                for (const s of backup.sources)
                    if (
                        !state.sources.some(
                            (existing) => existing.sha256 === s.sha256,
                        )
                    )
                        state.sources.push(s);
                for (const e of backup.entries)
                    state.entries.push({
                        ...e,
                        id: randomUUID(),
                        revision: 1,
                        importedAtMs: stamp,
                    });
            }
        }
    }
    return saveLibrary(file, state);
}
function extractGzipCheck(native: NativeFile) {
    const { gunzipSync } = require("zlib");
    gunzipSync(nativeBytes(native), { maxOutputLength: 2000000 });
}
function selectedEntries(state: ProgramLibrary, ids: string[]) {
    if (!Array.isArray(ids) || !ids.length || new Set(ids).size !== ids.length)
        fail("Selezionare almeno un programma.");
    return ids.map(
        (id) =>
            state.entries.find((e) => e.id === id) ||
            fail("Programma locale non trovato."),
    );
}
export function setLocalDeletion(
    file: string,
    ids: string[],
    expectedRevision: number,
    deleted: boolean,
): LibraryView {
    const state = readLibrary(file);
    if (state.revision !== expectedRevision)
        fail(
            "Archivio locale cambiato: aggiornare prima di eliminare o recuperare programmi.",
        );
    for (const e of selectedEntries(state, ids)) {
        if (deleted) e.deletedAtMs = Date.now();
        else delete e.deletedAtMs;
        e.revision++;
    }
    return saveLibrary(file, state);
}
export function exportBackupFile(
    file: string,
    destination: string,
    ids?: string[],
) {
    if (path.extname(destination).toLowerCase() !== ".json")
        fail("Il backup deve usare l’estensione .json.");
    const backup = buildBackup(readLibrary(file), ids),
        bytes = Buffer.from(JSON.stringify(backup, null, 2) + "\n");
    if (bytes.length > 32000000)
        fail(
            "Backup oltre il limite di 32 MB. Esportare una selezione di programmi.",
        );
    if (
        path.resolve(file).toLowerCase() ===
        path.resolve(destination).toLowerCase()
    )
        fail(
            "Il backup deve essere salvato in un file distinto dall’archivio di lavoro.",
        );
    writeVerifiedFile(destination, bytes);
    readBackup(JSON.parse(fs.readFileSync(destination, "utf8")));
    return {
        path: destination,
        count: backup.payload.entries.length,
        originals: backup.payload.entries.filter((e) => e.original).length,
        capturedAtMs: backup.payload.sources.map((s) => s.capturedAtMs),
        hardwareRestoreVerified: false,
    };
}
/** Prepara file locali originali o generati. Nessuna dipendenza da rete, Modbus o comandi forno. */
export function prepareRestoreFiles(
    file: string,
    folder: string,
    ids: string[],
    originalsOnly = true,
) {
    const state = readLibrary(file),
        entries = selectedEntries(state, ids);
    const files = entries.map((e) => {
        if (originalsOnly) {
            if (!e.original)
                fail(
                    "Una selezione non ha un originale nativo. Scegliere l’esportazione della versione locale.",
                );
            return {
                entry: e,
                native: e.original,
                kind: "original-byte-identical",
            };
        }
        if (!e.draft)
            fail("Programma non editabile: esportare il suo originale nativo.");
        return {
            entry: e,
            native: encodeNative(e.draft),
            kind: "generated-not-hardware-tested",
        };
    });
    const directory = path.join(
        folder,
        "AyPi-forno-" +
            new Date().toISOString().replace(/[:.]/g, "-") +
            "-" +
            randomUUID().slice(0, 8),
    );
    fs.mkdirSync(directory, { recursive: true });
    const manifest = {
        format: "aypi-forno-restore-files",
        version: 1,
        hardwareRestoreVerified: false,
        deviceWritesEnabled: false,
        programs: [] as any[],
    };
    for (const [index, item] of files.entries()) {
        const subfolder = String(index + 1).padStart(3, "0");
        fs.mkdirSync(path.join(directory, subfolder));
        const target = path.join(directory, subfolder, item.native.filename);
        writeVerifiedFile(target, nativeBytes(item.native));
        manifest.programs.push({
            id: item.entry.id,
            filename: subfolder + "/" + item.native.filename,
            sha256: item.native.sha256,
            kind: item.kind,
        });
    }
    writeVerifiedFile(
        path.join(directory, "VERIFICA.json"),
        Buffer.from(JSON.stringify(manifest, null, 2) + "\n"),
    );
    writeVerifiedFile(
        path.join(directory, "LEGGIMI.txt"),
        Buffer.from(
            "File locali: nessun invio al forno eseguito.\r\nGli originali sono copie identiche ai byte del clone/file importato.\r\nLe versioni generate richiedono verifica in iTools e collaudo controllato prima dell'uso.\r\nIl ripristino hardware non è stato verificato. Non ripristinare l'intero clone per il caricamento selettivo: il clone può sostituire configurazione e archivio programmi.\r\n",
        ),
    );
    return {
        path: directory,
        count: files.length,
        hardwareRestoreVerified: false,
    };
}
