const fs = require("fs");
const path = require("path");
const esbuild = require("esbuild");

const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist-ts");
const rendererRoot = path.join(rootDir, "src", "renderer");

const excludeNameContains = ["tsconfig"];
const excludePatterns = [];

const rendererRoots = [
    path.join(rendererRoot, "scripts"),
    path.join(rendererRoot, "templates"),
    path.join(rendererRoot, "Guida", "assets"),
];

function isExcluded(filePath) {
    const lower = filePath.toLowerCase();
    if (excludeNameContains.some((frag) => lower.includes(frag))) return true;
    if (excludePatterns.some((pat) => lower.includes(pat.toLowerCase()))) return true;
    return false;
}

function ensureDir(dir) {
    fs.mkdirSync(dir, { recursive: true });
}

function copyFile(srcPath, destPath) {
    ensureDir(path.dirname(destPath));
    fs.copyFileSync(srcPath, destPath);
}

function walk(dir, out = []) {
    if (!fs.existsSync(dir)) return out;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            walk(full, out);
        } else if (entry.isFile()) {
            out.push(full);
        }
    }
    return out;
}

function collectRendererFiles() {
    const files = [];
    for (const root of rendererRoots) {
        walk(root, files);
    }
    return files;
}

function isRendererEntryPoint(filePath) {
    const rel = path.relative(rendererRoot, filePath);
    const parts = rel.split(path.sep);

    // Only scripts loaded directly by an HTML page are entry points. Nested
    // files are implementation modules and are already bundled into these
    // page-level scripts; emitting them again only duplicates code in dist.
    if (parts[0] === "scripts" && parts.length === 2) return true;
    if (
        parts[0] === "scripts" &&
        parts[1] === "utilities" &&
        parts.length === 3
    ) {
        return true;
    }

    return (
        rel === path.join("templates", "hierarchy-report.ts") ||
        rel === path.join("Guida", "assets", "script.ts")
    );
}

async function buildRenderer() {
    const files = collectRendererFiles();
    const entryPoints = [];

    for (const filePath of files) {
        const ext = path.extname(filePath);
        const rel = path.relative(rendererRoot, filePath);
        const destPath = path.join(distDir, rel).replace(/\.ts$/i, ".js");

        if (isExcluded(filePath)) {
            continue;
        }

        if (ext === ".ts") {
            if (isRendererEntryPoint(filePath)) entryPoints.push(filePath);
            continue;
        } else if (ext === ".js") {
            copyFile(filePath, path.join(distDir, rel));
        } else {
            copyFile(filePath, path.join(distDir, rel));
        }
    }

    if (!entryPoints.length) return;

    await esbuild.build({
        entryPoints,
        outbase: rendererRoot,
        outdir: distDir,
        bundle: true,
        platform: "node",
        format: "cjs",
        target: "es2020",
        logLevel: "silent",
        external: [
            "electron",
            "fs",
            "path",
            "child_process",
            "os",
            "crypto",
            "stream",
            "buffer",
            "util",
            "events",
            "http",
            "https",
            "zlib",
            "url",
            "querystring",
            "net",
            "tls",
            "dns",
            "worker_threads",
            "perf_hooks",
            "xlsx",
            "axios",
            "chart.js",
            "chart.js/auto",
            "qrcode",
            "bwip-js",
            "ajv",
            "hash-wasm",
            "nodemailer",
            "otplib",
        ],
    });
}

buildRenderer().catch((err) => {
    console.error("[build-renderer] failed:", err);
    process.exit(1);
});
