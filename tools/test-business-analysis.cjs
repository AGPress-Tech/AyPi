const assert = require('node:assert/strict');
const { validateBusinessRequest, businessTableQuery, managerQuery } = require('../backend-dist/modules/analytics/business-analysis');
const { createAnalyticsService } = require('../backend-dist/modules/analytics/service');
const { managerFilters, managerStock } = require('../dist-ts/modules/analysis-manager-model');
const { overviewQuery, OVERVIEW_CHECKS } = require('../dist-ts/modules/analysis-overview-model');
const valid = { mode: 'prices', asOf: '2026-11-26' };
for (const bad of [{ ...valid, mode: 'sql' }, { ...valid, where: '1=1' }, { ...valid, asOf: '2026-02-30' }, { ...valid, limit: 1001 }, { ...valid, sort: [{ key: 'password', direction: 'asc' }] }, { ...valid, sort: [{ key: 'price', direction: 'desc; DROP TABLE' }] }]) assert.throws(() => validateBusinessRequest(bad));
const price = businessTableQuery({ ...valid, search: "A%_'", article: "A' OR 1=1--", sort: [{ key: 'article', direction: 'desc' }], currentOnly: true });
assert(!price.sql.includes("A' OR 1=1--")); assert(price.bindings.some(binding => binding.value === "A' OR 1=1--"));
assert(price.sql.includes('c.PriceList=p.PriceList AND c.CustSuppType=3211264'));
assert(price.sql.includes('MA_ItemCustomersPriceLists') && price.sql.includes('UNION ALL'));
assert(price.sql.includes('CAST(NULL AS varchar(8))'), 'Specific price currency must not be invented');
assert(price.sql.includes('headerFrom') && price.sql.includes('headerTo') && price.sql.includes('validTo>=@'));
assert.equal((price.sql.match(/\[article\] DESC/g) || []).length, 1);
const detailed = businessTableQuery({ ...valid, special: [{ name: 'Prezzo e scadenza', condition: { join: 'all', conditions: [{ field: 'price', op: 'range', value: '10', to: '20' }, { field: 'validTo', op: 'empty', value: '' }] } }] });
assert(detailed.bindings.some(binding => binding.type === 'number' && binding.value === 10));
assert(detailed.bindings.some(binding => binding.type === 'number' && binding.value === 20));
assert(detailed.sql.includes('CONVERT(date,[validTo]) IS NULL'));
assert(detailed.sql.indexOf('[price]>=@') < detailed.sql.indexOf('OFFSET'));
assert.throws(() => businessTableQuery({ ...valid, special: [{ name: 'Invalid', condition: { join: 'all', conditions: [{ field: 'password', op: 'exact', value: 'x' }] } }] }));
const commitments = businessTableQuery({ mode: 'commitments', asOf: valid.asOf, customerCode: 'C1' });
assert(commitments.sql.includes('d.Qty-d.DeliveredQty>0'));
for (const field of ['h.Cancelled', 'd.Cancelled', 'h.Delivered', 'd.Delivered']) assert(commitments.sql.includes(field));
assert(!commitments.sql.includes('OrderDate>=@'), 'Backlog must retain old orders');
const manager = managerQuery({ mode: 'manager', asOf: valid.asOf, from: '2024-01-01', to: valid.asOf });
assert(manager.sql.includes('PARTITION BY currency'));
assert(manager.sql.includes("NULLIF(LTRIM(RTRIM(Simulation)),'') IS NULL"));
assert(manager.sql.includes('lineAmount*residual/NULLIF(quantity,0)'));
assert(!/\b(?:UPDATE|DELETE|INSERT|DROP|EXEC)\b/i.test(manager.sql));
assert.throws(() => managerFilters({ from: '2026-02-30' }));
const stock = managerStock([
    { article: 'A', unit: 'KG', initial: 5, received: 0, issued: 6, owned: 1 },
    { article: 'A', unit: 'NR', initial: 2, received: 0, issued: 0, owned: 1 },
    { article: 'A', unit: 'KG', initial: 10, received: 0, issued: 0, owned: 0 },
    { article: 'B', unit: '', initial: null, received: 0, issued: 0 },
]);
assert.equal(stock.length, 4); assert.equal(stock.find(row => row.unit === 'KG' && row.ownership === 'Aziendale').quantity, -1);
assert.equal(stock.find(row => row.unit === 'KG' && row.ownership === 'Aziendale').negativePositions, 1);
assert.equal(stock.find(row => row.unit === 'U.M. non indicata').quantity, null);
for (const check of ['customer-prices', 'current-prices', 'customer-commitments', 'reserved-stock']) assert.equal(overviewQuery({ check }).check, check);
assert.equal(OVERVIEW_CHECKS['current-prices'].columns, OVERVIEW_CHECKS['customer-prices'].columns);
const seen = [];
class Pool { on() { return this; } async connect() { return this; } request() { return { input(name, type, value) { seen.push({ name, value }); }, async query(sql) {
    if (sql.includes('WITH OpenRows')) return { recordsets: [[{ orders: 1 }], [{ orders: 2 }], [{ currency: 'EUR', amount: 3.39 }], [], [], [], [], []] };
    return { recordset: [{ totalRows: '1', article: 'A', price: 0.123456789, validFrom: new Date('2026-01-01T00:00:00Z') }] };
} }; } async close() {} }
const service = createAnalyticsService(async () => ({ server: 'test', instance: '', database: 'test', user: 'test', password: 'test', encrypt: false, trustServerCertificate: true }), { ConnectionPool: Pool, VarChar: () => 'text', Date: 'date', Int: 'int', Float: 'float' });
(async () => {
    const data = await service.businessAnalysis({ ...valid, limit: 10 });
    assert.equal(data.total, 1); assert.equal(data.rows[0].price, 0.123456789); assert.equal(data.rows[0].validFrom, '2026-01-01');
    const dashboard = await service.businessAnalysis({ mode: 'manager', asOf: valid.asOf });
    assert.equal(dashboard.backlog[0].orders, 1); assert.equal(dashboard.monthly[0].currency, 'EUR'); assert.equal(dashboard.production.length, 0);
    assert(seen.some(binding => binding.name === 'asOf' && binding.value instanceof Date));
    await service.close();
    const { Router } = require('../backend-dist/shared/http/router'), { registerAnalyticsRoutes } = require('../backend-dist/modules/analytics/routes'), http = require('node:http');
    const router = new Router(); let calls = 0, failing = false;
    registerAnalyticsRoutes(router, { businessAnalysis: async input => { calls++; if (failing) throw Error('PRIVATE_SQL_DETAIL'); return { rows: [], total: 0, mode: input.mode }; } });
    const server = http.createServer((req, res) => void router.handle(req, res)); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
        const post = body => fetch(`http://127.0.0.1:${server.address().port}/api/erp/business-analysis`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        assert.equal((await post({ ...valid, sql: 'arbitrary' })).status, 400); assert.equal(calls, 0);
        const result = await post(valid); assert.equal(result.status, 200); assert.equal(result.headers.get('cache-control'), 'no-store');
        failing = true; const failure = await post(valid); assert.equal(failure.status, 503); assert(!(await failure.text()).includes('PRIVATE_SQL_DETAIL'));
    } finally { await new Promise(resolve => server.close(resolve)); }
    console.log('OK: business filters, bounded sorting, parameterized SQL, price sources/validity/currency, complete backlog, Manager grouping, stock ownership/units/nulls, service mapping and HTTP.');
})().catch(error => { console.error(error); process.exitCode = 1; });
