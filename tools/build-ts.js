const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist-ts");

function rmDir(target) {
    if (fs.existsSync(target)) {
        fs.rmSync(target, { recursive: true, force: true });
    }
}

function copyDir(src, dest, opts = {}) {
    if (!fs.existsSync(src)) return;
    fs.mkdirSync(dest, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
            copyDir(srcPath, destPath, opts);
        } else if (entry.isFile()) {
            if (opts.skipExt && opts.skipExt.includes(path.extname(entry.name))) {
                continue;
            }
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

rmDir(distDir);

// Copy non-JS/TS runtime assets
copyDir(path.join(rootDir, "assets"), path.join(distDir, "assets"));
copyDir(path.join(rootDir, "src", "renderer", "pages"), path.join(distDir, "pages"));
copyDir(path.join(rootDir, "src", "renderer", "styles"), path.join(distDir, "styles"));
copyDir(path.join(rootDir, "src", "renderer", "Guida"), path.join(distDir, "Guida"), { skipExt: [".ts"] });
copyDir(path.join(rootDir, "src", "renderer", "templates"), path.join(distDir, "templates"), { skipExt: [".ts"] });

// Generate git stats cache for infographics (optional).
try {
    const outPath = path.join(distDir, "pages", "utilities", "git-stats.json");
    spawnSync("node", [path.join(__dirname, "generate-git-stats.js"), outPath], {
        stdio: "inherit",
        shell: true,
        cwd: rootDir,
    });
} catch (err) {
    // Non-blocking: UI can still attempt live git access in dev.
}

// Copy required vendor assets from node_modules (renderer expects these paths)
const ganttSrc = path.join(rootDir, "node_modules", "dhtmlx-gantt", "codebase");
const ganttDest = path.join(distDir, "node_modules", "dhtmlx-gantt", "codebase");
copyDir(ganttSrc, ganttDest);

// Copy legacy JS modules that are not in TS
const legacyUpdater = path.join(rootDir, "modules", "updater.js");
if (fs.existsSync(legacyUpdater)) {
    const modulesDir = path.join(distDir, "modules");
    fs.mkdirSync(modulesDir, { recursive: true });
    fs.copyFileSync(legacyUpdater, path.join(modulesDir, "updater.js"));
}

let result = spawnSync("npx", ["tsc", "-p", "tsconfig.json"], {
    stdio: "inherit",
    shell: true,
    cwd: rootDir,
});
if (result.status !== 0) {
    process.exit(result.status ?? 1);
}

result = spawnSync("node", [path.join(__dirname, "build-renderer.js")], {
    stdio: "inherit",
    shell: true,
    cwd: rootDir,
});

process.exit(result.status ?? 1);
