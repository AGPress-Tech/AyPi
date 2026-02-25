import { Chart } from "chart.js/auto";

Chart.register({
    id: "lineOverlay",
    afterDatasetsDraw(chart) {
        const { ctx } = chart;
        const lineDatasets = chart.data.datasets
            .map((dataset, index) => ({ dataset, index }))
            .filter((item) => item.dataset.type === "line");

        lineDatasets.forEach(({ dataset, index }) => {
            const meta = chart.getDatasetMeta(index);
            if (!meta || meta.hidden) return;
            ctx.save();
            meta.dataset.draw(ctx);
            ctx.restore();
        });
    },
});
import { ipcRenderer } from "electron";

type DailyStats = {
    date: Date;
    additions: number;
    deletions: number;
    commits: number;
};

type TagStat = {
    name: string;
    date: Date;
};

type Series = {
    labels: string[];
    additions: number[];
    deletions: number[];
    net: number[];
    commits: number[];
    dates: Date[];
    startDate: Date;
    endDate: Date;
};

const rangeLabel = document.getElementById("rangeLabel");
const granularityLabel = document.getElementById("granularityLabel");
const summaryCommits = document.getElementById("summaryCommits");
const summaryAdditions = document.getElementById("summaryAdditions");
const summaryDeletions = document.getElementById("summaryDeletions");
const summaryNet = document.getElementById("summaryNet");
const rangeStart = document.getElementById(
    "rangeStart",
) as HTMLInputElement | null;
const rangeEnd = document.getElementById("rangeEnd") as HTMLInputElement | null;
const chartsGrid = document.getElementById("chartsGrid");
const rangeFill = document.getElementById("rangeFill");
const rangeGrabLeft = document.getElementById("rangeGrabLeft");
const rangeGrabRight = document.getElementById("rangeGrabRight");

const presetButtons = Array.from(
    document.querySelectorAll<HTMLButtonElement>(".preset-btn"),
);

let dailyStats: DailyStats[] = [];
let tagStats: TagStat[] = [];
let lastTimelineDates: Date[] = [];
let lastTimelineCommits: number[] = [];

let granularity: "week" | "month" = "week";
let series: Series | null = null;
let codeFrequencyChart: Chart | null = null;
let commitsChart: Chart | null = null;

const presets = {
    "3m": 3,
    "6m": 6,
    "1y": 12,
    all: 0,
};

init();

async function init() {
    const payload = await ipcRenderer.invoke("git-stats-get");
    if (!payload || !payload.ok || !payload.data || !payload.data.length) {
        updateEmptyState(payload?.reason);
        return;
    }

    dailyStats = payload.data.map(
        (entry: {
            date: string | number | Date;
            additions: any;
            deletions: any;
            commits: any;
        }) => ({
            date: new Date(entry.date),
            additions: entry.additions,
            deletions: entry.deletions,
            commits: entry.commits,
        }),
    );
    tagStats = Array.isArray(payload.tags)
        ? payload.tags.map(
              (entry: { name: any; date: string | number | Date }) => ({
                  name: entry.name,
                  date: new Date(entry.date),
              }),
          )
        : [];

    applyPreset("6m");
    bindControls();
    window.addEventListener("resize", () => {
        if (lastTimelineDates.length) {
            renderTimeline(lastTimelineDates, lastTimelineCommits);
        }
    });
}

function bindControls() {
    presetButtons.forEach((btn) => {
        btn.addEventListener("click", () => {
            const range = btn.dataset.range || "6m";
            applyPreset(range);
            presetButtons.forEach((b) =>
                b.classList.toggle("is-active", b === btn),
            );
        });
    });

    if (chartsGrid) {
        chartsGrid.classList.remove("is-split");
    }

    if (rangeStart && rangeEnd) {
        rangeStart.addEventListener("input", () => updateRangeFromInputs());
        rangeEnd.addEventListener("input", () => updateRangeFromInputs());
    }

    if (rangeFill && rangeStart && rangeEnd) {
        let dragging = false;
        let startX = 0;
        let startLeft = 0;
        let startRight = 0;

        const onMove = (event: MouseEvent) => {
            if (!dragging || !series) return;
            const rect = rangeFill.parentElement?.getBoundingClientRect();
            if (!rect) return;
            const deltaPx = event.clientX - startX;
            const span = series.labels.length - 1;
            if (span <= 0) return;
            const deltaIndex = Math.round((deltaPx / rect.width) * span);
            let nextStart = Math.max(0, Math.min(span, startLeft + deltaIndex));
            let nextEnd = Math.max(0, Math.min(span, startRight + deltaIndex));
            const width = startRight - startLeft;
            if (nextEnd - nextStart !== width) {
                if (nextStart === 0) {
                    nextEnd = width;
                } else if (nextEnd === span) {
                    nextStart = span - width;
                }
            }
            rangeStart.value = `${nextStart}`;
            rangeEnd.value = `${nextEnd}`;
            updateRangeFromInputs();
        };

        const onUp = () => {
            dragging = false;
            rangeFill.classList.remove("is-dragging");
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
            window.removeEventListener("mouseleave", onUp);
            window.removeEventListener("blur", onUp);
        };

        rangeFill.addEventListener("mousedown", (event) => {
            if (!series) return;
            dragging = true;
            rangeFill.classList.add("is-dragging");
            startX = event.clientX;
            startLeft = parseInt(rangeStart.value, 10) || 0;
            startRight = parseInt(rangeEnd.value, 10) || 0;
            window.addEventListener("mousemove", onMove);
            window.addEventListener("mouseup", onUp);
            window.addEventListener("mouseleave", onUp);
            window.addEventListener("blur", onUp);
        });
    }

    if (rangeGrabLeft && rangeStart && rangeEnd) {
        let resizing = false;
        let startX = 0;
        let startLeft = 0;

        const onMove = (event: MouseEvent) => {
            if (!resizing || !series) return;
            const rect = rangeGrabLeft.parentElement?.getBoundingClientRect();
            if (!rect) return;
            const deltaPx = event.clientX - startX;
            const span = series.labels.length - 1;
            if (span <= 0) return;
            const deltaIndex = Math.round((deltaPx / rect.width) * span);
            let nextStart = Math.max(0, Math.min(span, startLeft + deltaIndex));
            const endIndex = parseInt(rangeEnd.value, 10) || 0;
            if (nextStart > endIndex) nextStart = endIndex;
            rangeStart.value = `${nextStart}`;
            updateRangeFromInputs();
        };

        const onUp = () => {
            resizing = false;
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
            window.removeEventListener("mouseleave", onUp);
            window.removeEventListener("blur", onUp);
        };

        rangeGrabLeft.addEventListener("mousedown", (event) => {
            if (!series) return;
            resizing = true;
            startX = event.clientX;
            startLeft = parseInt(rangeStart.value, 10) || 0;
            window.addEventListener("mousemove", onMove);
            window.addEventListener("mouseup", onUp);
            window.addEventListener("mouseleave", onUp);
            window.addEventListener("blur", onUp);
        });
    }

    if (rangeGrabRight && rangeStart && rangeEnd) {
        let resizing = false;
        let startX = 0;
        let startRight = 0;

        const onMove = (event: MouseEvent) => {
            if (!resizing || !series) return;
            const rect = rangeGrabRight.parentElement?.getBoundingClientRect();
            if (!rect) return;
            const deltaPx = event.clientX - startX;
            const span = series.labels.length - 1;
            if (span <= 0) return;
            const deltaIndex = Math.round((deltaPx / rect.width) * span);
            let nextEnd = Math.max(0, Math.min(span, startRight + deltaIndex));
            const startIndex = parseInt(rangeStart.value, 10) || 0;
            if (nextEnd < startIndex) nextEnd = startIndex;
            rangeEnd.value = `${nextEnd}`;
            updateRangeFromInputs();
        };

        const onUp = () => {
            resizing = false;
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
            window.removeEventListener("mouseleave", onUp);
            window.removeEventListener("blur", onUp);
        };

        rangeGrabRight.addEventListener("mousedown", (event) => {
            if (!series) return;
            resizing = true;
            startX = event.clientX;
            startRight = parseInt(rangeEnd.value, 10) || 0;
            window.addEventListener("mousemove", onMove);
            window.addEventListener("mouseup", onUp);
            window.addEventListener("mouseleave", onUp);
            window.addEventListener("blur", onUp);
        });
    }
}

function updateEmptyState(reason?: string) {
    let message = "Nessun dato Git disponibile";
    if (reason === "git-not-found") {
        message = "Git non disponibile su questa postazione";
    } else if (reason === "repo-not-found") {
        message = "Repository Git non trovato";
    } else if (reason === "git-log-failed") {
        message = "Impossibile leggere la history Git";
    }
    if (rangeLabel) rangeLabel.textContent = message;
    if (granularityLabel) granularityLabel.textContent = "Granularità: n/d";
}

function toDateKey(date: Date) {
    const year = date.getFullYear();
    const month = `${date.getMonth() + 1}`.padStart(2, "0");
    const day = `${date.getDate()}`.padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function startOfDay(date: Date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfWeek(date: Date) {
    const day = date.getDay();
    const diff = (day + 6) % 7;
    const start = new Date(date);
    start.setDate(date.getDate() - diff);
    start.setHours(0, 0, 0, 0);
    return start;
}

function startOfMonth(date: Date) {
    return new Date(date.getFullYear(), date.getMonth(), 1);
}

function formatLabel(date: Date, mode: "week" | "month") {
    const month = date.toLocaleString("it-IT", { month: "short" });
    const year = `${date.getFullYear()}`.slice(-2);
    if (mode === "month") {
        return `${month} '${year}`;
    }
    const day = `${date.getDate()}`.padStart(2, "0");
    return `${day} ${month} '${year}`;
}

function buildSeries(mode: "week" | "month"): Series {
    const minDate = dailyStats[0].date;
    const maxDate = dailyStats[dailyStats.length - 1].date;
    const bucketMap = new Map<
        string,
        { date: Date; additions: number; deletions: number; commits: number }
    >();

    dailyStats.forEach((entry) => {
        const bucketDate =
            mode === "month"
                ? startOfMonth(entry.date)
                : startOfWeek(entry.date);
        const key = toDateKey(bucketDate);
        if (!bucketMap.has(key)) {
            bucketMap.set(key, {
                date: bucketDate,
                additions: 0,
                deletions: 0,
                commits: 0,
            });
        }
        const bucket = bucketMap.get(key)!;
        bucket.additions += entry.additions;
        bucket.deletions += entry.deletions;
        bucket.commits += entry.commits;
    });

    const labels: string[] = [];
    const additions: number[] = [];
    const deletions: number[] = [];
    const net: number[] = [];
    const commits: number[] = [];
    const dates: Date[] = [];

    let cursor =
        mode === "month" ? startOfMonth(minDate) : startOfWeek(minDate);
    const last =
        mode === "month" ? startOfMonth(maxDate) : startOfWeek(maxDate);

    while (cursor.getTime() <= last.getTime()) {
        const key = toDateKey(cursor);
        const bucket = bucketMap.get(key);
        labels.push(formatLabel(cursor, mode));
        dates.push(new Date(cursor));
        additions.push(bucket ? bucket.additions : 0);
        deletions.push(bucket ? -bucket.deletions : 0);
        net.push(bucket ? bucket.additions - bucket.deletions : 0);
        commits.push(bucket ? bucket.commits : 0);

        if (mode === "month") {
            cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
        } else {
            cursor = new Date(
                cursor.getFullYear(),
                cursor.getMonth(),
                cursor.getDate() + 7,
            );
        }
    }

    return {
        labels,
        additions,
        deletions,
        net,
        commits,
        dates,
        startDate: minDate,
        endDate: maxDate,
    };
}

function resolveGranularity(monthsSpan: number) {
    return monthsSpan > 18 ? "month" : "week";
}

function applyPreset(preset: string) {
    const months = presets[preset] ?? 6;
    const lastDate = dailyStats[dailyStats.length - 1].date;
    const target = months
        ? new Date(
              lastDate.getFullYear(),
              lastDate.getMonth() - months,
              lastDate.getDate(),
          )
        : dailyStats[0].date;

    const spanMonths = diffInMonths(dailyStats[0].date, lastDate);
    granularity = resolveGranularity(spanMonths);
    series = buildSeries(granularity);
    if (!series) return;

    const startIndex =
        months === 0 ? 0 : Math.max(0, findIndexForDate(series, target));
    const endIndex = series.labels.length - 1;

    updateRange(startIndex, endIndex);
    updateCharts();
}

function diffInMonths(start: Date, end: Date) {
    return (
        end.getFullYear() * 12 +
        end.getMonth() -
        (start.getFullYear() * 12 + start.getMonth())
    );
}

function findIndexForDate(targetSeries: Series, targetDate: Date) {
    const target = startOfDay(targetDate).getTime();
    const length = targetSeries.labels.length;
    if (!length) return 0;
    const start =
        granularity === "month"
            ? startOfMonth(dailyStats[0].date)
            : startOfWeek(dailyStats[0].date);
    let cursor = new Date(start);
    for (let i = 0; i < length; i += 1) {
        if (cursor.getTime() >= target) return i;
        if (granularity === "month") {
            cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
        } else {
            cursor = new Date(
                cursor.getFullYear(),
                cursor.getMonth(),
                cursor.getDate() + 7,
            );
        }
    }
    return 0;
}

function updateRange(startIndex: number, endIndex: number) {
    if (!rangeStart || !rangeEnd || !series) return;
    rangeStart.min = "0";
    rangeStart.max = `${series.labels.length - 1}`;
    rangeEnd.min = "0";
    rangeEnd.max = `${series.labels.length - 1}`;
    rangeStart.value = `${startIndex}`;
    rangeEnd.value = `${endIndex}`;
    updateRangeFill();
}

function updateRangeFromInputs() {
    if (!rangeStart || !rangeEnd || !series) return;
    let startIndex = parseInt(rangeStart.value, 10);
    let endIndex = parseInt(rangeEnd.value, 10);
    if (Number.isNaN(startIndex) || Number.isNaN(endIndex)) return;
    if (startIndex > endIndex) {
        [startIndex, endIndex] = [endIndex, startIndex];
    }
    rangeStart.value = `${startIndex}`;
    rangeEnd.value = `${endIndex}`;
    updateRangeFill();
    updateCharts(startIndex, endIndex);
}

function updateRangeFill() {
    if (!rangeFill || !series || !rangeStart || !rangeEnd) return;
    const startIndex = parseInt(rangeStart.value, 10) || 0;
    const endIndex = parseInt(rangeEnd.value, 10) || 0;
    const span = series.labels.length - 1;
    if (span <= 0) return;
    const left = (Math.min(startIndex, endIndex) / span) * 100;
    const right = (Math.max(startIndex, endIndex) / span) * 100;
    rangeFill.style.left = `${left}%`;
    rangeFill.style.width = `${right - left}%`;

    if (rangeGrabLeft) {
        const parent = rangeFill.parentElement;
        if (parent) {
            const parentRect = parent.getBoundingClientRect();
            const fillRect = rangeFill.getBoundingClientRect();
            const leftPx = fillRect.left - parentRect.left;
            rangeGrabLeft.style.left = `${leftPx}px`;
        }
    }
    if (rangeGrabRight) {
        const parent = rangeFill.parentElement;
        if (parent) {
            const parentRect = parent.getBoundingClientRect();
            const fillRect = rangeFill.getBoundingClientRect();
            const rightPx = fillRect.right - parentRect.left;
            rangeGrabRight.style.left = `${rightPx}px`;
        }
    }
}

function updateCharts(startIndex?: number, endIndex?: number) {
    if (!series) return;
    const start =
        typeof startIndex === "number"
            ? startIndex
            : parseInt(rangeStart?.value || "0", 10) || 0;
    const end =
        typeof endIndex === "number"
            ? endIndex
            : parseInt(rangeEnd?.value || `${series.labels.length - 1}`, 10) ||
              series.labels.length - 1;
    const labels = series.labels.slice(start, end + 1);
    const additions = series.additions.slice(start, end + 1);
    const deletions = series.deletions.slice(start, end + 1);
    const net = series.net.slice(start, end + 1);
    const commits = series.commits.slice(start, end + 1);
    const dates = series.dates.slice(start, end + 1);

    updateSummary(additions, deletions, net, commits);
    updateRangeLabel(start, end);
    updateGranularityLabel();

    renderCodeFrequency(labels, additions, deletions, net);
    renderCommits(labels, commits);
    renderTimeline(dates, commits);
    renderDateStrip("timelineDates", labels);
}

function updateSummary(
    additions: number[],
    deletions: number[],
    net: number[],
    commits: number[],
) {
    const totalAdd = additions.reduce((sum, v) => sum + v, 0);
    const totalDel = deletions.reduce((sum, v) => sum + v, 0);
    const totalNet = net.reduce((sum, v) => sum + v, 0);
    const totalCommits = commits.reduce((sum, v) => sum + v, 0);

    if (summaryCommits)
        summaryCommits.textContent = totalCommits.toLocaleString("it-IT");
    if (summaryAdditions)
        summaryAdditions.textContent = totalAdd.toLocaleString("it-IT");
    if (summaryDeletions)
        summaryDeletions.textContent =
            Math.abs(totalDel).toLocaleString("it-IT");
    if (summaryNet) summaryNet.textContent = totalNet.toLocaleString("it-IT");
}

function updateRangeLabel(startIndex: number, endIndex: number) {
    if (!rangeLabel || !series) return;
    const total = series.labels.length;
    const startLabel = series.labels[startIndex] || "";
    const endLabel = series.labels[endIndex] || "";
    rangeLabel.textContent = `${startLabel} → ${endLabel} (${endIndex - startIndex + 1}/${total})`;
}

function updateGranularityLabel() {
    if (!granularityLabel) return;
    granularityLabel.textContent = `Granularità: ${granularity === "month" ? "mensile" : "settimanale"}`;
}

function renderCodeFrequency(
    labels: string[],
    additions: number[],
    deletions: number[],
    net: number[],
) {
    const canvas = document.getElementById(
        "codeFrequencyChart",
    ) as HTMLCanvasElement | null;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    if (codeFrequencyChart) {
        codeFrequencyChart.destroy();
    }

    codeFrequencyChart = new Chart(ctx, {
        type: "bar",
        data: {
            labels,
            datasets: [
                {
                    label: "Additions",
                    data: additions,
                    backgroundColor: "#2ea043",
                    borderRadius: 3,
                    barPercentage: 0.9,
                    categoryPercentage: 0.9,
                    stack: "code",
                    order: 1,
                },
                {
                    label: "Deletions",
                    data: deletions,
                    backgroundColor: "#da3633",
                    borderRadius: 3,
                    barPercentage: 0.9,
                    categoryPercentage: 0.9,
                    stack: "code",
                    order: 1,
                },
                {
                    label: "Diff",
                    type: "line",
                    data: net,
                    borderColor: "#c6d7ff",
                    backgroundColor: "rgba(143, 180, 255, 0.2)",
                    tension: 0.3,
                    fill: false,
                    pointRadius: 0,
                    borderWidth: 2,
                    borderCapStyle: "round",
                    borderJoinStyle: "round",
                    order: 99,
                },
            ],
        },
        options: chartOptions({ showLegend: false }),
    });
}

function renderCommits(labels: string[], commits: number[]) {
    const canvas = document.getElementById(
        "commitsChart",
    ) as HTMLCanvasElement | null;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    if (commitsChart) {
        commitsChart.destroy();
    }

    const avg = rollingAverage(commits, granularity === "month" ? 3 : 4);

    commitsChart = new Chart(ctx, {
        type: "bar",
        data: {
            labels,
            datasets: [
                {
                    label: "Commits",
                    data: commits,
                    backgroundColor: "#1f6feb",
                    borderRadius: 3,
                    barPercentage: 0.9,
                    categoryPercentage: 0.9,
                    order: 1,
                },
                {
                    label: "Media",
                    type: "line",
                    data: avg,
                    borderColor: "#b8ccff",
                    tension: 0.3,
                    pointRadius: 0,
                    borderWidth: 2,
                    borderCapStyle: "round",
                    borderJoinStyle: "round",
                    order: 99,
                },
            ],
        },
        options: chartOptions({ showLegend: false }),
    });
}

function renderDateStrip(targetId: string, labels: string[]) {
    const container = document.getElementById(targetId);
    if (!container) return;
    container.innerHTML = "";
    if (!labels.length) return;
    const slots = 7;
    const lastIndex = labels.length - 1;
    const step = Math.max(1, Math.floor(lastIndex / (slots - 1)));
    for (let i = 0; i < slots; i += 1) {
        const index =
            i === slots - 1 ? lastIndex : Math.min(lastIndex, i * step);
        const item = document.createElement("span");
        item.textContent = labels[index] || "";
        container.appendChild(item);
    }
}

function renderTimeline(dates: Date[], commits: number[]) {
    const container = document.getElementById("releaseTimeline");
    if (!container) return;
    lastTimelineDates = dates.slice();
    lastTimelineCommits = commits.slice();
    container
        .querySelectorAll(".timeline-dot, .timeline-label")
        .forEach((node) => node.remove());
    if (dates.length <= 1) return;

    const minTime = dates[0].getTime();
    const maxTime = dates[dates.length - 1].getTime();
    const span = Math.max(1, maxTime - minTime);

    const maxCommits = Math.max(1, ...commits);

    dates.forEach((date, index) => {
        const count = commits[index] || 0;
        if (!count) return;
        const x = ((date.getTime() - minTime) / span) * 100;
        const dot = document.createElement("div");
        dot.className = "timeline-dot";
        const size = 4 + Math.min(6, (count / maxCommits) * 6);
        dot.style.width = `${size}px`;
        dot.style.height = `${size}px`;
        dot.style.left = `${x}%`;
        container.appendChild(dot);
    });

    const width = container.getBoundingClientRect().width;
    const points = tagStats
        .map((tag) => {
            const time = tag.date.getTime();
            return {
                name: tag.name,
                date: tag.date,
                time,
                x: ((time - minTime) / span) * 100,
            };
        })
        .filter((entry) => entry.time >= minTime && entry.time <= maxTime)
        .map((entry) => ({ ...entry, xPx: (entry.x / 100) * width }))
        .sort((a, b) => a.xPx - b.xPx);

    const clusters: (typeof points)[] = [];
    const threshold = 18;
    points.forEach((point) => {
        const last = clusters[clusters.length - 1];
        if (
            !last ||
            Math.abs(point.xPx - last[last.length - 1].xPx) > threshold
        ) {
            clusters.push([point]);
        } else {
            last.push(point);
        }
    });

    let lastLabelX: number | null = null;
    clusters.forEach((group) => {
        const x = group.reduce((sum, p) => sum + p.x, 0) / group.length;
        const dot = document.createElement("div");
        dot.className =
            group.length > 1
                ? "timeline-dot is-release is-cluster"
                : "timeline-dot is-release";
        if (group.length > 1) {
            dot.textContent = `${group.length}`;
        }
        dot.style.left = `${x}%`;
        container.appendChild(dot);

        if (group.length === 1) {
            const label = document.createElement("div");
            label.className = "timeline-label";
            if (lastLabelX !== null && Math.abs(x - lastLabelX) < 4) {
                label.classList.add("alt");
            }
            label.style.left = `${x}%`;
            label.textContent = group[0].name;
            container.appendChild(label);
            lastLabelX = x;
        } else {
            const tooltip = document.createElement("div");
            tooltip.className = "timeline-tooltip";
            tooltip.style.left = `${x}%`;
            const list = document.createElement("ul");
            group.forEach((entry) => {
                const item = document.createElement("li");
                item.textContent = entry.name;
                list.appendChild(item);
            });
            tooltip.appendChild(list);
            container.appendChild(tooltip);

            dot.addEventListener("mouseenter", () => {
                tooltip.classList.add("is-visible");
            });
            dot.addEventListener("mouseleave", () => {
                tooltip.classList.remove("is-visible");
            });
        }
    });
}

function rollingAverage(values: number[], windowSize: number) {
    if (windowSize <= 1) return values.slice();
    const out = values.map((_v, index) => {
        const start = Math.max(0, index - windowSize + 1);
        const slice = values.slice(start, index + 1);
        const sum = slice.reduce((acc, v) => acc + v, 0);
        return sum / slice.length;
    });
    return out;
}

function chartOptions({ showLegend }: { showLegend: boolean }) {
    return {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: {
                display: showLegend,
            },
            tooltip: {
                backgroundColor: "rgba(18, 22, 30, 0.95)",
                borderColor: "#253043",
                borderWidth: 1,
                titleColor: "#e9eef6",
                bodyColor: "#c9d2df",
            },
        },
        scales: {
            x: {
                stacked: true,
                grid: {
                    color: "rgba(255, 255, 255, 0.06)",
                    borderDash: [4, 4],
                },
                ticks: {
                    color: "#8a95a8",
                    maxRotation: 0,
                    autoSkip: true,
                    maxTicksLimit: 8,
                },
            },
            y: {
                stacked: true,
                grid: {
                    color: "rgba(255, 255, 255, 0.06)",
                    borderDash: [4, 4],
                },
                ticks: {
                    color: "#8a95a8",
                },
            },
        },
    };
}
