const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const reviewedSources = {
    'backend-dist/modules/forno/program-recipe.js': 'backend/src/modules/forno/program-recipe.ts',
    'backend-dist/modules/forno/service.js': 'backend/src/modules/forno/service.ts',
};
const transferSources = {
    'backend-dist/modules/forno/programs.js': 'backend/src/modules/forno/programs.ts',
    'backend-dist/modules/forno/routes.js': 'backend/src/modules/forno/routes.ts',
};
const activationSources = {
    'dist-backend-app/config.js': 'src/backend-app/config.ts',
    'dist-backend-app/main.js': 'src/backend-app/main.ts',
};
const addedSources = {
    'backend-dist/modules/forno/program-transfer.js': 'backend/src/modules/forno/program-transfer.ts',
    'backend-dist/modules/forno/program-transfer-plan.js': 'backend/src/modules/forno/program-transfer-plan.ts',
};
const hash = target => crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');

/** Baseline storica immutata; le revisioni possono aggiornare soltanto i file forno espressamente esaminati. */
function verifyBackend(root, baseline, review = null) {
    const failures = [], expectedFiles = { ...baseline.files };
    if (review) {
        const sources = review.version === 3 ? { ...reviewedSources, ...transferSources, ...activationSources } : review.version === 2 ? { ...reviewedSources, ...transferSources } : reviewedSources;
        const additions = review.version >= 2 ? addedSources : {};
        if (![1, 2, 3].includes(review.version) || review.baseInstallerSha256 !== baseline.installer.sha256 || !review.overrides ||
            Object.keys(review.overrides).length !== Object.keys(sources).length ||
            Object.keys(review.overrides).some(file => !Object.hasOwn(sources, file)) ||
            Object.keys(review.additions || {}).length !== Object.keys(additions).length ||
            Object.keys(review.additions || {}).some(file => !Object.hasOwn(additions, file))) {
            failures.push('Revisione non valida o non riferita al backend storico delle 13:38.');
        } else {
            for (const [file, entry] of Object.entries({ ...review.overrides, ...review.additions })) {
                if (!entry || entry.previousSha256 !== (baseline.files[file] || null) || !/^[a-f0-9]{64}$/.test(entry.sha256) ||
                    !/^[a-f0-9]{64}$/.test(entry.sourceSha256) || entry.source !== (sources[file] || additions[file]) ||
                    typeof entry.reason !== 'string' || !entry.reason.trim()) {
                    failures.push(`${file}: dichiarazione della revisione non valida.`);
                    continue;
                }
                expectedFiles[file] = entry.sha256;
                const source = path.join(root, entry.source);
                if (!fs.existsSync(source) || hash(source) !== entry.sourceSha256) failures.push(`${entry.source}: diverso dal sorgente revisionato.`);
            }
        }
    }
    const dependencies = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).dependencies;
    for (const name of new Set([...Object.keys(dependencies), ...Object.keys(baseline.dependencies)])) {
        if (dependencies[name] !== baseline.dependencies[name]) failures.push(`dipendenza ${name}: diversa dalla versione delle 13:38`);
    }
    for (const [file, expected] of Object.entries(expectedFiles)) {
        const target = path.join(root, file);
        if (!fs.existsSync(target)) failures.push(`${file}: mancante`);
        else if (hash(target) !== expected) failures.push(`${file}: diverso ${review && Object.hasOwn({ ...review.overrides, ...review.additions }, file) ? 'dalla revisione forno verificata' : 'dalla versione delle 13:38'}`);
    }
    function checkExtraFiles(folder) {
        if (!fs.existsSync(path.join(root, folder))) return;
        for (const entry of fs.readdirSync(path.join(root, folder), { withFileTypes: true })) {
            const file = `${folder}/${entry.name}`;
            if (entry.isDirectory()) checkExtraFiles(file);
            else if (file.endsWith('.js') && !Object.hasOwn(expectedFiles, file)) failures.push(`${file}: aggiunta rispetto alla versione delle 13:38`);
        }
    }
    checkExtraFiles('backend-dist'); checkExtraFiles('dist-backend-app');
    return { failures, total: Object.keys(expectedFiles).length, reviewed: review ? Object.keys({ ...review.overrides, ...review.additions }).length : 0 };
}

if (require.main === module) {
    const historical = process.argv.includes('--historical');
    if (process.argv.slice(2).some(arg => arg !== '--historical')) throw new Error('Opzione non riconosciuta. È disponibile soltanto --historical per il confronto storico integrale.');
    const root = path.resolve(__dirname, '..');
    const baseline = require('./baselines/backend-1.4.0-1338.json');
    const review = historical ? null : require('./baselines/backend-forno-management-2026-11-03.json');
    const result = verifyBackend(root, baseline, review);
    if (result.failures.length) {
        console.error('Pacchetto backend bloccato: il contenuto non corrisponde al riferimento verificato.');
        console.error(result.failures.join('\n'));
        console.error('Esaminare le differenze prima di aggiornare i riferimenti di distribuzione.');
        process.exitCode = 1;
    } else {
        console.log(historical
            ? `Backend verificato: ${result.total} file identici all'installer 1.4.0 delle 13:38.`
            : `Backend verificato: ${result.total - result.reviewed} file identici al riferimento delle 13:38; ${result.reviewed} file forno e relativi sorgenti corrispondono alla revisione gestione programmi del 03/11/2026.`);
    }
}
module.exports = { verifyBackend };
