const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { AnalysisDestinationCache } = require('../dist-ts/modules/analysis-destination-cache');
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));

async function main() {
    let now = 0, active = 0, maxActive = 0;
    const calls = [], waiting = [];
    const cache = new AnalysisDestinationCache(async (target, context) => {
        active++; maxActive = Math.max(maxActive, active);
        const operation = deferred(); waiting.push(operation); calls.push([target, context]);
        try { return await operation.promise; } finally { active--; }
    }, () => now);
    const first = cache.probe('article-orders', { article: 'A' });
    assert.equal(cache.probe('article-orders', { article: 'A' }, true), first, 'Hover and right click share one exact probe');
    const second = cache.probe('article-offers', { article: 'A' });
    const background = cache.probe('bom-analysis', { article: 'B' });
    const foreground = cache.probe('stock-analysis', { article: 'C' }, true);
    await tick(); assert.equal(calls.length, 2);
    waiting[0].resolve(true); await first; await tick();
    assert.equal(calls[2][0], 'stock-analysis', 'A click takes priority over queued speculative work');
    waiting[1].resolve(false); await second; await tick();
    waiting[2].resolve(true); waiting[3].resolve(true);
    await Promise.all([foreground, background]); await tick();
    assert.equal(maxActive, 2, 'All windows and hover probes share the backend concurrency budget');
    const count = calls.length;
    assert.equal(await cache.probe('article-orders', { article: 'A' }), true);
    assert.equal(await cache.probe('article-offers', { article: 'A' }), false);
    assert.equal(calls.length, count, 'Verified results are reused');
    now = 2001;
    const expiredMissing = cache.probe('article-offers', { article: 'A' }); await tick();
    waiting.at(-1).reject(Error('backend unavailable')); assert.equal(await expiredMissing, false); await tick();
    const retry = cache.probe('article-offers', { article: 'A' }); await tick();
    assert.equal(calls.length, count + 2, 'Failures must not be cached as missing destinations');
    waiting.at(-1).resolve(true); await retry; await tick();
    now = 15001;
    const expiredPresent = cache.probe('article-orders', { article: 'A' }); await tick();
    waiting.at(-1).resolve(false); assert.equal(await expiredPresent, false); await tick();
    cache.clear();
    const refreshed = cache.probe('article-orders', { article: 'A' }); await tick();
    waiting.at(-1).resolve(true); assert.equal(await refreshed, true); await tick();
    const oldSession = cache.probe('tooling', { article: 'SESSION' }); await tick();
    cache.clear(); waiting.at(-1).resolve(true);
    assert.equal(await oldSession, false, 'A login/logout change invalidates in-flight availability too'); await tick();

    let timerId = 0;
    const timers = new Map(), popups = [];
    const window = { isDestroyed: () => false }, sender = { isDestroyed: () => false };
    const exports = {};
    vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../dist-ts/modules/analysis-context-menu.js'), 'utf8'), {
        exports,
        setTimeout: callback => { timers.set(++timerId, callback); return timerId; },
        clearTimeout: id => timers.delete(id),
        require: name => {
            assert.equal(name, 'electron');
            return {
                BrowserWindow: { fromWebContents: () => window },
                Menu: { buildFromTemplate: items => {
                    const menu = { items, popup(options) { this.options = options; popups.push(this); }, closePopup() { this.options?.callback(); } };
                    return menu;
                } },
            };
        },
    });
    const presenter = new exports.AnalysisContextMenu();
    const position = { x: 123, y: 456 };
    const ready = [{ label: 'Ordine verificato' }];
    await presenter.show(sender, position, async () => ready);
    assert.equal(popups.length, 1, 'Warm menus open immediately without a loading popup');
    assert.equal(timers.size, 0);
    const slow = deferred(); const loading = presenter.show(sender, position, () => slow.promise);
    for (const callback of [...timers.values()]) callback();
    assert.equal(popups.at(-1).items[0].enabled, false);
    slow.resolve(ready); await loading;
    assert.equal(popups.at(-1).items[0].label, 'Ordine verificato');
    assert.equal(popups.at(-1).options.x, 123); assert.equal(popups.at(-1).options.y, 456);
    const dismissed = deferred(); const pending = presenter.show(sender, position, () => dismissed.promise);
    for (const callback of [...timers.values()]) callback();
    popups.at(-1).options.callback(); const beforeDismiss = popups.length;
    dismissed.resolve(ready); await pending;
    assert.equal(popups.length, beforeDismiss, 'Dismissed loading menus never reopen');
    const cancelled = deferred(); const cancelledShow = presenter.show(sender, position, () => cancelled.promise);
    presenter.cancel(sender); cancelled.resolve(ready); await cancelledShow;
    assert.equal(timers.size, 0); assert.equal(popups.length, beforeDismiss);
    const obsolete = deferred(); const obsoleteShow = presenter.show(sender, position, () => obsolete.promise);
    await presenter.show(sender, { x: 9, y: 8 }, async () => [{ label: 'Nuovo contesto' }]);
    const beforeObsolete = popups.length; obsolete.resolve(ready); await obsoleteShow;
    assert.equal(popups.length, beforeObsolete, 'An old reply must not replace the latest context');
    assert.equal(popups.at(-1).options.x, 9);
    console.log('OK: shared bounded probes, priority, cache expiry/errors/invalidation, immediate warm popup, native loading feedback, original position, Escape/dismissal and superseded requests.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
