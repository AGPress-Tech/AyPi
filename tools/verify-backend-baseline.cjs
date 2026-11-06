const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const reviewedSources = {
  "backend-dist/modules/forno/program-recipe.js":
    "backend/src/modules/forno/program-recipe.ts",
  "backend-dist/modules/forno/service.js":
    "backend/src/modules/forno/service.ts",
};
const transferSources = {
  "backend-dist/modules/forno/programs.js":
    "backend/src/modules/forno/programs.ts",
  "backend-dist/modules/forno/routes.js": "backend/src/modules/forno/routes.ts",
};
const activationSources = {
  "dist-backend-app/config.js": "src/backend-app/config.ts",
  "dist-backend-app/main.js": "src/backend-app/main.ts",
};
const addedSources = {
  "backend-dist/modules/forno/program-transfer.js":
    "backend/src/modules/forno/program-transfer.ts",
  "backend-dist/modules/forno/program-transfer-plan.js":
    "backend/src/modules/forno/program-transfer-plan.ts",
};
const hash = (target) =>
  crypto.createHash("sha256").update(fs.readFileSync(target)).digest("hex");
const analyticsOverrides = {
  "backend-dist/app.js": "backend/src/app.ts",
  "backend-dist/routes/index.js": "backend/src/routes/index.ts",
};
const analyticsAdditions = Object.fromEntries(["catalog", "config", "routes", "service"].map(name =>
  [`backend-dist/modules/analytics/${name}.js`, `backend/src/modules/analytics/${name}.ts`]));
analyticsAdditions["backend/scripts/configure-sql-analytics.ps1"] = "backend/scripts/configure-sql-analytics.ps1";
function applyAnalyticsReview(root, baseline, review, extension, expectedFiles, failures) {
  if (!extension) return {};
  const baseReviewHash = crypto.createHash("sha256").update(JSON.stringify(review)).digest("hex");
  const exactKeys = (object, expected) => object && Object.keys(object).length === Object.keys(expected).length && Object.keys(object).every(key => Object.hasOwn(expected, key));
  if (extension.version !== 1 || extension.baseInstallerSha256 !== baseline.installer.sha256 || extension.baseReviewSha256 !== baseReviewHash
      || !exactKeys(extension.overrides, analyticsOverrides) || !exactKeys(extension.additions, analyticsAdditions)
      || !exactKeys(extension.dependencies, {mssql:1}) || extension.dependencies.mssql !== "^12.7.14"
      || !/^[a-f0-9]{64}$/.test(extension.packageLockSha256 || "")) {
    failures.push("Revisione analisi SQL non valida o estesa oltre il perimetro autorizzato."); return {};
  }
  const lock = path.join(root,"package-lock.json");
  if (!fs.existsSync(lock) || hash(lock) !== extension.packageLockSha256) failures.push("package-lock.json: diverso dalla revisione analisi SQL.");
  for (const [file, entry] of Object.entries({...extension.overrides, ...extension.additions})) {
    const source = analyticsOverrides[file] || analyticsAdditions[file];
    if (!entry || entry.source !== source || entry.previousSha256 !== (expectedFiles[file] || null)
        || !/^[a-f0-9]{64}$/.test(entry.sha256 || "") || !/^[a-f0-9]{64}$/.test(entry.sourceSha256 || "") || !entry.reason) {
      failures.push(`${file}: dichiarazione della revisione SQL non valida.`); continue;
    }
    expectedFiles[file] = entry.sha256;
    const sourcePath = path.join(root,source);
    if (!fs.existsSync(sourcePath) || hash(sourcePath) !== entry.sourceSha256) failures.push(`${source}: diverso dal sorgente SQL revisionato.`);
  }
  return extension.dependencies;
}

/** Baseline storica immutata; Forno e SQL hanno revisioni separate e perimetri espliciti. */
function verifyBackend(root, baseline, review = null, analyticsReview = null) {
  const failures = [],
    expectedFiles = { ...baseline.files };
  if (review) {
    const sources =
      review.version === 3
        ? { ...reviewedSources, ...transferSources, ...activationSources }
        : review.version === 2
          ? { ...reviewedSources, ...transferSources }
          : reviewedSources;
    const additions = review.version >= 2 ? addedSources : {};
    if (
      ![1, 2, 3].includes(review.version) ||
      review.baseInstallerSha256 !== baseline.installer.sha256 ||
      !review.overrides ||
      Object.keys(review.overrides).length !== Object.keys(sources).length ||
      Object.keys(review.overrides).some(
        (file) => !Object.hasOwn(sources, file),
      ) ||
      Object.keys(review.additions || {}).length !==
      Object.keys(additions).length ||
      Object.keys(review.additions || {}).some(
        (file) => !Object.hasOwn(additions, file),
      )
    ) {
      failures.push(
        "Revisione non valida o non riferita al backend storico delle 13:38.",
      );
    } else {
      for (const [file, entry] of Object.entries({
        ...review.overrides,
        ...review.additions,
      })) {
        if (
          !entry ||
          entry.previousSha256 !== (baseline.files[file] || null) ||
          !/^[a-f0-9]{64}$/.test(entry.sha256) ||
          !/^[a-f0-9]{64}$/.test(entry.sourceSha256) ||
          entry.source !== (sources[file] || additions[file]) ||
          typeof entry.reason !== "string" ||
          !entry.reason.trim()
        ) {
          failures.push(`${file}: dichiarazione della revisione non valida.`);
          continue;
        }
        expectedFiles[file] = entry.sha256;
        const source = path.join(root, entry.source);
        if (!fs.existsSync(source) || hash(source) !== entry.sourceSha256)
          failures.push(`${entry.source}: diverso dal sorgente revisionato.`);
      }
    }
  }
  const sqlDependencies = applyAnalyticsReview(root, baseline, review, analyticsReview, expectedFiles, failures);
  const expectedDependencies = {...baseline.dependencies, ...sqlDependencies};
  const dependencies = JSON.parse(
    fs.readFileSync(path.join(root, "package.json"), "utf8"),
  ).dependencies;
  for (const name of new Set([
    ...Object.keys(dependencies),
    ...Object.keys(expectedDependencies),
  ])) {
    if (dependencies[name] !== expectedDependencies[name])
      failures.push(`dipendenza ${name}: diversa dalla versione delle 13:38`);
  }
  for (const [file, expected] of Object.entries(expectedFiles)) {
    const target = path.join(root, file);
    if (!fs.existsSync(target)) failures.push(`${file}: mancante`);
    else if (hash(target) !== expected)
      failures.push(
        `${file}: diverso ${review && Object.hasOwn({ ...review.overrides, ...review.additions }, file) ? "dalla revisione forno verificata" : "dalla versione delle 13:38"}`,
      );
  }
  function checkExtraFiles(folder) {
    if (!fs.existsSync(path.join(root, folder))) return;
    for (const entry of fs.readdirSync(path.join(root, folder), {
      withFileTypes: true,
    })) {
      const file = `${folder}/${entry.name}`;
      if (entry.isDirectory()) checkExtraFiles(file);
      else if (file.endsWith(".js") && !Object.hasOwn(expectedFiles, file))
        failures.push(`${file}: aggiunta rispetto alla versione delle 13:38`);
    }
  }
  checkExtraFiles("backend-dist");
  checkExtraFiles("dist-backend-app");
  return {
    failures,
    total: Object.keys(expectedFiles).length,
    reviewed: (review
      ? Object.keys({ ...review.overrides, ...review.additions }).length
      : 0) + (analyticsReview ? Object.keys({...analyticsReview.overrides,...analyticsReview.additions}).length : 0),
  };
}

if (require.main === module) {
  if (process.argv.length === 2) {
    require('./verify-backend-release.cjs').main();
  } else {
  const historical = process.argv.includes("--historical");
  if (process.argv.slice(2).some((arg) => !['--historical','--legacy-reviewed'].includes(arg)))
    throw new Error(
      "Opzione non riconosciuta. È disponibile soltanto --historical per il confronto storico integrale.",
    );
  const root = path.resolve(__dirname, "..");
  const baseline = require("./baselines/backend-1.4.0-1338.json");
  const review = historical
    ? null
    : require("./baselines/backend-forno-management-2026-11-03.json");
  const analyticsReview = historical ? null : require("./baselines/backend-analytics-2026-11-06.json");
  const result = verifyBackend(root, baseline, review, analyticsReview);
  if (result.failures.length) {
    console.error(
      "Pacchetto backend bloccato: il contenuto non corrisponde al riferimento verificato.",
    );
    console.error(result.failures.join("\n"));
    console.error(
      "Esaminare le differenze prima di aggiornare i riferimenti di distribuzione.",
    );
    process.exitCode = 1;
  } else {
    console.log(
      historical
        ? `Backend verificato: ${result.total} file identici all'installer 1.4.0 delle 13:38.`
        : `Backend verificato: revisione forno del 03/11/2026 preservata; analisi SQL e dipendenza mssql corrispondono al perimetro verificato del 06/11/2026.`,
    );
  }
  }
}
module.exports = { verifyBackend };
