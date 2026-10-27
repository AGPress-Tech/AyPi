const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "aypi-mes-migration-"));
process.env.AYPI_BACKEND_PROFILE = "dev";
process.env.AYPI_FP_GENERAL_DIR = path.join(root, "General");
process.env.AYPI_DB_PATH = path.join(root, "aypi.db");
process.env.AYPI_MES_DB_PATH = path.join(root, "mes.db");
process.env.AYPI_LOG_DIR = path.join(root, "logs");

const primaryStore = require("../backend-dist/shared/db/sqlite.js");
const mesStore = require("../backend-dist/shared/db/mes-sqlite.js");
const { migrateLegacyMesStorage } = require("../backend-dist/modules/mes/legacy-migration.js");

function exists(database, table) {
    return !!database.exec(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
        [table],
    )?.[0]?.values?.length;
}

(async () => {
    try {
        await primaryStore.initializeSqliteDatabase();
        await mesStore.initializeMesSqliteDatabase();
        const primary = primaryStore.getSqliteDatabase();
        primary.exec(`
            CREATE TABLE production_planner_state (
                store_key TEXT PRIMARY KEY,
                revision INTEGER NOT NULL,
                updated_at TEXT NOT NULL,
                updated_by TEXT NOT NULL,
                payload_json TEXT NOT NULL
            );
            CREATE TABLE mes_machine_events (
                event_id TEXT PRIMARY KEY,
                source TEXT NOT NULL,
                source_session_id TEXT NOT NULL,
                source_position TEXT NOT NULL,
                machine_id TEXT NOT NULL,
                occurred_at TEXT NOT NULL,
                received_at TEXT NOT NULL,
                pulse_delta INTEGER NOT NULL,
                piece_delta INTEGER NOT NULL,
                multiplier INTEGER NOT NULL,
                signal_mac TEXT NOT NULL DEFAULT '',
                signal_frame_id TEXT NOT NULL DEFAULT '',
                signal_byte INTEGER,
                signal_bit INTEGER,
                raw_json TEXT NOT NULL,
                imported_at TEXT NOT NULL,
                imported_by TEXT NOT NULL
            );
        `);
        primary.run(
            "INSERT INTO production_planner_state VALUES (?, ?, ?, ?, ?)",
            ["main", 7, "2026-10-27T08:00:00.000Z", "test", JSON.stringify({ machines: [], jobs: [{ id: "legacy" }], unavailabilities: [] })],
        );
        primary.run(
            "INSERT INTO mes_machine_events VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            ["event-1", "PLC_CSV", "session-1", "impulsi.csv:2", "21F400",
                "2026-10-27T08:00:01.000Z", "2026-10-27T08:00:02.000Z",
                1, 1, 1, "ec:1c:5d:08:83:69", "0x8002", 4, 6, "{}",
                "2026-10-27T08:00:02.000Z", "test"],
        );
        primaryStore.persistSqliteDatabase();

        const result = migrateLegacyMesStorage();
        assert.equal(result.migrated, true);
        assert.equal(fs.existsSync(result.backupPath), true);
        assert.equal(exists(primary, "production_planner_state"), false);
        assert.equal(exists(primary, "mes_machine_events"), false);

        const mes = mesStore.getMesSqliteDatabase();
        assert.equal(Number(mes.exec("SELECT COUNT(*) FROM mes_machine_events")[0].values[0][0]), 1);
        assert.equal(Number(mes.exec("SELECT revision FROM production_planner_state WHERE store_key = 'main'")[0].values[0][0]), 7);
        console.log("MES storage migration: OK");
    } finally {
        try { mesStore.closeMesSqliteDatabase(); } catch {}
        try { primaryStore.closeSqliteDatabase(); } catch {}
        fs.rmSync(root, { recursive: true, force: true });
    }
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
