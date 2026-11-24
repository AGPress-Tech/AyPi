import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import { backendConfig } from "../../config";
import { exportSqliteSnapshot, openSqliteSnapshot } from "../db/sqlite";
import { exportMesSqliteSnapshot } from "../db/mes-sqlite";
import { getFornoConfig } from "../../modules/forno/config";
import { openDatabase } from "../../modules/forno/archive";
import { copyDirectory } from "./backups";

export const PRIMARY_IMAGE = "General/data/aypi.db",
    MES_IMAGE = "General/data/mes.db",
    FORNO_IMAGE = "General/data/forno.db";
export const MANIFEST = "aypi-backup-manifest.json";
export type BackupModule = {
    id: string;
    label: string;
    prefixes: string[];
    files?: { source: string; archived: string }[];
    image?: string;
};
const moduleConfig = backendConfig.modules;
export const backupModules: BackupModule[] = [
    { id: "calendar", label: "Calendario dipendenti", prefixes: ["fp_"] },
    {
        id: "purchasing",
        label: "Gestione acquisti",
        prefixes: ["pm_"],
        files: [
            {
                source: path.join(moduleConfig.productManager.dir, "products"),
                archived: "AyPi Purchasing/products",
            },
        ],
    },
    { id: "ticket", label: "Ticket Support", prefixes: ["ts_"] },
    {
        id: "transfer",
        label: "Schede attrezzaggio Transfer",
        prefixes: ["transfer_"],
        files: [
            {
                source: path.join(
                    moduleConfig.transferAttrezzaggio.dir,
                    "_attachments",
                ),
                archived: "Schede Attrezzaggio/Transfer/_attachments",
            },
        ],
    },
    {
        id: "haas",
        label: "Schede attrezzaggio HAAS",
        prefixes: ["haas_"],
        files: [
            {
                source: path.join(
                    moduleConfig.haasAttrezzaggio.dir,
                    "_attachments",
                ),
                archived: "Schede Attrezzaggio/HAAS/_attachments",
            },
        ],
    },
    {
        id: "mold-design",
        label: "Registrazioni progettazione stampi",
        prefixes: ["registrazioni_progettazione_stampi"],
        files: [
            {
                source: path.join(
                    moduleConfig.registrazioniProgettazioneStampi.dir,
                    "_attachments",
                ),
                archived:
                    "Registrazioni Progettazione/Costruzione Stampi/_attachments",
            },
        ],
    },
    {
        id: "special-projects",
        label: "Registrazioni progetti speciali",
        prefixes: ["registrazioni_progetti_speciali"],
        files: [
            {
                source: path.join(
                    moduleConfig.registrazioniProgettiSpeciali.dir,
                    "_attachments",
                ),
                archived:
                    "Registrazioni Progettazione/Progetti Speciali/_attachments",
            },
        ],
    },
    {
        id: "production-planner",
        label: "Pianificazione produzione",
        prefixes: ["production_planner_"],
    },
    {
        id: "warehouse",
        label: "Inventario magazzino",
        prefixes: ["warehouse_"],
    },
    {
        id: "maintenance",
        label: "Gestione manutenzioni",
        prefixes: ["maintenance_"],
    },
    {
        id: "measurement",
        label: "Strumenti di misura",
        prefixes: ["measurement_"],
    },
    { id: "tooling", label: "Utensili e attrezzature", prefixes: ["tooling_"] },
    {
        id: "supplier-evaluation",
        label: "Valutazione fornitori",
        prefixes: ["supplier_evaluation_"],
    },
    {
        id: "processing-cycles",
        label: "Cicli di lavorazione",
        prefixes: ["processing_cycle"],
    },
    {
        id: "shared",
        label: "Configurazione condivisa e postazioni",
        prefixes: ["shared_"],
    },
    {
        id: "mes",
        label: "MES · Storico e dichiarazioni",
        prefixes: [],
        image: MES_IMAGE,
    },
    {
        id: "forno",
        label: "SCADA Forno · Storico",
        prefixes: [],
        image: FORNO_IMAGE,
    },
];
export function tableNames(db: any): string[] {
    return (
        db.exec(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
        )[0]?.values || []
    ).map((row: any[]) => String(row[0]));
}
export function ownedTable(module: BackupModule, name: string) {
    return module.prefixes.some((prefix) => name.startsWith(prefix));
}
export function snapshotFiles(root: string, relative = ""): string[] {
    return fs
        .readdirSync(path.join(root, relative), { withFileTypes: true })
        .flatMap((entry) => {
            if (entry.isSymbolicLink())
                throw Error(
                    "Il backup contiene un collegamento: " + entry.name,
                );
            const name = path.posix.join(relative, entry.name);
            return entry.isDirectory()
                ? snapshotFiles(root, name)
                : entry.isFile()
                  ? [name]
                  : [];
        });
}
export function safeSnapshotPath(root: string, relative: string) {
    if (
        !relative ||
        relative.includes("\\") ||
        relative
            .split("/")
            .some(
                (part) =>
                    !part ||
                    part === "." ||
                    part === ".." ||
                    part.includes(":"),
            )
    )
        throw Error("Percorso backup non valido.");
    const result = path.resolve(root, ...relative.split("/"));
    if (!result.startsWith(path.resolve(root) + path.sep))
        throw Error("Percorso backup fuori cartella.");
    let current = root;
    for (const part of relative.split("/")) {
        current = path.join(current, part);
        if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink())
            throw Error("Collegamento non consentito nel backup.");
    }
    return result;
}
export function hashFile(file: string) {
    const hash = createHash("sha256"),
        descriptor = fs.openSync(file, "r"),
        buffer = Buffer.allocUnsafe(1024 * 1024);
    try {
        let count: number;
        while (
            (count = fs.readSync(descriptor, buffer, 0, buffer.length, null)) >
            0
        )
            hash.update(buffer.subarray(0, count));
    } finally {
        fs.closeSync(descriptor);
    }
    return hash.digest("hex");
}
export function checkSqlite(data: Uint8Array) {
    const db = openSqliteSnapshot(data);
    try {
        if (
            db.exec("PRAGMA integrity_check")[0]?.values?.[0]?.[0] !== "ok" ||
            db.exec("PRAGMA foreign_key_check").length
        )
            throw Error(
                "Il database del backup non supera il controllo di integrità.",
            );
    } finally {
        db.close();
    }
}
export function checkSnapshotImage(file: string, image: string) {
    if (image !== FORNO_IMAGE) {
        checkSqlite(fs.readFileSync(file));
        return;
    }
    const connection = openDatabase(file, {
        readonly: true,
        fileMustExist: true,
        timeout: 10000,
    });
    try {
        if (
            connection.pragma("integrity_check", { simple: true }) !== "ok" ||
            connection.pragma("foreign_key_check").length
        )
            throw Error("Archivio Forno non integro nel backup.");
    } finally {
        connection.close();
    }
}
export function completeSnapshot(target: string, protectedCopy = false) {
    const write = (name: string, bytes: Uint8Array) => {
        const file = path.join(target, name);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, bytes);
    };
    write(PRIMARY_IMAGE, exportSqliteSnapshot());
    const mes = exportMesSqliteSnapshot();
    if (mes) write(MES_IMAGE, mes);
    const forno = getFornoConfig();
    if (fs.existsSync(forno.dbPath)) {
        const output = path.join(target, FORNO_IMAGE);
        fs.mkdirSync(path.dirname(output), { recursive: true });
        if (fs.existsSync(output)) fs.unlinkSync(output);
        const connection = openDatabase(forno.dbPath, {
            readonly: true,
            fileMustExist: true,
            timeout: 10000,
        });
        try {
            connection.exec(`VACUUM INTO '${output.replace(/'/g, "''")}'`);
        } finally {
            connection.close();
        }
    }
    for (const module of backupModules)
        for (const directory of module.files || []) {
            const destination = path.join(target, directory.archived);
            fs.mkdirSync(destination, { recursive: true });
            if (fs.existsSync(directory.source))
                copyDirectory(directory.source, destination);
        }
    const primary = openSqliteSnapshot(
        fs.readFileSync(path.join(target, PRIMARY_IMAGE)),
    );
    let modules: string[];
    try {
        const tables = tableNames(primary);
        modules = backupModules
            .filter((module) =>
                module.image
                    ? fs.existsSync(path.join(target, module.image))
                    : tables.some((name) => ownedTable(module, name)),
            )
            .map((module) => module.id);
    } finally {
        primary.close();
    }
    const files = snapshotFiles(target)
        .filter((name) => ![MANIFEST, ".incomplete"].includes(name))
        .map((name) => ({
            name,
            size: fs.statSync(path.join(target, name)).size,
            sha256: hashFile(path.join(target, name)),
        }));
    for (const image of [PRIMARY_IMAGE, MES_IMAGE, FORNO_IMAGE])
        if (fs.existsSync(path.join(target, image)))
            checkSnapshotImage(path.join(target, image), image);
    fs.writeFileSync(
        path.join(target, MANIFEST),
        JSON.stringify(
            {
                format: "aypi-backup",
                version: 1,
                createdAt: new Date().toISOString(),
                protected: protectedCopy,
                modules,
                files,
            },
            null,
            2,
        ),
    );
    verifySnapshot(target);
}
export function verifySnapshot(root: string) {
    const manifest = JSON.parse(
        fs.readFileSync(path.join(root, MANIFEST), "utf8"),
    );
    if (
        manifest?.format !== "aypi-backup" ||
        manifest.version !== 1 ||
        !Array.isArray(manifest.files) ||
        !Array.isArray(manifest.modules)
    )
        throw Error("Manifesto backup non valido.");
    const names = new Set<string>();
    for (const file of manifest.files) {
        const resolved = safeSnapshotPath(root, file.name);
        if (
            names.has(file.name) ||
            fs.statSync(resolved).size !== file.size ||
            hashFile(resolved) !== file.sha256
        )
            throw Error("Backup incompleto o modificato: " + file.name);
        names.add(file.name);
    }
    if (!names.has(PRIMARY_IMAGE))
        throw Error("Database principale assente dal backup.");
    const actual = snapshotFiles(root).filter(
        (name) => ![MANIFEST, ".incomplete"].includes(name),
    );
    if (actual.length !== names.size || actual.some((name) => !names.has(name)))
        throw Error("File non verificati nel backup.");
    for (const image of [PRIMARY_IMAGE, MES_IMAGE, FORNO_IMAGE])
        if (names.has(image)) checkSnapshotImage(path.join(root, image), image);
    return manifest;
}
