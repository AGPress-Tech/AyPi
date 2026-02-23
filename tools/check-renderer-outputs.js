const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist-ts');

const rendererRoots = [
  path.join(rootDir, 'scripts'),
  path.join(rootDir, 'templates'),
  path.join(rootDir, 'Guida', 'assets'),
];

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

function collectRendererFiles() {
  const files = [];
  for (const root of rendererRoots) walk(root, files);
  return files;
}

const files = collectRendererFiles();
let seenTs = 0;
let missing = 0;

for (const filePath of files) {
  const ext = path.extname(filePath);
  if (ext !== '.ts') continue;
  seenTs++;
  const rel = path.relative(rootDir, filePath);
  const outPath = path.join(distDir, rel).replace(/\.ts$/i, '.js');
  if (!fs.existsSync(outPath)) {
    if (missing < 20) {
      console.log('Missing:', rel);
    }
    missing++;
  }
}

console.log('TS files:', seenTs, 'missing outputs:', missing);
