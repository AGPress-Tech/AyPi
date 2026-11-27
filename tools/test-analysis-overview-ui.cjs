const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict'), path = require('node:path');
app.setPath('userData', path.join(__dirname, '../.tmp-analysis-catalog-simple')); app.commandLine.appendSwitch('disable-gpu');
for (const name of ['show', 'maximize', 'focus']) BrowserWindow.prototype[name] = function () {};
app.whenReady().then(async () => {
    const main = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false } });
    const run = (win, code) => win.webContents.executeJavaScript(code, true);
    try {
        await main.loadURL('about:blank');
        require('../dist-ts/modules/analysis-navigation').registerAnalysisNavigation(main, () => '');
        require('../dist-ts/modules/workstations').registerWorkstations(main, () => false, { request: async () => ({ version: 1, revision: 0, profiles: [{ id: 'default', name: 'Standard', rules: {} }] }) });
        await run(main, "require('electron').ipcRenderer.invoke('commercial-analysis-open')");
        const catalog = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('commercial-analysis.html'));
        assert.deepEqual(await run(catalog, "[...document.querySelectorAll('[data-analysis]')].map(button=>button.dataset.analysis)"), ['erp-explorer', 'article-orders', 'article-offers', 'customer-analysis', 'bom-analysis', 'bar-contracts', 'stock-analysis']);
        assert.equal(await run(catalog, "document.querySelector('#catalogView').hidden"), false);
        assert.equal(await run(catalog, "document.querySelector('#operationalView').hidden"), true);
        assert.equal((await run(main, "require('electron').ipcRenderer.invoke('analysis-overview-open')")).ok, false);
        for (const target of ['manager', 'customer-prices', 'customer-commitments']) assert.equal((await run(main, `require('electron').ipcRenderer.invoke('analysis-navigate',{target:'${target}'})`)).ok, false);
        assert.equal((await run(catalog, "require('electron').ipcRenderer.invoke('analysis-manager-load',{})")).ok, false);
        assert.equal((await run(catalog, "require('electron').ipcRenderer.invoke('analysis-overview-load',{check:'open-orders'})")).ok, false);
        console.log('OK: original seven-entry catalog, operational/managerial prototype hidden and inaccessible.');
        BrowserWindow.getAllWindows().forEach(win => win.destroy()); app.exit(0);
    } catch (error) { console.error(error); app.exit(1); }
});
