const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const baseline = require('./baselines/backend-1.4.0-1338.json');
const failures = [];
const dependencies = require('../package.json').dependencies;
for (const name of new Set([...Object.keys(dependencies), ...Object.keys(baseline.dependencies)])) {
    if (dependencies[name] !== baseline.dependencies[name]) failures.push(`dipendenza ${name}: diversa dalla versione delle 13:38`);
}
for (const [file, expected] of Object.entries(baseline.files)) {
    const target = path.join(root, file);
    if (!fs.existsSync(target)) {
        failures.push(`${file}: mancante`);
        continue;
    }
    const actual = crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
    if (actual !== expected) failures.push(`${file}: diverso dalla versione delle 13:38`);
}
function checkExtraFiles(folder) {
    if (!fs.existsSync(path.join(root, folder))) return;
    for (const entry of fs.readdirSync(path.join(root, folder), { withFileTypes: true })) {
        const file = `${folder}/${entry.name}`;
        if (entry.isDirectory()) checkExtraFiles(file);
        else if (file.endsWith('.js') && !Object.hasOwn(baseline.files, file)) failures.push(`${file}: aggiunta rispetto alla versione delle 13:38`);
    }
}
checkExtraFiles('backend-dist');
checkExtraFiles('dist-backend-app');
if (failures.length) {
    console.error('Pacchetto backend bloccato: il ripristino delle 13:38 non corrisponde.');
    console.error(failures.join('\n'));
    console.error('Esaminare le differenze prima di autorizzare una nuova versione del backend.');
    process.exitCode = 1;
} else {
    console.log(`Backend verificato: ${Object.keys(baseline.files).length} file identici all'installer 1.4.0 delle 13:38.`);
}
