// The operator UI retains the original catalog; prices are part of the selected customer.
const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), XLSX = require('xlsx');
const root = path.resolve(__dirname, '..'), dir = path.join(root, '.tmp-customer-prices'); fs.mkdirSync(dir, { recursive: true });
app.setPath('userData', path.join(dir, 'profile')); app.commandLine.appendSwitch('disable-gpu');
for (const name of ['show', 'maximize', 'focus']) BrowserWindow.prototype[name] = function () {};
process.on('uncaughtException', error => { console.error(error); app.exit(1); }); process.on('unhandledRejection', error => { console.error(error); app.exit(1); });
const calls = [], fields = require('../dist-ts/modules/analysis-overview-model').OVERVIEW_CHECKS['customer-prices'].columns;
const { specialFilterMatcher } = require('../dist-ts/modules/analysis-special-filters');
const prices = Array.from({ length: 262 }, (_, i) => ({ source: 'Listino', priceList: 'L1', priceListName: 'Listino prova', customerCode: i === 261 ? 'C2' : 'C1', customerName: i === 261 ? 'Cliente Due' : 'Cliente Uno', article: `ART-${String(i).padStart(3, '0')}`, description: 'Articolo prova', minimumQuantity: i % 2 ? 10 : 20, unit: i % 2 ? 'KG' : 'NR', price: i + 0.123456789, currency: 'EUR', validFrom: '2026-01-01', validTo: i === 260 ? '2026-02-01' : null, status: i === 260 ? 'Scaduto' : 'In validità', discount1: 0, discount2: 0, discountFormula: '', taxIncluded: 'Esclusa' }));
require('../dist-ts/modules/file-manager/backend-client').requestAypiBackend = async (endpoint, options = {}) => {
    const query = options.body || {}; calls.push({ endpoint, query });
    if (endpoint.endsWith('/customer-search')) return { customers: [{ code: 'C1', name: 'Cliente Uno' }, { code: 'C2', name: 'Cliente Due' }] };
    if (endpoint.endsWith('/customer-analysis')) return { customer: query.customer, rows: [], queriedAt: '2026-11-26T10:00:00Z' };
    if (endpoint.endsWith('/business-analysis')) {
        assert.equal(query.mode, 'prices'); assert(query.customerCode, 'A customer constraint is mandatory');
        let rows = prices.filter(row => row.customerCode === query.customerCode && (!query.currentOnly || row.status === 'In validità') && (!query.search || row.article.includes(query.search))).filter(specialFilterMatcher(query.special, fields));
        if (query.sort?.[0]?.direction === 'desc') rows = [...rows].reverse();
        return { rows: rows.slice(query.offset || 0, (query.offset || 0) + (query.limit || 250)), total: rows.length, queriedAt: '2026-11-26T10:00:00Z' };
    }
    return { rows: [], total: 0 };
};
app.whenReady().then(async () => {
    const timeout = setTimeout(() => { console.error('Global timeout'); app.exit(1); }, 45000), errors = [];
    app.on('web-contents-created', (_, contents) => contents.on('console-message', (_, level, message) => { if (level >= 3) errors.push(message); }));
    const main = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false } });
    const run = (win, code) => win.webContents.executeJavaScript(code, true);
    const wait = async (win, code) => { for (let i = 0; i < 140; i++) { if (await run(win, code)) return; await new Promise(resolve => setTimeout(resolve, 40)); } throw Error('Timeout: ' + code); };
    try {
        await main.loadURL('about:blank');
        require('../dist-ts/modules/analysis-navigation').registerAnalysisNavigation(main, () => '');
        require('../dist-ts/modules/workstations').registerWorkstations(main, () => false, { request: async () => ({ version: 1, revision: 0, profiles: [{ id: 'default', name: 'Standard', rules: {} }] }) });
        require('../dist-ts/modules/customer-analysis/ipc').registerCustomerAnalysisIpc(main, () => '');
        await run(main, "require('electron').ipcRenderer.invoke('commercial-analysis-open')");
        const catalog = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('commercial-analysis.html'));
        assert.equal(await run(catalog, "document.querySelectorAll('[data-analysis]').length"), 7);
        assert.equal((await run(main, "require('electron').ipcRenderer.invoke('analysis-overview-open')")).ok, false);
        for (const target of ['manager', 'customer-commitments', 'customer-prices']) assert.equal((await run(main, `require('electron').ipcRenderer.invoke('analysis-navigate',{target:'${target}'})`)).ok, false);
        await run(main, "require('electron').ipcRenderer.invoke('analysis-navigate',{target:'customer-analysis',context:{customerCode:'C1'}})");
        for (let i = 0; i < 120 && !BrowserWindow.getAllWindows().some(win => win.webContents.getURL().includes('customer-analysis.html')); i++) await new Promise(resolve => setTimeout(resolve, 40));
        const customer = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('customer-analysis.html'));
        await wait(customer, "document.querySelector('#customerIdentity').textContent.includes('C1') && !document.querySelector('#refresh').disabled");
        assert.equal(calls.some(call => call.endpoint.endsWith('/business-analysis')), false);
        await run(customer, "document.querySelector('[data-view=prices]').click()");
        await wait(customer, "document.querySelectorAll('#customerPriceTable tbody tr').length===250 && !document.querySelector('[data-price-load]').disabled");
        assert.equal(await run(customer, "document.querySelector('#filters').hidden && document.querySelector('#kpis').hidden"), true);
        assert.equal(await run(customer, "document.querySelectorAll('#customerPriceTable th').length"), 8);
        await run(customer, "window.firstPrice=document.querySelector('#customerPriceTable tbody tr');const s=document.querySelector('.customer-price-scroll');s.scrollTop=s.scrollHeight;s.dispatchEvent(new Event('scroll'))");
        await wait(customer, "document.querySelectorAll('#customerPriceTable tbody tr').length===260");
        assert.equal(await run(customer, "window.firstPrice===document.querySelector('#customerPriceTable tbody tr')"), true);
        await run(customer, "(()=>{document.querySelector('.business-detailed-filters').open=true;document.querySelector('[data-filter-field=price]').open=true;const g=document.querySelector('[data-filter-field=price]');g.querySelector('[data-value]').value='100';g.querySelector('[data-to]').value='105';g.querySelector('[data-value]').dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('[data-price-load]').click()})()");
        await wait(customer, "document.querySelector('[data-price-progress]').textContent==='5 di 5 prezzi'");
        assert(calls.at(-1).query.special.length > 0);
        const output = path.join(dir, 'prices.xlsx'); dialog.showSaveDialog = async () => ({ canceled: false, filePath: output });
        await run(customer, "document.querySelector('#export').click()"); await wait(customer, "document.querySelector('[data-price-status]').textContent==='5 prezzi esportati.'");
        const book = XLSX.readFile(output), exported = XLSX.utils.sheet_to_json(book.Sheets['Listino cliente'], { header: 1 });
        assert.equal(exported.length, 6); assert.equal(exported[1][2], 100.123456789);
        await run(customer, "document.querySelector('[data-preset-name]').value='Prezzi 100-105';document.querySelector('[data-preset-save]').click()");
        await wait(customer, "document.querySelector('[data-preset-status]').textContent==='Preset salvato.'");
        await run(customer, "document.querySelector('[data-price-reset]').click()"); await wait(customer, "document.querySelectorAll('#customerPriceTable tbody tr').length===250");
        await run(customer, "document.querySelector('[data-preset-list]').value='0';document.querySelector('[data-preset-load]').click();document.querySelector('[data-price-load]').click()");
        await wait(customer, "document.querySelector('[data-price-progress]').textContent==='5 di 5 prezzi'");
        await run(customer, "(()=>{document.querySelector('.business-detailed-filters').open=true;document.querySelector('[data-filter-field=price]').open=true;const g=document.querySelector('[data-filter-field=price]');g.querySelector('[data-mode]').value='exclude';document.querySelector('[data-price-load]').click()})()");
        await wait(customer, "document.querySelector('[data-price-progress]').textContent.includes('di 255 prezzi')");
        await run(customer, "document.querySelector('[data-price-reset]').click()"); await wait(customer, "!document.querySelector('[data-price-load]').disabled");
        await run(customer, "document.querySelector('.business-detailed-filters').open=true;document.querySelector('[data-special-create]').click()");
        await wait(customer, "!!document.querySelector('.analysis-special-dialog[open]')");
        await run(customer, "document.querySelector('.analysis-special-dialog[open] [data-special-cancel]').click()");
        await run(customer, "document.querySelector('[data-price-scope]').value='customer-prices';document.querySelector('[data-price-load]').click()");
        await wait(customer, "document.querySelector('[data-price-progress]').textContent.includes('di 261 prezzi')");
        const forged = await run(customer, "require('electron').ipcRenderer.invoke('customer-prices-load',{check:'customer-prices',customerCode:'C2'})"); assert.equal(forged.ok, false);
        assert.equal((await run(main, "require('electron').ipcRenderer.invoke('customer-prices-load',{check:'customer-prices',customerCode:'C1'})")).ok, false);
        for (const theme of ['standard', 'bluearchive']) for (const [width, height] of [[1500, 940], [1050, 700]]) {
            customer.setContentSize(width, height); await run(customer, `document.documentElement.dataset.forgeTheme='${theme}';document.querySelector('.customer-price-scroll').scrollTop=0;document.querySelector('.business-detailed-filters').open=true;document.querySelector('[data-filter-field=price]').open=true;new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
            assert.equal(await run(customer, 'document.body.scrollWidth>innerWidth'), false);
            assert.equal(await run(customer, "(()=>{const r=document.querySelector('.business-filter-content').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight})()"), true);
            await customer.webContents.capturePage(); fs.writeFileSync(path.join(dir, `filters-${theme}-${width}.png`), (await customer.webContents.capturePage()).toPNG());
            await run(customer, "document.querySelector('#customerIdentity').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))");
            assert.equal(await run(customer, "document.querySelector('.business-detailed-filters').open"), false);
        }
        await run(customer, "document.querySelector('[data-view=documents]').click()"); assert.equal(await run(customer, "document.querySelector('#filters').hidden"), false);
        await run(main, "require('electron').ipcRenderer.invoke('analysis-navigate',{target:'customer-analysis',context:{customerCode:'C2'}})");
        await wait(customer, "document.querySelector('#customerIdentity').textContent.includes('C2') && !document.querySelector('#refresh').disabled");
        await run(customer, "document.querySelector('[data-view=prices]').click()"); await wait(customer, "document.querySelector('[data-price-progress]').textContent==='1 di 1 prezzi'");
        assert.equal(await run(customer, "document.querySelector('#customerPriceTable tbody').textContent.includes('ART-261')"), true);
        assert.deepEqual(errors, []); console.log('OK: simple seven-module catalog, disabled managerial entrypoints, customer-only prices, full standard/advanced filters, exclusions, presets, full export, lazy append, customer isolation and both themes/sizes.');
        clearTimeout(timeout); BrowserWindow.getAllWindows().forEach(win => win.destroy()); app.exit(0);
    } catch (error) { console.error(error, errors); app.exit(1); }
});
