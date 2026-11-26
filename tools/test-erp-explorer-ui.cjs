const { app, BrowserWindow, ipcMain, dialog, Menu, session } = require('electron');
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os'), XLSX = require('xlsx');
const root = path.resolve(__dirname, '..'), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aypi-erp-ui-'));
app.setPath('userData', path.join(dir, 'profile')); app.commandLine.appendSwitch('disable-gpu');
const C = (key, label = key, kind = 'text') => ({ key, label, kind });
const customers = Array.from({ length: 603 }, (_, i) => ({ CustSupp: String(i).padStart(4, '0'), CustSuppType: 3211264, CompanyName: 'Cliente ' + i, TaxIdNumber: 'IVA-' + i, City: 'Città', ExtraERP: '<dettaglio completo>', CreditLimit: '123456789012345678.123456' }));
const columns = {
    customers: [C('CustSupp', 'Codice'), C('CustSuppType', 'Tipo', 'number'), C('CompanyName', 'Ragione sociale'), C('TaxIdNumber', 'Partita IVA'), C('City', 'Città'), C('ExtraERP', 'Dato aggiuntivo'), C('CreditLimit', 'Fido', 'number')],
    suppliers: [C('CustSupp', 'Codice'), C('CompanyName', 'Ragione sociale'), C('CustSuppType', 'Tipo', 'number')],
    articles: [C('Item', 'Articolo'), C('Description', 'Descrizione'), C('BaseUoM', 'U.M.'), C('Disabled', 'Disattivato', 'boolean')],
    contracts: [C('SuppQuotaId', 'ID', 'number'), C('QuotationNo', 'Contratto'), C('Supplier', 'Fornitore'), C('QuotationDate', 'Data', 'date')],
    orders: [C('SaleOrdId', 'ID', 'number'), C('InternalOrdNo', 'Ordine'), C('Customer', 'Cliente'), C('OrderDate', 'Data', 'date')],
    purchaseOrders: [C('PurchaseOrdId', 'ID', 'number'), C('InternalOrdNo', 'Ordine fornitore'), C('Supplier', 'Fornitore'), C('OrderDate', 'Data', 'date')],
    offers: [C('CustQuotaId', 'ID', 'number'), C('QuotationNo', 'Offerta'), C('Customer', 'Cliente')],
    stock: [C('Item', 'Articolo'), C('_Description', 'Descrizione articolo'), C('Storage', 'Magazzino'), C('_Available','Disponibile','number'), C('_Unit', 'U.M.'), C('_Quantity', 'Giacenza', 'number'), C('ReservedSaleOrd', 'Impegnata clienti', 'number'), C('OrderedToProd', 'Ordinata produzione', 'number'), C('FiscalYear', 'Esercizio', 'number'), C('FiscalPeriod', 'Periodo', 'number')],
    saleLines: [C('SaleOrdId', 'Ordine', 'number'), C('Item', 'Articolo'), C('Qty', 'Quantità', 'number')],
};
const data = {
    customers, suppliers: [{ CustSupp: '0000', CompanyName: 'Fornitore', CustSuppType: 3211265 }],
    articles: [{ Item: 'A1', Description: 'Articolo demo', BaseUoM: 'NR', Disabled: false }],
    contracts: [{ SuppQuotaId: 5, QuotationNo: '26/1/C', Supplier: '0000', QuotationDate: '2026-01-01' }],
    orders: [{ SaleOrdId: 7, InternalOrdNo: 'ORD-7', Customer: '0000', OrderDate: '2026-01-01' }],
    purchaseOrders: [{ PurchaseOrdId: 7, InternalOrdNo: 'ACQ-7', Supplier: '0000', OrderDate: '2026-01-01' }],
    offers: [{ CustQuotaId: 8, QuotationNo: 'OFF-8', Customer: '0000' }],
    stock: [{ Item: 'A1', _Description: 'Articolo demo', Storage: 'S1', _Available: '1.123456789123456789', _Unit: 'NR', _Quantity: '2.123456789123456789', ReservedSaleOrd: 1, OrderedToProd: 5, FiscalYear: 2026, FiscalPeriod: 1 }],
    saleLines: [{ SaleOrdId: 7, Item: 'A1', Qty: 2 }, { SaleOrdId: 7, Item: 'OTHER', Qty: 3 }],
};
let queries = [], ownCalls = 0, linkedCalls = 0, menus = [], exportPath = path.join(dir, 'dati.xlsx');
const ownRows = [
    { kind: 'order', documentId: 7, documentNo: 'ORD-7', line: 1, article: 'A1', description: 'Prima voce', quantity: 3390.0000000000005, deliveredQuantity: 3738.9000000000005, residual: -0.00001, unit: 'NR', unitPrice: 2.123456789, netPrice: 2, netAmount: 4, currency: 'EUR' },
    { kind: 'order', documentId: 7, documentNo: 'ORD-7', line: 2, article: 'OTHER', description: 'Altra voce', quantity: 3, deliveredQuantity: 0, residual: 3, unit: 'KG', unitPrice: 4, netPrice: 3, netAmount: 9, currency: 'EUR' },
    { kind: 'order', documentId: 7, documentNo: 'ORD-7', line: 3, article: '', description: 'Nota del documento', quantity: null, unit: '', netAmount: null },
];
require('../dist-ts/modules/file-manager/backend-client').requestAypiBackend = async (url, options) => {
    if (url === '/api/erp/explorer') {
        const q = options.body; queries.push(JSON.parse(JSON.stringify(q)));
        let rows = (data[q.dataset] || []).filter(row => Object.entries(q.where || {}).every(([key, value]) => String(row[key]) === String(value)));
        if (q.search) rows = rows.filter(row => Object.values(row).some(value => String(value).toLowerCase().includes(q.search.toLowerCase())));
        if (q.special?.length) rows = rows.filter(require('../dist-ts/modules/analysis-special-filters').specialFilterMatcher(q.special, columns[q.dataset]));
        const total = rows.length, offset = q.offset || 0; rows = rows.slice(offset, offset + (q.limit || 250));
        return { dataset: q.dataset, label: ({customers:'Anagrafiche clienti',suppliers:'Anagrafica fornitori',articles:'Articoli',stock:'Magazzino',orders:'Ordini clienti'})[q.dataset] || q.dataset, columns: columns[q.dataset] || [], keys: [columns[q.dataset]?.[0].key], rows, total, offset, queriedAt: '2026-11-25T09:00:00Z', period: q.dataset === 'stock' ? { year: 2026, period: 1 } : undefined, relations: q.dataset === 'customers' ? [{ id: 'orders', label: 'Ordini del cliente', target: 'orders', map: { CustSupp: 'Customer' } }] : q.dataset === 'orders' ? [{ id: 'lines', label: 'Voci dell’ordine', target: 'saleLines', map: { SaleOrdId: 'SaleOrdId' } }] : [] };
    }
    if (url === '/api/erp/document-lines') { ownCalls++; return { rows: ownRows, queriedAt: '2026-11-25T09:00:00Z' }; }
    if (url === '/api/erp/document-links') { linkedCalls++; return { rows: [{ ...ownRows[0], kind: 'offer', documentId: 8, documentNo: 'OFF-8', customerCode: '0000', customerName: 'Cliente', customerType: 'Cliente' }] }; }
    if (url === '/api/erp/article-orders') return { rows: [{ orderId: 7, orderNo: 'ORD-7', orderDate: '2026-01-01', article: 'A1', description: 'Prima voce', line: 1, quantity: 3390.0000000000005, unit: 'NR', residual: 1, currency: 'EUR' }, { orderId: 9, orderNo: 'ORD-9', orderDate: '2026-01-02', article: 'A1', description: 'Voce successiva', line: 1, quantity: 1, unit: 'NR', residual: 1, currency: 'EUR' }], total: 2, queriedAt: '2026-11-25T09:00:00Z' };
    if (url === '/api/erp/stock-customer-commitments') return { rows: [], queriedAt: '2026-11-25T09:00:00Z' };
    throw Error('Unexpected request ' + url);
};
app.whenReady().then(async () => {
    const watchdog = setTimeout(() => { console.error('ERP UI timeout'); app.exit(1); }, 120000);
    let win, sales;
    try {
        session.defaultSession.webRequest.onBeforeRequest({ urls: ['https://*/*'] }, (_r, callback) => callback({ cancel: true }));
        const main = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false } }); await main.loadURL('about:blank');
        const navigation = require('../dist-ts/modules/analysis-navigation'); navigation.registerAnalysisNavigation(main, () => '');
        require('../dist-ts/modules/erp-explorer/ipc').registerErpExplorerIpc(main, () => '');
        require('../dist-ts/modules/article-orders/ipc').registerArticleOrdersIpc(main, () => '');
        require('../dist-ts/modules/login-preferences').registerLoginPreferencesIpc();
        ipcMain.handle('workstations-get', () => ({ config: { version: 1, activeId: '', profiles: [] } }));
        Menu.buildFromTemplate = items => { menus.push(items); return { popup() {} }; };
        dialog.showSaveDialog = async () => ({ canceled: false, filePath: exportPath });
        const run = (target, code) => target.webContents.executeJavaScript('{' + code + '}', true);
        const wait = async (target, expression) => { const start = Date.now(); while (Date.now() - start < 12000) { if (await run(target, expression)) return; await new Promise(resolve => setTimeout(resolve, 30)); } throw Error('Timeout ' + expression); };
        assert.equal((await run(main, "require('electron').ipcRenderer.invoke('analysis-navigate',{target:'erp-explorer'})")).ok, true);
        for (let i = 0; i < 200 && !win; i++) { win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('erp-explorer.html')); if (!win) await new Promise(resolve => setTimeout(resolve, 25)); } assert(win);
        win.unmaximize(); await new Promise(resolve => setTimeout(resolve, 60)); win.setContentSize(1500, 940);
        const errors = []; win.webContents.on('console-message', (_e, level, message) => { if (level >= 3) errors.push(message); });
        await wait(win, "document.querySelector('.erp-view table tbody tr') && !document.querySelector('#export').disabled");
        assert.equal((await run(main, "require('electron').ipcRenderer.invoke('erp-explorer-query',{dataset:'customers'})")).ok, false, 'Reject a forged window');
        assert.equal(await run(win, "document.querySelectorAll('#blocks button').length"), 6);
        assert.equal(await run(win, "document.querySelector('.erp-view tbody tr td').textContent.includes('0000')"), true);
        await run(win, "window.firstRow=document.querySelector('.erp-view tbody tr');document.querySelector('.erp-expand').click()");
        assert(await run(win, "!document.querySelector('.erp-record-details').textContent.includes('<dettaglio completo>')"), "Technical fields stay out of details");
        assert(await run(win, "!!document.querySelector('.erp-detail-row.analysis-expanded-detail') && !!document.querySelector('.analysis-expanded-source')"));
        assert(await run(win, "![...document.querySelectorAll('.erp-view [data-columns] input')].some(c=>['CustSuppType','CreditLimit','ExtraERP'].includes(c.dataset.key))"), "Column picker offers useful business fields only");
        await run(win, "const scroll=document.querySelector('.erp-view>.erp-results>.table-scroll');scroll.scrollTop=scroll.scrollHeight;scroll.dispatchEvent(new Event('scroll'))");
        await wait(win, "document.querySelectorAll('.erp-view>.erp-results>.table-scroll>.erp-table>tbody>tr:not(.erp-detail-row)').length>=500");
        assert(await run(win, "window.firstRow===document.querySelector('.erp-view tbody tr') && !!document.querySelector('.erp-detail-row')"));
        await run(win, "const d=[...document.querySelectorAll('.erp-record-details>details')].find(d=>d.querySelector('summary').textContent==='Ordini del cliente');d.open=true");
        await wait(win, "!!document.querySelector('.erp-nested table tbody tr')");
        assert(queries.some(q => q.dataset === 'orders' && q.where.Customer === '0000' && !q.from));
        await run(win, "document.querySelector('.erp-view>.filter-panel [data-save]').click()"); // Empty name must be handled in-panel.
        await run(win, "document.querySelector('.erp-view .columns-picker').open=true;const c=document.querySelector('.erp-view [data-columns] [data-key=TaxIdNumber]');c.checked=true;c.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('.erp-view .columns-picker').open=false;document.querySelector('#export').click()");
        await wait(win, "!document.querySelector('#export').disabled");
        const workbook = XLSX.readFile(exportPath); assert.equal(XLSX.utils.sheet_to_json(workbook.Sheets.Dati).length, 603); assert.equal(workbook.Sheets.Dati.A2.t, 's');
        const headers = XLSX.utils.sheet_to_json(workbook.Sheets.Dati, { header: 1 })[0], tax = headers.indexOf('Partita IVA'); assert.equal(workbook.Sheets.Dati[XLSX.utils.encode_cell({ r: 1, c: tax })].v, 'IVA-0'); assert(!headers.includes('Fido'));
        await run(win, "document.querySelector('[data-block=orders]').click()"); await wait(win, "!!document.querySelector('.erp-view:not([hidden]) [data-document-id]')");
        assert(queries.some(q => q.dataset === 'orders' && q.from === '2024-01-01'));
        const beforeOwn = ownCalls, beforeLinked = linkedCalls;
        await run(win, "document.querySelector('.erp-view:not([hidden]) [data-document-id]').click()");
        await wait(win, "document.querySelector('.analysis-document-dialog [data-own-lines] table') && document.querySelector('.analysis-document-dialog .linked-document')");
        assert.equal(ownCalls, beforeOwn + 1); assert.equal(linkedCalls, beforeLinked + 1);
        assert(await run(win, "document.querySelector('.analysis-document-dialog [data-own-lines]').textContent.includes('Nota del documento')"));
        await run(win, "document.querySelector('.analysis-document-dialog .dialog-actions button').click()");
        for (const theme of ['standard', 'bluearchive']) {
            await win.loadFile(path.join(root, 'dist-ts/pages/erp-explorer.html'), { query: { theme } });
            await wait(win, "!document.querySelector('#export').disabled && !!document.querySelector('.erp-view tbody tr')");
            await run(win, "document.querySelector('[data-block=stock]').click()"); await wait(win, "document.querySelector('.erp-view:not([hidden]) [data-progress]').textContent.includes('2026 / 1')");
            assert(await run(win, "document.querySelector('.erp-view:not([hidden]) table').textContent.includes('2,123') && !document.querySelector('.erp-view:not([hidden]) table').textContent.includes('2,123456789123456789')"));
            assert.equal(await run(win, "document.querySelectorAll('.erp-view:not([hidden]) thead th').length"),6);
            assert.equal(await run(win, "document.querySelector('.erp-view:not([hidden]) [data-erp-field=_Quantity]').title"),'2.123456789123456789');
            if(theme==='standard') {
                await run(win, "document.querySelector('#export').click()"); await wait(win, "!document.querySelector('#export').disabled");
                const stockBook=XLSX.readFile(exportPath), stockRows=XLSX.utils.sheet_to_json(stockBook.Sheets.Dati);
                assert.equal(stockRows[0].Giacenza,'2.123456789123456789');
            }
            for (const [width, height] of [[1500, 940], [1000, 680]]) {
                win.setContentSize(width, height); await run(win, "new Promise(r=>setTimeout(r,100))");
                const geometry = await run(win, "(()=>{const table=document.querySelector('.erp-view:not([hidden]) .erp-results>.table-scroll');return {width:innerWidth,height:innerHeight,header:document.querySelector('.topbar').getBoundingClientRect().height,overflow:document.body.scrollWidth>innerWidth,table:table.clientHeight,border:getComputedStyle(table.querySelector('th')).borderRightWidth,accent:getComputedStyle(document.body).getPropertyValue('--ops-accent').trim()}})()");
                assert.equal(geometry.width, width); assert.equal(geometry.height, height);
                assert.equal(geometry.header, 70); assert.equal(geometry.overflow, false); assert(geometry.table > 300); assert.equal(geometry.border, '1px'); assert.equal(geometry.accent, theme === 'standard' ? '#cc930e' : '#168eea');
                fs.writeFileSync(path.join(dir, `erp-${theme}-${width}.png`), (await win.webContents.capturePage()).toPNG());
            }
        }
        assert.equal((await run(main, "require('electron').ipcRenderer.invoke('analysis-navigate',{target:'article-orders'})")).ok, true);
        for (let i = 0; i < 200 && !sales; i++) { sales = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('article-orders.html')); if (!sales) await new Promise(resolve => setTimeout(resolve, 25)); } assert(sales);
        sales.unmaximize(); await new Promise(resolve => setTimeout(resolve, 60));
        await wait(sales, "!!document.querySelector('#searchForm')"); await run(sales, "document.querySelector('#searchForm').requestSubmit()"); await wait(sales, "!!document.querySelector('#results [data-expand-document]')");
        const ownBefore = ownCalls, linksBefore = linkedCalls;
        await run(sales, "document.querySelector('[data-expand-document]').click()"); await wait(sales, "!!document.querySelector('.document-links-row [data-own-lines] table')");
        assert.equal(ownCalls, ownBefore + 1); assert.equal(linkedCalls, linksBefore, 'The arrow loads own order lines only');
        assert(await run(sales, "document.querySelector('.document-links-row').textContent.includes('OTHER')"));
        const expanded = await run(sales, "(()=>{const source=document.querySelector('#results [data-analysis-row]'),arrow=source.querySelector('[data-expand-document]'),detail=source.nextElementSibling,q=detail.querySelectorAll('tbody tr:first-child td');return {source:source.classList.contains('analysis-expanded-source'),controls:arrow.getAttribute('aria-controls')===detail.id,next:detail.nextElementSibling.dataset.analysisRow,quantity:q[3].textContent,raw:q[3].title,delivered:q[5].textContent,residual:q[6].textContent,linkBorder:getComputedStyle(source.querySelector('[data-open-document]')).borderTopWidth,decoration:getComputedStyle(source.querySelector('[data-open-document]')).textDecorationLine}})()");
        assert(expanded.source && expanded.controls); assert.equal(expanded.next, '1');
        assert.equal(expanded.quantity, '3.390'); assert.equal(expanded.raw, '3390.0000000000005');
        assert.equal(expanded.delivered, '3.738,9'); assert.equal(expanded.residual, '0');
        assert.equal(expanded.linkBorder, '0px'); assert.equal(expanded.decoration, 'underline');
        await run(sales, "document.querySelector('[data-expand-document]').click()");
        assert(await run(sales, "!document.querySelector('.document-links-row,.analysis-expanded-source') && !document.querySelector('[data-expand-document]').hasAttribute('aria-controls')"));

        await run(sales, "document.querySelector('[data-open-document]').click()"); await wait(sales, "!!document.querySelector('.analysis-document-dialog .linked-document')");
        assert.equal(linkedCalls, linksBefore + 1, 'The link opens own lines and related offers');
        await run(sales, "document.querySelector('.analysis-document-dialog .dialog-actions button').click()");
        for (const theme of ['standard', 'bluearchive']) {
            await sales.loadFile(path.join(root, 'dist-ts/pages/article-orders.html'), { query: { theme } });
            await run(sales, "document.querySelector('#searchForm').requestSubmit()");
            await wait(sales, "!!document.querySelector('[data-expand-document]')");
            await run(sales, "document.querySelector('[data-expand-document]').click()");
            await wait(sales, "!!document.querySelector('.document-links-row [data-own-lines] table')");
            for (const [width, height] of [[1500, 940], [1000, 680]]) {
                sales.setContentSize(width, height); await run(sales, "new Promise(r=>setTimeout(r,100))");
                const bounds = await run(sales, "(()=>{const scroll=document.querySelector('#results').parentElement,content=document.querySelector('.analysis-document-content'),detail=document.querySelector('.document-links-row>td'),source=document.querySelector('.analysis-expanded-source>td');return {width:content.getBoundingClientRect().width,available:scroll.clientWidth,bottom:getComputedStyle(detail).borderBottomWidth,side:getComputedStyle(detail).borderLeftWidth,top:getComputedStyle(source).borderTopWidth,overflow:document.body.scrollWidth>innerWidth}})()");
                assert(bounds.width <= bounds.available && bounds.width >= bounds.available - 40, JSON.stringify(bounds));
                assert.equal(bounds.bottom, '2px'); assert.equal(bounds.side, '3px'); assert.equal(bounds.top, '2px'); assert(!bounds.overflow);
                await run(sales, "document.querySelector('#results').parentElement.scrollLeft=700;new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))");
                const pinned = await run(sales, "(()=>{const r=document.querySelector('.analysis-document-content').getBoundingClientRect(),s=document.querySelector('#results').parentElement.getBoundingClientRect();return {left:r.left,right:r.right,sl:s.left,sr:s.right}})()");
                assert(pinned.left>=pinned.sl && pinned.right<=pinned.sr, JSON.stringify(pinned));
                fs.writeFileSync(path.join(dir, `expanded-${theme}-${width}.png`), (await sales.webContents.capturePage()).toPNG());
            }
            await run(sales, "document.querySelector('[data-open-document]').click()"); await wait(sales, "!!document.querySelector('.analysis-document-dialog .linked-document')");
            const linkedQuantity = await run(sales, "document.querySelector('.analysis-document-dialog .linked-document td[data-filter-value]').textContent");
            assert.equal(linkedQuantity, '3.390');
            for (const [width, height] of [[1500, 940], [1000, 680]]) {
                sales.setContentSize(width, height); await run(sales, "new Promise(r=>setTimeout(r,100))");
                const size = await run(sales, "(()=>{const r=document.querySelector('.analysis-document-dialog').getBoundingClientRect();return {width:r.width,height:r.height,w:innerWidth,h:innerHeight}})()"); assert(size.width >= size.w - 40 && size.height >= size.h - 40);
                assert.equal(size.w, width); assert.equal(size.h, height);
                fs.writeFileSync(path.join(dir, `order-${theme}-${width}.png`), (await sales.webContents.capturePage()).toPNG());
            }
        }
        assert.deepEqual(errors, []);
        console.log('OK: ERP six compact blocks, curated fields/details, readable quantities and exact tooltips/export, append retaining expanded details, scoped relations, complete typed Excel, permissions, two themes/sizes and Venduto own-line arrow vs combined document link.'); console.log('Artifacts: ' + dir);
        clearTimeout(watchdog); app.exit(0);
    } catch (error) { console.error(error); if (win && !win.isDestroyed()) { try { console.error(await win.webContents.executeJavaScript("document.body.innerText.slice(0,1200)")); fs.writeFileSync(path.join(dir, 'failure.png'), (await win.webContents.capturePage()).toPNG()); } catch {} } console.error(dir); clearTimeout(watchdog); app.exit(1); }
});
