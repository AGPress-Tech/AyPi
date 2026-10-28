const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
process.env.TZ = 'Europe/Rome';
const storage = new Map();
const sandbox = {
    require: (name) => name === 'electron' ? { ipcRenderer: { on() {}, invoke: async () => ({}) } } : {},
    console, Date, Intl, Math, Number, String, Array, Set, Map, JSON,
    setTimeout, clearTimeout, setInterval, clearInterval,
    localStorage: { getItem: (key) => storage.get(key) || null, setItem: (key, value) => storage.set(key, String(value)) },
    window: { addEventListener() {} },
    document: { addEventListener() {}, getElementById() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; } },
    assert,
};
vm.runInNewContext(fs.readFileSync('dist-ts/scripts/utilities/production-planner-scripts.js', 'utf8') + String.raw`
const local = (day, clock) => new Date(day + 'T' + clock + ':00');
const stamp = (date) => date && dateKey(date) + ' ' + String(date.getHours()).padStart(2,'0') + ':' + String(date.getMinutes()).padStart(2,'0');
const hours = Object.fromEntries(Array.from({length:7}, (_, i) => [String(i), i === 0 || i === 6 ? [] : [{start:'08:12',end:'16:12'}]]));
state = { version:1, machines:[{id:'m1',name:'Test',workingHours:hours}], jobs:[], unavailabilities:[] };
const begin = local('2026-10-28','08:12');
assert.equal(stamp(finishInMachineCalendar(begin, 16*3600, 'm1')), '2026-10-29 16:12');
assert.equal(stamp(finishInMachineCalendar(local('2026-10-28','10:12'), 16*3600, 'm1')), '2026-10-30 10:12');
state.unavailabilities = [{machineId:'m1',start:'2026-10-29',end:'2026-10-29'}];
assert.equal(stamp(finishInMachineCalendar(begin, 16*3600, 'm1')), '2026-10-30 16:12');
state.unavailabilities = [];
state.machines[0].workingHours['3'] = [{start:'06:00',end:'12:00'},{start:'12:30',end:'19:00'}];
assert.equal(stamp(finishInMachineCalendar(local('2026-10-28','12:00'),3600,'m1')), '2026-10-28 13:30');
state.machines[0].workingHours['3'] = [{start:'08:12',end:'13:00'},{start:'12:00',end:'16:12'}];
assert.equal(stamp(finishInMachineCalendar(begin,8*3600,'m1')), '2026-10-28 16:12', 'Overlapping work ranges must not double-count capacity');
state.machines[0].workingHours['3'] = [{start:'08:12',end:'16:12'}];
const noHours = Object.fromEntries(Array.from({length:7},(_, i) => [String(i),[]]));
state.machines.push({id:'closed',workingHours:noHours});
assert.equal(finishInMachineCalendar(begin, 3600, 'closed'), null);
const allDay = Object.fromEntries(Array.from({length:7},(_, i) => [String(i),[{start:'00:00',end:'24:00'}]]));
state.machines.push({id:'24h',workingHours:allDay});
assert.equal(stamp(finishInMachineCalendar(local('2026-10-28','22:00'),4*3600,'24h')), '2026-10-29 02:00');
assert.equal(stamp(finishInMachineCalendar(local('2026-03-29','00:00'),8*3600,'24h')), '2026-03-29 09:00', 'DST must preserve actual production seconds');
const job = {id:'j1',mesPhaseId:'p1',machineId:'m1',start:'2026-10-28',end:'2026-10-29',quantity:960,cycleSeconds:60,setupHours:0,durationDays:2};
const session = {sessionId:'s1',activationId:'a1',phaseId:'p1',machineId:'M1',status:'ACTIVE',mode:'PRODUCTION',
    startedAt:begin.toISOString(),targetQuantity:960,goodPieces:0,standardCycleSeconds:60,piecesPerPulse:1,
    averageCycleSeconds:null,forecastCycleSeconds:null};
mesSessions = [session]; mesReaderSnapshot = {machines:[]};
let result = jobScheduleForecast(job,begin);
assert.equal(stamp(result.end), '2026-10-29 16:12');
result = jobScheduleForecast(job,local('2026-10-28','10:12'));
assert.equal(stamp(result.end), '2026-10-30 10:12', 'An idle machine must push out its completion');
session.forecastCycleSeconds = 60 / 0.9;
result = jobScheduleForecast(job,begin);
assert.ok(Math.abs(result.efficiency - 90) < 0.0001);
assert.ok(result.end > result.plannedEnd, '90% cycle efficiency must delay completion');
assert.equal(result.end.getTime(), finishInMachineCalendar(begin,16*3600/0.9,'m1').getTime());
session.forecastCycleSeconds = null; session.averageCycleSeconds = 3600;
assert.equal(jobScheduleForecast(job,begin).cycleSeconds,60,'Stops must not inflate cycle time when no valid cycle is available');
session.averageCycleSeconds = null;
const evening = local('2026-10-28','19:00');
const before = jobScheduleForecast(job,evening).end;
session.goodPieces = 120;
const after = jobScheduleForecast(job,evening).end;
assert.ok(after < before,'Actual out-of-shift production must advance the projected delivery');
assert.equal(jobRequiredSeconds(job),16*3600,'Actual performance must not alter theoretical workload');
session.goodPieces = 0;
const now = local('2026-10-28','08:13');
mesReaderSnapshot = {machines:[{code:'M1',frame_time:now.getTime()/1000,last:now.getTime()/1000-20}]};
assert.equal(jobScheduleForecast(job,now).remainingSeconds,16*3600-20,'Credit work already done in the current cycle');
mesReaderSnapshot = {machines:[]};
session.mode = 'SETUP'; job.setupHours = 2;
assert.equal(jobScheduleForecast(job,local('2026-10-28','09:12')).setupRemaining,3600);
session.mode = 'PRODUCTION'; job.setupHours = 0; session.goodPieces = 1000;
assert.equal(jobScheduleForecast(job,evening).end.getTime(),evening.getTime(),'A fulfilled target must not add more work');
session.goodPieces = 0;
const precise = {...job, plannedStartAt:local('2026-10-28','10:12').toISOString()};
session.status = 'PAUSED';
assert.equal(stamp(jobScheduleForecast(precise,begin).end),'2026-10-30 10:12','Detailed placement must retain the hour');
session.status='ACTIVE'; session.activationId='root'; session.startedAt=begin.toISOString();
mesSessions=[session,{...session,sessionId:'setup-root',mode:'SETUP',status:'COMPLETED',
    startedAt:local('2026-10-25','08:12').toISOString(),endedAt:begin.toISOString()}];
state.jobs=[job];
pinActivePlannerJobs();
assert.equal(job.start,'2026-10-25','The activation start must not reset when setup ends');
assert.equal(job.plannedStartAt,local('2026-10-25','08:12').toISOString());
recalculateMachineSchedule('m1');
assert.equal(job.start,'2026-10-25','Calendar closures must not move an actual MES start');
unscheduleJob(job.id);
assert.equal(job.machineId,'m1','Active jobs cannot return to the backlog');
scheduleJob(job.id,'24h',local('2026-11-10','10:00'));
assert.equal(job.machineId,'m1'); assert.equal(job.start,'2026-10-25');
assert.equal(shiftMachineJobs('m1',3),0,'Bulk shifts must exclude active jobs');
assert.equal(stamp(jobScheduleForecast(job,begin).end),'2026-10-29 16:12',
    'Zero production after three days must still leave the full workload in the future');
stateCheckpoint=JSON.stringify(state);
undoStack=[{version:1,machines:[],jobs:[],unavailabilities:[]}];
const renderBeforeUndo=renderAll; renderAll=()=>{};
undoLastPlannerChange();
renderAll=renderBeforeUndo;
assert.equal(state.jobs.length,1,'Undo cannot remove an active scheduled job');
assert.equal(state.jobs[0].start,'2026-10-25');
assert.ok(state.machines.some(machine=>machine.id==='m1'));
if(remoteSaveTimer) { clearTimeout(remoteSaveTimer); remoteSaveTimer=null; }
if(mesScheduleTimer) { clearTimeout(mesScheduleTimer); mesScheduleTimer=null; }
console.log('Production forecast scenarios: OK');
`, sandbox);
