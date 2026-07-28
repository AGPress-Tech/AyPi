import { execFileSync, execSync } from "child_process";
import fs from "fs";
import path from "path";
import type { App, IpcMain } from "electron";
import {
    getBundledGitStats,
    writeGitStatsSnapshot,
} from "./git-snapshots";
import { startOfWeekMonday, toDateKey } from "./git-date-utils";

export function resolveGitRepoRoot(appPath: string) {
    const candidates = [process.cwd(), appPath];

    for (const start of candidates) {
        let current = start;
        for (let depth = 0; depth < 8; depth += 1) {
            if (fs.existsSync(path.join(current, ".git"))) {
                return current;
            }
            const parent = path.dirname(current);
            if (!parent || parent === current) break;
            current = parent;
        }
    }

    return "";
}

export function getGitDailyStats(repoRoot: string) {
    try {
        execSync("git --version", { stdio: "ignore" });
    } catch {
        return { ok: false, reason: "git-not-found", data: [], tags: [] };
    }

    try {
        const rawLog = execFileSync(
            "git",
            [
                "-C",
                repoRoot,
                "log",
                "--numstat",
                "--date=iso",
                "--pretty=format:@@@%H|%ad",
            ],
            { encoding: "utf8" },
        );
        const dailyStats = new Map<
            string,
            {
                date: string;
                additions: number;
                deletions: number;
                commits: number;
            }
        >();
        let currentDate = "";

        rawLog.split(/\r?\n/).forEach((line) => {
            if (!line.trim()) return;
            if (line.startsWith("@@@")) {
                const date = new Date(line.replace("@@@", "").split("|")[1] || "");
                if (Number.isNaN(date.getTime())) {
                    currentDate = "";
                    return;
                }
                currentDate = date.toISOString().slice(0, 10);
                if (!dailyStats.has(currentDate)) {
                    dailyStats.set(currentDate, {
                        date: currentDate,
                        additions: 0,
                        deletions: 0,
                        commits: 0,
                    });
                }
                dailyStats.get(currentDate)!.commits += 1;
                return;
            }

            if (!currentDate) return;
            const parts = line.split("\t");
            if (parts.length < 2) return;
            const additions = parseInt(parts[0], 10);
            const deletions = parseInt(parts[1], 10);
            const entry = dailyStats.get(currentDate);
            if (!entry) return;
            entry.additions += Number.isFinite(additions) ? additions : 0;
            entry.deletions += Number.isFinite(deletions) ? deletions : 0;
        });

        const data = Array.from(dailyStats.values()).sort((left, right) =>
            left.date.localeCompare(right.date),
        );
        let tags: { name: string; date: string }[] = [];
        try {
            const rawTags = execFileSync(
                "git",
                [
                    "-C",
                    repoRoot,
                    "for-each-ref",
                    "refs/tags",
                    "--sort=creatordate",
                    "--format=%(refname:short)|%(creatordate:iso)",
                ],
                { encoding: "utf8" },
            );
            tags = rawTags
                .split(/\r?\n/)
                .map((line) => line.trim())
                .filter(Boolean)
                .map((line) => {
                    const [name, date] = line.split("|");
                    return { name, date };
                })
                .filter((entry) => entry.name && entry.date);
        } catch {
            tags = [];
        }

        return { ok: true, data, tags };
    } catch {
        return {
            ok: false,
            reason: "git-log-failed",
            data: [],
            tags: [],
        };
    }
}

export function getLocalWeekDiffTotals(
    weekStart: Date,
    appPath: string,
) {
    const repoRoot = resolveGitRepoRoot(appPath);
    if (!repoRoot) return { additions: 0, deletions: 0 };

    const localStats = getGitDailyStats(repoRoot);
    if (!localStats?.ok || !Array.isArray(localStats.data)) {
        return { additions: 0, deletions: 0 };
    }

    const weekKey = toDateKey(startOfWeekMonday(weekStart));
    const dailyRows = localStats.data as Array<{
        date: string;
        additions: number;
        deletions: number;
    }>;
    return dailyRows.reduce<{
        additions: number;
        deletions: number;
    }>(
        (totals, row) => {
            const rowDate = row?.date
                ? new Date(`${row.date}T00:00:00Z`)
                : null;
            if (!rowDate || Number.isNaN(rowDate.getTime())) return totals;
            if (
                toDateKey(startOfWeekMonday(rowDate)) !== weekKey
            ) {
                return totals;
            }
            totals.additions += Number(row.additions || 0);
            totals.deletions += Number(row.deletions || 0);
            return totals;
        },
        { additions: 0, deletions: 0 },
    );
}

type LocalGitStatsDependencies = {
    ipcMain: IpcMain;
    app: Pick<App, "getAppPath">;
    getBundledStats?: typeof getBundledGitStats;
    resolveRepoRoot?: typeof resolveGitRepoRoot;
    getDailyStats?: typeof getGitDailyStats;
    writeSnapshot?: typeof writeGitStatsSnapshot;
};

export function registerLocalGitStatsIpc({
    ipcMain,
    app,
    getBundledStats = getBundledGitStats,
    resolveRepoRoot = resolveGitRepoRoot,
    getDailyStats = getGitDailyStats,
    writeSnapshot = writeGitStatsSnapshot,
}: LocalGitStatsDependencies) {
    ipcMain.handle("git-stats-get", async (_event, options) => {
        const fresh = !!options?.fresh;
        const targetPath = options?.persistPath
            ? String(options.persistPath)
            : undefined;

        if (!fresh) {
            const cached = getBundledStats();
            if (cached?.ok && cached.data?.length) {
                return cached;
            }
        }

        const repoRoot = resolveRepoRoot(app.getAppPath());
        if (!repoRoot) {
            const payload = {
                ok: false,
                reason: "repo-not-found",
                data: [],
                tags: [],
            };
            writeSnapshot(payload, targetPath);
            return payload;
        }

        const payload = getDailyStats(repoRoot);
        writeSnapshot(payload, targetPath);
        return payload;
    });
}
