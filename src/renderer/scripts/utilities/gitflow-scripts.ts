import { ipcRenderer } from "electron";

type GitStat = {
    date: string;
    additions: number;
    deletions: number;
    commits: number;
};

type TagStat = {
    name: string;
    date: string;
};

const track = document.getElementById("flowTrack");

init();

async function init() {
    if (!track) return;
    const params = new URLSearchParams(window.location.search);
    const force = params.get("force") === "1";
    const payload = await ipcRenderer.invoke("github-stats-get", {
        owner: "AGPress-Tech",
        repo: "AyPi",
        persistPath: "\\\\Dl360\\pubbliche\\TECH\\AyPi\\AGPRESS\\General\\git-stats.json",
        force,
    });
    if (!payload || !payload.ok || !payload.data || !payload.data.length) {
        const reason = payload?.reason ? `Motivo: ${payload.reason}` : "";
        const error = payload?.error ? `Errore: ${payload.error}` : "";
        const tokenInfo = payload?.tokenPresent ? "Token: rilevato" : "Token: NON rilevato";
        track.innerHTML = `<div style="color:#8a95a8; padding:16px;">
            Nessun dato disponibile.<br>${tokenInfo}<br>${reason}<br>${error}
        </div>`;
        return;
    }

    const stats: GitStat[] = payload.data;
    const tags: TagStat[] = Array.isArray(payload.tags) ? payload.tags : [];

    renderFlow(stats, tags);
}

function renderFlow(stats: GitStat[], tags: TagStat[]) {
    if (!track) return;
    track.innerHTML = "";

    const lanes = [
        { key: "main", label: "Main", top: 80 },
        { key: "minor", label: "Minor", top: 180 },
        { key: "patch", label: "Patch", top: 280 },
    ];

    lanes.forEach((lane) => {
        const line = document.createElement("div");
        line.className = `lane ${lane.key}`;
        track.appendChild(line);
    });

    if (!stats.length) return;
    const minTime = new Date(stats[0].date).getTime();
    const maxTime = new Date(stats[stats.length - 1].date).getTime();
    const span = Math.max(1, maxTime - minTime);
    const width = Math.max(1200, stats.length * 14);
    track.style.minWidth = `${width}px`;

    stats.forEach((entry) => {
        const time = new Date(entry.date).getTime();
        const x = ((time - minTime) / span) * width;
        const dot = document.createElement("div");
        dot.className = "commit-dot main";
        dot.style.left = `${x}px`;
        track.appendChild(dot);
    });

    tags.forEach((tag) => {
        const time = new Date(tag.date).getTime();
        if (Number.isNaN(time)) return;
        const x = ((time - minTime) / span) * width;
        const kind = getReleaseKind(tag.name);
        const node = document.createElement("div");
        node.className = `node ${kind}`;
        node.style.left = `${x}px`;
        node.textContent = tag.name;
        track.appendChild(node);
    });
}

function getReleaseKind(tagName: string) {
    const raw = String(tagName || "").trim();
    const cleaned = raw.replace(/^v/i, "");
    const parts = cleaned.split(".").map((p) => parseInt(p, 10));
    if (parts.length < 2 || parts.some((p) => Number.isNaN(p))) return "patch";
    const minor = parts[1];
    const patch = parts.length >= 3 ? parts[2] : 0;
    if (minor === 0 && patch === 0) return "main";
    if (minor > 0 && patch === 0) return "minor";
    return "patch";
}
