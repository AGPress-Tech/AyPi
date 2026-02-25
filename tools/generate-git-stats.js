const fs = require("fs");
const path = require("path");
const { execSync, execFileSync } = require("child_process");

const outputPath = process.argv[2];
if (!outputPath) {
    console.error("Missing output path.");
    process.exit(1);
}

function safeWrite(payload) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2), "utf8");
}

function ensureGitAvailable() {
    try {
        execSync("git --version", { stdio: "ignore" });
        return true;
    } catch (err) {
        return false;
    }
}

function resolveRepoRoot() {
    let current = process.cwd();
    for (let i = 0; i < 8; i += 1) {
        if (fs.existsSync(path.join(current, ".git"))) {
            return current;
        }
        const parent = path.dirname(current);
        if (!parent || parent === current) break;
        current = parent;
    }
    return "";
}

function buildDailyStats(repoRoot) {
    const raw = execFileSync(
        "git",
        ["-C", repoRoot, "log", "--numstat", "--date=iso", "--pretty=format:@@@%H|%ad"],
        { encoding: "utf8" }
    );

    const map = new Map();
    let currentDate = "";

    raw.split(/\r?\n/).forEach((line) => {
        if (!line.trim()) return;
        if (line.startsWith("@@@")) {
            const parts = line.replace("@@@", "").split("|");
            const datePart = parts[1] || "";
            const date = new Date(datePart);
            if (Number.isNaN(date.getTime())) {
                currentDate = "";
                return;
            }
            const key = date.toISOString().slice(0, 10);
            currentDate = key;
            if (!map.has(key)) {
                map.set(key, { date: key, additions: 0, deletions: 0, commits: 0 });
            }
            map.get(key).commits += 1;
            return;
        }

        if (!currentDate) return;
        const parts = line.split("\t");
        if (parts.length < 2) return;
        const additions = parseInt(parts[0], 10);
        const deletions = parseInt(parts[1], 10);
        const safeAdd = Number.isFinite(additions) ? additions : 0;
        const safeDel = Number.isFinite(deletions) ? deletions : 0;
        const entry = map.get(currentDate);
        if (!entry) return;
        entry.additions += safeAdd;
        entry.deletions += safeDel;
    });

    return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
}

function buildTagStats(repoRoot) {
    try {
        const raw = execFileSync(
            "git",
            ["-C", repoRoot, "for-each-ref", "refs/tags", "--sort=creatordate", "--format=%(refname:short)|%(creatordate:iso)"],
            { encoding: "utf8" }
        );
        return raw
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line) => {
                const [name, date] = line.split("|");
                return { name, date };
            })
            .filter((entry) => entry.name && entry.date);
    } catch {
        return [];
    }
}

if (!ensureGitAvailable()) {
    safeWrite({
        ok: false,
        reason: "git-not-found",
        generatedAt: new Date().toISOString(),
        data: [],
        tags: [],
    });
    process.exit(0);
}

const repoRoot = resolveRepoRoot();
if (!repoRoot) {
    safeWrite({
        ok: false,
        reason: "repo-not-found",
        generatedAt: new Date().toISOString(),
        data: [],
        tags: [],
    });
    process.exit(0);
}

try {
    const data = buildDailyStats(repoRoot);
    const tags = buildTagStats(repoRoot);
    safeWrite({
        ok: true,
        generatedAt: new Date().toISOString(),
        data,
        tags,
    });
} catch (err) {
    safeWrite({
        ok: false,
        reason: "git-log-failed",
        generatedAt: new Date().toISOString(),
        data: [],
        tags: [],
    });
}
