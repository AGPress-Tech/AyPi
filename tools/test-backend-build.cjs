const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { build, verify } = require('./backend-build.cjs');
const root = fs.mkdtempSync(path.resolve(__dirname, '../.tmp-backend-build-'));
function write(file, contents) {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
}
function config(rootDir, outDir) {
  return JSON.stringify({ compilerOptions: { target: 'ES2020', module: 'commonjs', types: [], skipLibCheck: true, rootDir, outDir }, include: [rootDir + '/**/*.ts'] });
}
write('backend/tsconfig.json', config('src', '../backend-dist'));
write('tsconfig.backend-app.json', config('src/backend-app', 'dist-backend-app'));
write('backend/src/main.ts', 'export const version: number = 1;');
write('src/backend-app/main.ts', 'export const ready: boolean = true;');
assert(verify(root).failures.some(f => f.includes('mancante')));
build(root, 'backend'); build(root, 'tray');
assert.deepEqual(verify(root).failures, []);
write('backend/src/analytics/new-module.ts', 'export const feature = "customer-analysis";');
build(root, 'backend');
assert.deepEqual(verify(root).failures, [], 'New modules require no frozen manifest updates');
write('backend-dist/main.js', 'obsolete');
assert(verify(root).failures.some(f => f.includes('diverso dai sorgenti')));
build(root, 'backend');
fs.unlinkSync(path.join(root, 'backend/src/analytics/new-module.ts'));
assert(verify(root).failures.some(f => f.includes('obsoleto')));
build(root, 'backend');
assert(!fs.existsSync(path.join(root, 'backend-dist/analytics/new-module.js')));
assert.deepEqual(verify(root).failures, []);
const previous = fs.readFileSync(path.join(root, 'backend-dist/main.js'), 'utf8');
write('backend/src/main.ts', 'export const version: number = "invalid";');
assert.throws(() => build(root, 'backend'), /not assignable/);
assert.equal(fs.readFileSync(path.join(root, 'backend-dist/main.js'), 'utf8'), previous, 'Type errors preserve the previous build');
write('backend/tsconfig.json', config('src', '../../outside-workspace'));
assert.throws(() => build(root, 'backend'), /outDir/);
const pkg = require('../package.json');
assert(pkg.scripts['dist:backend'].includes('verify:backend:build'));
assert(!pkg.scripts['dist:backend'].includes('verify:backend:baseline'));
console.log('OK: nuovi moduli, compilati modificati o mancanti, rimozione output obsoleti, errori TypeScript e confini delle cartelle generate.');
