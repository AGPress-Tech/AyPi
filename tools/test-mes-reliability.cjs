const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID: id } = require('node:crypto');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aypi-mes-reliability-'));
process.env.AYPI_BACKEND_PROFILE = 'dev';
process.env.AYPI_MES_DB_PATH = path.join(root, 'mes.db');
process.env.AYPI_DB_PATH = path.join(root, 'aypi.db');
process.env.AYPI_FP_GENERAL_DIR = path.join(root, 'General');
process.env.AYPI_LOG_DIR = path.join(root, 'logs');
const db = require('../backend-dist/shared/db/mes-sqlite');
const repo = require('../backend-dist/modules/mes/repository');
const production = require('../backend-dist/modules/mes/production-repository');
const sessions = require('../backend-dist/modules/mes/session-repository');
const service = require('../backend-dist/modules/mes/production-service');
const base = Date.now() - 3600000;
const time = (seconds) => new Date(base + seconds * 1000).toISOString();
const common = (seconds) => ({ actor: 'Operatore test', requestId: id(), now: time(seconds), auditId: id() });
const orderDraft = {
    orderNumber: 'TEST-1', articleCode: 'ART-1', customer: 'Test', targetQuantity: 100, unit: 'pz',
    orderType: 'MACHINING', materialAlloy: '', grossWeight: 0, netWeight: 0, kilogramsToStamp: 0,
    barBundles: '', materialOwner: '', barSize: '', firstDeliveryAt: '', dueAt: '',
    priority: 'NORMAL', notes: '', status: 'OPEN',
};
const phaseDraft = {
    phaseCode: '01', sequence: 1, articleCode: 'ART-1', targetQuantity: 100, unit: 'pz',
    standardCycleSeconds: 10, plannedSetupSeconds: 0, plannedMachineId: '', scheduledStart: '',
    scheduledEnd: '', planningStatus: 'BACKLOG', executionStatus: 'NOT_STARTED',
};
let orderId, phaseId;
const get = (sessionId) => sessions.listMachineSessions().find((s) => s.sessionId === sessionId);
function start(machineId, seconds, piecesPerPulse, extra = {}) {
    const sessionId = id();
    return sessions.startMachineSession({ ...common(seconds), machineId, phaseId, mode: 'PRODUCTION',
        note: '', sessionId, transitionId: id(), resolutionId: id(), auditIds: [id(), id()],
        choice: 'EXCLUDE_ALL', reasonCode: 'TEST', piecesPerPulse, ...extra });
}
function batch(seconds, lastPieceSeconds, machineId = 'M1') {
    const observedAt = time(seconds);
    return repo.storeCollectorBatch({ collectorId: 'PC', sourceSessionId: 'CAPTURE', batchId: id(), mode: 'LIVE',
        startedAt: time(0), sentAt: observedAt, stoppedAt: '', machines: [{ machineId, machineName: machineId,
            observedAt, frameAt: observedAt, detected: true, pulses: 1, pieces: 1, piecesLastHour: 1,
            lastPieceAt: lastPieceSeconds === null ? '' : time(lastPieceSeconds),
            lastCycleSeconds: null, multiplier: 1, frameCount: 1, invalidFrames: 0 }] }, observedAt);
}
function events(machineId, seconds, receivedSeconds = seconds.at(-1), rawMultiplier = 1) {
    const importedAt = time(receivedSeconds);
    return repo.storeMachineEvents(seconds.map((second) => ({ eventId: id(), source: 'PLC_CSV',
        sourceSessionId: 'CAPTURE', sourcePosition: id(), machineId, occurredAt: time(second),
        receivedAt: importedAt, pulseDelta: 1, pieceDelta: rawMultiplier, multiplier: rawMultiplier })), {
        importId: id(), source: 'PLC_CSV', sourceSessionId: 'CAPTURE', sourceFile: 'impulsi.csv',
        totalRows: seconds.length, validRows: seconds.length, insertedEvents: 0, duplicateEvents: 0,
        rejectedRows: 0, issues: [], importedAt }, 'Operatore test');
}
const sqlRows = (sql, params = []) => db.getMesSqliteDatabase().exec(sql, params)?.[0]?.values || [];

(async () => {
    await db.initializeMesSqliteDatabase();
    try {
        const created = production.createMesOrder({ ...common(0), order: { ...orderDraft, orderId: id() },
            phases: [{ ...phaseDraft, phaseId: id() }], auditIds: [id(), id()] });
        orderId = created.orderId; phaseId = created.phases[0].phaseId;

        const rename = fs.renameSync;
        try {
            fs.renameSync = (from, to) => {
                if (to === process.env.AYPI_MES_DB_PATH) throw Object.assign(new Error('Simulated disk failure'), { code: 'EACCES' });
                return rename(from, to);
            };
            assert.throws(() => db.runMesSqliteTransaction((database) => database.run(
                "UPDATE mes_orders SET customer = 'Not durable' WHERE order_id = ?", [orderId])));
        } finally { fs.renameSync = rename; }
        assert.equal(production.loadMesOrderDetail(orderId).customer, 'Test', 'Failed disk writes must not leave phantom in-memory changes');

        // Neither the order nor its audit entry may survive a phase revision conflict.
        await assert.rejects(service.saveMesOrderAndPhase({ orderId,
            order: { ...orderDraft, customer: 'Must roll back' }, baseRevision: created.revision,
            phaseId, phase: phaseDraft, phaseRevision: 999 }));
        assert.equal(production.loadMesOrderDetail(orderId).customer, 'Test');
        assert.equal(production.loadMesOrderDetail(orderId).revision, created.revision);

        let active = start('M1', 1);
        batch(2, null);
        assert.equal(sqlRows('SELECT operating_state FROM mes_machine_current')[0][0], 'STOPPED');
        events('M1', [3, 4]);
        active = get(active.sessionId);
        assert.equal(active.sessionGoodPieces, 2);

        // Setup/production switches must retain counters for the same activation.
        const setupId = id();
        sessions.beginSetupForMachineSession({ ...common(5), sessionId: active.sessionId,
            baseRevision: active.revision, setupSessionId: setupId, closeTransitionId: id(),
            startTransitionId: id(), note: '' });
        events('M1', [6]);
        let setup = get(setupId);
        assert.equal(setup.sessionGoodPieces, 2);
        const productionId = id();
        sessions.reconcileSetupSession({ ...common(8), sessionId: setupId, baseRevision: setup.revision,
            goodPieces: 1, scrapPieces: 0, excludedPieces: 0, startProduction: true, closeOrder: false,
            reconciliationId: id(), adjustmentId: id(), productionSessionId: productionId,
            closeTransitionId: id(), startTransitionId: id(), note: '' });
        assert.equal(get(productionId).sessionGoodPieces, 3);

        // Delayed pulses from an already closed setup remain visible and classifiable.
        events('M1', [7], 9);
        setup = get(setupId);
        assert.equal(setup.setupPieces, 1);
        sessions.reconcileSetupSession({ ...common(10), sessionId: setupId, baseRevision: setup.revision,
            goodPieces: 0, scrapPieces: 1, excludedPieces: 0, startProduction: false, closeOrder: false,
            reconciliationId: id(), adjustmentId: id(), productionSessionId: id(),
            closeTransitionId: id(), startTransitionId: id(), note: '' });
        assert.equal(get(setupId).setupPieces, 0);
        assert.equal(get(productionId).sessionScrapPieces, 1);
        assert.equal(get(productionId).status, 'ACTIVE');

        // A production gap can occur entirely between snapshots.
        batch(11, 11); batch(21, 11); batch(31, 11); batch(41, 40);
        events('M1', [11, 40], 42);
        const stopped = sqlRows(`SELECT started_at, ended_at FROM mes_machine_operating_intervals
            WHERE machine_id = 'M1' AND state = 'STOPPED'`);
        assert.ok(stopped.some(([from, to]) => from === time(31) && to === time(40)), JSON.stringify(stopped));
        batch(30, 20); // Out of order snapshots cannot overwrite the latest observation.
        assert.equal(sqlRows("SELECT observed_at FROM mes_machine_current WHERE machine_id = 'M1'")[0][0], time(41));

        active = get(productionId);
        sessions.changeMachineSessionState({ ...common(45), sessionId: active.sessionId,
            baseRevision: active.revision, action: 'PAUSE', transitionId: id(), note: '' });
        const next = start('M2', 46);
        assert.equal(next.sessionGoodPieces, 0);
        assert.equal(next.sessionScrapPieces, 0);
        assert.equal(next.goodPieces, 5);
        assert.equal(next.scrapPieces, 1);
        assert.throws(() => sessions.adjustMachineSessionProduction({ ...common(47), sessionId: next.sessionId,
            baseRevision: next.revision, kind: 'GOOD_PIECES_REMOVE', quantity: 1,
            reasonCode: 'TEST', note: '', adjustmentId: id() }));

        // Archive refuses an active order, then removes it from lists without deleting history.
        let detail = production.loadMesOrderDetail(orderId);
        assert.throws(() => production.archiveMesPhase({ ...common(48), phaseId, baseRevision: detail.phases[0].revision }));
        sessions.changeMachineSessionState({ ...common(49), sessionId: next.sessionId,
            baseRevision: next.revision, action: 'COMPLETE', transitionId: id(), note: '' });
        detail = production.loadMesOrderDetail(orderId);
        production.archiveMesPhase({ ...common(50), phaseId, baseRevision: detail.phases[0].revision });
        assert.equal(production.listMesOrders({ limit: 500, offset: 0 }).total, 0);
        assert.ok(sqlRows('SELECT event_id FROM mes_machine_events').length >= 6);
        assert.throws(() => start('M1', 51));

        const multipliedOrder = production.createMesOrder({ ...common(55),
            order: { ...orderDraft, orderId: id(), orderNumber: 'TEST-MULTIPLIER' },
            phases: [{ ...phaseDraft, phaseId: id() }], auditIds: [id(), id()] });
        orderId = multipliedOrder.orderId; phaseId = multipliedOrder.phases[0].phaseId;
        events('M3', [60, 61], 61, 2);
        assert.equal(sessions.loadActivationPreview('M3', phaseId).unassignedPulses, 2);
        let multiplied = start('M3', 62, 3, { choice: 'PARTIAL', attributedPieces: 4 });
        assert.equal(multiplied.piecesPerPulse, 3);
        assert.equal(multiplied.openingPieces, 4);
        assert.equal(sessions.loadActivationPreview('M3', phaseId).unassignedPieces, 0,
            'Partial attribution must consume the source beats including the excluded portion');
        events('M3', [63, 64], 64, 2);
        multiplied = get(multiplied.sessionId);
        assert.equal(multiplied.automaticPieces, 6, 'Session multiplier overrides raw collector multiplier');
        assert.equal(multiplied.sessionGoodPieces, 10);
        assert.equal(multiplied.lastCycleSeconds, 1 / 3);
        const multipliedSetupId = id();
        sessions.beginSetupForMachineSession({ ...common(65), sessionId: multiplied.sessionId,
            baseRevision: multiplied.revision, setupSessionId: multipliedSetupId,
            closeTransitionId: id(), startTransitionId: id(), note: '' });
        events('M3', [66], 66, 2);
        const multipliedSetup = get(multipliedSetupId);
        assert.equal(multipliedSetup.piecesPerPulse, 3);
        assert.equal(multipliedSetup.setupPieces, 3);
        const multipliedProductionId = id();
        sessions.reconcileSetupSession({ ...common(67), sessionId: multipliedSetupId, baseRevision: multipliedSetup.revision,
            goodPieces: 2, scrapPieces: 1, excludedPieces: 0, startProduction: true, closeOrder: false,
            reconciliationId: id(), adjustmentId: id(), productionSessionId: multipliedProductionId,
            closeTransitionId: id(), startTransitionId: id(), note: '' });
        multiplied = get(multipliedProductionId);
        assert.equal(multiplied.piecesPerPulse, 3);
        assert.equal(multiplied.sessionGoodPieces, 12);
        sessions.changeMachineSessionState({ ...common(68), sessionId: multiplied.sessionId,
            baseRevision: multiplied.revision, action: 'PAUSE', transitionId: id(), note: '' });
        const reopened = start('M3', 69, 1);
        events('M3', [70], 70, 2);
        assert.equal(get(reopened.sessionId).sessionGoodPieces, 1);
        events('M3', [64.5], 71, 2);
        assert.equal(get(reopened.sessionId).sessionGoodPieces, 1,
            'Delayed pulses retain the multiplier of their original activation');
        assert.equal(get(reopened.sessionId).goodPieces, 16);
        assert.equal(sessions.loadActivationPreview('M3', phaseId).unassignedPieces, 0);
        assert.throws(() => start('M4', 72, 0));
        assert.throws(() => start('M4', 72, 1.5));

        repo.loadAcquisitionStatus();
        assert.equal(sqlRows("SELECT operating_state FROM mes_machine_current WHERE machine_id = 'M1'")[0][0], 'UNMONITORED');
        const intervals = sqlRows('SELECT started_at, ended_at FROM mes_machine_operating_intervals');
        assert.ok(intervals.every(([from, to]) => !to || to >= from), 'No negative intervals');
        console.log('MES reliability scenarios: OK');
    } finally { db.closeMesSqliteDatabase(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
