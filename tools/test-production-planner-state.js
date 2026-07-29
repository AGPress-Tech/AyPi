const fs = require("fs");
const vm = require("vm");

const source = fs.readFileSync(
    "dist-ts/scripts/utilities/production-planner-scripts.js",
    "utf8",
);
const ipcRenderer = { on() {}, invoke: async () => ({ state: "connected" }) };
const storage = new Map();
const sandbox = {
    require: (name) => name === "electron" ? { ipcRenderer } : {},
    console,
    Date,
    Intl,
    Math,
    Number,
    String,
    Array,
    Set,
    Map,
    JSON,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    localStorage: {
        getItem: (key) => storage.get(key) || null,
        setItem: (key, value) => storage.set(key, String(value)),
    },
    window: { addEventListener() {} },
    document: {
        addEventListener() {},
        getElementById() { return null; },
        querySelector() { return null; },
        querySelectorAll() { return []; },
    },
};

const tests = String.raw`
function makeJob(id, start, end, durationDays, workStatus = "not_started") {
    return { id, machineId: "m1", start, end, durationDays, baseSpanDays: 1, workStatus };
}
function assertEqual(actual, expected, label) {
    if (actual !== expected) {
        throw new Error(label + ": atteso " + expected + ", ottenuto " + actual);
    }
}

state = {
    version: 1,
    machines: [],
    unavailabilities: [],
    jobs: [makeJob("after", "2026-08-27", "2026-08-28", 2)],
};
let added = newlyBlockedProductionDates("m1", "2026-08-25", "2026-08-25");
state.unavailabilities.push({
    id: "u1",
    machineId: "m1",
    type: "maintenance",
    start: "2026-08-25",
    end: "2026-08-25",
    title: "",
});
insertMachineDowntime("m1", added);
assertEqual(state.jobs[0].start, "2026-08-28", "fermo precedente: inizio");
assertEqual(state.jobs[0].end, "2026-08-31", "fermo precedente: fine");

state = {
    version: 1,
    machines: [],
    unavailabilities: [],
    jobs: [
        makeJob("crossing", "2026-08-27", "2026-08-28", 2),
        makeJob("following", "2026-08-31", "2026-09-01", 2),
        makeJob("done", "2026-08-31", "2026-09-01", 2, "done"),
    ],
};
added = newlyBlockedProductionDates("m1", "2026-08-27", "2026-08-27");
state.unavailabilities.push({
    id: "u2",
    machineId: "m1",
    type: "maintenance",
    start: "2026-08-27",
    end: "2026-08-27",
    title: "",
});
insertMachineDowntime("m1", added);
assertEqual(state.jobs[0].start, "2026-08-27", "fermo attraversato: inizio invariato");
assertEqual(state.jobs[0].end, "2026-08-31", "fermo attraversato: fine estesa");
assertEqual(state.jobs[1].start, "2026-09-01", "lavorazione successiva: inizio");
assertEqual(state.jobs[1].end, "2026-09-02", "lavorazione successiva: fine");
assertEqual(state.jobs[2].start, "2026-08-31", "terminata: inizio storico");
assertEqual(state.jobs[2].end, "2026-09-01", "terminata: fine storica");

state = {
    version: 1,
    machines: [],
    unavailabilities: [{
        id: "old",
        machineId: "m1",
        type: "closure",
        start: "2026-08-25",
        end: "2026-08-25",
        title: "",
    }],
    jobs: [],
};
added = newlyBlockedProductionDates("m1", "2026-08-25", "2026-08-25");
assertEqual(added.length, 0, "giorno già indisponibile non duplicato");

renderAll = () => {};
renderMachinesDialog = () => {};
renderUnavailabilityList = () => {};
renderClosureList = () => {};
renderMachinePicker = () => {};
notify = () => {};
state = { version: 1, machines: [], unavailabilities: [], jobs: [] };
undoStack = [];
stateCheckpoint = JSON.stringify(state);
state.jobs.push(makeJob("undo-me", "2026-08-27", "2026-08-27", 1));
saveState();
if (remoteSaveTimer) {
    clearTimeout(remoteSaveTimer);
    remoteSaveTimer = null;
}
assertEqual(undoStack.length, 1, "cronologia: passaggio registrato");
undoLastPlannerChange();
if (remoteSaveTimer) {
    clearTimeout(remoteSaveTimer);
    remoteSaveTimer = null;
}
assertEqual(state.jobs.length, 0, "cronologia: stato precedente ripristinato");
assertEqual(undoStack.length, 0, "cronologia: passaggio consumato");

console.log("Planner state scenarios: OK");
`;

vm.runInNewContext(`${source}\n${tests}`, sandbox, {
    filename: "production-planner-scripts.js",
});
