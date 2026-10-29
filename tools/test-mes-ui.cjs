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
    'mes-setup-links': {ok:true,data:[]},
    'mes-setup-catalog': {ok:true,data:{rows:[{type:'TRANSFER',recordId:'sheet1',label:'ART Transfer',article:'ART'}]}},
    'mes-setup-preview': {ok:true,data:{type:'TRANSFER',recordId:'sheet1',label:'ART Transfer',sheet:{codiceArticolo:'ART',note:'Anteprima variante',utensili:[],attachments:[]}}},
    'mes-manual-declare': {ok:true,data:{duplicate:false}},
})) ipcMain.handle(channel, () => result);
app.whenReady().then(async () => {
    const win = new BrowserWindow({ show: false, width: 1280, height: 720,
        webPreferences: { nodeIntegration: true, contextIsolation: false, backgroundThrottling: false, offscreen: true } });
    try {
        await win.loadFile(path.resolve('dist-ts/pages/utilities/production-planner.html'));
        const run = (source) => win.webContents.executeJavaScript(source);
        await run(`refreshMesRuntime({quiet:true});`);
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
                document.getElementById('mes-activation-source').value='PLC'; updateMesActivationSource();
                const field = document.getElementById('mes-activation-pieces-per-pulse');
                let ok = field.required && field.value === '' && !field.checkValidity();
                field.value = '3'; field.dispatchEvent(new Event('input', {bubbles:true}));
                ok = ok && document.getElementById('mes-attributed-pieces').max === '6'
                    && document.getElementById('mes-activation-preview').textContent.includes('6 pezzi');
                closeDialog('mes-activation-dialog'); await openMesActivation('M1','qa-phase');
                document.getElementById('mes-activation-source').value='PLC'; updateMesActivationSource();
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
        assert.ok(await run(`(async()=>{
            const oldOrders=mesOrders,oldSessions=mesSessions;
            mesOrders=[{orderId:'manual-order',orderNumber:'OP',phases:[{phaseId:'manual-phase',articleCode:'ART',phaseCode:'01'}]}];
            await mesOperations.openSheets('manual-phase');
            let ok=document.getElementById('mes-sheet-catalog').textContent.includes('ART Transfer');
            closeDialog('mes-sheets-dialog');
            mesSessions=[{sessionId:'manual-session',machineId:'M1',orderNumber:'OP',articleCode:'ART',operatorNames:['Ada'],revision:1,collectionMode:'MANUAL',status:'ACTIVE',manualState:'STOPPED'}];
            ok=ok&&mesMachineVisualState(mesSessions[0],null)==='stopped';
            mesSessions[0].manualState='PRODUCTION';ok=ok&&mesMachineVisualState(mesSessions[0],null)==='production';
            mesOperations.openManual('manual-session','PIECES');
            ok=ok&&document.getElementById('mes-manual-department').value==='Torneria'
                &&document.getElementById('mes-manual-operator').value==='Ada';
            document.getElementById('mes-manual-quantity').value='10';
            await document.getElementById('mes-manual-form').onsubmit({preventDefault(){}});
            ok=ok&&!document.getElementById('mes-manual-dialog').classList.contains('is-open');
            mesOrders=oldOrders;mesSessions=oldSessions;return ok;
        })()`),'Setup catalog and manual declarations must work in the existing module');
        assert.ok(await run(`(async()=>{
            openJob(undefined,false,'MACHINING');
            const field=document.getElementById('job-setup-sheets');
            let ok=!!(field.compareDocumentPosition(document.getElementById('job-notes'))&Node.DOCUMENT_POSITION_FOLLOWING);
            document.getElementById('job-article').value='ART';
            await mesOperations.openOrderSheetPicker('ART');
            const context=()=>document.querySelector('[data-catalog-sheet]').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:200,clientY:300}));
            ok=ok&&!document.querySelector('#mes-sheet-catalog button');
            context();document.querySelector('[data-sheet-menu="preview"]').click();
            await new Promise(resolve=>setTimeout(resolve,40));
            ok=ok&&!document.getElementById('mes-sheet-preview').hidden&&document.getElementById('mes-sheet-preview').textContent.includes('Anteprima variante');
            const full=document.querySelector('.dialog--sheet-document').getBoundingClientRect();
            ok=ok&&full.width>=innerWidth-2&&full.height>=innerHeight-2;
            ok=ok&&!field.textContent.includes('sheet1');
            document.querySelector('[data-close-sheet-preview]').click();
            ok=ok&&document.getElementById('mes-sheets-dialog').classList.contains('is-open')&&!field.textContent.includes('sheet1');
            context();document.querySelector('[data-sheet-menu="preview"]').click();
            await new Promise(resolve=>setTimeout(resolve,40));
            document.getElementById('mes-sheet-preview-attach').click();
            ok=ok&&field.textContent==='sheet1'&&document.getElementById('job-dialog').classList.contains('is-open');
            await mesOperations.openOrderSheetPicker('ART');
            context();document.querySelector('[data-sheet-menu="attach"]').click();
            ok=ok&&!document.getElementById('mes-sheets-dialog').classList.contains('is-open')&&field.textContent==='sheet1';
            await mesOperations.openOrderSheetPicker('ART');
            document.querySelector('#mes-sheets-dialog [data-close-sheets]').click();
            ok=ok&&field.textContent==='sheet1';
            closeDialog('job-dialog');return ok;
        })()`),'Sheet context menu must open fullscreen preview, cancel without attaching and attach directly');
        const scheduler = await run(`(() => {
            if(mesRefreshTimer) { clearInterval(mesRefreshTimer); mesRefreshTimer=null; }
            const machine = state.machines[0];
            const day = dateKey(new Date()); visibleStart = parseDate(day);
            const order = {orderId:'qa-order',orderNumber:'QA-16H',customer:'Test',articleCode:'ART',orderType:'MACHINING',priority:'NORMAL',revision:1};
            const phase = {phaseId:'qa-live',phaseCode:'01',targetQuantity:960,unit:'pz',standardCycleSeconds:60,
                plannedSetupSeconds:0,plannedMachineId:machine.id,scheduledStart:day+'T08:12:00',revision:1};
            const job = createMesPlannerProjection(order,phase,false);
            state.jobs = [job];
            mesOrders = [{...order,phases:[phase]}];
            mesSessions = [{sessionId:'qa-session',activationId:'qa-session',phaseId:phase.phaseId,machineId:machine.id,
                startedAt:day+'T08:12:00',status:'ACTIVE',mode:'PRODUCTION',targetQuantity:960,goodPieces:0,
                standardCycleSeconds:60,piecesPerPulse:1,forecastCycleSeconds:null,progressPercent:0}];
            showMesPage('scheduler'); setTimelineZoom('hours');
            const timeline = document.getElementById('timeline'), scroll = document.getElementById('timeline-scroll');
            const bar = timeline.querySelector('[data-job-id]');
            const before = parseFloat(bar.style.width), originalEnd = job.end;
            mesSessions[0].forecastCycleSeconds = 60/0.9; renderTimeline();
            const extended = parseFloat(timeline.querySelector('[data-job-id]').style.width) > before;
            bar.focus(); scroll.scrollLeft = 200; renderTimeline();
            const stable = document.activeElement === bar && scroll.scrollLeft === 200 && job.end === originalEnd;
            calendarPanSession = {originX:500,originStart:parseDate(visibleStart),originScrollLeft:200,lastDeltaDays:0,pointerId:1,captureTarget:timeline};
            updateCalendarPan({clientX:400,preventDefault(){}});
            const panned = scroll.scrollLeft === 300; finishCalendarPan();
            const lane = timeline.querySelector('.machine-days');
            const requested = requestedScheduleTime(lane,lane.getBoundingClientRect().left+dayWidth*10.25/24);
            return {extended,stable,panned,preciseDrop:requested.getHours()===10&&requested.getMinutes()===15,
                hours:timeline.querySelectorAll('.day-heading__hours span').length,
                expectedHours:visibleDays*24,shading:timeline.querySelectorAll('.off-shift').length,
                horizontal:scroll.scrollWidth>scroll.clientWidth};
        })()`);
        assert.ok(scheduler.extended, 'Slower actual cycles must extend the visible Gantt bar');
        assert.ok(scheduler.stable, 'Forecast updates must preserve focus, horizontal scroll and theoretical schedule');
        assert.ok(scheduler.panned, 'Grab-to-scroll must work at hourly zoom');
        assert.ok(scheduler.preciseDrop, 'Detailed placement must resolve quarter-hour boundaries');
        assert.equal(scheduler.hours,scheduler.expectedHours);
        assert.ok(scheduler.shading>0 && scheduler.horizontal);
        assert.ok(await run(`(async () => {
            const job=state.jobs[0], before={machineId:job.machineId,start:job.start};
            const bar=document.querySelector('#timeline [data-job-id]');
            let ok=bar.draggable===false && bar.dataset.scheduleLocked==='true';
            unscheduleJob(job.id); scheduleJob(job.id,job.machineId,addDays(job.start,10));
            ok=ok && job.machineId===before.machineId && job.start===before.start;
            ok=ok && await deleteJobWithConfirmation(job.id)===false;
            openJob(job);
            ok=ok && document.getElementById('job-machine-picker').disabled && document.getElementById('job-start').disabled
                && document.getElementById('delete-job').disabled;
            restoreJobFormInteractivity(false);
            ok=ok && document.getElementById('job-machine-picker').disabled && document.getElementById('job-start').disabled;
            closeDialog('job-dialog'); return ok;
        })()`),'Active orders must stay pinned across drag, removal, deletion and form editing');
        await run(`showMesPage('scheduler'); setTimelineZoom('hours');`);
        const previousTick = await run(`document.getElementById('scheduler-live-status').textContent`);
        for (let attempt = 0; attempt < 30; attempt++) {
            await new Promise(resolve => setTimeout(resolve, 100));
            if (await run(`document.getElementById('scheduler-live-status').textContent`) !== previousTick) break;
        }
        assert.notEqual(await run(`document.getElementById('scheduler-live-status').textContent`),previousTick,
            'Live forecasts must refresh while the scheduler is open');
        fs.writeFileSync(path.join(os.tmpdir(),'aypi-scheduler-hours.png'),(await win.webContents.capturePage()).toPNG());
        await run(`setTimelineZoom('days'); mesSessions=[]; mesOrders=[]; state.jobs=[]; showMesPage('production');`);
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
            await run(`mesOperations.resetOrderSheet(''); mesOperations.openOrderSheetPicker('ART')`);
            const sheets=await run(`(()=>{const dialog=document.querySelector('.dialog--mes-sheets').getBoundingClientRect();const button=document.querySelector('#mes-sheets-dialog footer [data-close-sheets]').getBoundingClientRect();return dialog.top>=0&&dialog.bottom<=innerHeight&&button.bottom<=innerHeight&&document.documentElement.scrollWidth<=innerWidth+2;})()`);
            assert.ok(sheets,`Setup sheet selector and confirmation must fit at ${width}x${height}`);
            if(width===1280)fs.writeFileSync(path.join(os.tmpdir(),'aypi-setup-sheet-picker.png'),(await win.webContents.capturePage()).toPNG());
            await run(`closeDialog('mes-sheets-dialog')`);
        }
        console.log('MES UI scenarios: OK');
    } catch (error) { console.error(error); process.exitCode = 1; }
    finally { win.destroy(); app.exit(process.exitCode || 0); }
}).catch((error) => { console.error(error); app.exit(1); });
