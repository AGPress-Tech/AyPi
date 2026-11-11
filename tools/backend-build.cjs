const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const targets = {
  backend: { config: 'backend/tsconfig.json', output: 'backend-dist' },
  tray: { config: 'tsconfig.backend-app.json', output: 'dist-backend-app' },
};

function compile(root, name) {
  const target = targets[name];
  if (!target) throw new Error(`Target backend sconosciuto: ${name}`);
  root = path.resolve(root);
  const configPath = path.join(root, target.config);
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config || {}, ts.sys, path.dirname(configPath));
  const diagnostics = [...(config.error ? [config.error] : []), ...parsed.errors];
  const output = path.resolve(root, target.output);
  // Only these two generated directories directly inside the workspace can be rebuilt.
  if (path.dirname(output) !== root || path.resolve(parsed.options.outDir || '') !== output) {
    throw new Error(`${target.config}: outDir deve essere ${target.output} nella cartella del progetto.`);
  }
  const program = ts.createProgram(parsed.fileNames, { ...parsed.options, noEmit: false, noEmitOnError: true });
  diagnostics.push(...ts.getPreEmitDiagnostics(program));
  const files = new Map();
  const emitted = program.emit(undefined, (file, text, bom) => {
    const absolute = path.resolve(file);
    if (!absolute.startsWith(output + path.sep)) throw new Error(`Output fuori dalla cartella compilata: ${file}`);
    files.set(absolute, Buffer.from((bom ? '\uFEFF' : '') + text));
  });
  diagnostics.push(...emitted.diagnostics);
  const errors = diagnostics.filter(d => d.category === ts.DiagnosticCategory.Error);
  if (errors.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(errors, {
    getCanonicalFileName: file => file,
    getCurrentDirectory: () => root,
    getNewLine: () => '\n',
  }));
  if (emitted.emitSkipped || !files.size) throw new Error(`${target.config}: nessun file compilato.`);
  return { root, output, files };
}

function build(root, name) {
  // Compile and type-check before replacing the previous generated output.
  const result = compile(root, name);
  fs.rmSync(result.output, { recursive: true, force: true });
  for (const [file, contents] of result.files) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents);
  }
  return result.files.size;
}

function verify(root) {
  const failures = [];
  let count = 0;
  for (const name of Object.keys(targets)) {
    const result = compile(root, name);
    count += result.files.size;
    for (const [file, expected] of result.files) {
      const relative = path.relative(result.root, file);
      if (!fs.existsSync(file)) failures.push(`${relative}: compilato mancante; ricompilare il backend.`);
      else if (!fs.readFileSync(file).equals(expected)) failures.push(`${relative}: compilato diverso dai sorgenti attuali; ricompilare il backend.`);
    }
    function walk(directory) {
      if (!fs.existsSync(directory)) return;
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) walk(file);
        else if (!result.files.has(file)) failures.push(`${path.relative(result.root, file)}: output obsoleto o estraneo; ricompilare il backend.`);
      }
    }
    walk(result.output);
  }
  return { failures, count };
}

function main() {
  const root = path.resolve(__dirname, '..');
  const [mode, target, ...extra] = process.argv.slice(2);
  if (mode === 'build' && targets[target] && !extra.length) {
    console.log(`${target}: ${build(root, target)} file compilati; output precedenti sostituiti.`);
  } else if (mode === 'verify' && !target) {
    const result = verify(root);
    if (result.failures.length) throw new Error(result.failures.join('\n'));
    console.log(`Backend verificato: ${result.count} compilati corrispondono ai sorgenti attuali.`);
  } else throw new Error('Uso: node tools/backend-build.cjs build backend|tray oppure verify');
}

if (require.main === module) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { build, verify };
