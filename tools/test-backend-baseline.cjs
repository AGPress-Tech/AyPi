const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
const { verifyBackend } = require('./verify-backend-baseline.cjs');
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
function fixture(run) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aypi-baseline-'));
    const write = (file, text) => { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), text); };
    const files = { 'backend-dist/modules/forno/program-recipe.js': hash('old recipe'), 'backend-dist/modules/forno/service.js': hash('old service'), 'backend-dist/modules/mobile-gateway/server.js': hash('gateway'), 'backend/scripts/install-server-task.ps1': hash('installer') };
    const baseline = { installer: { sha256: hash('installer exe') }, dependencies: { ws: '1.0' }, files };
    const review = { version: 1, baseInstallerSha256: baseline.installer.sha256, overrides: {} };
    write('package.json', JSON.stringify({ dependencies: baseline.dependencies }));
    write('backend-dist/modules/mobile-gateway/server.js', 'gateway'); write('backend/scripts/install-server-task.ps1', 'installer');
    for (const [name, text] of [['program-recipe', 'new recipe'], ['service', 'new service']]) {
        const file = `backend-dist/modules/forno/${name}.js`, source = `backend/src/modules/forno/${name}.ts`;
        write(file, text); write(source, text + ' source');
        review.overrides[file] = { previousSha256: files[file], sha256: hash(text), source, sourceSha256: hash(text + ' source'), reason: 'Modifica esaminata' };
    }
    const verify = () => verifyBackend(root, baseline, review);
    try { run({ root, baseline, review, write, verify }); } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
test('accetta soltanto la combinazione completa revisionata; confronto storico resta integrale', () => fixture(({ root, baseline, write, verify }) => {
    assert.deepEqual(verify().failures, []); assert.equal(verify().reviewed, 2);
    assert.equal(verifyBackend(root, baseline).failures.length, 2);
    write('backend-dist/modules/forno/service.js', 'old service'); assert(verify().failures.some(f => f.includes('service.js')));
}));
test('blocca ulteriori modifiche a compilati, sorgenti e gateway', () => fixture(({ write, verify }) => {
    write('backend-dist/modules/forno/program-recipe.js', 'unexpected'); write('backend/src/modules/forno/service.ts', 'unexpected'); write('backend-dist/modules/mobile-gateway/server.js', 'unexpected');
    const failures = verify().failures;
    for (const name of ['program-recipe.js', 'service.ts', 'mobile-gateway/server.js']) assert(failures.some(f => f.includes(name)), name);
}));
test('blocca dipendenze, file mancanti e JavaScript aggiuntivi', () => fixture(({ root, write, verify }) => {
    write('package.json', JSON.stringify({ dependencies: { ws: '2.0' } })); write('backend-dist/extra.js', 'extra'); fs.unlinkSync(path.join(root, 'backend/scripts/install-server-task.ps1'));
    const failures = verify().failures;
    for (const name of ['dipendenza ws', 'extra.js', 'install-server-task.ps1: mancante']) assert(failures.some(f => f.includes(name)), name);
}));
test('rifiuta revisioni estese e riferimenti storici diversi', () => fixture(({ review, verify }) => {
    review.overrides['backend-dist/modules/mobile-gateway/server.js'] = { sha256: hash('gateway') }; assert(verify().failures.some(f => f.includes('Revisione non valida')));
    delete review.overrides['backend-dist/modules/mobile-gateway/server.js']; review.overrides['backend-dist/modules/forno/service.js'].previousSha256 = hash('other'); assert(verify().failures.some(f => f.includes('dichiarazione')));
}));
