const assert = require('node:assert/strict');
const { readErpExplorer, validateExplorerRequest } = require('../backend-dist/modules/analytics/erp-explorer');
const { documentLinesQuery } = require('../backend-dist/modules/analytics/document-lines');
const model = require('../dist-ts/modules/erp-explorer/model');
const { validateAnalysisContext } = require('../dist-ts/modules/analysis-navigation-model');
const definitions = {
    MA_CustSupp: { CustSupp: 'varchar', CustSuppType: 'int', CompanyName: 'varchar', Disabled: 'bit', ExtraERP: 'nvarchar' },
    MA_CustSuppBranches: { CustSupp: 'varchar', CustSuppType: 'int', Branch: 'varchar', Address: 'nvarchar' },
    MA_Items: { Item: 'varchar', Description: 'varchar', BaseUoM: 'varchar' },
    MA_SaleOrd: { SaleOrdId: 'int', Customer: 'varchar', CustSuppType: 'int', InternalOrdNo: 'varchar', OrderDate: 'datetime' },
    MA_SaleOrdDetails: { SaleOrdId: 'int', Line: 'int', SubId: 'int', Item: 'varchar', Qty: 'decimal' },
    MA_PurchaseOrd: { PurchaseOrdId: 'int', Supplier: 'varchar', InternalOrdNo: 'varchar', OrderDate: 'datetime' },
    MA_PurchaseOrdDetails: { PurchaseOrdId: 'int', Line: 'int', Item: 'varchar', SuppQuotaId: 'int', Qty: 'decimal' },
    MA_SuppQuotas: { SuppQuotaId: 'int', Supplier: 'varchar', QuotationNo: 'varchar', QuotationDate: 'datetime' },
    MA_SuppQuotasDetail: { SuppQuotaId: 'int', Line: 'int', Item: 'varchar', Qty: 'decimal' },
    MA_ItemsStorageQty: { Item: 'varchar', Storage: 'varchar', FiscalYear: 'int', FiscalPeriod: 'int', InitialQty: 'decimal', ReceivedQty: 'decimal', IssuedQty: 'decimal', ReservedSaleOrd: 'decimal', ReservedByProd: 'decimal', OrderedPurchOrd: 'decimal', OrderedToProd: 'decimal' },
};
const metadata = Object.entries(definitions).flatMap(([tableName, fields]) => Object.entries(fields).map(([columnName, typeName], i) => ({ tableName, columnName, typeName, ordinal: i + 1, primaryOrdinal: i === 0 ? 1 : 0 })));
const fk = [
    { relationId: 77, childTable: 'MA_CustSuppBranches', parentTable: 'MA_CustSupp', childColumn: 'CustSupp', parentColumn: 'CustSupp', keyOrdinal: 1 },
    { relationId: 77, childTable: 'MA_CustSuppBranches', parentTable: 'MA_CustSupp', childColumn: 'CustSuppType', parentColumn: 'CustSuppType', keyOrdinal: 2 },
];
let calls = [];
const connection = { request() { const bindings = []; return { input(name, type, value) { bindings.push({ name, type, value }); return this; }, async query(sql) {
    calls.push({ sql, bindings });
    if (sql.includes('FROM sys.tables')) return { recordset: metadata, recordsets: [metadata, fk] };
    if (sql.includes('MA_ItemsStorageQty')) return { recordset: [{ Item: 'A', Storage: 'S1', FiscalYear: 2026, FiscalPeriod: 1, _Quantity: 5, _Available: 2, __total: 1 }], recordsets: [[], [{ year: 2026, period: 1 }]] };
    return { recordset: [{ CustSupp: '0001', CustSuppType: 3211264, CompanyName: 'Cliente', ExtraERP: 'Conservato', __total: 1 }] };
} }; } };
const driver = { Int: 'int', Float: 'float', Date: 'date', NVarChar: n => 'nvarchar' + n };
(async () => {
    const customers = await readErpExplorer(connection, driver, { dataset: 'customers' });
    assert.equal(customers.rows[0].CustSupp, '0001');
    assert(customers.columns.some(c => c.key === 'ExtraERP'));
    assert(customers.relations.some(r => r.target === 'orders'));
    const branch = customers.relations.find(r => r.target === 'related-77'); assert(branch);
    assert.deepEqual(branch.map, { CustSupp: 'CustSupp', CustSuppType: 'CustSuppType' }, 'Composite identity keeps customers and suppliers distinct');
    assert(calls.at(-1).bindings.some(b => b.value === 3211264));
    const payload = "x%' OR 1=1 --";
    await readErpExplorer(connection, driver, { dataset: 'suppliers', search: payload, where: { CustSupp: '0001' }, sort: [{ key: 'CompanyName', direction: 'desc' }], offset: 250 });
    assert(!calls.at(-1).sql.includes(payload)); assert(calls.at(-1).bindings.some(b => b.value === 3211265)); assert(calls.at(-1).bindings.some(b => b.value === 250));
    assert(calls.at(-1).sql.includes('Data.[CompanyName] DESC,Data.[CustSupp] ASC'));
    await readErpExplorer(connection, driver, { dataset: branch.target, where: { CustSupp: '0001', CustSuppType: 3211264 } });
    assert(calls.at(-1).sql.includes('dbo.[MA_CustSuppBranches]'));
    const stock = await readErpExplorer(connection, driver, { dataset: 'stock' });
    assert.deepEqual(stock.period, { year: 2026, period: 1 });
    assert(calls.at(-1).sql.includes('q.FiscalYear=@selectedYear AND q.FiscalPeriod=@selectedPeriod'));
    assert(calls.at(-1).sql.includes('q.InitialQty+q.ReceivedQty-q.IssuedQty'));
    assert(stock.columns.some(c => c.key === '_Unit'));
    assert(!stock.relations.some(r => r.target.startsWith('production')), 'An unverified production table must not be offered');
    assert(!stock.columns.some(c => c.label === 'Prodotta'), 'Received stock is not labelled as production');
    const group = { name: 'Composto', condition: { join: 'any', conditions: [{ field: 'Qty', op: 'gte', value: '2.123456789' }, { field: 'Item', op: 'prefix', value: 'A' }] } };
    await readErpExplorer(connection, driver, { dataset: 'saleLines', special: [group] });
    assert(calls.at(-1).bindings.some(b => b.value === 2.123456789));
    assert(calls.at(-1).sql.indexOf('[Qty]>=') < calls.at(-1).sql.indexOf(' OFFSET '));
    const before = calls.length;
    await assert.rejects(readErpExplorer(connection, driver, { dataset: 'customers', sort: [{ key: 'CustSupp;DROP TABLE X', direction: 'asc' }] }));
    assert.equal(calls.length, before);
    for (const request of [{ dataset: 'sys.tables' }, { dataset: '__proto__' }, { dataset: 'orders', limit: 2000 }, { dataset: 'orders', where: { Customer: null } }]) assert.throws(() => validateExplorerRequest(request));
    await assert.rejects(readErpExplorer(connection, driver, { dataset: 'related-999' }));
    assert.equal(calls.filter(c => c.sql.includes('FROM sys.tables')).length, 1, 'Schema is cached');
    assert.deepEqual(model.ERP_BLOCKS.map(b => b.id), ['customers', 'suppliers', 'articles', 'contracts', 'orders', 'stock']);
    assert.deepEqual(model.explorerCellContext('purchaseOrders', { PurchaseOrdId: 42, InternalOrdNo: 'PO-1' }, 'InternalOrdNo'), { purchaseOrderId: '42' });
    assert.equal(model.explorerCellContext('saleLines', { SaleOrdId: 42, Item: 'A', Qty: 10 }, 'Qty'), null);
    assert.deepEqual(model.explorerContextRequest({ purchaseOrderId: '42' }), { dataset: 'purchaseOrders', where: { PurchaseOrdId: '42' } });
    const presentation = require('../dist-ts/modules/erp-explorer/presentation');
    assert.deepEqual(presentation.explorerColumns('customers', customers.columns).map(c => c.key), ['CustSupp', 'CompanyName', 'Disabled']);
    assert.equal(presentation.formatExplorerValue('40.694999999999936', {kind:'number'}), '40,695');
    assert.equal(presentation.formatExplorerValue('-0.0000000000001', {kind:'number'}), '0');
    assert.equal(presentation.formatExplorerValue('123456789012345678.123456', {kind:'number'}), '123.456.789.012.345.678,123');
    assert.equal(presentation.formatExplorerValue('999.9999', {kind:'number'}), (1000n).toLocaleString('it-IT'));
    assert.equal(presentation.formatExplorerValue('0001', {kind:'text'}), '0001');
    assert.deepEqual(presentation.explorerRelations([{target:'related-77',label:'Dati aggiuntivi · Internal'},{target:'orders',label:'Ordini'},{target:'related-88',label:'Contatti'}]).map(r=>r.label), ['Ordini','Contatti']);
    assert.deepEqual(model.explorerCellContext('saleLines', {SaleOrdId:42,_DocumentNo:'ORD-42'}, '_DocumentNo'), {documentId:'42',documentNo:'ORD-42',documentKind:'order'});
    await readErpExplorer(connection, driver, { dataset: 'orders' });
    assert(calls.at(-1).sql.includes('party.CustSuppType=3211264'));
    await readErpExplorer(connection, driver, { dataset: 'saleLines' });
    assert(calls.at(-1).sql.includes('header.[SaleOrdId]=q.[SaleOrdId]'));
    assert.throws(() => validateAnalysisContext({ purchaseOrderId: '1 OR 1=1' }));
    const own = documentLinesQuery({ kind: 'order', id: 42 });
    assert.equal(own.bindings[0].value, 42); assert(own.sql.includes('WHERE h.SaleOrdId=@id')); assert(!own.sql.includes('NULLIF')); assert(!own.sql.includes('NOT LIKE')); assert(own.sql.includes('d.TaxableAmount AS netAmount'));
    assert.throws(() => documentLinesQuery({ kind: 'purchase', id: 42 }));
    assert.throws(() => documentLinesQuery({ kind: 'order', id: '42' }));
    const http = require('node:http');
    const { Router } = require('../backend-dist/shared/http/router');
    const router = new Router();
    require('../backend-dist/modules/analytics/routes').registerAnalyticsRoutes(router, {
        erpExplorer: input => readErpExplorer(connection, driver, input),
        documentLines: async input => ({ rows: [{ documentId: input.id, article: 'OTHER' }] }),
    });
    const server = http.createServer(async (req, res) => { try { await router.handle(req, res); } catch { res.statusCode = 500; res.end(); } });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
        const url = 'http://127.0.0.1:' + server.address().port;
        const post = (route, body) => fetch(url + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        assert.equal((await post('/api/erp/explorer', { dataset: 'sys.tables' })).status, 400);
        const response = await post('/api/erp/explorer', { dataset: 'customers' }); assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store'); assert.equal((await response.json()).total, 1);
        assert.equal((await post('/api/erp/document-lines', { kind: 'purchase', id: 42 })).status, 400);
        assert.equal((await post('/api/erp/document-lines', { kind: 'order', id: 42 })).status, 200);
    } finally { await new Promise(resolve => server.close(resolve)); }
    console.log('OK: full ERP scalar fields, six blocks, metadata-verified composite subcategories, schema cache, precise identities, parameterized search/sorting, stock periods/quantities, custom conditions and complete own document lines.');
})().catch(error => { console.error(error); process.exitCode = 1; });
