// Acquire a stable, read-only Access snapshot for the corporate backend installer.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..'), folder = path.join(root, '.private', 'measurement'); fs.mkdirSync(folder, { recursive: true });
const source = require('../dist-ts/config/paths').MODULI_FILES[3], copy = path.join(folder, 'source.accdb'), output = path.join(folder, 'measurement-import.json'), seed = path.join(root, '.private', 'measurement-instruments-import.json');
const hash = b => crypto.createHash('sha256').update(b).digest('hex'); let digest = '';
for (let n = 0; n < 3; n++) { const bytes = fs.readFileSync(source); fs.writeFileSync(copy, bytes); if (hash(bytes) === hash(fs.readFileSync(source))) { digest = hash(bytes); break } }
if (!digest) throw Error('Access cambia durante la copia: ripetere la lettura.');
execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'src/renderer/scripts/measurement-instruments-access.ps1'), '-Source', copy, '-Output', output], { windowsHide: true, timeout: 120000 });
const input = { ...JSON.parse(fs.readFileSync(output, 'utf8')), source }, clean = require('../backend-dist/modules/measurement-instruments/model').cleanImport(input);
if (clean.issues.some(i => i.excluded)) throw Error('Strumenti esclusi: verificare il rapporto prima di predisporre la migrazione.');
fs.writeFileSync(seed, JSON.stringify(input)); fs.writeFileSync(path.join(folder, 'migration-report.json'), JSON.stringify({ at: new Date().toISOString(), source, sourceHash: digest, instruments: clean.instruments.length, baselineDates: clean.calibrations.length, nst: clean.instruments.filter(i => i.mode === 'nst').length, issues: clean.issues, sourceOpenedReadOnly: true, operationalDatabaseWritten: false }, null, 2));
console.log(JSON.stringify({ instruments: clean.instruments.length, baselineDates: clean.calibrations.length, issues: clean.issues.length, seed: '.private/measurement-instruments-import.json', report: '.private/measurement/migration-report.json' }));
