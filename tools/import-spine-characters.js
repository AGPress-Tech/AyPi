const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const sourceDir = path.resolve(
    process.argv[2] ||
        path.join(rootDir, "..", "Schale-Archive", "Spine_Characters"),
);
const targetDir = path.join(
    rootDir,
    "assets",
    "bluearchive",
    "spine",
    "characters",
);
const manifestPath = path.join(targetDir, "characters.js");
const clearOnly = process.argv.includes("--clear");

function atlasPages(atlasPath) {
    const lines = fs.readFileSync(atlasPath, "utf8").split(/\r?\n/);
    const pages = [];
    for (let index = 0; index < lines.length - 1; index += 1) {
        const candidate = lines[index].trim();
        if (candidate && /^size:/i.test(lines[index + 1])) {
            pages.push(candidate);
        }
    }
    return [...new Set(pages)];
}

function chooseSkeleton(files, atlasStem) {
    const skeletons = files.filter((name) => name.toLowerCase().endsWith(".skel"));
    return (
        skeletons.find(
            (name) =>
                path.basename(name, path.extname(name)).toLowerCase() ===
                atlasStem.toLowerCase(),
        ) ||
        skeletons.find((name) => !/_home\.skel$/i.test(name)) ||
        skeletons[0]
    );
}

if (!clearOnly && !fs.existsSync(sourceDir)) {
    throw new Error(`Cartella personaggi non trovata: ${sourceDir}`);
}

fs.rmSync(targetDir, { recursive: true, force: true });
fs.mkdirSync(targetDir, { recursive: true });

const characters = [];
const sourceEntries = clearOnly
    ? []
    : fs
          .readdirSync(sourceDir, { withFileTypes: true })
          .filter((item) => item.isDirectory())
          .sort((left, right) => left.name.localeCompare(right.name));
for (const entry of sourceEntries) {
    const characterSource = path.join(sourceDir, entry.name);
    const files = fs.readdirSync(characterSource);
    const atlasName = files.find((name) => name.toLowerCase().endsWith(".atlas"));
    if (!atlasName) continue;

    const atlasStem = path.basename(atlasName, path.extname(atlasName));
    const skeletonName = chooseSkeleton(files, atlasStem);
    if (!skeletonName) continue;

    const pages = atlasPages(path.join(characterSource, atlasName));
    if (!pages.length) continue;

    const requiredFiles = [atlasName, skeletonName, ...pages];
    if (
        requiredFiles.some(
            (name) => !fs.existsSync(path.join(characterSource, name)),
        )
    ) {
        continue;
    }

    const characterTarget = path.join(targetDir, entry.name);
    fs.mkdirSync(characterTarget, { recursive: true });
    for (const name of requiredFiles) {
        fs.copyFileSync(
            path.join(characterSource, name),
            path.join(characterTarget, name),
        );
    }

    characters.push({
        id: entry.name,
        skel: `../assets/bluearchive/spine/characters/${entry.name}/${skeletonName}`,
        atlas: `../assets/bluearchive/spine/characters/${entry.name}/${atlasName}`,
    });
}

const manifest = `window.AYPI_SPINE_CHARACTERS = ${JSON.stringify(characters, null, 2)};\n`;
fs.writeFileSync(manifestPath, manifest, "utf8");
console.log(
    clearOnly
        ? `Catalogo personaggi aggiuntivi svuotato in ${targetDir}.`
        : `Importati ${characters.length} personaggi Spine da ${sourceDir} in ${targetDir}.`,
);
