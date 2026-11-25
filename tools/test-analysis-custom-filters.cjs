const assert = require('node:assert/strict');
const client = require('../dist-ts/modules/analysis-special-filters');
const backend = require('../backend-dist/modules/analytics/special-filters');
const group = (join, ...conditions) => ({ join, conditions });
const rule = (field, op, value = '', to) => ({ field, op, value, ...(to === undefined ? {} : { to }) });
const fields = [{ key: 'article', label: 'Articolo', kind: 'text' }, { key: 'quantity', label: 'Quantita', kind: 'number' }, { key: 'netPrice', label: 'Prezzo', kind: 'money' }];
const filters = [{ name: 'Composto', condition: group('all', rule('article', 'prefix', 'A'), group('any', rule('quantity', 'gte', '5'), rule('netPrice', 'lt', '2.123456789'))) }];
const rows = [{ article: 'A1', quantity: 1, netPrice: 1 }, { article: 'A2', quantity: 6, netPrice: 9 }, { article: 'A3', quantity: 2, netPrice: 5 }, { article: 'B1', quantity: 9, netPrice: 1 }];
assert.deepEqual(rows.filter(client.specialFilterMatcher(filters, fields)), rows.slice(0, 2));
assert.deepEqual(rows.filter(backend.specialRecordMatcher(filters, fields)), rows.slice(0, 2));
assert.deepEqual(rows.filter(client.specialFilterMatcher([{ ...filters[0], exclude: true }], fields)), rows.slice(2));
assert.equal(rows.filter(client.specialFilterMatcher([{ ...filters[0], enabled: false }], fields)).length, 4);
const { buildArticleOrderQuery } = require('../backend-dist/modules/analytics/article-orders');
const { buildArticleOfferQuery } = require('../backend-dist/modules/analytics/article-offers');
for (const empty of [buildArticleOrderQuery({}), buildArticleOrderQuery({ includeCancelled: true }), buildArticleOfferQuery({})]) {
    assert(!/WHERE\s+ORDER BY/.test(empty.sql), 'An empty selection must generate valid SQL');
    assert(empty.sql.includes('COUNT_BIG(*) OVER()'));
    assert(empty.sql.includes('OFFSET @p'));
    assert.equal(empty.filters.articles.length, 0);
}
const sql = buildArticleOrderQuery({ special: filters });
assert(sql.sql.includes(' AND ') && sql.sql.includes(' OR '));
assert(sql.bindings.some(b => b.value === 2.123456789));
assert(sql.sql.indexOf('[quantity]>=') < sql.sql.indexOf(' OFFSET '));
const payload = "a%' OR 1=1 --";
const injected = buildArticleOrderQuery({ special: [{ name: 'Test', condition: group('all', rule('article', 'contains', payload)) }] });
assert(!injected.sql.includes(payload));
assert(injected.bindings.some(b => b.value.includes && b.value.includes('OR 1=1')));
assert(buildArticleOfferQuery({ special: [{ name: 'Data', condition: group('all', rule('offerDate', 'gte', '2024-01-01')) }] }).sql.includes('[offerDate]>='));
assert.throws(() => buildArticleOrderQuery({ special: [{ name: 'Campo', condition: group('all', rule('unknown', 'exact', 'A')) }] }));
assert.throws(() => backend.validateStoredSpecialFilters([{ name: 'Vuoto', condition: group('all') }]));
assert.throws(() => backend.validateStoredSpecialFilters([{ name: 'Profondo', condition: group('all', group('all', group('all', group('all', rule('article', 'exact', 'A'))))) }]));

const native = [{ name: 'Esclusione', exclude: true, condition: group('any', rule('code', 'contains', 'X'), rule('code', 'prefix', 'Z')) }];
const base = { special: native, departments: [], machines: [], kind: '', from: '2024-01-01', to: '2026-12-31', text: '', rules: [] };
const maintenance = require('../backend-dist/modules/maintenance/preferences');
const measurement = require('../backend-dist/modules/measurement-instruments/preferences');
for (const validate of [maintenance.validateMaintenancePreferences, measurement.validatePreferences]) {
    const saved = validate({ filterPresets: [{ name: 'Composto', view: 'dashboard', filters: base }], columns: {} });
    assert.deepEqual(saved.filterPresets[0].filters.special, native);
}
const tooling = require('../backend-dist/modules/tooling/workspace');
assert.deepEqual(tooling.validateWorkspace({ filterPresets: [{ name: 'Composto', filters: base }] }).filterPresets[0].filters.special, native);
const { recentAnalysisYears } = require('../dist-ts/modules/analysis-filter-modes');
assert.deepEqual(recentAnalysisYears(new Date(2026, 0, 1)), [2024, 2025, 2026]);
assert.deepEqual(recentAnalysisYears(new Date(2027, 0, 1)), [2025, 2026, 2027]);
console.log('OK: nested E/O, exclusions, disabled filters, money precision, server agreement, parameterized SQL, invalid AST, native preset round trips and calendar-year defaults.');
