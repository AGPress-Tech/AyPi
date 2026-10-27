import fs from "fs";
import { backendConfig } from "../../config";
import {
    getMesSqliteDatabase,
    runMesSqliteTransaction,
} from "../../shared/db/mes-sqlite";
import {
    getSqliteDatabase,
    persistSqliteDatabase,
    runSqliteTransaction,
} from "../../shared/db/sqlite";
import { logger } from "../../shared/logging/logger";
import { initializeProductionPlannerSqliteStore } from "../production-planner/repository";
import { initializeMesSqliteStore, backfillMesActivationIds } from "./repository";

type LegacyTable = {
    name: string;
    revisionColumn?: string;
};

const LEGACY_TABLES: LegacyTable[] = [
    { name: "mes_machine_events" },
    { name: "mes_import_runs" },
    { name: "mes_collector_sessions" },
    { name: "mes_ingest_batches" },
    { name: "mes_machine_current" },
    { name: "mes_machine_state_intervals" },
    { name: "mes_machine_operating_intervals" },
    { name: "mes_orders" },
    { name: "mes_phases" },
    { name: "mes_machine_sessions" },
    { name: "mes_session_operator_intervals" },
    { name: "mes_session_transitions" },
    { name: "mes_event_allocations" },
    { name: "mes_unassigned_resolutions" },
    { name: "mes_production_adjustments" },
    { name: "mes_setup_reconciliations" },
    { name: "mes_audit_log" },
    { name: "production_planner_state", revisionColumn: "revision" },
];

function quoteIdentifier(value: string) {
    return `"${value.replace(/"/g, '""')}"`;
}

function tableExists(database: any, table: string) {
    return !!database.exec(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
        [table],
    )?.[0]?.values?.length;
}

function tableColumns(database: any, table: string) {
    return (database.exec(`PRAGMA table_info(${quoteIdentifier(table)})`)?.[0]?.values || [])
        .map((row: unknown[]) => String(row[1]));
}

function tableCount(database: any, table: string) {
    return Number(database.exec(
        `SELECT COUNT(*) FROM ${quoteIdentifier(table)}`,
    )?.[0]?.values?.[0]?.[0]) || 0;
}

function allocateSafetyCopyPath() {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const base = `${backendConfig.database.path}.pre-mes-split-${stamp}.bak`;
    if (!fs.existsSync(base)) return base;
    let suffix = 2;
    while (fs.existsSync(`${base}.${suffix}`)) suffix += 1;
    return `${base}.${suffix}`;
}

function copyTableRows(source: any, target: any, descriptor: LegacyTable) {
    const sourceColumns = tableColumns(source, descriptor.name);
    const targetColumnSet = new Set(tableColumns(target, descriptor.name));
    const columns = sourceColumns.filter((column) => targetColumnSet.has(column));
    if (!columns.length) throw new Error(`Nessuna colonna compatibile per ${descriptor.name}.`);
    const columnSql = columns.map(quoteIdentifier).join(", ");
    const placeholders = columns.map(() => "?").join(", ");
    const insertSql = `INSERT OR IGNORE INTO ${quoteIdentifier(descriptor.name)} (${columnSql}) VALUES (${placeholders})`;
    const total = tableCount(source, descriptor.name);
    const pageSize = 1000;
    for (let offset = 0; offset < total; offset += pageSize) {
        const result = source.exec(
            `SELECT ${columnSql} FROM ${quoteIdentifier(descriptor.name)} LIMIT ? OFFSET ?`,
            [pageSize, offset],
        )?.[0];
        (result?.values || []).forEach((values: unknown[]) => target.run(insertSql, values));
    }

    if (descriptor.name === "production_planner_state" && descriptor.revisionColumn) {
        const sourceRow = source.exec(
            `SELECT ${columnSql} FROM production_planner_state WHERE store_key = 'main'`,
        )?.[0]?.values?.[0];
        if (sourceRow) {
            const revisionIndex = columns.indexOf(descriptor.revisionColumn);
            const targetRevision = Number(target.exec(
                "SELECT revision FROM production_planner_state WHERE store_key = 'main'",
            )?.[0]?.values?.[0]?.[0]) || 0;
            const sourceRevision = Number(sourceRow[revisionIndex]) || 0;
            if (sourceRevision > targetRevision) {
                target.run("DELETE FROM production_planner_state WHERE store_key = 'main'");
                target.run(insertSql, sourceRow);
            }
        }
    }
    return total;
}

export function migrateLegacyMesStorage() {
    initializeMesSqliteStore();
    initializeProductionPlannerSqliteStore();
    const primary = getSqliteDatabase();
    const mes = getMesSqliteDatabase();
    const present = LEGACY_TABLES.filter((table) => tableExists(primary, table.name));
    if (!present.length) return { migrated: false, backupPath: "", tables: [] as string[] };

    const backupPath = allocateSafetyCopyPath();
    fs.writeFileSync(backupPath, Buffer.from(primary.export()), { flag: "wx" });

    const copiedCounts = new Map<string, number>();
    runMesSqliteTransaction((target) => {
        present.forEach((descriptor) => {
            if (!tableExists(target, descriptor.name)) {
                throw new Error(`Tabella MES di destinazione mancante: ${descriptor.name}.`);
            }
            copiedCounts.set(descriptor.name, copyTableRows(primary, target, descriptor));
        });
        backfillMesActivationIds(target);
    });

    present.forEach((descriptor) => {
        const sourceCount = copiedCounts.get(descriptor.name) || 0;
        const targetCount = tableCount(mes, descriptor.name);
        if (targetCount < sourceCount) {
            throw new Error(
                `Verifica migrazione fallita per ${descriptor.name}: sorgente ${sourceCount}, destinazione ${targetCount}.`,
            );
        }
    });

    runSqliteTransaction((database) => {
        [...present].reverse().forEach((descriptor) => {
            database.exec(`DROP TABLE ${quoteIdentifier(descriptor.name)}`);
        });
    });
    try {
        primary.exec("VACUUM;");
        persistSqliteDatabase();
    } catch (error) {
        logger.warn("Primary SQLite cleanup completed without compaction", {
            event: "mes_legacy_vacuum_failed",
            category: "storage",
            module: "mes",
            detail: error instanceof Error ? error.message : String(error),
        });
    }

    const tables = present.map((descriptor) => descriptor.name);
    logger.info("Legacy MES storage migrated", {
        event: "mes_legacy_storage_migrated",
        category: "storage",
        module: "mes",
        backupPath,
        mesDbPath: backendConfig.mesDatabase.path,
        tables,
        rows: Object.fromEntries(copiedCounts),
    });
    return { migrated: true, backupPath, tables };
}
