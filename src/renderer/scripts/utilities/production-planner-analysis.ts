// @ts-nocheck
require("../shared/dev-guards");
const { ipcRenderer } = require("electron");
const XLSX = require("xlsx");
const ChartModule = require("chart.js/auto");
const Chart = ChartModule.Chart || ChartModule.default || ChartModule;

const byId = (id: string) => document.getElementById(id);
const numberFormat = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 1 });
const integerFormat = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 0 });
const dateFormat = new Intl.DateTimeFormat("it-IT");
const STORAGE_KEY = "aypi-production-analysis-custom-v1";
const WORK_LABELS = {
    not_started: "Non ancora iniziato",
    running: "In corso",
    done: "Terminato",
};
const MATERIAL_LABELS = {
    available: "Disponibile",
    partial: "Parzialmente disponibile",
    incoming: "In arrivo",
    missing: "Non disponibile",
    verification: "Da verificare",
};
const DIMENSION_LABELS = {
    machine: "Macchina",
    department: "Reparto",
    category: "Categoria",
    article: "Articolo",
    customer: "Cliente",
    material: "Stato materiale",
    status: "Stato lavorazione",
    period: "Periodo",
};
const METRIC_LABELS = {
    jobs: "Numero lavorazioni",
    distinctArticles: "Articoli distinti",
    producedPieces: "Pezzi prodotti",
    plannedPieces: "Pezzi pianificati",
    producedKg: "Kg prodotti",
    completion: "Completamento medio %",
    punctuality: "Puntualità %",
    duration: "Durata media",
};

let plannerState = { machines: [], jobs: [], unavailabilities: [] };
let filteredJobs = [];
let remoteRevision = 0;
let refreshTimer = null;
let charts = new Map();
let customAnalyses = loadCustomAnalyses();

function escapeHtml(value: unknown) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function localIso(date: Date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function parseDate(value: string) {
    if (!value) return null;
    const parsed = new Date(`${String(value).slice(0, 10)}T12:00:00`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function displayDate(value: string) {
    const date = parseDate(value);
    return date ? dateFormat.format(date) : "—";
}

function clamp(value: number, min = 0, max = 1) {
    return Math.max(min, Math.min(max, Number(value) || 0));
}

function machineFor(job) {
    return plannerState.machines.find((machine) => machine.id === job.machineId) || {
        id: job.machineId || "",
        name: job.machineId ? "Macchina rimossa" : "Da pianificare",
        department: job.machineId ? "Non assegnato" : "Da pianificare",
        category: "Non assegnata",
    };
}

function progressRatio(job) {
    if (job.workStatus === "done") return 1;
    return clamp((Number(job.progressDays) || 0) / Math.max(1, Number(job.durationDays) || 1));
}

function completionDate(job) {
    if (job.workStatus !== "done") return "";
    return String(job.completedAt || job.end || "").slice(0, 10);
}

function isOnTime(job) {
    const due = parseDate(job.firstDeliveryDate);
    const completed = parseDate(completionDate(job));
    if (!due || !completed) return null;
    return completed <= due;
}

function summarize(jobs) {
    const articleSet = new Set();
    const machineSet = new Set();
    const departmentSet = new Set();
    let completed = 0;
    let plannedPieces = 0;
    let producedPieces = 0;
    let plannedKg = 0;
    let producedKg = 0;
    let progressTotal = 0;
    let durationTotal = 0;
    let punctualEligible = 0;
    let punctual = 0;
    jobs.forEach((job) => {
        if (job.article) articleSet.add(String(job.article).trim().toLocaleLowerCase("it"));
        const machine = machineFor(job);
        if (job.machineId) machineSet.add(job.machineId);
        if (machine.department) departmentSet.add(machine.department);
        const quantity = Math.max(0, Number(job.quantity) || 0);
        const ratio = progressRatio(job);
        if (job.unit === "kg") {
            plannedKg += quantity;
            producedKg += quantity * ratio;
        } else {
            plannedPieces += quantity;
            producedPieces += quantity * ratio;
        }
        progressTotal += ratio;
        durationTotal += Math.max(0, Number(job.durationDays) || 0);
        if (job.workStatus === "done") completed += 1;
        const onTime = isOnTime(job);
        if (onTime !== null) {
            punctualEligible += 1;
            if (onTime) punctual += 1;
        }
    });
    return {
        jobs: jobs.length,
        distinctArticles: articleSet.size,
        machines: machineSet.size,
        departments: departmentSet.size,
        completed,
        plannedPieces,
        producedPieces,
        plannedKg,
        producedKg,
        completion: jobs.length ? (progressTotal / jobs.length) * 100 : 0,
        duration: jobs.length ? durationTotal / jobs.length : 0,
        punctualEligible,
        punctual,
        punctuality: punctualEligible ? (punctual / punctualEligible) * 100 : null,
    };
}

function startOfWeek(date: Date) {
    const copy = new Date(date);
    const day = copy.getDay() || 7;
    copy.setDate(copy.getDate() - day + 1);
    return copy;
}

function periodKey(job, granularity) {
    const date = parseDate(completionDate(job) || job.end || job.start);
    if (!date) return "Senza data";
    const year = date.getFullYear();
    const month = date.getMonth();
    if (granularity === "day") return localIso(date);
    if (granularity === "week") return `Settimana ${localIso(startOfWeek(date))}`;
    if (granularity === "quarter") return `${year} · T${Math.floor(month / 3) + 1}`;
    if (granularity === "year") return String(year);
    return `${year}-${String(month + 1).padStart(2, "0")}`;
}

function groupJobs(jobs, keyGetter) {
    const groups = new Map();
    jobs.forEach((job) => {
        const key = String(keyGetter(job) || "Non specificato");
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(job);
    });
    return [...groups.entries()].map(([label, items]) => ({
        label,
        jobs: items,
        summary: summarize(items),
    }));
}

function selectedValues(id: string) {
    const select = byId(id) as HTMLSelectElement;
    return new Set([...select.selectedOptions].map((option) => option.value));
}

function exactMatch(value, filter) {
    if (!filter) return true;
    return String(value || "").trim().localeCompare(filter.trim(), "it", { sensitivity: "accent" }) === 0;
}

function overlaps(job, from, to) {
    if (!from && !to) return true;
    const start = String(job.start || job.end || "").slice(0, 10);
    const end = String(job.end || job.start || "").slice(0, 10);
    if (!start && !end) return false;
    return (!from || end >= from) && (!to || start <= to);
}

function within(value, from, to) {
    if (!from && !to) return true;
    const date = String(value || "").slice(0, 10);
    if (!date) return false;
    return (!from || date >= from) && (!to || date <= to);
}

function readFilters() {
    return {
        productionFrom: (byId("filter-production-from") as HTMLInputElement).value,
        productionTo: (byId("filter-production-to") as HTMLInputElement).value,
        deliveryFrom: (byId("filter-delivery-from") as HTMLInputElement).value,
        deliveryTo: (byId("filter-delivery-to") as HTMLInputElement).value,
        completionFrom: (byId("filter-completion-from") as HTMLInputElement).value,
        completionTo: (byId("filter-completion-to") as HTMLInputElement).value,
        article: (byId("filter-article") as HTMLInputElement).value,
        customer: (byId("filter-customer-text") as HTMLInputElement).value,
        workStatus: (byId("filter-work-status") as HTMLSelectElement).value,
        materialStatus: (byId("filter-material-status") as HTMLSelectElement).value,
        unit: (byId("filter-unit") as HTMLSelectElement).value,
        departments: selectedValues("filter-departments"),
        categories: selectedValues("filter-categories"),
        machines: selectedValues("filter-machines"),
        onlyCompleted: (byId("filter-only-completed") as HTMLInputElement).checked,
        granularity: (byId("filter-granularity") as HTMLSelectElement).value,
    };
}

function applyFilters() {
    const filters = readFilters();
    filteredJobs = plannerState.jobs.filter((job) => {
        const machine = machineFor(job);
        if (!overlaps(job, filters.productionFrom, filters.productionTo)) return false;
        if (!within(job.firstDeliveryDate, filters.deliveryFrom, filters.deliveryTo)) return false;
        if (!within(completionDate(job), filters.completionFrom, filters.completionTo)) return false;
        if (!exactMatch(job.article, filters.article)) return false;
        if (!exactMatch(job.customer, filters.customer)) return false;
        if (filters.workStatus && job.workStatus !== filters.workStatus) return false;
        if (filters.materialStatus && job.materialStatus !== filters.materialStatus) return false;
        if (filters.unit && job.unit !== filters.unit) return false;
        if (filters.departments.size && !filters.departments.has(machine.department)) return false;
        if (filters.categories.size && !filters.categories.has(machine.category)) return false;
        if (filters.machines.size && !filters.machines.has(job.machineId)) return false;
        if (filters.onlyCompleted && job.workStatus !== "done") return false;
        return true;
    });
    renderAll(filters);
}

function renderFilterSummary(filters) {
    const parts = [`${integerFormat.format(filteredJobs.length)} lavorazioni`];
    if (filters.productionFrom || filters.productionTo) {
        parts.push(`produzione ${displayDate(filters.productionFrom)} – ${displayDate(filters.productionTo)}`);
    }
    if (filters.deliveryFrom || filters.deliveryTo) parts.push("prima consegna filtrata");
    if (filters.completionFrom || filters.completionTo) parts.push("completamento filtrato");
    if (filters.departments.size) parts.push(`${filters.departments.size} reparti`);
    if (filters.categories.size) parts.push(`${filters.categories.size} categorie`);
    if (filters.machines.size) parts.push(`${filters.machines.size} macchine`);
    if (filters.article) parts.push(`articolo “${filters.article}”`);
    if (filters.customer) parts.push(`cliente “${filters.customer}”`);
    byId("active-filter-summary").textContent = parts.join(" · ");
}

function renderKpis(summary) {
    byId("kpi-jobs").textContent = integerFormat.format(summary.jobs);
    byId("kpi-jobs-note").textContent = `${integerFormat.format(summary.completed)} completate`;
    byId("kpi-articles").textContent = integerFormat.format(summary.distinctArticles);
    byId("kpi-pieces").textContent = integerFormat.format(summary.producedPieces);
    byId("kpi-kg").textContent = numberFormat.format(summary.producedKg);
    byId("kpi-on-time").textContent = summary.punctuality === null ? "—" : `${numberFormat.format(summary.punctuality)}%`;
    byId("kpi-on-time-note").textContent = `${summary.punctualEligible} completate con prima consegna`;
    byId("kpi-completion").textContent = `${numberFormat.format(summary.completion)}%`;
    byId("kpi-duration").textContent = numberFormat.format(summary.duration);
    byId("kpi-machines").textContent = integerFormat.format(summary.machines);
    byId("kpi-departments-note").textContent = `${summary.departments} reparti`;
}

function chartColors(count) {
    const palette = ["#2c93e8", "#62d6ff", "#705cdf", "#40bf8d", "#f2b84b", "#ff7891", "#5175aa", "#8ed1d8"];
    return Array.from({ length: count }, (_, index) => palette[index % palette.length]);
}

function drawChart(id, config) {
    charts.get(id)?.destroy();
    const canvas = byId(id) as HTMLCanvasElement;
    if (!canvas) return;
    charts.set(id, new Chart(canvas, {
        ...config,
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 220 },
            plugins: {
                legend: { labels: { usePointStyle: true, boxWidth: 9 } },
                tooltip: { intersect: false },
                ...(config.options?.plugins || {}),
            },
            scales: config.options?.scales,
            indexAxis: config.options?.indexAxis,
        },
    }));
}

function renderCharts(groups) {
    const periods = groups.period.slice().sort((a, b) => a.label.localeCompare(b.label, "it"));
    drawChart("chart-timeline", {
        type: "line",
        data: {
            labels: periods.map((row) => row.label),
            datasets: [
                { label: "Pezzi prodotti", data: periods.map((row) => row.summary.producedPieces), borderColor: "#2c93e8", backgroundColor: "#2c93e822", fill: true, tension: .28 },
                { label: "Kg prodotti", data: periods.map((row) => row.summary.producedKg), borderColor: "#705cdf", backgroundColor: "#705cdf18", fill: true, tension: .28 },
            ],
        },
    });
    const machines = groups.machine.slice().sort((a, b) => b.summary.producedPieces - a.summary.producedPieces).slice(0, 15);
    drawChart("chart-machines", {
        type: "bar",
        data: { labels: machines.map((row) => row.label), datasets: [{ label: "Pezzi prodotti", data: machines.map((row) => row.summary.producedPieces), backgroundColor: "#2c93e8" }] },
        options: { indexAxis: "y", plugins: { legend: { display: false } } },
    });
    const departments = groups.department.slice().sort((a, b) => b.summary.jobs - a.summary.jobs);
    drawChart("chart-departments", {
        type: "bar",
        data: {
            labels: departments.map((row) => row.label),
            datasets: [
                { label: "Lavorazioni", data: departments.map((row) => row.summary.jobs), backgroundColor: "#2c93e8" },
                { label: "Articoli distinti", data: departments.map((row) => row.summary.distinctArticles), backgroundColor: "#62d6ff" },
            ],
        },
    });
    const statusCounts = ["not_started", "running", "done"].map((status) => filteredJobs.filter((job) => job.workStatus === status).length);
    drawChart("chart-status", {
        type: "doughnut",
        data: { labels: Object.values(WORK_LABELS), datasets: [{ data: statusCounts, backgroundColor: ["#91a3b8", "#2c93e8", "#40bf8d"] }] },
        options: { plugins: { legend: { position: "bottom" } } },
    });
    const punctualDepartments = departments.filter((row) => row.summary.punctuality !== null);
    drawChart("chart-punctuality", {
        type: "bar",
        data: { labels: punctualDepartments.map((row) => row.label), datasets: [{ label: "Puntualità %", data: punctualDepartments.map((row) => row.summary.punctuality), backgroundColor: punctualDepartments.map((row) => row.summary.punctuality >= 90 ? "#40bf8d" : row.summary.punctuality >= 70 ? "#f2b84b" : "#ff7891") }] },
        options: { indexAxis: "y", scales: { x: { min: 0, max: 100 } }, plugins: { legend: { display: false } } },
    });
}

function tableMarkup(headers, rows) {
    return `<thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${
        rows.length
            ? rows.map((row) => `<tr>${row.map((cell, index) => `<td${index === 0 ? ' class="cell-label"' : ""}>${escapeHtml(cell)}</td>`).join("")}</tr>`).join("")
            : `<tr><td colspan="${headers.length}" class="empty-cell">Nessun dato per i filtri selezionati</td></tr>`
    }</tbody>`;
}

function summaryRow(row) {
    const summary = row.summary;
    return [
        row.label,
        integerFormat.format(summary.jobs),
        integerFormat.format(summary.distinctArticles),
        integerFormat.format(summary.producedPieces),
        numberFormat.format(summary.producedKg),
        `${numberFormat.format(summary.completion)}%`,
        summary.punctuality === null ? "—" : `${numberFormat.format(summary.punctuality)}%`,
        numberFormat.format(summary.duration),
    ];
}

function renderTables(groups) {
    const headers = ["Voce", "Lavorazioni", "Articoli distinti", "Pezzi prodotti", "Kg prodotti", "Completamento", "Puntualità", "Durata media"];
    [
        ["machine", "machine-table"],
        ["department", "department-table"],
        ["article", "article-table"],
        ["period", "period-table"],
    ].forEach(([groupName, tableId]) => {
        const rows = groups[groupName].slice().sort((a, b) => b.summary.jobs - a.summary.jobs);
        byId(tableId).innerHTML = tableMarkup(headers, rows.map(summaryRow));
        byId(`${groupName}-table-count`).textContent = `${integerFormat.format(rows.length)} righe`;
    });
    const limit = 1000;
    const rows = filteredJobs.slice(0, limit).map((job) => {
        const machine = machineFor(job);
        const onTime = isOnTime(job);
        return [
            job.article || "—", job.customer || "—", job.phase || "—", job.materialAlloy || "—", job.barKgBundles || "—",
            machine.name, machine.department, displayDate(job.start), displayDate(job.end),
            displayDate(job.firstDeliveryDate), displayDate(completionDate(job)), WORK_LABELS[job.workStatus] || job.workStatus,
            `${numberFormat.format(progressRatio(job) * 100)}%`, MATERIAL_LABELS[job.materialStatus] || job.materialStatus,
            numberFormat.format(job.quantity), job.unit || "pz", onTime === null ? "—" : onTime ? "Sì" : "No",
        ];
    });
    byId("detail-table").innerHTML = tableMarkup(
        ["Articolo", "Cliente", "Fase", "Materiale / Lega", "Kg / Fasci di barra", "Macchina", "Reparto", "Inizio", "Fine", "Prima consegna", "Completata il", "Stato", "Avanzamento", "Disponibilità materiale", "Quantità", "Unità", "Puntuale"],
        rows,
    );
    byId("detail-table-count").textContent = filteredJobs.length > limit
        ? `${integerFormat.format(limit)} di ${integerFormat.format(filteredJobs.length)} · Excel contiene tutto`
        : `${integerFormat.format(filteredJobs.length)} righe`;
}

function dimensionKey(job, dimension, granularity) {
    const machine = machineFor(job);
    if (dimension === "machine") return machine.name;
    if (dimension === "department") return machine.department;
    if (dimension === "category") return machine.category;
    if (dimension === "article") return job.article || "Senza articolo";
    if (dimension === "customer") return job.customer || "Senza cliente";
    if (dimension === "material") return MATERIAL_LABELS[job.materialStatus] || job.materialStatus;
    if (dimension === "status") return WORK_LABELS[job.workStatus] || job.workStatus;
    return periodKey(job, granularity);
}

function metricValue(summary, metric) {
    if (metric === "punctuality") return summary.punctuality ?? 0;
    return Number(summary[metric]) || 0;
}

function loadCustomAnalyses() {
    try {
        const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function renderCustomAnalyses(filters) {
    const container = byId("custom-grid");
    [...charts.keys()].filter((key) => key.startsWith("custom-")).forEach((key) => {
        charts.get(key)?.destroy();
        charts.delete(key);
    });
    if (!customAnalyses.length) {
        container.innerHTML = '<div class="custom-empty">Nessuna analisi personalizzata. Aggiungine una usando i controlli sopra.</div>';
        return;
    }
    container.innerHTML = customAnalyses.map((spec) => `
        <article class="custom-card">
            <header><div><span class="eyebrow">${escapeHtml(DIMENSION_LABELS[spec.dimension] || spec.dimension)}</span><h3>${escapeHtml(METRIC_LABELS[spec.metric] || spec.metric)}</h3></div>
            <button type="button" class="custom-remove" data-remove-custom="${escapeHtml(spec.id)}" title="Rimuovi analisi">×</button></header>
            <div class="custom-chart-wrap" id="custom-body-${escapeHtml(spec.id)}"><canvas id="custom-chart-${escapeHtml(spec.id)}"></canvas></div>
        </article>`).join("");
    customAnalyses.forEach((spec) => {
        const groups = groupJobs(filteredJobs, (job) => dimensionKey(job, spec.dimension, filters.granularity))
            .map((row) => ({ ...row, value: metricValue(row.summary, spec.metric) }))
            .sort((a, b) => spec.dimension === "period" ? a.label.localeCompare(b.label, "it") : b.value - a.value)
            .slice(0, 25);
        const body = byId(`custom-body-${spec.id}`);
        if (spec.type === "table") {
            body.innerHTML = `<div class="table-scroll"><table>${tableMarkup(
                [DIMENSION_LABELS[spec.dimension], METRIC_LABELS[spec.metric]],
                groups.map((row) => [row.label, numberFormat.format(row.value)]),
            )}</table></div>`;
            return;
        }
        drawChart(`custom-chart-${spec.id}`, {
            type: spec.type,
            data: {
                labels: groups.map((row) => row.label),
                datasets: [{ label: METRIC_LABELS[spec.metric], data: groups.map((row) => row.value), backgroundColor: spec.type === "doughnut" ? chartColors(groups.length) : "#2c93e8", borderColor: "#2c93e8", tension: .25 }],
            },
            options: { indexAxis: spec.type === "bar" && groups.length > 8 ? "y" : "x", plugins: { legend: { display: spec.type === "doughnut" } } },
        });
    });
}

function buildGroups(filters) {
    return {
        machine: groupJobs(filteredJobs, (job) => machineFor(job).name),
        department: groupJobs(filteredJobs, (job) => machineFor(job).department),
        category: groupJobs(filteredJobs, (job) => machineFor(job).category),
        article: groupJobs(filteredJobs, (job) => job.article || "Senza articolo"),
        customer: groupJobs(filteredJobs, (job) => job.customer || "Senza cliente"),
        material: groupJobs(filteredJobs, (job) => MATERIAL_LABELS[job.materialStatus] || job.materialStatus),
        status: groupJobs(filteredJobs, (job) => WORK_LABELS[job.workStatus] || job.workStatus),
        period: groupJobs(filteredJobs, (job) => periodKey(job, filters.granularity)),
    };
}

function renderAll(filters = readFilters()) {
    const summary = summarize(filteredJobs);
    const groups = buildGroups(filters);
    renderFilterSummary(filters);
    renderKpis(summary);
    renderCharts(groups);
    renderTables(groups);
    renderCustomAnalyses(filters);
}

function setSync(state, text, detail = "") {
    const element = byId("analysis-sync");
    element.className = `analysis-sync is-${state}`;
    element.querySelector("span").textContent = text;
    element.title = detail;
}

function showToast(message, error = false) {
    const toast = byId("analysis-toast");
    toast.textContent = message;
    toast.classList.toggle("is-error", error);
    toast.classList.add("is-visible");
    window.setTimeout(() => toast.classList.remove("is-visible"), 3200);
}

function fillMultiSelect(id, values) {
    const element = byId(id) as HTMLSelectElement;
    const selected = new Set([...element.selectedOptions].map((option) => option.value));
    element.innerHTML = values.map((value) => `<option value="${escapeHtml(value)}"${selected.has(value) ? " selected" : ""}>${escapeHtml(value)}</option>`).join("");
}

function populateFilterOptions() {
    fillMultiSelect("filter-departments", [...new Set(plannerState.machines.map((machine) => machine.department).filter(Boolean))].sort((a, b) => a.localeCompare(b, "it")));
    fillMultiSelect("filter-categories", [...new Set(plannerState.machines.map((machine) => machine.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, "it")));
    fillMultiSelect("filter-machines", plannerState.machines.slice().sort((a, b) => a.name.localeCompare(b.name, "it")).map((machine) => machine.id));
    const machineSelect = byId("filter-machines") as HTMLSelectElement;
    [...machineSelect.options].forEach((option) => {
        const machine = plannerState.machines.find((item) => item.id === option.value);
        if (machine) option.textContent = machine.name;
    });
}

async function loadLatest(manual = false) {
    const refresh = byId("analysis-refresh");
    refresh.classList.add("is-loading");
    setSync("loading", "Aggiornamento…");
    try {
        const result = await ipcRenderer.invoke("production-planner-load");
        if (!result?.ok) throw new Error(result?.error || "Backend non raggiungibile");
        const snapshot = result.snapshot || {};
        plannerState = snapshot.state || { machines: [], jobs: [], unavailabilities: [] };
        plannerState.machines ||= [];
        plannerState.jobs ||= [];
        remoteRevision = Number(snapshot.revision) || 0;
        populateFilterOptions();
        applyFilters();
        const time = new Date(snapshot.updatedAt || Date.now()).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
        setSync("online", `Sincronizzato ${time}`, `Revisione ${remoteRevision}`);
        if (manual) showToast("Analisi aggiornata con i dati più recenti");
    } catch (error) {
        setSync("offline", "Backend non disponibile", String(error));
        showToast("Impossibile aggiornare i dati di produzione", true);
    } finally {
        refresh.classList.remove("is-loading");
    }
}

function setQuickRange(value) {
    const from = byId("filter-production-from") as HTMLInputElement;
    const to = byId("filter-production-to") as HTMLInputElement;
    if (value === "custom") return;
    if (value === "all") {
        from.value = "";
        to.value = "";
        return;
    }
    const today = new Date();
    const start = new Date(today);
    if (value === "current-month") start.setDate(1);
    if (value === "3-months") start.setMonth(start.getMonth() - 3);
    if (value === "6-months") start.setMonth(start.getMonth() - 6);
    if (value === "12-months") start.setMonth(start.getMonth() - 12);
    if (value === "current-year") {
        start.setMonth(0);
        start.setDate(1);
    }
    from.value = localIso(start);
    to.value = localIso(today);
}

function resetFilters() {
    document.querySelectorAll(".filter-panel input").forEach((input: HTMLInputElement) => {
        if (input.type === "checkbox") input.checked = false;
        else input.value = "";
    });
    document.querySelectorAll(".filter-panel select").forEach((select: HTMLSelectElement) => {
        [...select.options].forEach((option) => option.selected = false);
        select.selectedIndex = 0;
    });
    (byId("filter-quick-range") as HTMLSelectElement).value = "12-months";
    (byId("filter-granularity") as HTMLSelectElement).value = "month";
    setQuickRange("12-months");
    applyFilters();
}

function exportRows(groups) {
    const summary = summarize(filteredJobs);
    const overview = [
        ["Indicatore", "Valore"],
        ["Lavorazioni", summary.jobs],
        ["Completate", summary.completed],
        ["Articoli distinti", summary.distinctArticles],
        ["Pezzi prodotti", summary.producedPieces],
        ["Pezzi pianificati", summary.plannedPieces],
        ["Kg prodotti", summary.producedKg],
        ["Kg pianificati", summary.plannedKg],
        ["Completamento medio %", summary.completion],
        ["Puntualità %", summary.punctuality ?? ""],
        ["Produzioni valutabili per puntualità", summary.punctualEligible],
        ["Durata media", summary.duration],
        ["Macchine", summary.machines],
        ["Reparti", summary.departments],
    ];
    const aggregateHeaders = ["Voce", "Lavorazioni", "Articoli distinti", "Pezzi prodotti", "Pezzi pianificati", "Kg prodotti", "Kg pianificati", "Completamento %", "Puntualità %", "Durata media"];
    const aggregate = (rows) => [aggregateHeaders, ...rows.map((row) => [
        row.label, row.summary.jobs, row.summary.distinctArticles, row.summary.producedPieces, row.summary.plannedPieces,
        row.summary.producedKg, row.summary.plannedKg, row.summary.completion, row.summary.punctuality ?? "", row.summary.duration,
    ])];
    const detail = [["Articolo", "Cliente", "Fase", "Materiale / Lega", "Kg / Fasci di barra", "Macchina", "Reparto", "Categoria", "Inizio", "Fine", "Durata", "Prima consegna", "Qtà prima consegna", "Consegna finale opzionale", "Completata il", "Stato", "Avanzamento %", "Disponibilità materiale", "Quantità", "Unità", "Puntuale", "Note"],
        ...filteredJobs.map((job) => {
            const machine = machineFor(job);
            const onTime = isOnTime(job);
            return [job.article, job.customer, job.phase, job.materialAlloy, job.barKgBundles, machine.name, machine.department, machine.category,
                job.start, job.end, job.durationDays, job.firstDeliveryDate, job.firstDeliveryQuantity, job.dueDate, completionDate(job),
                WORK_LABELS[job.workStatus] || job.workStatus, progressRatio(job) * 100, MATERIAL_LABELS[job.materialStatus] || job.materialStatus,
                job.quantity, job.unit, onTime === null ? "" : onTime ? "Sì" : "No", job.notes];
        })];
    return { overview, aggregate, detail };
}

async function exportExcel() {
    if (!filteredJobs.length) {
        showToast("Non ci sono dati da esportare con questi filtri", true);
        return;
    }
    const filters = readFilters();
    const groups = buildGroups(filters);
    const path = await ipcRenderer.invoke("select-output-file", {
        defaultName: `analisi_produzione_${localIso(new Date())}.xlsx`,
        filters: [{ name: "File Excel", extensions: ["xlsx"] }],
    });
    if (!path) return;
    try {
        const workbook = XLSX.utils.book_new();
        const rows = exportRows(groups);
        const append = (name, data) => {
            const sheet = XLSX.utils.aoa_to_sheet(data);
            if (data.length && data[0]?.length) sheet["!autofilter"] = { ref: `A1:${XLSX.utils.encode_col(data[0].length - 1)}${Math.max(1, data.length)}` };
            sheet["!freeze"] = { xSplit: 0, ySplit: 1 };
            sheet["!cols"] = (data[0] || []).map((header) => ({ wch: Math.min(35, Math.max(12, String(header).length + 2)) }));
            XLSX.utils.book_append_sheet(workbook, sheet, name);
        };
        append("Riepilogo", rows.overview);
        append("Per macchina", rows.aggregate(groups.machine));
        append("Per reparto", rows.aggregate(groups.department));
        append("Per categoria", rows.aggregate(groups.category));
        append("Per articolo", rows.aggregate(groups.article));
        append("Per cliente", rows.aggregate(groups.customer));
        append("Per materiale", rows.aggregate(groups.material));
        append("Per stato", rows.aggregate(groups.status));
        append("Per periodo", rows.aggregate(groups.period));
        append("Dettaglio", rows.detail);
        append("Filtri", [
            ["Filtro", "Valore"],
            ["Produzione da", filters.productionFrom], ["Produzione a", filters.productionTo],
            ["Prima consegna da", filters.deliveryFrom], ["Prima consegna a", filters.deliveryTo],
            ["Completamento da", filters.completionFrom], ["Completamento a", filters.completionTo],
            ["Articolo", filters.article], ["Cliente", filters.customer],
            ["Stato", filters.workStatus], ["Materiale", filters.materialStatus], ["Unità", filters.unit],
            ["Reparti", [...filters.departments].join(", ")], ["Categorie", [...filters.categories].join(", ")],
            ["Macchine", [...filters.machines].map((id) => plannerState.machines.find((machine) => machine.id === id)?.name || id).join(", ")],
            ["Solo completate", filters.onlyCompleted ? "Sì" : "No"], ["Granularità", filters.granularity],
        ]);
        customAnalyses.forEach((spec, index) => {
            const customGroups = groupJobs(filteredJobs, (job) => dimensionKey(job, spec.dimension, filters.granularity))
                .map((row) => [row.label, metricValue(row.summary, spec.metric)])
                .sort((a, b) => String(a[0]).localeCompare(String(b[0]), "it"));
            append(`Personalizzata ${index + 1}`, [
                [DIMENSION_LABELS[spec.dimension] || spec.dimension, METRIC_LABELS[spec.metric] || spec.metric],
                ...customGroups,
            ]);
        });
        XLSX.writeFile(workbook, path, { cellDates: true });
        showToast("File Excel creato correttamente");
    } catch (error) {
        showToast(`Esportazione non riuscita: ${String(error)}`, true);
    }
}

function bindEvents() {
    byId("analysis-close").addEventListener("click", () => window.close());
    byId("analysis-refresh").addEventListener("click", () => void loadLatest(true));
    byId("analysis-export").addEventListener("click", () => void exportExcel());
    byId("analysis-apply").addEventListener("click", applyFilters);
    byId("analysis-reset").addEventListener("click", resetFilters);
    byId("filter-quick-range").addEventListener("change", (event) => {
        setQuickRange(event.target.value);
        if (event.target.value !== "custom") applyFilters();
    });
    ["filter-production-from", "filter-production-to"].forEach((id) => byId(id).addEventListener("change", () => {
        (byId("filter-quick-range") as HTMLSelectElement).value = "custom";
    }));
    byId("filter-granularity").addEventListener("change", applyFilters);
    byId("custom-add").addEventListener("click", () => {
        customAnalyses.push({
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            dimension: (byId("custom-dimension") as HTMLSelectElement).value,
            metric: (byId("custom-metric") as HTMLSelectElement).value,
            type: (byId("custom-chart-type") as HTMLSelectElement).value,
        });
        localStorage.setItem(STORAGE_KEY, JSON.stringify(customAnalyses));
        renderCustomAnalyses(readFilters());
    });
    byId("custom-grid").addEventListener("click", (event) => {
        const button = (event.target as HTMLElement).closest("[data-remove-custom]") as HTMLElement;
        if (!button) return;
        customAnalyses = customAnalyses.filter((spec) => spec.id !== button.dataset.removeCustom);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(customAnalyses));
        renderCustomAnalyses(readFilters());
    });
    ipcRenderer.on("aypi-realtime-event", (_event, realtimeEvent) => {
        if (!["*", "production-planner"].includes(realtimeEvent?.module)) return;
        window.clearTimeout(refreshTimer);
        refreshTimer = window.setTimeout(() => void loadLatest(false), 250);
    });
    ipcRenderer.on("aypi-realtime-status", (_event, status) => {
        if (status?.state === "connected") return;
        if (status?.state === "connecting") setSync("loading", "Connessione…");
        if (status?.state === "disconnected") setSync("offline", "Riconnessione…", status?.error || "");
    });
}

setQuickRange("12-months");
bindEvents();
void loadLatest(false);
