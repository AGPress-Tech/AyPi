const { app, BrowserWindow, ipcMain, session } = require('electron'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), os = require('node:os'), { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..'), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aypi-detail-filters-')); app.setPath('userData', path.join(dir, 'profile')); app.commandLine.appendSwitch('disable-gpu');
const { emptyCustomerPreferences } = require('../dist-ts/modules/customer-analysis/model');
const base = { kind: 'order', documentId: 1, documentNo: 'ORD-1', documentDate: '2026-11-20', deliveryDate: '2026-12-01', customerCode: 'C1', customerName: 'Cliente demo', unit: 'NR', currency: 'EUR', quantity: 10, deliveredQuantity: 2, residual: 8, unitPrice: 1.123456789, netPrice: 1.123456789, netAmount: 11.23456789, delivered: 0, cancelled: 0, headerCancelled: 0, headerDelivered: 0 };
const rows = [...Array.from({ length: 320 }, (_, i) => ({ ...base, article: 'ART-' + String(i).padStart(4, '0'), description: 'Articolo ' + i, line: i + 1 })), { ...base, article: '*INTERNO', line: 999 }, { ...base, kind: 'offer', documentId: 2, documentNo: 'OFF-2', article: '*OFFERTA', description: 'Articolo offerta', line: 1 }];
let links = 0, contexts = [], prefs = emptyCustomerPreferences();
ipcMain.handle('customer-analysis-preferences-load', () => ({ ok: true, preferences: prefs })); ipcMain.handle('customer-analysis-preferences-save', (_e, value) => ({ ok: true, preferences: prefs = value }));
ipcMain.handle('customer-analysis-customers', () => ({ ok: true, customers: [{ code: 'C1', name: 'Cliente demo' }] })); ipcMain.handle('customer-analysis-load', () => ({ ok: true, rows, queriedAt: '2026-11-24T10:00:00Z' })); ipcMain.handle('analysis-document-links', () => { links++; return { ok: true, rows: [] } }); ipcMain.handle('analysis-context-menu', (_e, value) => { contexts.push(value); return { ok: true } });
app.whenReady().then(async () => {
    require('../dist-ts/modules/login-preferences').registerLoginPreferencesIpc();
    const watchdog = setTimeout(() => { console.error('Timeout details UI'); app.exit(1) }, 300000); let win;
    try {
        session.defaultSession.webRequest.onBeforeRequest({ urls: ['https://*/*'] }, (_d, callback) => callback({ cancel: true }));
        win = new BrowserWindow({ show: false, width: 1520, height: 960, webPreferences: { nodeIntegration: true, contextIsolation: false, backgroundThrottling: false } });
        win.webContents.on('console-message', (_event, level, message) => { if (level >= 3) console.error(message) }); const run = code => { return win.webContents.executeJavaScript('{' + code + '}', true) }, wait = async code => { const start = Date.now(); while (Date.now() - start < 10000) { if (await run('!!(' + code + ')')) return; await new Promise(resolve => setTimeout(resolve, 30)) } throw Error('Timeout ' + code) };
        // Audit the shared layout against actual page templates, keeping service scripts out of this geometry fixture.
        const names = ['turning-analysis.html', 'management.html', 'maintenance.html', 'measurement-instruments.html', 'tooling.html', 'supplier-evaluation.html', 'article-orders.html', 'article-offers.html', 'bom-analysis.html', 'bar-contracts.html', 'stock-analysis.html', 'processing-cycles.html', 'production-planner-analysis.html', 'ferie-permessi.html', 'product-manager.html', 'product-manager-cart.html', 'product-manager-interventions.html', 'ticket-support.html', 'ticket-support-admin.html', 'production-planner.html', 'ferie-permessi-analysis.html', 'customer-analysis.html', 'mes-analysis.html', 'inventario-magazzino.html', 'warehouse-3d.html'];
        const walk = folder => fs.readdirSync(folder, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(path.join(folder, entry.name)) : [path.join(folder, entry.name)]), files = walk(path.join(root, 'dist-ts/pages'));
        for (const name of names.filter(name => !process.env.AYPI_TEST_LAYOUT || new RegExp(process.env.AYPI_TEST_LAYOUT).test(name))) {
            console.log('Layout: ' + name); const source = files.find(file => path.basename(file) === name); assert(source, name); const html = fs.readFileSync(source, 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, match => match.includes('utility-layout-bootstrap.js') ? match : '').replace('<head>', `<head><base href="${pathToFileURL(source).href}">`), fixture = path.join(dir, name); fs.writeFileSync(fixture, html);
            for (const theme of ['standard', 'bluearchive']) {
                await win.loadFile(fixture, { query: { theme } }); await run("document.body.classList.add('fp-calendar-ready','pm-ready');const inventory=document.querySelector('#inventorySearchDialog');if(inventory){inventory.classList.add('is-open');inventory.setAttribute('aria-hidden','false')};const workspace=document.querySelector('#workspace');if(workspace)workspace.hidden=false;const list=document.querySelector('#listView');if(list){list.hidden=false;document.querySelector('#homeView').hidden=true}");
                if (name !== 'stock-analysis.html') {
                    for (const [width, height] of [[1520, 960], [1050, 700]]) {
                        win.setContentSize(width, height);
                        await run("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
                        assert.equal(await run("!!document.querySelector('.aypi-filter-panel,.analysis-filter-presets,.analysis-detail-filters,.analysis-special-filters')"), false, name + ': native operational filters');
                        fs.writeFileSync(path.join(dir, `${name}-${theme}-${width}.png`), (await win.webContents.capturePage()).toPNG());
                    }
                    continue;
                }
                await wait("document.querySelector('.aypi-filter-panel')");
                assert(await run("!!document.querySelector('.aypi-filter-panel .analysis-filter-presets')"), name + ': presets');
                for (const [width, height] of [[1520, 960], [1050, 700]]) { win.setContentSize(width, height); await run("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))"); const geometry = await run("(()=>{const p=document.querySelector('.aypi-filter-panel'),r=p.getBoundingClientRect();return {width:r.width,left:r.left,right:r.right,window:innerWidth,overflow:p.scrollWidth>p.clientWidth}})()"); assert(geometry.width > 150 && geometry.width <= 300 && geometry.right <= geometry.window && !geometry.overflow, name + ' ' + theme + ' ' + width + ': ' + JSON.stringify(geometry)); }

            }
        }
        console.log('OK: Giacenze adapted; native filters retained in every other module: ' + names.filter(name => !process.env.AYPI_TEST_LAYOUT || new RegExp(process.env.AYPI_TEST_LAYOUT).test(name)).length + ' analysis/operational modules in both themes and sizes.'); console.log('Artifacts: ' + dir); clearTimeout(watchdog); win.destroy(); app.exit(0);
    } catch (error) { console.error(error); clearTimeout(watchdog); if (win) win.destroy(); app.exit(1) }
});
