const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

// All storage stays in a new fixture; never use the configured server share.
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'aypi-login-tests-'));
Object.assign(process.env, {
    AYPI_BACKEND_PROFILE: 'dev',
    AYPI_FP_GENERAL_DIR: path.join(temporary, 'AGPRESS', 'General'),
    AYPI_DB_PATH: path.join(temporary, 'AGPRESS', 'General', 'data', 'aypi.db'),
    AYPI_LOG_DIR: path.join(temporary, 'logs'),
    AYPI_FORNO_ENABLED: '0',
});

const sqlite = require('../backend-dist/shared/db/sqlite');
const repository = require('../backend-dist/modules/shared/repository');
const automatic = require('../backend-dist/shared/storage/agpress-backups');
const backupFiles = require('../backend-dist/shared/storage/backups');

(async () => {
    await sqlite.initializeSqliteDatabase();
    try {
        repository.initializeSharedSqliteStore();
        const originalDaily = backupFiles.createDailyDirectoryBackup;
        backupFiles.createDailyDirectoryBackup = () => {
            throw Error('Suspended automatic backup must never touch storage');
        };
        try {
            assert.equal(automatic.AUTOMATIC_BACKUPS_ENABLED, false);
            for (let i = 0; i < 3; i++) {
                assert.equal(automatic.ensureAgpressDailyBackup().reason, 'automatic-backups-suspended');
            }
            await repository.saveAdminCredentials([{ name: 'Test operator', password: 'fixture-password' }]);
            assert(await repository.verifyAdminPassword('fixture-password', 'Test operator'));
            const migrated = repository.loadAdminCredentials()[0];
            assert(migrated.passwordHash, 'Legacy plaintext must still migrate');
            assert(!migrated.password);

            const originalSave = sqlite.persistSqliteDatabase;
            const originalBackup = automatic.ensureAgpressDailyBackup;
            let writes = 0, backupCalls = 0;
            sqlite.persistSqliteDatabase = () => { writes++; throw Error('Login must not persist the database'); };
            automatic.ensureAgpressDailyBackup = () => { backupCalls++; throw Error('Login must not invoke backups'); };
            // Also watch writes, since repository-internal transactions can call
            // a locally bound persistence function rather than the export above.
            const originalWrite = fs.writeFileSync;
            fs.writeFileSync = () => { writes++; throw Error('Login must not write files'); };
            try {
                const before = fs.readFileSync(process.env.AYPI_DB_PATH);
                for (let i = 0; i < 3; i++) {
                    const result = await repository.verifyAdminPassword('fixture-password', 'Test operator');
                    assert.equal(result.passwordHash, migrated.passwordHash);
                    assert.equal(repository.loadAdminCredentials()[0].passwordHash, migrated.passwordHash);
                }
                assert.equal(await repository.verifyAdminPassword('wrong-password', 'Test operator'), null);
                assert.equal(await repository.verifyAdminPassword('fixture-password', 'Someone else'), null);
                assert.equal(await repository.verifyAdminPassword('', 'Test operator'), null);
                assert(await repository.verifyAdminPassword('fixture-password'), 'Legacy callers without a name still work');
                assert.deepEqual(fs.readFileSync(process.env.AYPI_DB_PATH), before);
                assert.equal(writes, 0);
                assert.equal(backupCalls, 0);
            } finally {
                fs.writeFileSync = originalWrite;
                sqlite.persistSqliteDatabase = originalSave;
                automatic.ensureAgpressDailyBackup = originalBackup;
            }
            assert(!fs.existsSync(automatic.getAgpressBackupRootDir()), 'No automatic backup directories created');
        } finally {
            backupFiles.createDailyDirectoryBackup = originalDaily;
        }
    } finally {
        sqlite.closeSqliteDatabase();
    }

    // Reproduce the installed Electron layout without loading a native binary
    // for the test runner's ABI or accessing any real production paths.
    const archive = path.resolve(__dirname, '../backend-dist/modules/forno/archive.js');
    const source = fs.readFileSync(archive, 'utf8');
    for (const environmentOverride of [false, true]) {
        const resources = path.join(temporary, 'installed', 'resources');
        const root = environmentOverride ? path.join(temporary, 'override') : path.join(resources, 'backend-resources', 'forno');
        const expected = path.join(root, 'native', 'electron-v132-win32-x64', 'better_sqlite3.node');
        let selected;
        const exports = {};
        vm.runInNewContext(source, {
            exports, Buffer, __dirname: path.dirname(archive),
            process: { versions: { electron: '34.3.0', modules: '132' }, platform: 'win32', arch: 'x64', resourcesPath: resources, env: environmentOverride ? { AYPI_FORNO_RESOURCES: root } : {} },
            require: name => name === 'fs' ? { existsSync: candidate => candidate === expected } : name === 'better-sqlite3' ? function (_file, options) { selected = options.nativeBinding; } : require(name),
        });
        exports.openDatabase(':memory:');
        assert.equal(selected, expected, 'Native SQLite resolves in installed layout and with explicit override');
    }
    console.log('Backend login OK: unchanged hashes, no writes/backups, legacy migration, invalid credentials, suspended automatic backups and installed Electron native binding.');
})().catch(error => { console.error(error); process.exitCode = 1; });
