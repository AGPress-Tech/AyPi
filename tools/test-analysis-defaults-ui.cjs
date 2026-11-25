const { app, BrowserWindow, ipcMain, session } = require('electron');
const assert = require('node:assert/strict'), path = require('node:path'), fs = require('node:fs'), os = require('node:os');
const root = path.resolve(__dirname, '..'), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aypi-analysis-defaults-'));
app.setPath('userData', path.join(dir, 'profile')); app.commandLine.appendSwitch('disable-gpu');
const { emptyWorkspace } = require('../dist-ts/modules/analysis-ui-model');
ipcMain.handle('analysis-ui-load', () => ({ ok: true, preferences: emptyWorkspace() }));
ipcMain.handle('analysis-ui-save', (_e, value) => ({ ok: true, preferences: value.preferences }));
const requests = [];
for (const kind of ['orders', 'offers']) ipcMain.handle('article-' + kind + '-search', (_event, value) => {
    const module = require('../backend-dist/modules/analytics/article-' + kind);
    const filters = kind === 'orders' ? module.validateArticleOrderFilters(value) : module.validateArticleOfferFilters(value);
    requests.push({ kind, filters });
    return { ok: true, rows: [], total: 0, queriedAt: new Date().toISOString() };
});
// Exercise initialization without contacting an ERP or a production backend.
app.whenReady().then(async () => {
    require('../dist-ts/modules/login-preferences').registerLoginPreferencesIpc();
    session.defaultSession.webRequest.onBeforeRequest({ urls: ['https://*/*'] }, (_request, callback) => callback({ cancel: true }));
    const win = new BrowserWindow({ show: false, width: 1500, height: 940, webPreferences: { nodeIntegration: true, contextIsolation: false, backgroundThrottling: false } });
    const run = code => win.webContents.executeJavaScript(code, true);
    const errors = []; win.webContents.on('console-message', (_e, level, message) => { if (level >= 3) errors.push(message); });
    const wait = async code => { const start = Date.now(); while (Date.now() - start < 10000) { if (await run(code)) return; await new Promise(resolve => setTimeout(resolve, 25)); } throw Error('Timeout ' + code); };
    try {
        const year = new Date().getFullYear();
        for (const theme of ['standard', 'bluearchive']) {
            for (const page of ['article-orders.html', 'article-offers.html']) {
                await win.loadFile(path.join(root, 'dist-ts/pages', page), { query: { theme } });
                await wait("!!document.querySelector('[data-special-create]')");
                const selector = `[data-key=${page.includes('offers') ? 'offerDates' : 'orderDates'}] .from`;
                await wait(`document.querySelector(${JSON.stringify(selector)}).value!==''`);
                assert.equal(await run(`document.querySelector(${JSON.stringify(selector)}).value`), (year - 2) + '-01-01', page);
                assert.equal(await run("!!document.querySelector('.aypi-filter-panel,[data-filter-mode],[data-rule-mode]')"), false, 'No layout transformation or extra ordinary field modes: ' + page);
                for (const [width, height] of [[1500, 940], [1000, 680]]) {
                    win.setContentSize(width, height);
                    await run("document.querySelector('[data-special-create]').click()");
                    const rect = await run("(()=>{const d=document.querySelector('.analysis-special-dialog'),r=d.getBoundingClientRect(),f=d.querySelector('footer').getBoundingClientRect();return {left:r.left,right:r.right,bottom:f.bottom,width:innerWidth,height:innerHeight}})()");
                    assert(rect.left >= 0 && rect.right <= rect.width && rect.bottom <= rect.height, JSON.stringify(rect));
                    await run("document.querySelector('[data-special-cancel]').click()");
                    assert.equal(await run("document.querySelectorAll('.special-filter-chip').length"), 0, 'Cancel leaves filters unchanged');
                }
                let previous = requests.length;
                await run("document.querySelector('#searchForm').requestSubmit()");
                await wait("!document.querySelector('#search').disabled");
                assert.equal(requests.length, previous + 1, 'No article or document is required');
                await run("document.querySelector('#reset').click()");
                assert.equal(await run("[...document.querySelectorAll('#filterGroups input:not([type=checkbox])')].every(input=>input.value==='')"), true, 'Azzera clears the temporal range too');
                previous = requests.length;
                await run("document.querySelector('#searchForm').requestSubmit()");
                await wait("!document.querySelector('#search').disabled");
                assert.equal(requests.length, previous + 1, 'All fields may be empty');
                const sent = requests.at(-1).filters;
                assert.equal(sent.articles.length, 0);
                assert.equal((sent.orderDates || sent.offerDates).length, 0);
            }
        }
        assert.deepEqual(errors, []);
        console.log('OK: Ordini/Offerte retain native layout, default to three calendar years, allow empty searches and clear all fields with Azzera, in both themes and sizes.');
        win.destroy(); app.exit(0);
    } catch (error) { console.error(error); console.error(errors); win.destroy(); app.exit(1); }
});
