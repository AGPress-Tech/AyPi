// Actual Electron windows/IPC/renderers; all ERP and supplier data are isolated fixtures.
const { app, BrowserWindow, Menu } = require('electron');
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '..'), folder = path.join(root, '.tmp-bar-navigation'); fs.mkdirSync(folder, { recursive: true }); app.setPath('userData', path.join(folder, 'profile-' + Date.now())); app.commandLine.appendSwitch('disable-gpu');
for (const m of ['show', 'focus', 'maximize']) BrowserWindow.prototype[m] = function () { };
const suppliers = [{ code: '0666', name: 'METALLURGICA SAN MARCO SPA', disabled: false }, { code: '0940', name: 'GAMBARI SRL', disabled: false }];
const contracts = suppliers.map((s, i) => ({ id: i + 1, line: 1, date: '2026-01-01', contract: `26/00${i + 1}/C`, supplierCode: s.code, supplier: s.name, item: 'BT000OA', description: 'BARRA OTTONE', quantity: 10000, price: 8, unit: 'KG', currency: 'EUR', closed: 0, lineClosed: 0 }));
const orders = [{ id: 20, line: 1, document: '26/ACQ', contractId: 1, contractLine: 1, supplierCode: '0666', item: 'BT042OA', description: 'BARRA 42', quantity: 1000, received: 100, unit: 'KG', closed: 0, lineClosed: 0, cancelled: 0, lineCancelled: 0 }];
const sale = { orderId: 500, orderNo: '26/VEND', orderDate: '2026-01-01', line: 1, article: 'BT042OA', description: 'Barra', quantity: 10, deliveredQuantity: 0, residual: 10, unit: 'KG', currency: 'EUR', customerCode: 'C1', customerName: 'Cliente', unitPrice: 10, netPrice: 10, netAmount: 100, delivered: 0, cancelled: 0, headerDelivered: 0, headerCancelled: 0 };
const settings = require('../backend-dist/modules/supplier-evaluation/model').defaultSupplierSettings();
const erpRequests = [];
require('../dist-ts/modules/file-manager/backend-client').requestAypiBackend = async (endpoint, options) => {
    const body = options?.body || {};
    if (endpoint === '/api/erp/explorer') {
        erpRequests.push(body);
        const header = body.dataset === 'purchaseOrders' && String(body.where?.PurchaseOrdId) === '20';
        const lines = body.dataset === 'purchaseLines' && String(body.where?.PurchaseOrdId) === '20';
        const rows = header ? [{ PurchaseOrdId: 20, InternalOrdNo: '26/ACQ', Supplier: '0666', OrderDate: '2026-01-01', Delivered: false }] : lines ? [{ PurchaseOrdId: 20, Line: 1, Item: 'BT042OA', Description: 'Barra 42', Qty: 1000, UoM: 'KG' }, { PurchaseOrdId: 20, Line: 2, Item: 'OTHER', Description: 'Altra voce dello stesso ordine', Qty: 10, UoM: 'KG' }] : [];
        const columns = lines ? [{ key: 'PurchaseOrdId', kind: 'number' }, { key: 'Line', kind: 'number' }, { key: 'Item', kind: 'text' }, { key: 'Description', kind: 'text' }, { key: 'Qty', kind: 'number' }, { key: 'UoM', kind: 'text' }] : [{ key: 'PurchaseOrdId', label: 'ID', kind: 'number' }, { key: 'InternalOrdNo', label: 'Ordine', kind: 'text' }, { key: 'Supplier', label: 'Fornitore', kind: 'text' }, { key: 'OrderDate', label: 'Data', kind: 'date' }, { key: 'Delivered', label: 'Evaso', kind: 'boolean' }];
        return { dataset: body.dataset, label: lines ? 'Voci ordine fornitore' : 'Ordini fornitori', columns, rows, total: rows.length, offset: 0, keys: lines ? ['PurchaseOrdId', 'Line'] : ['PurchaseOrdId'], relations: header ? [{ id: 'lines', label: 'Tutte le voci ordine', target: 'purchaseLines', map: { PurchaseOrdId: 'PurchaseOrdId' } }] : [], queriedAt: '2026-11-26T10:00:00Z' };
    }

    if (endpoint === '/api/erp/bar-contracts') return { contracts, orders, queriedAt: '2026-11-19T10:00:00Z' };
    if (endpoint.endsWith('/bar-contracts/suppliers')) return { suppliers };
    if (endpoint.endsWith('/article-orders')) { const rows = !body.articles?.length || body.articles.some(a => a.value === 'BT042OA') ? [sale] : []; return { rows, total: rows.length, offset: 0, queriedAt: '2026-11-19T10:00:00Z' }; }
    if (endpoint.endsWith('/article-offers')) return { rows: [], total: 0, offset: 0 };
    if (endpoint.endsWith('/bom-analysis')) return { rows: !body.bom && (!body.article || body.article === 'BT042OA') ? [{ bom: 'BOM1', component: 'BT042OA', line: 1, quantity: 1 }] : [], queriedAt: '2026-11-19T10:00:00Z' };
    if (endpoint.endsWith('/employees')) return { groups: { Ufficio: ['Operatore test'] } };
    if (endpoint.endsWith('/snapshot')) return { suppliers: suppliers.map(s => ({ ...s, id: 'erp:' + s.code, legacy: false })), records: [], profiles: [], attachments: [], settings, erpAvailable: true };
    if (endpoint.endsWith('/preferences')) return { preferences: body };
    throw Error('Unexpected endpoint ' + endpoint);
};
const run = (w, c) => w.webContents.executeJavaScript(c, true), find = page => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().split('?')[0].endsWith('/' + page));
const until = async f => { const start = Date.now(); while (Date.now() - start < 12000) { if (await f()) return; await new Promise(r => setTimeout(r, 30)); } throw Error('Timeout navigazione contratti barra'); };
Menu.setApplicationMenu(null); let menu = []; Menu.buildFromTemplate = items => ({ popup() { menu = items; } });
app.whenReady().then(async () => {
    const watchdog = setTimeout(() => app.exit(1), 60000), errors = []; app.on('web-contents-created', (_e, c) => c.on('console-message', (_e, l, m) => { if (l >= 3) errors.push(m); }));
    try {
        const main = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false } }); await main.loadURL('about:blank');
        require('../dist-ts/modules/analysis-navigation').registerAnalysisNavigation(main, () => '');
        require('../dist-ts/modules/bar-contracts/ipc').registerBarContractsIpc(main, () => '');
        require('../dist-ts/modules/article-orders/ipc').registerArticleOrdersIpc(main, () => '');
        require('../dist-ts/modules/bom-analysis/ipc').registerBomAnalysisIpc(main, () => '');
        require('../dist-ts/modules/erp-explorer/ipc').registerErpExplorerIpc(main, () => '');
        require('../dist-ts/modules/supplier-evaluation/ipc').registerSupplierEvaluationIpc(main, () => '');
        const open = async (target, context) => assert.equal((await run(main, `require('electron').ipcRenderer.invoke('analysis-navigate',${JSON.stringify({ target, context })})`)).ok, true);
        await open('bar-contracts'); await until(() => find('bar-contracts.html')); const bar = find('bar-contracts.html'); await until(() => run(bar, "document.querySelector('#contractCount').textContent==='2'"));
        const right = async (w, selector) => { menu = []; assert(await run(w, `!!document.querySelector(${JSON.stringify(selector)})`), selector); await run(w, `document.querySelector(${JSON.stringify(selector)})?.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))`); };
        // Only the clicked identity cell supplies context; quantities and purchase document IDs never become sales IDs.
        await right(bar, '#results td.numeric'); await new Promise(r => setTimeout(r, 80)); assert.equal(menu.length, 0);
        await right(bar, '#results td[data-analysis-supplier-code="0666"]'); await until(() => menu.length > 0); assert.deepEqual(menu.map(i => i.label), ['Analizza fornitore in Valutazione fornitori']); menu[0].click();
        await until(() => find('supplier-evaluation.html')); const supplier = find('supplier-evaluation.html'), supplierWindowId = supplier.id;
        await until(() => run(supplier, "document.querySelectorAll('#loginEmployee option').length>1")); assert.equal(await run(supplier, "document.querySelector('#loginDialog').open"), true);
        await run(supplier, "document.querySelector('#loginEmployee').value='Operatore test';document.querySelector('#loginForm').requestSubmit()"); await until(() => run(supplier, "document.querySelector('#supplierAnalysisTitle').textContent.includes('METALLURGICA SAN MARCO')"));
        await right(bar, '#results td[data-analysis-supplier-code="0940"]'); await until(() => menu.length > 0); menu[0].click(); await until(() => run(supplier, "document.querySelector('#supplierAnalysisTitle').textContent.includes('GAMBARI')")); assert.equal(find('supplier-evaluation.html').id, supplierWindowId);
        await run(bar, "document.querySelector('[data-expand-contract=\"1\"]').click()");
        await right(bar, '.contract-orders-row td[data-column=document]');
        await until(() => menu.some(item => item.label.includes('acquisto')));
        assert.equal(menu.length, 1); assert(!menu.some(item => /venduto|offerta/i.test(item.label)));
        assert.equal(await run(bar, "document.querySelector('.contract-orders-row td[data-column=document]').dataset.analysisPurchaseOrderId"), '20');
        menu[0].click(); await until(() => find('erp-explorer.html'));
        const explorer = find('erp-explorer.html'), explorerId = explorer.id;
        await until(() => run(explorer, "!!document.querySelector('.erp-view:not([hidden]) tbody tr')"));
        assert(erpRequests.some(request => request.dataset === 'purchaseOrders' && request.where?.PurchaseOrdId === '20'));
        assert.equal(find('article-orders.html'), undefined, 'Purchase orders must not open Venduto');
        await until(() => run(explorer, "document.querySelectorAll('.analysis-document-dialog .erp-nested tbody tr').length===2"));
        assert(await run(explorer, "document.querySelector('.analysis-document-dialog').textContent.includes('OTHER')"));
        assert.equal(await run(explorer, "document.querySelector('.analysis-document-dialog [data-erp-field=Delivered]').textContent"), 'No');
        await run(explorer, "document.querySelector('.analysis-document-dialog .dialog-actions button').click()");
        await until(() => run(explorer, "!document.querySelector('.analysis-document-dialog')"));
        const headerReads = erpRequests.filter(request => request.dataset==='purchaseOrders').length;
        await run(explorer, "document.querySelector('.erp-view:not([hidden]) [data-erp-document]').click()");
        await until(() => run(explorer, "document.querySelectorAll('.analysis-document-dialog .erp-nested tbody tr').length===2"));
        assert.equal(erpRequests.filter(request => request.dataset==='purchaseOrders').length, headerReads, 'Clicking the order number opens details without re-filtering the same page');
        assert(!await run(explorer, "!!document.querySelector('.analysis-document-dialog [data-context] button')"));
        await run(explorer, "document.querySelector('.analysis-document-dialog [data-search]').value='OTHER';document.querySelector('.analysis-document-dialog [data-reset]').click()");
        await until(() => erpRequests.at(-1).dataset==='purchaseLines');
        assert.deepEqual(erpRequests.at(-1).where, { PurchaseOrdId: 20 }, 'Reset keeps the exact order identity');
        assert.equal(await run(explorer, "document.querySelectorAll('.analysis-document-dialog').length"), 1);


        await run(bar, "document.querySelector('[data-contract=\"1\"]').click()");
        await right(bar, '#detailTable tbody td:first-child');
        await until(() => menu.some(item => item.label.includes('acquisto'))); menu.find(item => item.label.includes('acquisto')).click();
        await until(() => find('erp-explorer.html').id === explorerId);
        assert.equal(await run(bar, "document.querySelector('#contractDetail').open"), true);
        await right(bar, '#detailTable td[data-column=date]'); await new Promise(r => setTimeout(r, 80)); assert.equal(menu.length, 0);
        await right(bar, '#detailTable td[data-analysis-article="BT042OA"]'); await until(() => menu.some(i => i.label.includes('venduto'))); assert(menu.some(i => i.label.includes('distinte'))); assert(!menu.some(i => /Torneria|offerte|fornitore/.test(i.label))); menu.find(i => i.label.includes('venduto')).click();
        await until(() => find('article-orders.html')); const sold = find('article-orders.html'), soldId = sold.id; await until(() => run(sold, "document.querySelectorAll('#results [data-analysis-row]').length===1"));
        assert.equal(await run(bar, "document.querySelector('#contractDetail').open"), true); assert.equal(await run(bar, "document.querySelector('#contractCount').textContent"), '2');
        await right(bar, '#detailTable td[data-analysis-article="BT042OA"]'); await until(() => menu.some(i => i.label.includes('venduto'))); menu.find(i => i.label.includes('venduto')).click(); await until(() => find('article-orders.html').id === soldId);
        // Reverse navigation resolves the generic contract through its exact linked purchase order article.
        await right(sold, '#results td[data-analysis-field="article"]'); await until(() => menu.some(i => i.label.includes('contratti barra'))); menu.find(i => i.label.includes('contratti barra')).click(); await until(() => run(bar, "document.querySelector('#contractCount').textContent==='1'")); assert.equal(find('bar-contracts.html').id, bar.id); assert.equal(await run(bar, "document.querySelector('[data-field=item] [data-value]').value"), 'BT042OA');
        for (const theme of ['standard', 'bluearchive']) {
            await explorer.loadFile(path.join(root, 'dist-ts/pages/erp-explorer.html'), { query: { theme } });
            await open('erp-explorer', { purchaseOrderId: '20' });
            await until(() => run(explorer, "document.querySelectorAll('.analysis-document-dialog .erp-nested tbody tr').length===2"));
            assert.equal(await run(explorer, "document.querySelectorAll('.analysis-document-dialog').length"), 1);
            for (const [width,height] of [[1500,940],[1000,680]]) {
                explorer.setContentSize(width,height);
                await run(explorer, "new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))");
                const geometry=await run(explorer, "(()=>{const d=document.querySelector('.analysis-document-dialog').getBoundingClientRect();return {w:d.width,h:d.height,vw:innerWidth,vh:innerHeight,overflow:document.body.scrollWidth>innerWidth}})()");
                assert(geometry.w>=geometry.vw-40&&geometry.h>=geometry.vh-40&&!geometry.overflow,JSON.stringify(geometry));
                fs.writeFileSync(path.join(folder, `purchase-order-${theme}-${width}.png`),(await explorer.webContents.capturePage()).toPNG());
            }
        }
        // Unknown articles do not offer a contract destination.
        menu = []; await run(sold, "require('electron').ipcRenderer.invoke('analysis-context-menu',{article:'UNKNOWN'})"); assert(!menu.some(i => i.label.includes('contratti barra')));
        assert.deepEqual(errors, []); console.log('OK: dettaglio ordine acquisto diretto, tutte le voci, nessun ricaricamento circolare, contesto fisso su Azzera, due temi/dimensioni, menu per cella, articolo/fornitore, dati assenti, login con contesto pendente, riuso finestre, dettaglio mantenuto e ritorno ai contratti tramite articolo ordine.');
    } catch (e) { console.error(e); console.error(errors); process.exitCode = 1; } finally { clearTimeout(watchdog); for (const w of BrowserWindow.getAllWindows()) w.destroy(); app.exit(process.exitCode || 0); }
});
