const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { handleStdioError } = require('../dist-ts/modules/stdio-errors');
assert.doesNotThrow(() => process.stdout.emit('error', Object.assign(new Error('Closed pipe'), { code: 'EPIPE' })));
assert.throws(() => handleStdioError(Object.assign(new Error('Other error'), { code: 'EIO' })));
const moduleExports = {};
vm.runInNewContext(fs.readFileSync('dist-ts/modules/file-manager/production-planner-ipc.js', 'utf8'), {
    exports: moduleExports,
    require: (name) => name === 'electron-log' ? { info() {}, warn() {}, error() {} } : require(name),
    URL, URLSearchParams, console,
});
const handlers = new Map();
const orders = Array.from({ length: 1001 }, (_, index) => ({ orderId: `order-${index}`, phases: [] }));
let failSecondPage = false;
moduleExports.registerProductionPlannerIpc({ handle: (name, fn) => handlers.set(name, fn) }, async (pathname) => {
    const url = new URL(pathname, 'http://localhost');
    const offset = Number(url.searchParams.get('offset')) || 0;
    if (failSecondPage && offset > 0) throw new Error('Network unavailable');
    return { total: orders.length, rows: orders.slice(offset, offset + 500), limit: 500, offset };
});
(async () => {
    const list = handlers.get('mes-orders-list');
    const result = await list(null, {});
    assert.equal(result.ok, true);
    assert.equal(result.data.rows.length, 1001);
    assert.equal(new Set(result.data.rows.map((row) => row.orderId)).size, 1001);
    failSecondPage = true;
    const failed = await list(null, {});
    assert.equal(failed.ok, false, 'A partial page load must not appear as a complete order list');
    console.log('MES IPC pagination: OK');
})().catch((error) => { console.error(error); process.exitCode = 1; });
