// Run with Electron: node_modules/electron/dist/electron.exe tools/test-mes-ui.cjs
const { app, BrowserWindow, ipcMain } = require('electron');
require('../dist-ts/modules/stdio-errors');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'aypi-mes-ui-')));
for (const [channel, result] of Object.entries({
    'aypi-realtime-status-get': { state: 'offline' }, 'focus-sender-window': true,
    'production-planner-load': { ok: false }, 'production-planner-check': { ok: false },
    'production-planner-save': { ok: false }, 'mes-sessions-list': { ok: true, data: [] },
    'mes-orders-list': { ok: true, data: { rows: [], total: 0 } },
    'plc-reader-snapshot': { session: { running: false }, machines: [] },
    'mes-assignees-list': { ok: true, data: { groups: { Torneria: ['Ada', 'Bruno'], Stampaggio: ['Carla'] } } },
    'mes-acquisition-status': { ok: true, data: { machines: [], sessions: [] } },
    'mes-activation-preview': { ok: true, data: { unassignedPulses: 2, unassignedPieces: 2, unassignedEvents: 2 } },
})) ipcMain.handle(channel, () => result);
app.whenReady().then(async () => {
    const win = new BrowserWindow({ show: false, width: 1280, height: 720,
        webPreferences: { nodeIntegration: true, contextIsolation: false, backgroundThrottling: false } });
    try {
        await win.loadFile(path.resolve('dist-ts/pages/utilities/production-planner.html'));
        const run = (source) => win.webContents.executeJavaScript(source);
        await run(`document.getElementById('planner-splash')?.remove(); refreshMesRuntime({quiet:true});`);
        const focus = await run(`(() => {
            const box = document.createElement('div'); document.body.appendChild(box);
            updateMesContent(box, '<article data-mes-machine-card="m1"><button data-test="focus">A</button><strong>1</strong></article>');
            const button = box.querySelector('button'); button.focus();
            updateMesContent(box, '<article data-mes-machine-card="m1"><button data-test="focus">A</button><strong>2</strong></article>');
            let ok = box.querySelector('button') === button && document.activeElement === button && box.querySelector('strong').textContent === '2';
            updateMesContent(box, '<article data-mes-machine-card="m2">New</article><article data-mes-machine-card="m1"><button data-test="focus">A</button><strong>3</strong></article>');
            ok = ok && box.children.length === 2 && box.lastElementChild.querySelector('button') === button;
            box.remove(); return ok;
        })()`);
        assert.ok(focus, 'Live updates must preserve focused buttons');
        assert.ok(await run(`(async () => {
            const previousOrders = mesOrders;
            mesOrders = [{ orderId:'qa-order',orderNumber:'QA', phases:[{phaseId:'qa-phase',phaseCode:'01'}] }];
            try {
                await openMesActivation('M1','qa-phase');
                const field = document.getElementById('mes-activation-pieces-per-pulse');
                let ok = field.required && field.value === '' && !field.checkValidity();
                field.value = '3'; field.dispatchEvent(new Event('input', {bubbles:true}));
                ok = ok && document.getElementById('mes-attributed-pieces').max === '6'
                    && document.getElementById('mes-activation-preview').textContent.includes('6 pezzi');
                closeDialog('mes-activation-dialog'); await openMesActivation('M1','qa-phase');
                ok = ok && field.value === ''; closeDialog('mes-activation-dialog'); return ok;
            } finally { mesOrders = previousOrders; }
        })()`), 'Every activation must ask for its own pieces-per-beat value');
        assert.ok(await run(`(() => {
            const now = Date.now() / 1000;
            const session = {status:'ACTIVE', mode:'PRODUCTION', standardCycleSeconds:100, startedAt:new Date((now-500)*1000).toISOString()};
            return mesMachineVisualState(session, {frame_time:now,last:now-201}) === 'stopped'
                && mesMachineVisualState(session, {frame_time:now,last:now-100}) === 'production'
                && mesMachineVisualState(session, {frame_time:now,last:now-501,operating_state:'PRODUCTION'}) === 'stopped'
                && mesMachineVisualState(session, {frame_time:now-30,last:now-1}) === 'unmonitored';
        })()`), 'Machine state must depend on a fresh pulse in the current session');
        assert.ok(await run(`(async () => {
            const form = document.createElement('form'); form.id = 'qa-submit';
            form.innerHTML = '<button type="submit">Salva</button>'; document.body.appendChild(form);
            let calls = 0; let release; const pending = new Promise(resolve => release = resolve);
            bindMesSubmit(form.id, async () => { calls++; await pending; });
            form.dispatchEvent(new SubmitEvent('submit', {bubbles:true,cancelable:true}));
            form.dispatchEvent(new SubmitEvent('submit', {bubbles:true,cancelable:true}));
            const locked = calls === 1 && form.querySelector('button').disabled;
            release(); await new Promise(resolve => setTimeout(resolve, 0));
            const ok = locked && !form.querySelector('button').disabled && form.querySelector('button').textContent === 'Salva';
            form.remove(); return ok;
        })()`), 'Forms must prevent duplicate submits and restore controls');
        assert.ok(await run(`(() => {
            mesAssigneeGroups = {Torneria:['Ada','Bruno'],Stampaggio:['Carla']};
            fillMesDepartmentSelect('mes-activation-department');
            document.getElementById('mes-activation-department').value = 'Torneria';
            renderMesActivationOperators();
            return [...document.getElementById('mes-activation-operator').options].map(o=>o.value).join(',') === ',Ada,Bruno';
        })()`), 'Operator choices must be filtered by department');
        for (const [width, height] of [[1280,720], [1920,1080], [1024,600]]) {
            win.setSize(width, height);
            await new Promise(resolve => setTimeout(resolve, 80));
            const geometry = await run(`(() => {
                showMesPage('production'); renderMesConsole();
                const grid = document.getElementById('mes-machine-grid'); grid.scrollTop = grid.scrollHeight;
                const last = grid.lastElementChild?.getBoundingClientRect(); const rect = grid.getBoundingClientRect();
                return {lastVisible: !last || last.bottom <= rect.bottom + 2, pageOverflow: document.documentElement.scrollWidth > innerWidth + 2};
            })()`);
            assert.ok(geometry.lastVisible, `Last machine must be accessible at ${width}x${height}`);
            assert.ok(!geometry.pageOverflow, `Page must fit at ${width}x${height}`);
            const modal = await run(`(() => {
                openJob(undefined, false, 'MACHINING');
                const form = document.getElementById('job-form');
                const rect = form.getBoundingClientRect();
                const ok = rect.top >= -1 && rect.bottom <= innerHeight + 1;
                closeDialog('job-dialog'); return ok;
            })()`);
            assert.ok(modal, `Order dialog must fit at ${width}x${height}`);
        }
        console.log('MES UI scenarios: OK');
    } catch (error) { console.error(error); process.exitCode = 1; }
    finally { win.destroy(); app.exit(process.exitCode || 0); }
}).catch((error) => { console.error(error); app.exit(1); });
