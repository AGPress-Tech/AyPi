// @ts-nocheck
require("../shared/dev-guards");
import { ipcRenderer } from "electron";
import path from "path";
import ChartJSImport from "chart.js/auto";

const Chart = ChartJSImport?.Chart || ChartJSImport?.default || ChartJSImport;

const bootRequire = (modulePath) => {
    try {
        return require(modulePath);
    } catch (err) {
        ipcRenderer.invoke("show-message-box", {
            type: "error",
            message: "Errore caricamento modulo analisi calendario.",
            detail: `${modulePath}\n${err.message || err}`,
        });
        throw err;
    }
};

const fpBaseDir = path.join(__dirname, "..", "..", "scripts", "utilities", "ferie-permessi");
const { loadAssigneeOptions } = bootRequire(path.join(fpBaseDir, "services", "assignees"));
const { loadPayload, normalizeBalances, applyMissingRequestDeductions } = bootRequire(
    path.join(fpBaseDir, "services", "balances")
);
const { getRequestDates } = bootRequire(path.join(fpBaseDir, "utils", "requests"));
const { getTypeLabel } = bootRequire(path.join(fpBaseDir, "utils", "labels"));
const { formatDate } = bootRequire(path.join(fpBaseDir, "utils", "date-format"));
const { THEME_STORAGE_KEY, COLOR_STORAGE_KEY, DEFAULT_TYPE_COLORS } = bootRequire(
    path.join(fpBaseDir, "config", "constants")
);

const TYPE_KEYS = ["ferie", "permesso", "straordinari", "mutua", "infortunio", "speciale", "retribuito"];
const DEPT_FALLBACK = "Senza reparto";
const LINE_COLORS = ["#1d4ed8", "#0f766e", "#b45309", "#6d28d9", "#be123c", "#0369a1", "#047857", "#7c2d12"];

const state = {
    assigneeGroups: {},
    selectedDepartments: new Set(),
    departmentSearch: "",
    sortDaily: { key: "period", dir: "asc" },
    sortEmployee: { key: "total", dir: "desc" },
    charts: {
        line: null,
        bars: null,
    },
    tooltipPositionerReady: false,
};

function byId(id) {
    return document.getElementById(id);
}

function setMessage(message = "", isError = false) {
    const el = byId("fpa-message");
    if (!el) return;
    if (!message) {
        el.textContent = "";
        el.classList.add("is-hidden");
        return;
    }
    el.textContent = message;
    el.style.color = isError ? "#b91c1c" : "#0f766e";
    el.classList.remove("is-hidden");
}

function compareAlphaNumeric(a, b) {
    return String(a ?? "").localeCompare(String(b ?? ""), "it", {
        numeric: true,
        sensitivity: "base",
    });
}

function compareNumber(a, b) {
    const aa = Number(a) || 0;
    const bb = Number(b) || 0;
    if (aa === bb) return 0;
    return aa < bb ? -1 : 1;
}

function roundHours(value) {
    return Math.round((Number(value) || 0) * 100) / 100;
}

function formatHours(value) {
    const v = roundHours(value);
    if (Number.isInteger(v)) return String(v);
    return v.toFixed(2);
}

function getSortIndicator(sortState, key) {
    if (!sortState || sortState.key !== key) return "";
    return sortState.dir === "asc" ? " ▲" : " ▼";
}

function toggleSort(stateKey, key, defaultDir = "asc") {
    const current = state[stateKey];
    if (!current || current.key !== key) {
        state[stateKey] = { key, dir: defaultDir };
        return;
    }
    state[stateKey] = {
        key,
        dir: current.dir === "asc" ? "desc" : "asc",
    };
}

function loadThemeSetting() {
    try {
        const value = window.localStorage?.getItem(THEME_STORAGE_KEY);
        return value === "dark" || value === "aypi" ? value : "light";
    } catch (_err) {
        return "light";
    }
}

function applyTheme() {
    const theme = loadThemeSetting();
    document.body.classList.toggle("fp-dark", theme === "dark");
    document.body.classList.toggle("fp-aypi", theme === "aypi");
}

function loadTypeColors() {
    try {
        const raw = window.localStorage?.getItem(COLOR_STORAGE_KEY);
        if (!raw) return { ...DEFAULT_TYPE_COLORS };
        const parsed = JSON.parse(raw);
        return {
            ferie: parsed.ferie || DEFAULT_TYPE_COLORS.ferie,
            permesso: parsed.permesso || DEFAULT_TYPE_COLORS.permesso,
            straordinari: parsed.straordinari || DEFAULT_TYPE_COLORS.straordinari,
            mutua: parsed.mutua || DEFAULT_TYPE_COLORS.mutua,
            speciale: parsed.speciale || DEFAULT_TYPE_COLORS.speciale,
            retribuito: parsed.retribuito || parsed.giustificato || DEFAULT_TYPE_COLORS.retribuito,
        };
    } catch (_err) {
        return { ...DEFAULT_TYPE_COLORS };
    }
}

function getTypeColor(type) {
    const colors = loadTypeColors();
    if (type === "infortunio") return colors.mutua || DEFAULT_TYPE_COLORS.mutua;
    return colors[type] || "#1d4ed8";
}

function toDateKey(date) {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
}

function fromDateKey(value) {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const [y, m, d] = value.split("-").map((v) => parseInt(v, 10));
    const date = new Date(y, m - 1, d);
    if (Number.isNaN(date.getTime())) return null;
    return date;
}

function toDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date, days) {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
}

function buildDateRange(start, end) {
    const rows = [];
    let cursor = toDay(start);
    const to = toDay(end);
    while (cursor <= to) {
        rows.push(toDateKey(cursor));
        cursor = addDays(cursor, 1);
    }
    return rows;
}

function getRangeMode() {
    return document.querySelector("input[name='fpa-range']:checked")?.value || "month";
}

function resolveRange() {
    const mode = getRangeMode();
    const now = new Date();
    if (mode === "last30") {
        const end = toDay(now);
        return { start: addDays(end, -29), end };
    }
    if (mode === "custom") {
        const start = fromDateKey(byId("fpa-start")?.value || "");
        const end = fromDateKey(byId("fpa-end")?.value || "");
        if (!start || !end || end < start) return null;
        return { start, end };
    }
    return {
        start: new Date(now.getFullYear(), now.getMonth(), 1),
        end: new Date(now.getFullYear(), now.getMonth() + 1, 0),
    };
}

function setDefaultRange() {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const startInput = byId("fpa-start");
    const endInput = byId("fpa-end");
    if (startInput) startInput.value = toDateKey(start);
    if (endInput) endInput.value = toDateKey(end);
}

function toggleCustomDateInputs() {
    const custom = getRangeMode() === "custom";
    const startInput = byId("fpa-start");
    const endInput = byId("fpa-end");
    if (startInput) startInput.disabled = !custom;
    if (endInput) endInput.disabled = !custom;
}

function getSelectedTypes() {
    return TYPE_KEYS.filter((type) => byId(`fpa-type-${type}`)?.checked);
}

function loadDataset() {
    const assigneesData = loadAssigneeOptions();
    state.assigneeGroups = assigneesData?.groups || {};
    const normalized = normalizeBalances(loadPayload(), state.assigneeGroups);
    const fixed = applyMissingRequestDeductions(normalized.payload);
    return fixed.payload || {};
}

function getDepartmentMeta(payload) {
    const fromGroups = Object.keys(state.assigneeGroups || {}).map((name) => ({
        name,
        employees: Array.isArray(state.assigneeGroups[name]) ? state.assigneeGroups[name].length : 0,
    }));
    const groupSet = new Set(fromGroups.map((it) => it.name));
    const fromRequests = (payload.requests || [])
        .filter((req) => req && req.status === "approved")
        .map((req) => (req.department || "").trim())
        .filter(Boolean)
        .filter((name) => !groupSet.has(name))
        .map((name) => ({ name, employees: 0 }));
    const all = [...fromGroups, ...fromRequests];
    if (!all.length) return [{ name: DEPT_FALLBACK, employees: 0 }];
    return all.sort((a, b) => a.name.localeCompare(b.name, "it"));
}

function renderDepartments(payload) {
    const list = byId("fpa-dept-list");
    if (!list) return;
    const meta = getDepartmentMeta(payload);
    if (!state.selectedDepartments.size) {
        meta.forEach((entry) => state.selectedDepartments.add(entry.name));
    }

    const q = state.departmentSearch.trim().toLowerCase();
    const rows = meta.filter((entry) => !q || entry.name.toLowerCase().includes(q));
    list.innerHTML = rows
        .map((entry) => {
            const checked = state.selectedDepartments.has(entry.name) ? "checked" : "";
            return `
                <div class="fpa-dept-item" data-name="${entry.name}">
                    <label>
                        <input type="checkbox" ${checked}>
                        <span>${entry.name}</span>
                    </label>
                    <span class="fpa-dept-count">${entry.employees} dip.</span>
                </div>
            `;
        })
        .join("");

    list.querySelectorAll(".fpa-dept-item").forEach((row) => {
        const name = row.getAttribute("data-name") || "";
        const checkbox = row.querySelector("input[type='checkbox']");
        checkbox?.addEventListener("change", () => {
            if (checkbox.checked) state.selectedDepartments.add(name);
            else state.selectedDepartments.delete(name);
            renderDepartmentSelectedCount();
            renderDashboard();
        });
    });
    renderDepartmentSelectedCount();
}

function renderDepartmentSelectedCount() {
    const badge = byId("fpa-dept-selected");
    if (!badge) return;
    badge.textContent = `${state.selectedDepartments.size} selezionati`;
}

function buildAnalysis(payload) {
    const range = resolveRange();
    if (!range) return { error: "Periodo non valido." };
    const selectedTypes = getSelectedTypes();
    if (!selectedTypes.length) return { error: "Seleziona almeno un tipo assenza." };
    if (!state.selectedDepartments.size) return { error: "Seleziona almeno un reparto." };
    const lineGroup = byId("fpa-line-group")?.value || "total";
    const granularity = byId("fpa-granularity")?.value || "day";
    const dateKeys = buildDateRange(range.start, range.end);
    const dayMap = new Map(dateKeys.map((key) => [key, { people: new Set(), byDept: new Map(), byType: new Map() }]));

    const employeeMap = new Map();
    let approvedCount = 0;
    let personDays = 0;
    const peopleSet = new Set();

    (payload.requests || []).forEach((req) => {
        if (!req || req.status !== "approved") return;
        const type = req.type || "";
        if (!selectedTypes.includes(type)) return;
        const department = (req.department || "").trim() || DEPT_FALLBACK;
        if (!state.selectedDepartments.has(department)) return;
        const employeeRaw =
            typeof req.employee === "string"
                ? req.employee
                : req.employee && typeof req.employee === "object"
                  ? String(req.employee.name || "")
                  : "";
        const employee = employeeRaw.trim() || "Dipendente";
        const dates = getRequestDates(req);
        if (!dates.start || !dates.end) return;
        const reqStart = toDay(dates.start);
        const reqEnd = toDay(dates.end);
        if (reqEnd < range.start || reqStart > range.end) return;
        approvedCount += 1;

        let current = reqStart < range.start ? range.start : reqStart;
        const last = reqEnd > range.end ? range.end : reqEnd;
        current = toDay(current);
        const to = toDay(last);
        const employeeKey = `${department}|${employee}`;

        while (current <= to) {
            const key = toDateKey(current);
            const row = dayMap.get(key);
            if (row) {
                const wasPresent = row.people.has(employeeKey);
                row.people.add(employeeKey);
                if (!wasPresent) {
                    personDays += 1;
                    peopleSet.add(employeeKey);
                }
                if (!row.byDept.has(department)) row.byDept.set(department, new Set());
                row.byDept.get(department).add(employeeKey);
                if (!row.byType.has(type)) row.byType.set(type, new Set());
                row.byType.get(type).add(employeeKey);
                const dayStart = new Date(`${key}T00:00:00`);
                const dayEnd = new Date(`${key}T23:59:59.999`);
                let hoursForDay = 0;
                if (req.allDay) {
                    hoursForDay = 8;
                } else {
                    const overlapStart = new Date(Math.max(dates.start.getTime(), dayStart.getTime()));
                    const overlapEnd = new Date(Math.min(dates.end.getTime(), dayEnd.getTime()));
                    if (overlapEnd > overlapStart) {
                        hoursForDay = (overlapEnd.getTime() - overlapStart.getTime()) / 3600000;
                    }
                }
                hoursForDay = roundHours(hoursForDay);
                if (hoursForDay > 0) {
                    if (!employeeMap.has(employeeKey)) {
                        employeeMap.set(employeeKey, {
                            employee,
                            department,
                            byType: {},
                            total: 0,
                            byTypeHours: {},
                            totalHours: 0,
                        });
                    }
                    const emp = employeeMap.get(employeeKey);
                    emp.byType[type] = (emp.byType[type] || 0) + 1;
                    emp.total += 1;
                    emp.byTypeHours[type] = roundHours((emp.byTypeHours[type] || 0) + hoursForDay);
                    emp.totalHours = roundHours((emp.totalHours || 0) + hoursForDay);
                }
            }
            current = addDays(current, 1);
        }
    });

    const dailyRows = dateKeys.map((date) => {
        const row = dayMap.get(date);
        const departments = {};
        row.byDept.forEach((set, dept) => (departments[dept] = set.size));
        const types = {};
        row.byType.forEach((set, type) => (types[type] = set.size));
        return { date, total: row.people.size, departments, types };
    });

    let lineSeries = [];
    if (lineGroup === "department") {
        const names = Array.from(
            dailyRows.reduce((acc, row) => {
                Object.keys(row.departments).forEach((dept) => acc.add(dept));
                return acc;
            }, new Set())
        ).sort((a, b) => a.localeCompare(b, "it"));
        lineSeries = names.map((name, idx) => ({
            label: name,
            color: LINE_COLORS[idx % LINE_COLORS.length],
            values: dailyRows.map((row) => row.departments[name] || 0),
        }));
    } else if (lineGroup === "type") {
        lineSeries = selectedTypes.map((type) => ({
            label: getTypeLabel(type),
            color: getTypeColor(type),
            values: dailyRows.map((row) => row.types[type] || 0),
        }));
    } else {
        lineSeries = [{ label: "Totale", color: "#1d4ed8", values: dailyRows.map((row) => row.total || 0) }];
    }

    return {
        selectedTypes,
        lineGroup,
        granularity,
        dailyRows,
        lineSeries,
        employeeRows: Array.from(employeeMap.values()).sort((a, b) => b.total - a.total),
        kpis: {
            approvedCount,
            people: peopleSet.size,
            personDays,
        },
    };
}

function getWeekKey(dateKey) {
    const d = fromDateKey(dateKey);
    if (!d) return dateKey;
    const day = d.getDay();
    const isoDay = day === 0 ? 7 : day;
    const monday = addDays(d, 1 - isoDay);
    const year = monday.getFullYear();
    const first = new Date(year, 0, 1);
    const firstIsoDay = first.getDay() === 0 ? 7 : first.getDay();
    const firstMonday = addDays(first, 1 - firstIsoDay);
    const week = Math.floor((toDay(monday).getTime() - toDay(firstMonday).getTime()) / (7 * 86400000)) + 1;
    return `${year}-W${String(Math.max(1, week)).padStart(2, "0")}`;
}

function getMonthKey(dateKey) {
    const d = fromDateKey(dateKey);
    if (!d) return dateKey;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function formatBucketLabel(key, granularity) {
    if (granularity === "week") {
        return key.replace("-", " ");
    }
    if (granularity === "month") {
        const [y, m] = key.split("-");
        return `${m}/${y}`;
    }
    return formatDate(key);
}

function aggregateAnalysisRows(data) {
    const granularity = data.granularity || "day";
    if (granularity === "day") {
        return {
            labels: data.dailyRows.map((row) => formatDate(row.date)),
            rows: data.dailyRows,
            lineSeries: data.lineSeries,
        };
    }

    const bucketMap = new Map();
    data.dailyRows.forEach((row) => {
        const key = granularity === "week" ? getWeekKey(row.date) : getMonthKey(row.date);
        if (!bucketMap.has(key)) {
            bucketMap.set(key, { key, total: 0, departments: {}, types: {}, days: 0 });
        }
        const bucket = bucketMap.get(key);
        bucket.total += row.total || 0;
        bucket.days += 1;
        Object.entries(row.departments || {}).forEach(([dept, count]) => {
            bucket.departments[dept] = (bucket.departments[dept] || 0) + (count || 0);
        });
        Object.entries(row.types || {}).forEach(([type, count]) => {
            bucket.types[type] = (bucket.types[type] || 0) + (count || 0);
        });
    });

    const rows = Array.from(bucketMap.values()).sort((a, b) => a.key.localeCompare(b.key));
    const lineSeries = data.lineSeries.map((series) => {
        const values = rows.map((row) => {
            if (data.lineGroup === "department") {
                return row.departments[series.label] || 0;
            }
            if (data.lineGroup === "type") {
                const matchType = data.selectedTypes.find((type) => getTypeLabel(type) === series.label);
                return (matchType && row.types[matchType]) || 0;
            }
            return row.total || 0;
        });
        return { ...series, values };
    });

    return {
        labels: rows.map((row) => formatBucketLabel(row.key, granularity)),
        rows,
        lineSeries,
    };
}

function getChartTheme() {
    const theme = loadThemeSetting();
    if (theme === "dark") {
        return {
            text: "#c9d6ea",
            grid: "rgba(148,163,184,0.28)",
            border: "rgba(148,163,184,0.5)",
            tooltipBg: "#0f172a",
        };
    }
    if (theme === "aypi") {
        return {
            text: "#e4d4bf",
            grid: "rgba(196,184,166,0.24)",
            border: "rgba(196,184,166,0.5)",
            tooltipBg: "#2b2824",
        };
    }
    return {
        text: "#334155",
        grid: "rgba(148,163,184,0.25)",
        border: "rgba(148,163,184,0.5)",
        tooltipBg: "#0f172a",
    };
}

function ensureChartCanvas(host, canvasId, minWidth = 0, height = 260) {
    if (!host) return null;
    host.innerHTML = `<canvas id="${canvasId}" height="${height}"></canvas>`;
    const canvas = host.querySelector("canvas");
    if (!canvas) return null;
    const hostRect = Math.floor(host.getBoundingClientRect().width || 0);
    const fallbackWidth = Math.max(640, Math.floor(window.innerWidth * 0.5));
    const width = Math.max(minWidth, hostRect || fallbackWidth);
    canvas.width = width;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    return canvas;
}

function renderKpis(data) {
    const host = byId("fpa-kpis");
    if (!host) return;
    host.innerHTML = `
        <article class="fpa-kpi"><small>Richieste approvate</small><strong>${data.kpis.approvedCount}</strong></article>
        <article class="fpa-kpi"><small>Persone coinvolte</small><strong>${data.kpis.people}</strong></article>
        <article class="fpa-kpi"><small>Giorni-assenza</small><strong>${data.kpis.personDays}</strong></article>
    `;
}

function renderLineChart(data) {
    const host = byId("fpa-line-chart");
    if (!host) return;
    const view = aggregateAnalysisRows(data);
    if (!view.rows.length || !view.lineSeries.length) {
        if (state.charts.line) {
            state.charts.line.destroy();
            state.charts.line = null;
        }
        host.innerHTML = "Nessun dato nel periodo selezionato.";
        return;
    }
    const canvas = ensureChartCanvas(host, "fpa-line-canvas", 0, 260);
    if (!canvas) return;
    if (state.charts.line) {
        state.charts.line.destroy();
        state.charts.line = null;
    }
    if (!state.tooltipPositionerReady && Chart?.Tooltip?.positioners) {
        Chart.Tooltip.positioners.cursorOffset = function (_items, eventPosition) {
            return {
                x: eventPosition.x + 18,
                y: eventPosition.y - 18,
            };
        };
        state.tooltipPositionerReady = true;
    }
    const theme = getChartTheme();
    state.charts.line = new Chart(canvas.getContext("2d"), {
        type: "line",
        data: {
            labels: view.labels,
            datasets: view.lineSeries.map((series) => ({
                label: series.label,
                data: series.values,
                borderColor: series.color,
                backgroundColor: series.color,
                tension: 0.25,
                pointRadius: 0,
                pointHoverRadius: 0,
                fill: false,
                borderWidth: 2,
            })),
        },
        options: {
            responsive: false,
            maintainAspectRatio: false,
            animations: {
                x: {
                    type: "number",
                    easing: "easeInQuad",
                    duration: 600,
                    from: NaN,
                    delay(ctx) {
                        if (ctx.type !== "data" || ctx.xStarted) {
                            return 0;
                        }
                        ctx.xStarted = true;
                        return ctx.dataIndex * 60;
                    },
                },
                y: {
                    type: "number",
                    easing: "easeInQuad",
                    duration: 600,
                    from(ctx) {
                        const yScale = ctx.chart.scales.y;
                        return yScale ? yScale.getPixelForValue(0) : 0;
                    },
                    delay(ctx) {
                        if (ctx.type !== "data" || ctx.yStarted) {
                            return 0;
                        }
                        ctx.yStarted = true;
                        return ctx.dataIndex * 60;
                    },
                },
            },
            interaction: {
                mode: "index",
                intersect: false,
            },
            plugins: {
                legend: {
                    display: true,
                    position: "bottom",
                    labels: {
                        color: theme.text,
                        boxWidth: 10,
                        boxHeight: 10,
                        usePointStyle: true,
                        pointStyle: "circle",
                    },
                },
                tooltip: {
                    backgroundColor: theme.tooltipBg,
                    position: "cursorOffset",
                    caretPadding: 10,
                    callbacks: {
                        label(context) {
                            const label = context.dataset?.label || "";
                            const value = context.parsed?.y ?? 0;
                            return `${label}: ${value}`;
                        },
                    },
                },
            },
            scales: {
                x: {
                    ticks: {
                        color: theme.text,
                        maxRotation: 0,
                        autoSkip: view.labels.length > 20,
                        maxTicksLimit: 12,
                    },
                    grid: { color: theme.grid },
                    border: { color: theme.border },
                },
                y: {
                    beginAtZero: true,
                    ticks: { color: theme.text, precision: 0 },
                    grid: { color: theme.grid },
                    border: { color: theme.border },
                },
            },
        },
    });
}

function renderDailyTable(data) {
    const host = byId("fpa-daily-table");
    if (!host) return;
    const view = aggregateAnalysisRows(data);
    const granularity = data.granularity || "day";
    const firstHeader = granularity === "day" ? "Data" : granularity === "week" ? "Settimana" : "Mese";
    const rows = view.rows
        .map((row) => {
            const label =
                granularity === "day"
                    ? formatDate(row.date)
                    : granularity === "week"
                      ? formatBucketLabel(row.key, "week")
                      : formatBucketLabel(row.key, "month");
            return {
                period: label,
                periodSort: granularity === "day" ? row.date : row.key,
                total: row.total || 0,
            };
        })
        .sort((a, b) => {
            const sign = state.sortDaily.dir === "asc" ? 1 : -1;
            if (state.sortDaily.key === "total") {
                return compareNumber(a.total, b.total) * sign;
            }
            return compareAlphaNumeric(a.periodSort, b.periodSort) * sign;
        });

    host.innerHTML = `
        <table class="fpa-table">
            <thead>
                <tr>
                    <th class="fpa-sortable" data-sort-key="period">${firstHeader}${getSortIndicator(state.sortDaily, "period")}</th>
                    <th class="fpa-sortable" data-sort-key="total">Assenti${getSortIndicator(state.sortDaily, "total")}</th>
                </tr>
            </thead>
            <tbody>
                ${rows
                    .map((row) => {
                        return `<tr><td>${row.period}</td><td>${row.total}</td></tr>`;
                    })
                    .join("")}
            </tbody>
        </table>
    `;

    host.querySelectorAll("th.fpa-sortable").forEach((th) => {
        th.addEventListener("click", () => {
            const key = th.getAttribute("data-sort-key") || "period";
            toggleSort("sortDaily", key, key === "total" ? "desc" : "asc");
            renderDashboard();
        });
    });
}

function renderBarsChart(data) {
    const host = byId("fpa-bars-chart");
    if (!host) return;
    const topN = parseInt(byId("fpa-top-n")?.value || "10", 10);
    const rows = data.employeeRows.slice(0, Number.isFinite(topN) ? topN : 10);
    if (!rows.length) {
        if (state.charts.bars) {
            state.charts.bars.destroy();
            state.charts.bars = null;
        }
        host.innerHTML = "Nessun dato nel periodo selezionato.";
        return;
    }
    const labels = rows.map((row) => `${row.employee} (${row.department})`);
    const chartHeight = Math.max(290, rows.length * 32);
    const canvas = ensureChartCanvas(host, "fpa-bars-canvas", 0, chartHeight);
    if (!canvas) return;
    if (state.charts.bars) {
        state.charts.bars.destroy();
        state.charts.bars = null;
    }
    const theme = getChartTheme();
    state.charts.bars = new Chart(canvas.getContext("2d"), {
        type: "bar",
        data: {
            labels,
            datasets: data.selectedTypes.map((type) => ({
                label: getTypeLabel(type),
                data: rows.map((row) => row.byType?.[type] || 0),
                backgroundColor: getTypeColor(type),
                borderColor: getTypeColor(type),
                borderWidth: 0,
                stack: "assenze",
                borderRadius: 4,
                barThickness: labels.length > 16 ? 12 : undefined,
            })),
        },
        options: {
            responsive: false,
            maintainAspectRatio: false,
            indexAxis: "y",
            animation: {
                duration: 800,
                easing: "easeOutQuart",
            },
            plugins: {
                legend: {
                    display: true,
                    position: "bottom",
                    labels: {
                        color: theme.text,
                        boxWidth: 10,
                        boxHeight: 10,
                        usePointStyle: true,
                        pointStyle: "circle",
                    },
                },
                tooltip: {
                    backgroundColor: theme.tooltipBg,
                },
            },
            scales: {
                x: {
                    stacked: true,
                    beginAtZero: true,
                    ticks: {
                        color: theme.text,
                        precision: 0,
                    },
                    grid: { color: theme.grid },
                    border: { color: theme.border },
                },
                y: {
                    stacked: true,
                    ticks: { color: theme.text },
                    grid: { color: theme.grid },
                    border: { color: theme.border },
                },
            },
        },
    });
}

function renderEmployeeTable(data) {
    const host = byId("fpa-employee-table");
    if (!host) return;
    const topN = parseInt(byId("fpa-top-n")?.value || "10", 10);
    const rows = data.employeeRows
        .slice(0, Number.isFinite(topN) ? topN : 10)
        .slice()
        .sort((a, b) => {
            const sign = state.sortEmployee.dir === "asc" ? 1 : -1;
            const key = state.sortEmployee.key;
            if (key === "employee" || key === "department") {
                return compareAlphaNumeric(a[key], b[key]) * sign;
            }
            if (key === "total") {
                return compareNumber(a.totalHours, b.totalHours) * sign;
            }
            return compareNumber(a.byTypeHours?.[key] || 0, b.byTypeHours?.[key] || 0) * sign;
        });
    host.innerHTML = `
        <table class="fpa-table">
            <thead>
                <tr>
                    <th class="fpa-sortable" data-sort-key="employee">Dipendente${getSortIndicator(state.sortEmployee, "employee")}</th>
                    <th class="fpa-sortable" data-sort-key="department">Reparto${getSortIndicator(state.sortEmployee, "department")}</th>
                    ${data.selectedTypes
                        .map((type) => `<th class="fpa-sortable" data-sort-key="${type}">${getTypeLabel(type)} (h)${getSortIndicator(state.sortEmployee, type)}</th>`)
                        .join("")}
                    <th class="fpa-sortable" data-sort-key="total">Totale (h)${getSortIndicator(state.sortEmployee, "total")}</th>
                </tr>
            </thead>
            <tbody>
                ${rows
                    .map(
                        (row) => `<tr>
                            <td>${row.employee}</td>
                            <td>${row.department}</td>
                            ${data.selectedTypes.map((type) => `<td>${formatHours(row.byTypeHours?.[type] || 0)}</td>`).join("")}
                            <td><b>${formatHours(row.totalHours || 0)}</b></td>
                        </tr>`
                    )
                    .join("")}
            </tbody>
        </table>
    `;

    host.querySelectorAll("th.fpa-sortable").forEach((th) => {
        th.addEventListener("click", () => {
            const key = th.getAttribute("data-sort-key") || "total";
            toggleSort("sortEmployee", key, key === "employee" || key === "department" ? "asc" : "desc");
            renderDashboard();
        });
    });
}

function destroyCharts() {
    if (state.charts.line) {
        state.charts.line.destroy();
        state.charts.line = null;
    }
    if (state.charts.bars) {
        state.charts.bars.destroy();
        state.charts.bars = null;
    }
}

function renderDashboard() {
    const payload = loadDataset();
    const analysis = buildAnalysis(payload);
    if (analysis.error) {
        destroyCharts();
        setMessage(analysis.error, true);
        return;
    }
    setMessage("");
    renderKpis(analysis);
    renderLineChart(analysis);
    renderDailyTable(analysis);
    renderBarsChart(analysis);
    renderEmployeeTable(analysis);
}

function resetFilters() {
    const month = document.querySelector("input[name='fpa-range'][value='month']");
    if (month) month.checked = true;
    const typeDefaults = {
        ferie: true,
        permesso: true,
        straordinari: false,
        mutua: true,
        infortunio: false,
        speciale: false,
        retribuito: false,
    };
    TYPE_KEYS.forEach((type) => {
        const el = byId(`fpa-type-${type}`);
        if (el) el.checked = !!typeDefaults[type];
    });
    const lineGroup = byId("fpa-line-group");
    if (lineGroup) lineGroup.value = "total";
    const topN = byId("fpa-top-n");
    if (topN) topN.value = "10";
    setDefaultRange();
    toggleCustomDateInputs();
    state.departmentSearch = "";
    const search = byId("fpa-dept-search");
    if (search) search.value = "";
    state.selectedDepartments.clear();
}

function init() {
    applyTheme();
    resetFilters();
    const payload = loadDataset();
    renderDepartments(payload);
    renderDashboard();
    requestAnimationFrame(() => renderDashboard());

    byId("fpa-refresh")?.addEventListener("click", () => {
        renderDashboard();
    });
    byId("fpa-close")?.addEventListener("click", () => {
        window.close();
    });
    byId("fpa-apply")?.addEventListener("click", () => {
        renderDashboard();
    });
    byId("fpa-reset")?.addEventListener("click", () => {
        resetFilters();
        renderDepartments(loadDataset());
        renderDashboard();
    });

    byId("fpa-dept-all")?.addEventListener("click", () => {
        getDepartmentMeta(loadDataset()).forEach((entry) => state.selectedDepartments.add(entry.name));
        renderDepartments(loadDataset());
        renderDashboard();
    });
    byId("fpa-dept-none")?.addEventListener("click", () => {
        state.selectedDepartments.clear();
        renderDepartments(loadDataset());
        setMessage("Seleziona almeno un reparto.", true);
    });
    byId("fpa-dept-search")?.addEventListener("input", (event) => {
        state.departmentSearch = event.target.value || "";
        renderDepartments(loadDataset());
    });

    document.querySelectorAll("input[name='fpa-range']").forEach((el) => {
        el.addEventListener("change", () => {
            toggleCustomDateInputs();
            renderDashboard();
        });
    });

    [
        "fpa-start",
        "fpa-end",
        "fpa-line-group",
        "fpa-granularity",
        "fpa-top-n",
        ...TYPE_KEYS.map((type) => `fpa-type-${type}`),
    ].forEach((id) => {
        byId(id)?.addEventListener("change", () => {
            renderDashboard();
        });
    });

    window.addEventListener("resize", () => {
        renderDashboard();
    });

    window.addEventListener("beforeunload", () => {
        destroyCharts();
    });
}

document.addEventListener("DOMContentLoaded", init);

