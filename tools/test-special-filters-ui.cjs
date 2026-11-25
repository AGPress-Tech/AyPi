const { app, BrowserWindow, ipcMain } = require('electron');
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const root = path.resolve(__dirname, '..'), dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aypi-special-ui-'));
app.setPath('userData', path.join(dir, 'profile')); app.commandLine.appendSwitch('disable-gpu');
const stock = require('../dist-ts/modules/stock-analysis/model');
const base = { unit: 'NR', initial: 0, received: 0, issued: 0, owned: 1, reservedSales: 0, reservedProduction: 0, orderedPurchase: 0, orderedProduction: 0, fiscalYear: 2026, fiscalPeriod: 1 };
const rows = [['A1', 'S1', 2], ['A2', 'S2', 3], ['A3', 'S3', 5], ['B1', 'S1', 6]].map(([article, storage, initial]) => ({ ...base, article, storage, initial }));
let prefs = { version: 1, columns: ['article', 'quantity'], presets: [] }, exported;
ipcMain.handle('stock-analysis-preferences-load', () => ({ ok: true, preferences: prefs }));
ipcMain.handle('stock-analysis-preferences-save', (_event, value) => ({ ok: true, preferences: prefs = stock.validateStockPreferences(value) }));
ipcMain.handle('stock-analysis-load', () => ({ ok: true, rows, periods: [{ year: 2026, period: 1 }], selected: { year: 2026, period: 1 }, queriedAt: new Date().toISOString() }));
ipcMain.handle('stock-analysis-export', (_event, value) => { exported = stock.filterStock(stock.normalizeStock(rows), value.search); return { ok: true, count: exported.length, positions: exported.length }; });
app.whenReady().then(async () => {
    const win = new BrowserWindow({ show: false, width: 1500, height: 940, webPreferences: { nodeIntegration: true, contextIsolation: false, backgroundThrottling: false } });
    const errors = []; win.webContents.on('console-message', (_e, level, message) => { if (level >= 3) errors.push(message); });
    const run = code => win.webContents.executeJavaScript(code, true);
    const wait = async code => { const start = Date.now(); while (Date.now() - start < 10000) { if (await run(code)) return; await new Promise(r => setTimeout(r, 25)); } throw Error('Timeout ' + code); };
    const set = async (selector, value, event = 'change') => run(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event(${JSON.stringify(event)},{bubbles:true}))})()`);
    const leaf = async (key, field, op, value) => {
        const selector = `.analysis-special-dialog [data-special-path="${key}"]`;
        await set(selector + ' [data-special-field]', field);
        await set(selector + ' [data-special-op]', op);
        await set(selector + ' [data-special-value]', value, 'input');
    };
    try {
        for (const theme of ['standard', 'bluearchive']) {
            await win.loadFile(path.join(root, 'dist-ts/pages/stock-analysis.html'), { query: { theme } });
            await wait("document.querySelector('#articleCount').textContent==='4'");
            await run("document.querySelector('[data-special-create]').click()");
            await set('[data-special-name]', 'A nei magazzini S1 o S2', 'input');
            await leaf('root.0', 'article', 'prefix', 'A');
            await leaf('root.1', 'quantity', 'gte', '2');
            await run("document.querySelector('[data-special-path=root] > .special-group-actions [data-special-add-group]').click()");
            await leaf('root.2.0', 'storage', 'exact', 'S1');
            await leaf('root.2.1', 'storage', 'exact', 'S2');
            for (const [width, height] of [[1500, 940], [1000, 680]]) {
                win.setContentSize(width, height);
                await run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
                assert(await run("(()=>{const d=document.querySelector('.analysis-special-dialog'),r=d.getBoundingClientRect(),f=d.querySelector('footer').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&f.bottom<=r.bottom&&d.scrollWidth<=d.clientWidth})()"));
                fs.writeFileSync(path.join(dir, `${theme}-${width}.png`), (await win.webContents.capturePage()).toPNG());
            }
            await run("document.querySelector('.analysis-special-dialog form').requestSubmit()");
            assert.equal(await run("document.querySelector('.analysis-special-dialog').open"), false);
            assert.equal(await run("document.querySelector('#articleCount').textContent"), '2');
            await wait("document.activeElement===document.querySelector('[data-special-create]')");
            await run("document.querySelector('#export').click()"); await wait("document.querySelector('#status').textContent.includes('Esportati')");
            assert.deepEqual(exported.map(row => row.article), ['A1', 'A2']);
            await run("document.querySelector('#savePreset').click();document.querySelector('#presetName').value='Composto E/O';document.querySelector('#presetDialog button[value=save]').click()");
            await wait("document.querySelectorAll('#presets option').length===2");
            assert.equal(prefs.presets[0].search.special[0].condition.conditions[2].join, 'any');
            await run("document.querySelector('#reset').click();document.querySelector('#presets').value='0';document.querySelector('#presets').dispatchEvent(new Event('change'))");
            assert.equal(await run("document.querySelector('#articleCount').textContent"), '2');
            await run("document.querySelector('[data-special-enabled]').click()");
            assert.equal(await run("document.querySelector('#articleCount').textContent"), '4');
            await run("document.querySelector('[data-special-enabled]').click();document.querySelector('[data-special-edit]').click()");
            await set('[data-special-mode]', 'exclude');
            await run("document.querySelector('.analysis-special-dialog form').requestSubmit()");
            assert.equal(await run("document.querySelector('#articleCount').textContent"), '2');
            await run("document.querySelector('#export').click()"); await wait("document.querySelector('#status').textContent.includes('Esportati')");
            assert.deepEqual(exported.map(row => row.article), ['A3', 'B1']);
            await run("document.querySelector('[data-special-edit]').click()");
            await set('[data-special-name]', 'Bozza da annullare', 'input');
            win.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
            win.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
            await wait("!document.querySelector('.analysis-special-dialog').open");
            assert(!await run("document.querySelector('.special-filter-list').textContent.includes('Bozza da annullare')"));
            await run("document.querySelector('[data-special-delete]').click();document.querySelector('#presets').value='0';document.querySelector('#deletePreset').click()");
            await wait("document.querySelectorAll('#presets option').length===1");
        }
        assert.deepEqual(errors, []);
        console.log('OK: Electron filtri speciali E/O, sottogruppi, modifica, annullamento, attivazione/esclusione, preset ed export, due temi e dimensioni. Artifacts: ' + dir);
        win.destroy(); app.exit(0);
    } catch (error) { console.error(error); console.error(errors); console.error(await run("(()=>{const d=document.querySelector('.analysis-special-dialog'),r=d.getBoundingClientRect(),f=d.querySelector('footer').getBoundingClientRect();return {rect:r.toJSON(),footer:f.toJSON(),width:innerWidth,height:innerHeight,scroll:d.scrollWidth,client:d.clientWidth,css:getComputedStyle(d).cssText}})()")); fs.writeFileSync(path.join(dir,"failure.png"),(await win.webContents.capturePage()).toPNG()); console.error(dir); win.destroy(); app.exit(1); }
});
