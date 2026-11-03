/* Backup offline: legge un clone iTools, non apre socket e non invia comandi al forno. */
const fs = require("fs"),
  path = require("path"),
  os = require("os");
const {
  importProgramFiles,
  readLibrary,
  exportBackupFile,
  prepareRestoreFiles,
} = require("../dist-ts/modules/forno/program-library");
const { sha256 } = require("../dist-ts/modules/forno/program-native");
const [clonePath, parent] = process.argv.slice(2);
if (!clonePath || !parent) {
  console.error(
    "Uso: node tools/backup-forno-clone.cjs <clone.uic> <cartella-backup>",
  );
  process.exit(1);
}
const source = path.resolve(clonePath),
  destination = path.resolve(parent),
  bytes = fs.readFileSync(source);
fs.mkdirSync(destination, { recursive: true });
const day = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Rome",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(Date.now());
const folder = fs.mkdtempSync(path.join(destination, "Forno_" + day + "_")),
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), "aypi-forno-backup-")),
  libraryFile = path.join(temporary, "library.json");
try {
  importProgramFiles(libraryFile, [source]);
  const copy = path.join(folder, path.basename(source));
  fs.writeFileSync(copy, bytes, { flag: "wx" });
  if (sha256(fs.readFileSync(copy)) !== sha256(bytes))
    throw Error("Copia clone non identica.");
  const archive = path.join(folder, "Programmi_forno.aypi-forno-backup.json"),
    backup = exportBackupFile(libraryFile, archive);
  const state = readLibrary(libraryFile),
    native = prepareRestoreFiles(
      libraryFile,
      folder,
      state.entries.map((e) => e.id),
      true,
    );
  const sourceDate = new Date(
    Math.trunc(fs.statSync(source).mtimeMs),
  ).toLocaleString("it-IT", { timeZone: "Europe/Rome" });
  const report = {
    sourceSnapshotAt: sourceDate,
    sourceSha256: sha256(bytes),
    programCount: backup.count,
    originalNativePrograms: backup.originals,
    backup: archive,
    originalFiles: native.path,
    deviceContacted: false,
    hardwareRestoreVerified: false,
  };
  fs.writeFileSync(
    path.join(folder, "RIEPILOGO.json"),
    JSON.stringify(report, null, 2) + "\n",
    { flag: "wx" },
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (fs.existsSync(libraryFile)) fs.unlinkSync(libraryFile);
  fs.rmdirSync(temporary);
}
