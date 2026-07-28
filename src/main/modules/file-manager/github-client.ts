import fs from "fs";
import https from "https";
import log from "electron-log";

export type GithubCommit = {
    sha: string;
    date: string;
};

function fetchJson(url: string, token?: string): Promise<any> {
    return new Promise((resolve, reject) => {
        const headers: Record<string, string> = {
            "User-Agent": "AyPi",
            Accept: "application/vnd.github+json",
        };
        if (token) headers.Authorization = `Bearer ${token}`;

        const request = https.get(url, { headers }, (response) => {
            const chunks: Buffer[] = [];
            response.on("data", (chunk) => chunks.push(chunk));
            response.on("end", () => {
                const raw = Buffer.concat(chunks).toString("utf8");
                const status = response.statusCode || 0;
                if (status >= 200 && status < 300) {
                    try {
                        resolve(JSON.parse(raw));
                    } catch (err) {
                        log.warn("[github] JSON parse failed", {
                            url,
                            status,
                            error:
                                err instanceof Error
                                    ? err.message
                                    : String(err),
                        });
                        reject(err);
                    }
                    return;
                }
                if (status === 202) {
                    log.warn("[github] pending (202)", { url });
                    resolve({ __pending: true, __status: status });
                    return;
                }
                const body = raw ? raw.slice(0, 600) : "";
                log.warn("[github] request failed", { url, status, body });
                reject(new Error(`HTTP ${status}: ${body}`));
            });
        });
        request.on("error", (err) => {
            log.warn("[github] request error", {
                url,
                error: err instanceof Error ? err.message : String(err),
            });
            reject(err);
        });
        request.end();
    });
}

export function readSharedGithubToken() {
    const envPath = "\\\\Dl360\\pubbliche\\TECH\\AyPi\\AGPRESS\\General\\.env";
    try {
        if (!fs.existsSync(envPath)) return "";
        const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith("#")) continue;
            const separator = trimmed.indexOf("=");
            if (separator <= 0) continue;
            const key = trimmed.slice(0, separator).trim();
            const value = trimmed.slice(separator + 1).trim();
            if (key === "GH_TOKEN" || key === "GITHUB_TOKEN") {
                return value.replace(/^"|"$/g, "").replace(/^'|'$/g, "");
            }
        }
        return "";
    } catch {
        return "";
    }
}

async function resolveTagCommit(
    baseUrl: string,
    sha: string,
    token?: string,
): Promise<GithubCommit | null> {
    try {
        const commit = await fetchJson(`${baseUrl}/commits/${sha}`, token);
        const date = commit?.commit?.author?.date;
        if (date) return { sha, date };
    } catch {
        // Annotated tags are resolved through the tag object below.
    }
    try {
        const tag = await fetchJson(`${baseUrl}/git/tags/${sha}`, token);
        const targetSha = tag?.object?.sha;
        if (!targetSha) return null;
        const commit = await fetchJson(
            `${baseUrl}/commits/${targetSha}`,
            token,
        );
        const date = commit?.commit?.author?.date;
        return date ? { sha: targetSha, date } : null;
    } catch {
        return null;
    }
}

export {
    fetchJson as fetchGithubJson,
    resolveTagCommit as resolveGithubTagCommit,
};

export async function fetchGithubCommits(
    owner: string,
    repo: string,
    token?: string,
    maxCommits = 400,
    minDate?: Date,
) {
    const baseUrl = `https://api.github.com/repos/${owner}/${repo}`;
    const commits: GithubCommit[] = [];
    let page = 1;
    const minTime = minDate ? new Date(minDate).getTime() : null;

    while (commits.length < maxCommits) {
        const response = await fetchJson(
            `${baseUrl}/commits?per_page=100&page=${page}`,
            token,
        );
        if (!Array.isArray(response) || response.length === 0) break;
        response.forEach((entry) => {
            const sha = entry?.sha;
            const date = entry?.commit?.author?.date;
            if (sha && date) commits.push({ sha, date });
        });
        if (minTime && commits.length) {
            const oldest = new Date(
                commits[commits.length - 1].date,
            ).getTime();
            if (!Number.isNaN(oldest) && oldest <= minTime) break;
        }
        if (response.length < 100) break;
        page += 1;
    }
    return commits.slice(0, maxCommits);
}

export async function fetchGithubDiffTotalsForCommits(
    owner: string,
    repo: string,
    commits: GithubCommit[],
    token?: string,
    maxCommitDetails = 120,
) {
    const baseUrl = `https://api.github.com/repos/${owner}/${repo}`;
    let additions = 0;
    let deletions = 0;
    const list = Array.isArray(commits)
        ? commits.slice(0, maxCommitDetails)
        : [];

    for (const entry of list) {
        if (!entry?.sha) continue;
        try {
            const details = await fetchJson(
                `${baseUrl}/commits/${entry.sha}`,
                token,
            );
            additions += Number(details?.stats?.additions || 0);
            deletions += Number(details?.stats?.deletions || 0);
        } catch (err) {
            log.warn("[github-stats] commit details fetch failed", {
                owner,
                repo,
                sha: entry.sha,
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }
    return { additions, deletions };
}

export async function fetchGithubTags(
    owner: string,
    repo: string,
    token?: string,
) {
    const baseUrl = `https://api.github.com/repos/${owner}/${repo}`;
    const tags = await fetchJson(`${baseUrl}/tags?per_page=100`, token);
    if (!Array.isArray(tags)) return [];
    const details = await Promise.all(
        tags.slice(0, 200).map(async (tag) => {
            const sha = tag?.commit?.sha;
            if (!sha) return null;
            const resolved = await resolveTagCommit(baseUrl, sha, token);
            return resolved
                ? { name: tag.name, date: resolved.date, sha: resolved.sha }
                : null;
        }),
    );
    return details.filter(Boolean);
}
