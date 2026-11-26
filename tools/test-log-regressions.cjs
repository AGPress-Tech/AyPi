const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'aypi-log-regressions-'));
Object.assign(process.env, {
    AYPI_BACKEND_PROFILE: 'dev', AYPI_FORNO_ENABLED: '0',
    AYPI_FP_GENERAL_DIR: path.join(temporary, 'General'),
    AYPI_DB_PATH: path.join(temporary, 'data.db'),
    AYPI_LOG_DIR: path.join(temporary, 'logs'),
    AYPI_ANALYTICS_CREDENTIALS_FILE: path.join(temporary, 'credentials.json'),
});
delete process.env.AYPI_ANALYTICS_SQL_PASSWORD;
const { logger } = require('../backend-dist/shared/logging/logger');
const logs = [];
for (const level of ['info', 'warn', 'error']) logger[level] = (message, data) => logs.push({ level, message, ...data });

async function main() {
    const errors = require('../backend-dist/shared/http/errors');
    const routes = require('../backend-dist/routes');
    routes.registerRoutes = router => {
        router.register('POST', '/test/auth', () => { throw errors.unauthorized('Invalid admin credentials'); });
        router.register('POST', '/test/system', () => { throw errors.badRequest('Sistema utilizzato'); });
        router.register('GET', '/test/failure', () => { throw Error('Unexpected failure'); });
        const { registerAnalyticsRoutes } = require('../backend-dist/modules/analytics/routes');
        const fail = async () => { throw Object.assign(Error('PRIVATE SQL password=SECRET'), { code: 'ELOGIN', number: 18456 }); };
        registerAnalyticsRoutes(router, { articleOffers: fail, stockAnalysis: fail, barContracts: fail, bomAnalysis: fail });
    };
    const { createBackendServer } = require('../backend-dist/app');
    const server = createBackendServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const post = url => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    try {
        assert.equal((await post('/test/auth')).status, 401);
        assert.equal((await post('/test/system')).status, 400);
        assert.equal((await fetch(base + '/test/failure')).status, 500);
        const rejects = logs.filter(x => x.message === 'HTTP request rejected');
        assert.deepEqual(rejects.map(x => [x.level, x.statusCode]), [['warn', 401], ['warn', 400]]);
        assert(rejects.every(x => x.event === 'http_request_completed'), 'Keep compatibility with the backend log viewer');
        assert.equal(logs.filter(x => x.event === 'http_request_failed').length, 1);
        for (const name of ['article-offers', 'stock-analysis', 'bar-contracts', 'bom-analysis']) {
            const response = await post('/api/erp/' + name);
            assert.equal(response.status, 503);
            assert(!(await response.text()).includes('SECRET'));
            const diagnostic = logs.filter(x => x.event === 'analytics_request_unavailable').at(-1);
            assert.equal(diagnostic.requestId, response.headers.get('x-aypi-request-id'));
            assert.equal(diagnostic.reason, 'sql_authentication');
            assert.equal(diagnostic.sqlNumber, 18456);
        }
        assert(!JSON.stringify(logs).includes('SECRET'));
        // Both WebSocket upgrade handlers must coexist on the actual HTTP server.
        const WebSocket = require('ws');
        for (const endpoint of ['/ws', '/api/forno/live']) {
            const socket = new WebSocket(base.replace('http:', 'ws:') + endpoint);
            await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
            socket.close();
            await new Promise(resolve => socket.once('close', resolve));
        }
    } finally {
        require('../backend-dist/shared/realtime/websocket-hub').closeRealtimeHub(server);
        require('../backend-dist/modules/forno/live').closeFornoLive(server);
        await new Promise(resolve => server.close(resolve));
    }
    const { loadAnalyticsConfig } = require('../backend-dist/modules/analytics/config');
    await assert.rejects(loadAnalyticsConfig(), { code: 'ANALYTICS_NOT_CONFIGURED' });
    fs.writeFileSync(process.env.AYPI_ANALYTICS_CREDENTIALS_FILE, '{malformed SECRET');
    await assert.rejects(loadAnalyticsConfig(), { code: 'ANALYTICS_CONFIG_INVALID' });
    fs.writeFileSync(process.env.AYPI_ANALYTICS_CREDENTIALS_FILE, 'null');
    await assert.rejects(loadAnalyticsConfig(), { code: 'ANALYTICS_CONFIG_INVALID' });

    // Deterministic heartbeat clock: no 30-second waits and no production sockets.
    let now = 0;
    class SocketServer extends EventEmitter { close() {} }
    const exports = {};
    vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../backend-dist/shared/realtime/websocket-hub.js'), 'utf8'), {
        exports, Buffer, URL, setInterval: () => ({ unref() {} }), clearInterval() {},
        require: name => name === 'perf_hooks' ? { performance: { now: () => now } }
            : name === 'ws' ? { __esModule: true, default: { OPEN: 1 }, WebSocketServer: SocketServer }
            : name === '../logging/logger' ? { logger } : require(name),
    });
    const hub = new exports.RealtimeHub(new EventEmitter());
    const socket = new EventEmitter();
    let pings = 0, terminations = 0;
    Object.assign(socket, { readyState: 1, send() {}, ping() { pings++; }, terminate() { terminations++; }, close() {} });
    hub.handleConnection(socket, { url: '/ws', socket: { remoteAddress: 'fixture' } });
    hub.heartbeat(); assert.equal(pings, 1);
    now = 29999; hub.heartbeat(); assert.equal(terminations, 0, 'A full response window is required');
    now = 90000; hub.heartbeat(); assert.equal(terminations, 0, 'A stalled server must give pong callbacks a fresh window');
    assert.equal(pings, 2);
    socket.emit('pong');
    now = 120000; hub.heartbeat(); assert.equal(terminations, 0);
    now = 150000; hub.heartbeat(); assert.equal(terminations, 1, 'Unresponsive clients must still expire');
    hub.close();

    // A cached filename/version must not let an unusable native DLL pass a build.
    const cached = path.join(temporary, 'backend/resources/forno/native/electron-v132-win32-x64/better_sqlite3.node');
    fs.mkdirSync(path.dirname(cached), { recursive: true });
    fs.writeFileSync(cached, 'fixture'); fs.writeFileSync(cached + '.version', 'test');
    let nativeBroken = true, probes = 0;
    const context = {
        __dirname: path.join(temporary, 'tools'), process: { env: {} }, console: { log() {} },
        require: name => name === 'electron' ? 'fixture-electron'
            : name === 'better-sqlite3/package.json' ? { version: 'test' }
            : name === 'child_process' ? { execFileSync(_file, _args, options) {
                if (!options.env.AYPI_VERIFY_SQLITE_BINDING) return JSON.stringify({ abi: '132', platform: 'win32', arch: 'x64' });
                probes++; assert.equal(options.env.AYPI_VERIFY_SQLITE_BINDING, cached);
                if (nativeBroken) throw Error('Native ABI mismatch');
                return '';
            } } : require(name),
    };
    const preparation = fs.readFileSync(path.join(__dirname, 'prepare-forno-native.cjs'), 'utf8');
    vm.runInNewContext(preparation.slice(0, preparation.lastIndexOf('main().catch')) + '\nglobalThis.prepare = main;', context);
    await assert.rejects(context.prepare(), /Native ABI mismatch/);
    nativeBroken = false; await context.prepare(); assert.equal(probes, 2);
    console.log('OK: HTTP rejection severity, correlated private ERP diagnostics, SQL configuration, WebSocket endpoints, heartbeat recovery/timeout and cached native ABI checks.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
