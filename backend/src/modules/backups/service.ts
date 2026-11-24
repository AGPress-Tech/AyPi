import fs from "fs";
import path from "path";
import { randomUUID, createHash } from "crypto";
import { backendConfig } from "../../config";
import { HttpError } from "../../shared/http/errors";
import { exclusiveMaintenance, setBackupRecoveryRequired, isBackupRecoveryRequired } from "../../shared/ops/maintenance";
import { createAgpressBackup, getAgpressBackupRootDir, listAgpressBackups, resolveAgpressBackupDir } from "../../shared/storage/agpress-backups";
import { copyDirectory, isProtectedBackup } from "../../shared/storage/backups";
import { backupModules, tableNames, ownedTable } from "../../shared/storage/backup-data";
import { PRIMARY_IMAGE, MES_IMAGE, FORNO_IMAGE, MANIFEST, hashFile, snapshotFiles, verifySnapshot, checkSqlite, checkSnapshotImage } from "../../shared/storage/backup-data";
import { exportSqliteSnapshot, openSqliteSnapshot, replaceSqliteSnapshot } from "../../shared/db/sqlite";
import { exportMesSqliteSnapshot, replaceMesSqliteSnapshot } from "../../shared/db/mes-sqlite";
import { getFornoConfig } from "../forno/config";
import { startFornoService, stopFornoService } from "../forno/service";
import { logger } from "../../shared/logging/logger";

const digest = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");
const quoted = (name: string) => '"' + name.replace(/"/g, '""') + '"';
const journalPath = () => path.join(path.dirname(backendConfig.database.path), "aypi-restore-pending.json");
type Plan = { name: string; all: boolean; modules: string[]; fingerprint: string; expiresAt: number };
const plans = new Map<string, Plan>();
export function initializeBackupRecovery() { setBackupRecoveryRequired(fs.existsSync(journalPath())); }

function inspectBackup(name: string) {
    const root = resolveAgpressBackupDir(name);
    if (!fs.existsSync(root) || fs.existsSync(path.join(root, ".incomplete"))) throw Error("Backup assente o incompleto.");
    if (fs.existsSync(path.join(root, MANIFEST))) {
        const manifest = verifySnapshot(root);
        return { root, manifest, fingerprint: digest(JSON.stringify(manifest)), legacy: false };
    }
    // Historical backups have no manifest: validate their databases and pin every file
    // to this preview, so a changed directory cannot later be restored with its token.
    const primaryPath = path.join(root, PRIMARY_IMAGE);
    if (!fs.existsSync(primaryPath)) throw Error("Il backup non contiene il database AyPi.");
    checkSqlite(fs.readFileSync(primaryPath));
    const db = openSqliteSnapshot(fs.readFileSync(primaryPath));
    let modules: string[];
    try { const tables = tableNames(db); modules = backupModules.filter(module => module.image ? fs.existsSync(path.join(root, module.image)) && !fs.existsSync(path.join(root, module.image + "-wal")) : tables.some(name => ownedTable(module, name))).map(module => module.id); }
    finally { db.close(); }
    for (const module of backupModules.filter(module => modules.includes(module.id) && module.image)) checkSnapshotImage(path.join(root, module.image!), module.image!);
    const files = snapshotFiles(root).map(file => ({ name: file, size: fs.statSync(path.join(root, file)).size, sha256: hashFile(path.join(root, file)) }));
    const manifest = { createdAt: new Date(fs.statSync(root).mtimeMs).toISOString(), modules, files };
    return { root, manifest, fingerprint: digest(JSON.stringify(files)), legacy: true };
}
export function backupCatalog() {
    const items = listAgpressBackups().map(entry => {
        const root = resolveAgpressBackupDir(entry.name);
        let metadata: any;
        try { metadata = JSON.parse(fs.readFileSync(path.join(root, MANIFEST), "utf8")); } catch {}
        return { ...entry, createdAt: metadata?.createdAt || new Date(entry.mtimeMs).toISOString(), availableModules: metadata?.modules || null, legacy: !metadata, protected: isProtectedBackup(getAgpressBackupRootDir(), entry.name) };
    });
    let recovery: any = null;
    if (fs.existsSync(journalPath())) { try { recovery = JSON.parse(fs.readFileSync(journalPath(), "utf8")); } catch { recovery = { error: "Registro recupero non leggibile: controllare le cartelle sul server." }; } }
    return { items, modules: backupModules.map(module => ({ id: module.id, label: module.label })), retention: 3, folder: getAgpressBackupRootDir(), recovery };
}

function primaryImage(root: string, ids: string[], all: boolean) {
    const source = openSqliteSnapshot(fs.readFileSync(path.join(root, PRIMARY_IMAGE)));
    const target = all ? source : openSqliteSnapshot(exportSqliteSnapshot());
    const current = all ? openSqliteSnapshot(exportSqliteSnapshot()) : target;
    try {
        const sourceNames = tableNames(source), targetNames = tableNames(target), currentNames = tableNames(current);
        const selected = backupModules.filter(module => ids.includes(module.id) && !module.image);
        const schema = (db: any, table: string) => db.exec(`PRAGMA table_info(${quoted(table)})`)[0]?.values.map((row: any[]) => [row[1], row[2], row[3], row[4], row[5]]) || [];
        for (const table of all ? currentNames : sourceNames.filter(table => selected.some(module => ownedTable(module, table)))) {
            if (all && !sourceNames.includes(table) || sourceNames.includes(table) && currentNames.includes(table) && JSON.stringify(schema(source, table)) !== JSON.stringify(schema(current, table))) throw Error(`Struttura dati incompatibile per ${table}. Il backup richiede una verifica della versione del backend.`);
        }
        if (!all) {
            target.exec("PRAGMA foreign_keys=OFF; BEGIN;");
            const tables = [...new Set([...targetNames, ...sourceNames])].filter(table => selected.some(module => ownedTable(module, table)));
            for (const table of tables) {
                if (!targetNames.includes(table)) {
                    const sql = source.exec("SELECT sql FROM sqlite_master WHERE type='table' AND name=?", [table])[0].values[0][0];
                    target.exec(String(sql));
                }
                target.exec(`DELETE FROM ${quoted(table)}`);
                if (!sourceNames.includes(table)) continue;
                const columns = source.exec(`PRAGMA table_info(${quoted(table)})`)[0].values.map((row: any[]) => String(row[1]));
                const rows = source.exec(`SELECT ${columns.map(quoted).join(",")} FROM ${quoted(table)}`)[0]?.values || [];
                const insert = target.prepare(`INSERT INTO ${quoted(table)}(${columns.map(quoted).join(",")}) VALUES(${columns.map(() => "?").join(",")})`);
                try { for (const row of rows) insert.run(row); } finally { insert.free(); }
                if (target.exec("SELECT 1 FROM sqlite_master WHERE name='sqlite_sequence'").length) {
                    target.run("DELETE FROM sqlite_sequence WHERE name=?", [table]);
                    if (source.exec("SELECT 1 FROM sqlite_master WHERE name='sqlite_sequence'").length) {
                        const seq = source.exec("SELECT seq FROM sqlite_sequence WHERE name=?", [table])[0]?.values[0]?.[0];
                        if (seq !== undefined) target.run("INSERT INTO sqlite_sequence(name,seq) VALUES(?,?)", [table, seq]);
                    }
                }
            }
            target.exec("COMMIT;");
        }
        if ((all || ids.includes("shared")) && tableNames(target).includes("mobile_admin_sessions")) target.exec("DELETE FROM mobile_admin_sessions;");
        const bytes = Buffer.from(target.export()); checkSqlite(bytes); return bytes;
    } finally { source.close(); if (target !== source) target.close(); if (current !== target) current.close(); }
}
function validateSelection(root: string, modules: string[], all: boolean) {
    if (all && (exportMesSqliteSnapshot() && !fs.existsSync(path.join(root, MES_IMAGE)) || fs.existsSync(getFornoConfig().dbPath) && !fs.existsSync(path.join(root, FORNO_IMAGE)))) throw Error("Il backup non contiene tutti gli archivi del server. Scegli il ripristino dei soli moduli disponibili.");
    const primary = primaryImage(root, modules, all);
    for (const module of backupModules.filter(module => modules.includes(module.id))) {
        if (module.image) checkSnapshotImage(path.join(root, module.image), module.image);
        for (const directory of module.files || []) if (!fs.existsSync(path.join(root, directory.archived))) throw Error(`Allegati non presenti nel backup: ${module.label}.`);
    }
    return primary;
}
export function previewRestore(input: any) {
    if (!input || !["all", "modules"].includes(input.scope) || typeof input.name !== "string") throw Error("Scegli un backup e l’ambito del ripristino.");
    if (fs.existsSync(journalPath())) {
        const recovery = JSON.parse(fs.readFileSync(journalPath(), "utf8"));
        if (input.name !== recovery.safety || input.scope !== "all") throw Error("Per recuperare il server scegli Tutto e la copia protetta indicata nel messaggio di recupero.");
    }
    const backup = inspectBackup(input.name), all = input.scope === "all";
    const modules = all ? backup.manifest.modules : input.modules;
    if (!Array.isArray(modules) || !modules.length || modules.length !== new Set(modules).size || modules.some(id => !backupModules.some(module => module.id === id) || !backup.manifest.modules.includes(id))) throw Error("Scegli almeno un modulo contenuto nel backup.");
    validateSelection(backup.root, modules, all);
    for (const [key, plan] of plans) if (plan.expiresAt < Date.now()) plans.delete(key);
    if (plans.size > 100) throw Error("Troppe anteprime aperte. Attendi qualche minuto.");
    const token = randomUUID(), expiresAt = Date.now() + 5 * 60000;
    plans.set(token, { name: input.name, modules, all, fingerprint: backup.fingerprint, expiresAt });
    return { token, expiresAt, name: input.name, createdAt: backup.manifest.createdAt, modules: backupModules.filter(module => modules.includes(module.id)).map(module => ({ id: module.id, label: module.label })), all, legacy: backup.legacy, protected: isProtectedBackup(getAgpressBackupRootDir(), input.name), folder: getAgpressBackupRootDir() };
}
function replaceForno(file?: string) {
    const destination = getFornoConfig().dbPath;
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    const temporary = destination + ".restore-" + randomUUID();
    if (file) { fs.copyFileSync(file, temporary); fs.renameSync(temporary, destination); }
    else if (fs.existsSync(destination)) fs.unlinkSync(destination);
    for (const suffix of ["-wal", "-shm", "-journal"]) if (fs.existsSync(destination + suffix)) fs.unlinkSync(destination + suffix);
}
export async function executeRestore(input: any, actor: string) {
    const plan = plans.get(input?.token);
    if (!plan || plan.expiresAt < Date.now() || input.confirmation !== "RIPRISTINA" || input.clientsClosed !== true) throw new HttpError(409, "Conferma non valida o anteprima scaduta. Chiudi i moduli e prepara nuovamente il ripristino.");
    plans.delete(input.token);
    return exclusiveMaintenance(async () => {
        const backup = inspectBackup(plan.name);
        if (backup.fingerprint !== plan.fingerprint) throw Error("Il backup è cambiato dopo l’anteprima. Nessun ripristino eseguito.");
        const primary = validateSelection(backup.root, plan.modules, plan.all);
        await stopFornoService();
        let safety: ReturnType<typeof createAgpressBackup> = null;
        const previousJournal = fs.existsSync(journalPath()) ? fs.readFileSync(journalPath()) : null;
        let journalWritten = false;
        const moved: { target: string; retired: string; existed: boolean }[] = [];
        try {
            safety = createAgpressBackup("safety-before-restore", 3, true);
            if (!safety) throw Error("Backup di sicurezza non creato: ripristino annullato.");
            verifySnapshot(safety.path);
            const journalTemporary = journalPath() + "." + randomUUID() + ".tmp";
            try {
                const descriptor = fs.openSync(journalTemporary, "wx");
                try { fs.writeFileSync(descriptor, JSON.stringify({ safety: safety.name, safetyPath: safety.path, source: plan.name, modules: plan.modules, at: new Date().toISOString(), actor }, null, 2)); fs.fsyncSync(descriptor); }
                finally { fs.closeSync(descriptor); }
                fs.renameSync(journalTemporary, journalPath());
            } finally { if (fs.existsSync(journalTemporary)) { try { fs.unlinkSync(journalTemporary); } catch {} } }
            journalWritten = true;
            for (const module of backupModules.filter(module => plan.modules.includes(module.id))) for (const directory of module.files || []) {
                const target = directory.source, retired = target + ".before-restore-" + randomUUID(), stage = target + ".restore-" + randomUUID();
                if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) throw Error("Cartella allegati non ripristinabile: collegamento sul server.");
                copyDirectory(path.join(backup.root, directory.archived), stage);
                const existed = fs.existsSync(target);
                if (existed) fs.renameSync(target, retired);
                moved.push({ target, retired, existed });
                fs.renameSync(stage, target);
            }
            replaceSqliteSnapshot(primary);
            if (plan.modules.includes("mes")) replaceMesSqliteSnapshot(fs.readFileSync(path.join(backup.root, MES_IMAGE)));
            if (plan.modules.includes("forno")) replaceForno(path.join(backup.root, FORNO_IMAGE));
            fs.unlinkSync(journalPath()); journalWritten = false; setBackupRecoveryRequired(false);
            for (const item of moved) if (item.existed) { try { fs.rmSync(item.retired, { recursive: true, force: true }); } catch {} }
            try { logger.info("Ripristino backup completato", { module: "core", event: "backup_restore", actor, source: plan.name, modules: plan.modules, safety: safety.name }); } catch { /* A log failure cannot turn a committed restore into a reported rollback. */ }
            return { ok: true, restored: plan.name, modules: plan.modules, safety: safety.name, safetyPath: safety.path };
        } catch (error) {
            let rollbackError = "";
            if (safety && journalWritten) {
                try {
                    replaceSqliteSnapshot(fs.readFileSync(path.join(safety.path, PRIMARY_IMAGE)));
                    if (plan.modules.includes("mes")) replaceMesSqliteSnapshot(fs.readFileSync(path.join(safety.path, MES_IMAGE)));
                    if (plan.modules.includes("forno")) replaceForno(fs.existsSync(path.join(safety.path, FORNO_IMAGE)) ? path.join(safety.path, FORNO_IMAGE) : undefined);
                    for (const item of moved.reverse()) {
                        if (fs.existsSync(item.target)) fs.rmSync(item.target, { recursive: true, force: true });
                        if (item.existed) fs.renameSync(item.retired, item.target);
                    }
                    if (previousJournal) fs.writeFileSync(journalPath(), previousJournal);
                    else fs.unlinkSync(journalPath());
                    setBackupRecoveryRequired(!!previousJournal);
                } catch (failure) { rollbackError = (failure as Error).message; setBackupRecoveryRequired(true); }
            }
            throw new HttpError(500, `${(error as Error).message}${rollbackError ? " Recupero automatico non completato: il server resta bloccato in attesa di recupero." : " Nessun ripristino applicato; stato precedente conservato."}`, { details: { safety: safety?.name, safetyPath: safety?.path, rollbackError } });
        } finally {
            if (!isBackupRecoveryRequired()) await startFornoService().catch(error => { try { logger.error("Riavvio acquisizione forno dopo backup non riuscito", { detail: String(error) }); } catch {} });
        }
    });
}
export async function createManualBackup() {
    if (isBackupRecoveryRequired()) throw new HttpError(409, "Completa prima il recupero del server dalla copia protetta indicata.");
    return exclusiveMaintenance(async () => {
        const backup = createAgpressBackup("manual-full", 3);
        if (!backup) throw Error("Cartella dati AyPi non disponibile.");
        return backup;
    });
}
