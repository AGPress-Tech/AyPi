const test = require("node:test"),
  assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  crypto = require("node:crypto");
const { verifyBackend } = require("./verify-backend-baseline.cjs");
const hash = (text) => crypto.createHash("sha256").update(text).digest("hex");
function fixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aypi-baseline-"));
  const write = (file, text) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  };
  const files = {
    "backend-dist/modules/forno/program-recipe.js": hash("old recipe"),
    "backend-dist/modules/forno/service.js": hash("old service"),
    "backend-dist/modules/mobile-gateway/server.js": hash("gateway"),
    "backend/scripts/install-server-task.ps1": hash("installer"),
  };
  const baseline = {
    installer: { sha256: hash("installer exe") },
    dependencies: { ws: "1.0" },
    files,
  };
  const review = {
    version: 1,
    baseInstallerSha256: baseline.installer.sha256,
    overrides: {},
  };
  write(
    "package.json",
    JSON.stringify({ dependencies: baseline.dependencies }),
  );
  write("backend-dist/modules/mobile-gateway/server.js", "gateway");
  write("backend/scripts/install-server-task.ps1", "installer");
  for (const [name, text] of [
    ["program-recipe", "new recipe"],
    ["service", "new service"],
  ]) {
    const file = `backend-dist/modules/forno/${name}.js`,
      source = `backend/src/modules/forno/${name}.ts`;
    write(file, text);
    write(source, text + " source");
    review.overrides[file] = {
      previousSha256: files[file],
      sha256: hash(text),
      source,
      sourceSha256: hash(text + " source"),
      reason: "Modifica esaminata",
    };
  }
  const verify = () => verifyBackend(root, baseline, review);
  try {
    run({ root, baseline, review, write, verify });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}
test("accetta soltanto la combinazione completa revisionata; confronto storico resta integrale", () =>
  fixture(({ root, baseline, write, verify }) => {
    assert.deepEqual(verify().failures, []);
    assert.equal(verify().reviewed, 2);
    assert.equal(verifyBackend(root, baseline).failures.length, 2);
    write("backend-dist/modules/forno/service.js", "old service");
    assert(verify().failures.some((f) => f.includes("service.js")));
  }));
test("blocca ulteriori modifiche a compilati, sorgenti e gateway", () =>
  fixture(({ write, verify }) => {
    write("backend-dist/modules/forno/program-recipe.js", "unexpected");
    write("backend/src/modules/forno/service.ts", "unexpected");
    write("backend-dist/modules/mobile-gateway/server.js", "unexpected");
    const failures = verify().failures;
    for (const name of [
      "program-recipe.js",
      "service.ts",
      "mobile-gateway/server.js",
    ])
      assert(
        failures.some((f) => f.includes(name)),
        name,
      );
  }));
test("blocca dipendenze, file mancanti e JavaScript aggiuntivi", () =>
  fixture(({ root, write, verify }) => {
    write("package.json", JSON.stringify({ dependencies: { ws: "2.0" } }));
    write("backend-dist/extra.js", "extra");
    fs.unlinkSync(path.join(root, "backend/scripts/install-server-task.ps1"));
    const failures = verify().failures;
    for (const name of [
      "dipendenza ws",
      "extra.js",
      "install-server-task.ps1: mancante",
    ])
      assert(
        failures.some((f) => f.includes(name)),
        name,
      );
  }));
test("rifiuta revisioni estese e riferimenti storici diversi", () =>
  fixture(({ review, verify }) => {
    review.overrides["backend-dist/modules/mobile-gateway/server.js"] = {
      sha256: hash("gateway"),
    };
    assert(verify().failures.some((f) => f.includes("Revisione non valida")));
    delete review.overrides["backend-dist/modules/mobile-gateway/server.js"];
    review.overrides["backend-dist/modules/forno/service.js"].previousSha256 =
      hash("other");
    assert(verify().failures.some((f) => f.includes("dichiarazione")));
  }));

test("revisione trasferimenti: quattro override e due aggiunte, sorgenti esatti e nessuna estensione arbitraria", () =>
  fixture(({ root, baseline, review, write }) => {
    review.version = 2;
    review.additions = {};
    for (const name of [
      "programs",
      "routes",
      "program-transfer",
      "program-transfer-plan",
    ]) {
      const file = `backend-dist/modules/forno/${name}.js`,
        source = `backend/src/modules/forno/${name}.ts`,
        old = "old " + name,
        current = "reviewed " + name;
      const addition = name.startsWith("program-transfer");
      if (!addition) baseline.files[file] = hash(old);
      write(file, current);
      write(source, current + " source");
      (addition ? review.additions : review.overrides)[file] = {
        previousSha256: addition ? null : hash(old),
        sha256: hash(current),
        source,
        sourceSha256: hash(current + " source"),
        reason: "Trasferimenti verificati",
      };
    }
    assert.deepEqual(verifyBackend(root, baseline, review).failures, []);
    assert.equal(verifyBackend(root, baseline, review).reviewed, 6);
    write("backend/src/modules/forno/program-transfer.ts", "changed");
    assert(
      verifyBackend(root, baseline, review).failures.some((f) =>
        f.includes("program-transfer.ts"),
      ),
    );
    review.additions["backend-dist/unknown.js"] = {};
    assert(
      verifyBackend(root, baseline, review).failures.some((f) =>
        f.includes("Revisione non valida"),
      ),
    );
  }));

test("revisione tests automatico: ammette solo i due file launcher esaminati in aggiunta ai trasferimenti", () =>
  fixture(({ root, baseline, review, write }) => {
    review.version = 3;
    review.additions = {};
    const sources = {
      "backend-dist/modules/forno/programs.js":
        "backend/src/modules/forno/programs.ts",
      "backend-dist/modules/forno/routes.js":
        "backend/src/modules/forno/routes.ts",
      "dist-backend-app/config.js": "src/backend-app/config.ts",
      "dist-backend-app/main.js": "src/backend-app/main.ts",
      "backend-dist/modules/forno/program-transfer.js":
        "backend/src/modules/forno/program-transfer.ts",
      "backend-dist/modules/forno/program-transfer-plan.js":
        "backend/src/modules/forno/program-transfer-plan.ts",
    };
    for (const [file, source] of Object.entries(sources)) {
      const addition = file.includes("/program-transfer"),
        current = "reviewed " + file,
        old = "old " + file;
      if (!addition) baseline.files[file] = hash(old);
      write(file, current);
      write(source, current + " source");
      (addition ? review.additions : review.overrides)[file] = {
        previousSha256: addition ? null : hash(old),
        sha256: hash(current),
        source,
        sourceSha256: hash(current + " source"),
        reason: "Modifica esaminata",
      };
    }
    assert.deepEqual(verifyBackend(root, baseline, review).failures, []);
    assert.equal(verifyBackend(root, baseline, review).reviewed, 8);
    write("src/backend-app/main.ts", "unexpected launcher change");
    assert(
      verifyBackend(root, baseline, review).failures.some((f) =>
        f.includes("src/backend-app/main.ts"),
      ),
    );
  }));
