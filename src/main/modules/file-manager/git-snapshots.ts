import { app } from "electron";
import fs from "fs";
import path from "path";
import log from "electron-log";

const GIT_STATS_PATH =
    "\\\\Dl360\\pubbliche\\TECH\\AyPi\\AGPRESS\\General\\data\\git-stats.json";
const GITFLOW_PATH =
    "\\\\Dl360\\pubbliche\\TECH\\AyPi\\AGPRESS\\General\\data\\gitflow.json";

function writeSnapshot(
    payload: any,
    targetPath: string | undefined,
    fallbackPath: string,
    logScope: string,
) {
    const outputPath =
        targetPath && typeof targetPath === "string"
            ? targetPath
            : fallbackPath;
    try {
        if (payload && typeof payload === "object" && !payload.fetchedAt) {
            payload.fetchedAt = new Date().toISOString();
        }
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2), "utf8");
        return { ok: true, path: outputPath };
    } catch (err) {
        log.warn(`[${logScope}] write snapshot failed:`, err);
        return {
            ok: false,
            path: outputPath,
            error: err instanceof Error ? err.message : String(err),
        };
    }
}

function readSnapshot(
    targetPath: string | undefined,
    fallbackPath: string,
) {
    const inputPath =
        targetPath && typeof targetPath === "string"
            ? targetPath
            : fallbackPath;
    try {
        if (!fs.existsSync(inputPath)) return null;
        const parsed = JSON.parse(fs.readFileSync(inputPath, "utf8"));
        if (!parsed || typeof parsed !== "object") return null;
        if (!parsed.fetchedAt) {
            try {
                parsed.fetchedAt = fs.statSync(inputPath).mtime.toISOString();
            } catch {
                // A missing timestamp only disables freshness checks.
            }
        }
        return parsed;
    } catch {
        return null;
    }
}

export function getBundledGitStats() {
    try {
        const cachedPath = path.join(
            app.getAppPath(),
            "pages",
            "utilities",
            "git-stats.json",
        );
        if (!fs.existsSync(cachedPath)) return null;
        const parsed = JSON.parse(fs.readFileSync(cachedPath, "utf8"));
        return parsed && Array.isArray(parsed.data) ? parsed : null;
    } catch {
        return null;
    }
}

export function writeGitStatsSnapshot(payload: any, targetPath?: string) {
    return writeSnapshot(payload, targetPath, GIT_STATS_PATH, "git-stats");
}

export function readGitStatsSnapshot(targetPath?: string) {
    return readSnapshot(targetPath, GIT_STATS_PATH);
}

export function writeGitflowSnapshot(payload: any, targetPath?: string) {
    return writeSnapshot(payload, targetPath, GITFLOW_PATH, "gitflow");
}

export function readGitflowSnapshot(targetPath?: string) {
    return readSnapshot(targetPath, GITFLOW_PATH);
}
