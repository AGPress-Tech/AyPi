const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("fs"),
  os = require("os"),
  path = require("path");
function compile(file) {
  const m = { exports: {} };
  const source = require("esbuild").buildSync({
    entryPoints: [file],
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
  }).outputFiles[0].text;
  new Function("module", "exports", "require", source)(m, m.exports, require);
  return m.exports;
}
const model = compile("src/main/modules/forno/program-draft.ts"),
  store = compile("src/main/modules/forno/program-draft-store.ts");
const {
  newProgramDraft,
  validateDraft,
  parseDeci,
  parseDuration,
  formatDuration,
  addStep,
  changeStep,
  changeStart,
  removeStep,
  draftTimeline,
  moveDraftPoint,
  insertDraftPoint,
  reviewDraft,
  draftFromRecipe,
} = model;
const example = () => addStep(addStep(newProgramDraft(), "ramp"), "dwell");
const complete = (d) =>
  d.steps.at(-1)?.kind === "end" ? d : addStep(d, "end");

test("precisione: tempi in ms e decimi senza arrotondare input fuori risoluzione", () => {
  assert.equal(parseDeci("530,1"), 5301);
  assert.equal(parseDeci("-0.1"), -1);
  for (const value of ["", "530.12", "NaN", "Infinity", "1e2", "10000.1"])
    assert.throws(() => parseDeci(value));
  for (const ms of [1, 999, 1000, 59999, 3600000, 1800000000])
    assert.equal(parseDuration(formatDuration(ms)), ms);
  assert.equal(parseDuration("02:30:00.250"), 9000250);
  for (const value of [
    "0",
    "00:00:00",
    "00:60:00",
    "00:00:60",
    "500:00:00.001",
    "1:00:00.0001",
  ])
    assert.throws(() => parseDuration(value));
});
test("rampe/soste: un solo modello e propagazione dei plateau senza alterare durate o eventi", () => {
  let d = example();
  d = changeStep(d, 0, {
    targetDeciC: 5301,
    durationMs: 9000250,
    events: [true, false, true],
  });
  assert.equal(d.steps[1].targetDeciC, 5301);
  assert.equal(d.steps[1].durationMs, 3600000);
  assert.deepEqual(d.steps[1].events, [false, false, false]);
  const r = reviewDraft(complete(d));
  assert.equal(r.instructions[0].durationMs, 9000250);
  assert.equal(r.instructions[0].targetC, 530.1);
  assert.equal(r.instructions[0].targetFloat32C, Math.fround(530.1));
  assert.equal(r.instructions[1].fromMs, 9000250);
  assert.equal(r.durationMs, 12600250);
  assert.throws(
    () =>
      validateDraft({
        ...d,
        steps: [d.steps[0], { ...d.steps[1], targetDeciC: 1 }],
      }),
    /stasi/,
  );
  const firstDwell = addStep(newProgramDraft(), "dwell");
  assert.equal(changeStart(firstDwell, 350).steps[0].targetDeciC, 350);
  const removed = removeStep(d, 0);
  assert.equal(removed.steps[0].targetDeciC, d.startDeciC);
});
test("grafico: trascinamento conserva durata delle fasi successive, sosta bloccata in temperatura", () => {
  const d = example(),
    before = JSON.stringify(d),
    moved = moveDraftPoint(d, 0, 5400123, 4000);
  assert.equal(moved.steps[0].durationMs, 5400123);
  assert.equal(moved.steps[1].durationMs, 3600000);
  assert.equal(moved.steps[1].targetDeciC, 4000);
  assert.equal(
    moveDraftPoint(moved, 1, 10000000, 9999).steps[1].targetDeciC,
    4000,
  );
  assert.throws(() => moveDraftPoint(d, 0, 0, 2000));
  assert.equal(JSON.stringify(d), before);
});
test("disegno: divisione rampa conserva fine, durata totale e comandi; errori senza modifiche parziali", () => {
  let d = changeStep(example(), 0, {
    events: [true, false, true],
    userValueDeci: 50,
  });
  const before = JSON.stringify(d);
  const split = insertDraftPoint(d, 1800000, 900, "ramp");
  assert.equal(split.steps.length, 3);
  assert.equal(split.steps[1].targetDeciC, d.steps[0].targetDeciC);
  assert.equal(
    reviewDraft(complete(split)).durationMs,
    reviewDraft(complete(d)).durationMs,
  );
  assert.deepEqual(split.steps[1].events, [true, false, true]);
  assert.equal(split.steps[1].userValueDeci, 50);
  assert.throws(() => insertDraftPoint(d, 5400000, 900, "ramp"), /rampa/);
  assert.equal(JSON.stringify(d), before);
  const append = insertDraftPoint(d, 9000000, 3000, "ramp");
  assert.equal(reviewDraft(complete(append)).durationMs, 9000000);
  assert.equal(append.steps[2].targetDeciC, 3000);
});
test("limiti, schema futuro e tipi non gestiti bloccati; nessun evento mancante diventa OFF", () => {
  let d = newProgramDraft();
  for (let i = 0; i < 25; i++) d = addStep(d, "dwell");
  assert.throws(() => addStep(d, "ramp"), /25/);
  assert.throws(() => validateDraft({ ...d, version: 3 }), /Formato/);
  assert.throws(() => validateDraft({ ...d, nativeCommand: "Run" }), /campi/);
  for (const events of [[], [false, false], [0, 1, 0], [null, false, false]])
    assert.throws(() => changeStep(d, 0, { events }));
  assert.throws(() => reviewDraft(newProgramDraft()), /almeno/);
});
test("importazione ciclo 1 reale: Fine esplicita e parametri preservati; Wait supportato, rate e due canali rifiutati", () => {
  const {
    decodeRecipeSegment,
  } = require("../backend-dist/modules/forno/program-recipe"),
    f = require("./fixtures/forno-cycle1-2026-11-02.json");
  const recipe = {
    name: "Ciclo_1_530_8h",
    readAtMs: 1,
    channels: 1,
    rampStyle: 0,
    maxEvents: 3,
    features: { holdback: false, pvEvents: false },
    holdback: [],
    segments: f.segments.map((s) =>
      decodeRecipeSegment(s.number, String(s.number), s.words, 1),
    ),
  };
  const d = draftFromRecipe(recipe);
  assert.equal(d.steps.length, 8);
  assert.equal(reviewDraft(complete(d)).durationMs, 39630000);
  assert.deepEqual(d.steps[6].events, [true, true, true]);
  assert.equal(d.steps[1].userValueDeci, 50);
  assert.equal(d.startDeciC, 200);
  for (const patch of [
    { channels: 2 },
    { rampStyle: 1 },
    { features: { holdback: true } },
    { maxEvents: 8 },
  ])
    assert.throws(() => draftFromRecipe({ ...recipe, ...patch }));
  const changed = structuredClone(recipe);
  changed.segments[2].type = 4;
  assert.equal(reviewDraft(draftFromRecipe(changed)).durationMs, null);
  const precision = structuredClone(recipe);
  precision.segments[0].targets = [200.123];
  assert.throws(() => draftFromRecipe(precision), /rappresentabili/);
});
test("salvataggio locale atomico e rilettura: file corrotto esplicito, input invalido conserva precedente", () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "aypi-program-draft-")),
    file = path.join(folder, "draft.json");
  try {
    assert.equal(store.readProgramDraft(file), null);
    const d = example();
    assert.deepEqual(store.writeProgramDraft(file, d), d);
    assert.deepEqual(store.readProgramDraft(file), d);
    assert.throws(() => store.writeProgramDraft(file, { ...d, name: "" }));
    assert.deepEqual(store.readProgramDraft(file), d);
    assert.deepEqual(fs.readdirSync(folder), ["draft.json"]);
    fs.writeFileSync(file, '{"format":');
    assert.throws(() => store.readProgramDraft(file));
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
});

test("Fine esplicita: nuove bozze vuote, export/verifica bloccati senza Fine; migrazione v1 conserva la chiusura precedente", () => {
  assert.deepEqual(newProgramDraft().steps, []);
  assert.throws(() => reviewDraft(example()), /Manca la fase Fine/);
  let d = complete(example());
  assert.equal(d.steps.at(-1).kind, "end");
  assert.throws(() => addStep(d, "end"), /già presente/);
  d = removeStep(d, d.steps.length - 1);
  assert.throws(() => reviewDraft(d), /Manca/);
  const legacy = {
    ...example(),
    version: 1,
    endType: "reset",
    endLabel: "Chiusura",
  };
  const migrated = validateDraft(legacy);
  assert.equal(migrated.version, 2);
  assert.equal(migrated.steps.at(-1).label, "Chiusura");
  assert.equal(migrated.steps.at(-1).endAction, "reset");
  assert.equal(legacy.steps.length, 2);
  const hold = changeStep(migrated, migrated.steps.length - 1, {
    endAction: "dwell",
    events: [false, true, false],
  });
  assert.equal(reviewDraft(hold).durationMs, null);
  assert.equal(model.buildDraftProfile(hold).durationMs, null);
});
test("Step istantaneo e Wait configurabile: grafico si ferma all’attesa, senza cancellare le fasi successive", () => {
  let d = addStep(newProgramDraft(), "step");
  d = changeStep(d, 0, { targetDeciC: 3500 });
  d = addStep(d, "wait");
  d = changeStep(d, 1, { waitFor: 1, waitCondition: 2, waitValueDeci: 3000 });
  d = addStep(d, "ramp");
  d = complete(d);
  const profile = model.buildDraftProfile(d);
  assert.equal(profile.durationMs, null);
  assert.equal(profile.points.at(-1).x, 0);
  assert.equal(profile.points.at(-1).y, 350);
  assert.equal(d.steps.length, 4);
  assert.equal(reviewDraft(d).durationMs, null);
  assert.equal(reviewDraft(d).instructions[1].waitValue, 300);
  assert.throws(() => changeStep(d, 1, { waitFor: 2 }), /CH1/);
});
test("GoBack finito, continuo e limite anteprima; loop annidati e destinazioni perse bloccati", () => {
  let d = addStep(example(), "goback");
  d = changeStep(d, 2, { goBackTo: 1, cycles: 2 });
  d = complete(d);
  assert.equal(reviewDraft(d).durationMs, 21600000);
  assert.equal(model.buildDraftProfile(d).shownMs, 21600000);
  assert.throws(() => removeStep(d, 0), /destinazione/);
  const inserted = addStep(d, "step", -1);
  assert.equal(inserted.steps[3].goBackTo, 2);
  assert.equal(reviewDraft(changeStep(d, 2, { cycles: 0 })).durationMs, null);
  assert(
    model
      .buildDraftProfile(changeStep(d, 2, { cycles: 32767 }))
      .warnings.some((w) => w.includes("500")),
  );
  const separate = addStep(addStep(d, "ramp"), "goback", 3);
  assert.throws(() => changeStep(separate, 4, { goBackTo: 1 }), /annidati/);
});

test("riordino atomico: durate/eventi/nomi conservati, plateau ricalcolati e GoBack segue la destinazione", () => {
  let d = changeStep(example(), 0, {
    label: "Rampa A",
    targetDeciC: 5301,
    durationMs: 9000250,
    events: [true, false, true],
  });
  d = addStep(d, "ramp");
  d = changeStep(d, 2, {
    label: "Rampa B",
    targetDeciC: 6000,
    events: [false, true, false],
  });
  d = complete(d);
  const original = structuredClone(d);
  const moved = model.reorderStep(d, 2, 0);
  assert.deepEqual(
    moved.steps.map((s) => s.label),
    ["Rampa B", "Rampa A", "", ""],
  );
  assert.deepEqual(moved.steps[1], d.steps[0]);
  assert.equal(moved.steps[2].targetDeciC, 5301);
  assert.equal(moved.steps.at(-1).targetDeciC, 5301);
  assert.deepEqual(d, original);
  assert.throws(() => model.reorderStep(d, 0, 3), /Fine/);
  assert.throws(() => model.reorderStep(d, 3, 0), /Fine/);
  const inserted = addStep(d, "dwell", 1);
  assert.equal(inserted.steps[2].kind, "dwell");
  assert.equal(inserted.steps[3].label, "Rampa B");
  let loop = addStep(example(), "goback");
  loop = changeStep(loop, 2, { goBackTo: 1, cycles: 2 });
  loop = complete(loop);
  const remapped = model.reorderStep(loop, 0, 1);
  assert.equal(remapped.steps[2].goBackTo, 2);
  assert.equal(remapped.steps[0].targetDeciC, loop.startDeciC);
  assert.throws(() => model.reorderStep(loop, 0, 2), /precedente/);
  assert.equal(loop.steps[2].goBackTo, 1);
});
