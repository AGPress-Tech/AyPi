// @ts-nocheck
require("../shared/dev-guards");
const { ipcRenderer } = require("electron");
const {
    matchesArticleWildcard,
} = require("./production-planner/article-wildcard");

window.addEventListener("error", (event) => {
    console.error("[production-planner] Errore renderer non gestito", {
        message: event.message,
        source: event.filename,
        line: event.lineno,
        column: event.colno,
        stack: event.error?.stack || "",
    });
});
window.addEventListener("unhandledrejection", (event) => {
    console.error(
        "[production-planner] Promise renderer non gestita",
        event.reason?.stack || event.reason || "Errore sconosciuto",
    );
});

type MaterialStatus = "available" | "partial" | "incoming" | "missing" | "verification";
type WorkStatus = "not_started" | "running" | "done";
type Priority = "normal" | "high" | "urgent";

type Machine = {
    id: string;
    name: string;
    department: string;
    category: string;
    color: string;
};

type ProductionJob = {
    id: string;
    customer: string;
    article: string;
    phase: string;
    materialAlloy: string;
    quantity: number;
    unit: "pz" | "kg";
    barKgBundles: string;
    materialOwner: string;
    machineId: string;
    start: string;
    end: string;
    durationDays: number;
    baseSpanDays: number;
    dueDate: string;
    firstDeliveryDate: string;
    firstDeliveryQuantity: number;
    materialStatus: MaterialStatus;
    workStatus: WorkStatus;
    progressDays: number;
    completedAt: string;
    priority: Priority;
    notes: string;
    previousJobId: string;
    nextJobId: string;
};

type UnavailabilityType = "breakdown" | "maintenance" | "vacation" | "closure";

type MachineUnavailability = {
    id: string;
    groupId?: string;
    machineId: string;
    type: UnavailabilityType;
    start: string;
    end: string;
    title: string;
    scopeLabel?: string;
};

type PlannerState = {
    version: 1;
    machineColorSchemeVersion?: number;
    machines: Machine[];
    jobs: ProductionJob[];
    unavailabilities: MachineUnavailability[];
};

const STORAGE_KEY = "aypi-production-planner-v1";
const DAY_MS = 24 * 60 * 60 * 1000;
let dayWidth = 92;

const materialLabels: Record<MaterialStatus, string> = {
    available: "Disponibile",
    partial: "Parzialmente disponibile",
    incoming: "In arrivo",
    missing: "Non disponibile",
    verification: "Da verificare",
};

const workLabels: Record<WorkStatus, string> = {
    not_started: "Non ancora iniziato",
    running: "In corso",
    done: "Terminato",
};

const unavailabilityLabels: Record<UnavailabilityType, string> = {
    breakdown: "Guasto",
    maintenance: "Manutenzione",
    vacation: "Ferie",
    closure: "Chiusura",
};

const defaultMachines: Machine[] = [
    { id: "trapano", name: "TRAPANO", department: "Foratura", category: "Trapani", color: "#00aa55" },
    { id: "21b100", name: "21B100 (Ofmec)", department: "Fresatura", category: "Fresatrici", color: "#dfb900" },
    { id: "21a100", name: "21A100 (AMA)", department: "Fresatura", category: "Fresatrici", color: "#13a9d6" },
    { id: "21a400", name: "21A400 (Maspe 10 unità)", department: "Maspe", category: "Maspe", color: "#ef986a" },
    { id: "21a500", name: "21A500 (Maspe 12 unità)", department: "Maspe", category: "Maspe", color: "#568fc4" },
    { id: "21d100", name: "21D100 (Famup Centro di lavoro)", department: "Centri di lavoro", category: "Centri di lavoro", color: "#2dad62" },
    { id: "21d200", name: "21D200 (BFV orizzontale)", department: "Centri di lavoro", category: "Centri di lavoro", color: "#d9b82c" },
    { id: "21d400", name: "21D400 (Mazak FH-4800)", department: "Centri di lavoro", category: "Centri di lavoro", color: "#df4a49" },
    { id: "21d450", name: "21D450 (Mazak FH-4800)", department: "Centri di lavoro", category: "Centri di lavoro", color: "#df4a49" },
    { id: "21d300", name: "21D300 (Haas VF-70)", department: "Centri di lavoro", category: "Centri di lavoro", color: "#1aa7cf" },
];

let state: PlannerState;
let visibleStart = startOfWeek(new Date());
let visibleDays = 14;
let draggedJobId = "";
let draggedMachineId = "";
let machineAutoScrollFrame: number | null = null;
let machineAutoScrollVelocity = 0;
let jobDragAutoScrollFrame: number | null = null;
let jobDragHorizontalDirection = 0;
let jobDragHorizontalIntensity = 0;
let jobDragVerticalVelocity = 0;
let jobDragLastHorizontalStep = 0;
let jobDragClientX = 0;
let jobDragMachineId = "";
let jobDragAutoScrollReadyAt = 0;
let jobDragAutoScrollSignature = "";
const JOB_DRAG_AUTO_SCROLL_DELAY_MS = 480;
let resizeSession: null | {
    jobId: string;
    edge: "start" | "end";
    originX: number;
    originalStart: string;
    originalEnd: string;
    bar: HTMLElement;
    originalLeft: number;
    originalWidth: number;
    deltaDays: number;
    pointerId: number;
    captureTarget: HTMLElement;
} = null;
let contextJobId = "";
let jobFormRevision = 0;
let linkPickerDirection: "previous" | "next" = "next";
let linkPickerCustomer = "";
let linkPickerDeliveryFrom = "";
let linkPickerDeliveryTo = "";
let linkPickerProductionFrom = "";
let linkPickerProductionTo = "";
let suppressJobClickUntil = 0;
let toastTimer: ReturnType<typeof setTimeout> | null = null;
let resizeRenderTimer: ReturnType<typeof setTimeout> | null = null;
let remoteSaveTimer: ReturnType<typeof setTimeout> | null = null;
let remotePollTimer: ReturnType<typeof setInterval> | null = null;
let remoteRevision = 0;
let localChangeVersion = 0;
let localDirty = false;
let remoteSaveInFlight = false;
let remoteLoadInFlight = false;
let realtimeConnected = false;
let undoStack: PlannerState[] = [];
let stateCheckpoint = "";
let applyingUndo = false;
const MAX_UNDO_STEPS = 40;
let backlogView: "queue" | "filtered" = "queue";
let showArchived = false;
let rangeEditItemIds: string[] = [];
let rangeEditRevision = 0;
let machinePickerDepartment = "";
let machinePickerCategory = "";
let machinePickerSearch = "";
let nativeFocusRequest = 0;
let calendarPanSession: null | {
    originX: number;
    originStart: Date;
    lastDeltaDays: number;
    pointerId: number;
    captureTarget: HTMLElement;
} = null;
const selectedDepartments = new Set<string>();
const selectedCategories = new Set<string>();
const selectedMachines = new Set<string>();
const pendingDepartments = new Set<string>();
const pendingCategories = new Set<string>();
const pendingMachines = new Set<string>();
let resourceFilterDraftActive = false;
const selectedMaterials = new Set<MaterialStatus>();
const contextHoverTimers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

const byId = (id: string) => document.getElementById(id) as HTMLElement | null;
const inputValue = (id: string) => (byId(id) as HTMLInputElement | HTMLSelectElement | null)?.value || "";

function uid(prefix: string) {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function parseDate(value: string | Date) {
    if (value instanceof Date) return new Date(value.getFullYear(), value.getMonth(), value.getDate());
    const [year, month, day] = String(value).split("-").map(Number);
    return new Date(year, (month || 1) - 1, day || 1);
}

function dateKey(value: string | Date) {
    const date = value instanceof Date ? value : parseDate(value);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function addDays(value: string | Date, days: number) {
    const date = parseDate(value);
    date.setDate(date.getDate() + days);
    return date;
}

function isWeekend(value: string | Date) {
    const day = parseDate(value).getDay();
    return day === 0 || day === 6;
}

function nextWeekday(value: string | Date) {
    let date = parseDate(value);
    while (isWeekend(date)) date = addDays(date, 1);
    return date;
}

function diffDays(left: string | Date, right: string | Date) {
    return Math.round((parseDate(left).getTime() - parseDate(right).getTime()) / DAY_MS);
}

function countWeekdays(start: string | Date, end: string | Date) {
    if (!start || !end || parseDate(end) < parseDate(start)) return 0;
    let count = 0;
    for (let date = parseDate(start); date <= parseDate(end); date = addDays(date, 1)) {
        if (!isWeekend(date)) count += 1;
    }
    return count;
}

function countProductionDays(start: string | Date, end: string | Date, machineId: string) {
    if (!start || !end || parseDate(end) < parseDate(start)) return 0;
    let count = 0;
    for (let date = parseDate(start); date <= parseDate(end); date = addDays(date, 1)) {
        if (!isWeekend(date) && !isMachineUnavailable(machineId, date)) count += 1;
    }
    return count;
}

function unavailabilityContains(item: MachineUnavailability, value: string | Date) {
    const date = parseDate(value);
    return date >= parseDate(item.start) && date <= parseDate(item.end);
}

function isMachineUnavailable(machineId: string, value: string | Date) {
    return state.unavailabilities.some(
        (item) => item.machineId === machineId && unavailabilityContains(item, value),
    );
}

function newlyBlockedProductionDates(
    machineId: string,
    start: string,
    end: string,
    previousUnavailabilities: MachineUnavailability[] = state.unavailabilities,
) {
    const dates: Date[] = [];
    for (let date = parseDate(start); date <= parseDate(end); date = addDays(date, 1)) {
        if (isWeekend(date)) continue;
        const wasAlreadyUnavailable = previousUnavailabilities.some(
            (item) => item.machineId === machineId && unavailabilityContains(item, date),
        );
        if (!wasAlreadyUnavailable) dates.push(parseDate(date));
    }
    return dates;
}

function nextAvailableProductionDay(value: string | Date, machineId: string) {
    let date = addDays(value, 1);
    for (let guard = 0; guard < 3660; guard += 1) {
        if (!isWeekend(date) && !isMachineUnavailable(machineId, date)) return date;
        date = addDays(date, 1);
    }
    return date;
}

function endForProductionDuration(start: string | Date, durationDays: number, machineId: string) {
    const duration = Math.max(1, Math.round(durationDays || 1));
    let date = nextWeekday(start);
    let producedDays = 0;
    for (let guard = 0; guard < 3660; guard += 1) {
        if (!isWeekend(date) && !isMachineUnavailable(machineId, date)) producedDays += 1;
        if (producedDays >= duration) return date;
        date = addDays(date, 1);
    }
    return date;
}

function recalculateMachineSchedule(machineId: string) {
    state.jobs.forEach((job) => {
        if (job.machineId !== machineId || !job.start || job.workStatus === "done") return;
        job.end = dateKey(endForProductionDuration(job.start, job.durationDays || 1, machineId));
        job.baseSpanDays = Math.max(1, diffDays(job.end, job.start) + 1);
    });
}

function insertMachineDowntime(machineId: string, blockedDates: Date[]) {
    if (!blockedDates.length) {
        recalculateMachineSchedule(machineId);
        return;
    }
    const dates = [...blockedDates].sort((left, right) => left.getTime() - right.getTime());
    const jobs = state.jobs.filter(
        (job) => job.machineId === machineId && !!job.start && job.workStatus !== "done",
    );

    dates.forEach((blockedDate) => {
        jobs.forEach((job) => {
            if (parseDate(job.end) < blockedDate) return;

            // Un fermo inserito prima della lavorazione sposta l'intera barra di
            // una giornata produttiva. Se invece la attraversa, l'inizio resta
            // fermo e il calcolo della fine recupera il giorno non lavorato.
            if (parseDate(job.start) > blockedDate) {
                job.start = dateKey(nextAvailableProductionDay(job.start, machineId));
            }
            job.end = dateKey(endForProductionDuration(job.start, job.durationDays || 1, machineId));
            job.baseSpanDays = Math.max(1, diffDays(job.end, job.start) + 1);
        });
    });
}

function startOfWeek(value: Date) {
    const date = parseDate(value);
    const weekday = date.getDay() || 7;
    date.setDate(date.getDate() - weekday + 1);
    return date;
}

function formatShortDate(value: string | Date) {
    return new Intl.DateTimeFormat("it-IT", { day: "2-digit", month: "short" }).format(parseDate(value));
}

function formatLongDate(value: string | Date) {
    if (!value) return "—";
    return new Intl.DateTimeFormat("it-IT", { day: "2-digit", month: "2-digit", year: "numeric" }).format(parseDate(value));
}

function formatPeriod(start: Date, days: number) {
    const end = addDays(start, days - 1);
    return `${new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "long" }).format(start)} — ${new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "long", year: "numeric" }).format(end)}`;
}

function showDateInSecondColumn(value: string | Date) {
    visibleStart = addDays(value, -1);
}

function escapeHtml(value: unknown) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function jobTitle(job: ProductionJob) {
    return [job.article, job.phase].filter((value) => String(value || "").trim()).join(" · ");
}

const MACHINE_GROUP_COLORS = [
    "#2478c8", "#13a9d6", "#2dad62", "#df8b32", "#8b65c2",
    "#df535b", "#2c9a94", "#5e74d8", "#c2732d", "#3a9c55",
    "#b95691", "#387fb0", "#8074c9", "#b08a28", "#2f91c7",
    "#cc5f45", "#498e7c", "#a65bba", "#657f35", "#d34f78",
];

function machineGroupKey(department: string, category: string) {
    return `${String(department || "").trim().toLocaleLowerCase("it")}::${String(category || "").trim().toLocaleLowerCase("it")}`;
}

function randomMachineGroupColor(usedColors: Set<string>) {
    const available = MACHINE_GROUP_COLORS.filter(
        (color) => !usedColors.has(color.toLocaleLowerCase()),
    );
    if (available.length) {
        return available[Math.floor(Math.random() * available.length)];
    }
    for (let attempt = 0; attempt < 100; attempt += 1) {
        const hue = Math.floor(Math.random() * 360);
        const saturation = 58 + Math.floor(Math.random() * 20);
        const lightness = 42 + Math.floor(Math.random() * 13);
        const color = hslToHex(hue, saturation, lightness);
        if (!usedColors.has(color.toLocaleLowerCase())) return color;
    }
    const seed = Math.floor(Math.random() * 0xffffff);
    for (let offset = 0; offset <= 0xffffff; offset += 1) {
        const color = `#${((seed + offset) % 0x1000000).toString(16).padStart(6, "0")}`;
        if (!usedColors.has(color.toLocaleLowerCase())) return color;
    }
    return "#2478c8";
}

function hslToHex(hue: number, saturation: number, lightness: number) {
    const s = saturation / 100;
    const l = lightness / 100;
    const chroma = (1 - Math.abs(2 * l - 1)) * s;
    const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
    const match = l - chroma / 2;
    let red = 0;
    let green = 0;
    let blue = 0;
    if (hue < 60) [red, green] = [chroma, x];
    else if (hue < 120) [red, green] = [x, chroma];
    else if (hue < 180) [green, blue] = [chroma, x];
    else if (hue < 240) [green, blue] = [x, chroma];
    else if (hue < 300) [red, blue] = [x, chroma];
    else [red, blue] = [chroma, x];
    return `#${[red, green, blue]
        .map((channel) => Math.round((channel + match) * 255).toString(16).padStart(2, "0"))
        .join("")}`;
}

function normalizeMachineGroupColors(
    machines: Machine[],
    regenerateExisting = false,
) {
    const colorByGroup = new Map<string, string>();
    const usedColors = new Set<string>();
    machines.forEach((machine) => {
        const key = machineGroupKey(machine.department, machine.category);
        let color = colorByGroup.get(key);
        const storedColor = regenerateExisting
            ? ""
            : String(machine.color || "").trim();
        if (!color) {
            color = storedColor && !usedColors.has(storedColor.toLocaleLowerCase())
                ? storedColor
                : randomMachineGroupColor(usedColors);
            colorByGroup.set(key, color);
            usedColors.add(color.toLocaleLowerCase());
        }
        machine.color = color;
    });
    return machines;
}

function assignColorForMachineGroup(machine: Machine, forceNew = false) {
    const key = machineGroupKey(machine.department, machine.category);
    const groupMate = state.machines.find(
        (item) => item.id !== machine.id
            && machineGroupKey(item.department, item.category) === key,
    );
    const usedColors = new Set(
        state.machines
            .filter((item) => item.id !== machine.id
                && machineGroupKey(item.department, item.category) !== key)
            .map((item) => String(item.color || "").toLocaleLowerCase()),
    );
    if (forceNew && machine.color) {
        usedColors.add(machine.color.toLocaleLowerCase());
    }
    machine.color = groupMate?.color || randomMachineGroupColor(usedColors);
    state.machines.forEach((item) => {
        if (machineGroupKey(item.department, item.category) === key) {
            item.color = machine.color;
        }
    });
}

function loadState(): PlannerState {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) {
            const initialState: PlannerState = {
                version: 1,
                machineColorSchemeVersion: 2,
                machines: normalizeMachineGroupColors(
                    defaultMachines.map((machine) => ({ ...machine })),
                    true,
                ),
                jobs: [],
                unavailabilities: [],
            };
            localStorage.setItem(STORAGE_KEY, JSON.stringify(initialState));
            return initialState;
        }
        const parsed = JSON.parse(raw);
        if (!parsed || !Array.isArray(parsed.machines) || !Array.isArray(parsed.jobs)) {
            throw new Error("Formato dati non valido");
        }
        const unavailabilities = Array.isArray(parsed.unavailabilities) ? parsed.unavailabilities : [];
        const jobs = parsed.jobs.map((job: ProductionJob) => {
            const normalizedJob = { ...job } as Record<string, unknown>;
            delete normalizedJob.lot;
            delete normalizedJob.orderReference;
            const existingSpan = job.start && job.end ? Math.max(1, diffDays(job.end, job.start) + 1) : 1;
            const durationDays = Number(job.durationDays) || countWeekdays(job.start, job.end) || 1;
            const workStatus: WorkStatus = job.workStatus === "running"
                ? "running"
                : job.workStatus === "done"
                    ? "done"
                    : "not_started";
            const progressDays = workStatus === "done"
                ? durationDays
                : workStatus === "running"
                    ? Math.min(durationDays, Math.max(0, Number(job.progressDays) || 0))
                    : 0;
            const storedCompletedAt = String(job.completedAt || "");
            const completedAtDate = storedCompletedAt
                ? new Date(storedCompletedAt)
                : null;
            const completedAt = workStatus === "done"
                ? completedAtDate && !Number.isNaN(completedAtDate.getTime())
                    ? completedAtDate.toISOString()
                    : job.end
                        ? parseDate(job.end).toISOString()
                        : new Date().toISOString()
                : "";
            return {
                ...normalizedJob,
                materialAlloy: String(job.materialAlloy || ""),
                barKgBundles: String(job.barKgBundles || ""),
                materialOwner: String(job.materialOwner || ""),
                durationDays,
                baseSpanDays: Number(job.baseSpanDays) || existingSpan,
                workStatus,
                progressDays,
                completedAt,
                previousJobId: String(job.previousJobId || ""),
                nextJobId: String(job.nextJobId || ""),
            };
        });
        const jobIds = new Set(jobs.map((job: ProductionJob) => job.id));
        jobs.forEach((job: ProductionJob) => {
            if (!jobIds.has(job.previousJobId) || job.previousJobId === job.id) job.previousJobId = "";
            if (!jobIds.has(job.nextJobId) || job.nextJobId === job.id) job.nextJobId = "";
        });
        jobs.forEach((job: ProductionJob) => {
            if (job.nextJobId) {
                const next = jobs.find((item: ProductionJob) => item.id === job.nextJobId);
                if (!next?.previousJobId) next.previousJobId = job.id;
                else if (next.previousJobId !== job.id) job.nextJobId = "";
            }
            if (job.previousJobId) {
                const previous = jobs.find((item: ProductionJob) => item.id === job.previousJobId);
                if (!previous?.nextJobId) previous.nextJobId = job.id;
                else if (previous.nextJobId !== job.id) job.previousJobId = "";
            }
        });
        const shouldRegenerateMachineColors =
            Number(parsed.machineColorSchemeVersion) < 2;
        const machines = normalizeMachineGroupColors(
            parsed.machines.map((machine: Machine) => ({
                ...machine,
                category: String(machine.category || "").trim() || "Senza categoria",
            })),
            shouldRegenerateMachineColors,
        );
        const normalizedState: PlannerState = {
            version: 1,
            machineColorSchemeVersion: 2,
            machines,
            jobs,
            unavailabilities,
        };
        if (shouldRegenerateMachineColors) {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizedState));
        }
        return normalizedState;
    } catch (error) {
        console.error("Impossibile caricare il pianificatore:", error);
        const fallbackState: PlannerState = {
            version: 1,
            machineColorSchemeVersion: 2,
            machines: normalizeMachineGroupColors(
                defaultMachines.map((machine) => ({ ...machine })),
                true,
            ),
            jobs: [],
            unavailabilities: [],
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(fallbackState));
        return fallbackState;
    }
}

// La normalizzazione dello stato usa la palette colori delle macchine.
// Inizializziamo lo stato solo dopo che palette e helper sono stati definiti,
// evitando la temporal dead zone dei const nelle build appena avviate.
state = loadState();
stateCheckpoint = JSON.stringify(state);

function updateUndoButton() {
    const button = byId("undo-planner") as HTMLButtonElement | null;
    if (!button) return;
    const available = undoStack.length > 0;
    button.disabled = !available;
    button.title = available
        ? `Annulla ultima modifica (Ctrl+Z) · ${undoStack.length} ${undoStack.length === 1 ? "passaggio disponibile" : "passaggi disponibili"}`
        : "Nessuna modifica da annullare";
}

function resetUndoHistory() {
    undoStack = [];
    stateCheckpoint = JSON.stringify(state);
    updateUndoButton();
}

function saveState() {
    const serializedState = JSON.stringify(state);
    if (!applyingUndo && stateCheckpoint && serializedState !== stateCheckpoint) {
        undoStack.push(JSON.parse(stateCheckpoint));
        if (undoStack.length > MAX_UNDO_STEPS) {
            undoStack.splice(0, undoStack.length - MAX_UNDO_STEPS);
        }
    }
    stateCheckpoint = serializedState;
    updateUndoButton();
    localStorage.setItem(STORAGE_KEY, serializedState);
    localDirty = true;
    localChangeVersion += 1;
    setSyncStatus("syncing", "Sincronizzazione…");
    if (remoteSaveTimer) clearTimeout(remoteSaveTimer);
    remoteSaveTimer = setTimeout(() => {
        remoteSaveTimer = null;
        void pushPlannerState();
    }, 80);
}

function undoLastPlannerChange() {
    const previousState = undoStack.pop();
    if (!previousState) {
        updateUndoButton();
        notify("Nessuna modifica da annullare");
        return;
    }

    if (remoteSaveTimer) {
        clearTimeout(remoteSaveTimer);
        remoteSaveTimer = null;
    }
    applyingUndo = true;
    state = JSON.parse(JSON.stringify(previousState));
    saveState();
    applyingUndo = false;
    renderAll();
    if (byId("machines-dialog")?.classList.contains("is-open")) renderMachinesDialog();
    if (byId("unavailability-dialog")?.classList.contains("is-open")) renderUnavailabilityList();
    if (byId("closures-dialog")?.classList.contains("is-open")) renderClosureList();
    if (byId("machine-picker-dialog")?.classList.contains("is-open")) renderMachinePicker();
    notify("Ultima modifica annullata");
}

function formatSyncClock(value: string | Date = new Date()) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("it-IT", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
    }).format(date);
}

function syncedNowLabel() {
    return `Sincronizzato ${formatSyncClock()}`;
}

function snapshotSyncDetail(snapshot: any) {
    const modifiedAt = formatSyncClock(snapshot?.updatedAt);
    const actor = String(snapshot?.updatedBy || "").trim();
    const revision = Number(snapshot?.revision) || remoteRevision;
    const modification = modifiedAt
        ? `Ultima modifica ${modifiedAt}${actor ? ` di ${actor}` : ""}`
        : "Nessuna modifica registrata";
    return `${modification} · revisione ${revision}`;
}

function setSyncStatus(
    status: "connecting" | "online" | "syncing" | "offline" | "conflict",
    text: string,
    detail = "",
) {
    const element = byId("sync-status");
    const label = byId("sync-status-text");
    if (element) {
        element.dataset.status = status;
        element.title = detail || text;
    }
    if (label) label.textContent = text;
}

function applyRemoteSnapshot(snapshot: any, announce = false) {
    if (!snapshot?.state) return false;
    const previousMachineOrder = state.machines.map((machine) => machine.id).join("|");
    const needsMachineColorMigration =
        Number(snapshot.state.machineColorSchemeVersion) < 2;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot.state));
    state = loadState();
    remoteRevision = Number(snapshot.revision) || 0;
    localDirty = false;
    resetUndoHistory();
    if (needsMachineColorMigration) {
        saveState();
    } else {
        setSyncStatus(
            "online",
            syncedNowLabel(),
            snapshotSyncDetail(snapshot),
        );
    }
    renderAll();
    const nextMachineOrder = state.machines.map((machine) => machine.id).join("|");
    if (
        previousMachineOrder !== nextMachineOrder
        && byId("machines-dialog")?.classList.contains("is-open")
    ) {
        renderMachinesDialog();
    }
    if (byId("machine-picker-dialog")?.classList.contains("is-open")) {
        renderMachinePicker();
    }
    if (announce) notify("Pianificazione aggiornata con gli ultimi dati");
    return true;
}

async function pushPlannerState() {
    if (remoteSaveInFlight || !localDirty) return;
    remoteSaveInFlight = true;
    const pushedVersion = localChangeVersion;
    const snapshot = JSON.parse(JSON.stringify(state));
    setSyncStatus("syncing", "Salvataggio…");
    try {
        const result = await ipcRenderer.invoke("production-planner-save", {
            state: snapshot,
            baseRevision: remoteRevision,
        });
        if (result?.ok && result.snapshot) {
            remoteRevision = Number(result.snapshot.revision) || remoteRevision;
            if (pushedVersion === localChangeVersion) localDirty = false;
            setSyncStatus(
                "online",
                syncedNowLabel(),
                snapshotSyncDetail(result.snapshot),
            );
        } else if (result?.conflict && result.latest?.state) {
            applyRemoteSnapshot(result.latest);
            setSyncStatus(
                "conflict",
                "Aggiornato da un altro utente",
                "La modifica locale non è stata sovrascritta sul server. Ripeti l'operazione sui dati aggiornati.",
            );
            notify("Un altro operatore aveva già modificato il planner: caricati i dati più recenti");
        } else {
            localDirty = true;
            setSyncStatus("offline", "Offline · modifiche locali", result?.error || "Backend non raggiungibile");
        }
    } catch (error) {
        localDirty = true;
        setSyncStatus("offline", "Offline · modifiche locali", String(error));
    } finally {
        remoteSaveInFlight = false;
        if (localDirty) {
            if (remoteSaveTimer) clearTimeout(remoteSaveTimer);
            remoteSaveTimer = setTimeout(() => {
                remoteSaveTimer = null;
                void pushPlannerState();
            }, 3000);
        }
    }
}

async function loadLatestPlanner(options: { manual?: boolean; initial?: boolean } = {}) {
    if (remoteLoadInFlight) return;
    if (options.manual && localDirty) await pushPlannerState();
    if (localDirty || remoteSaveInFlight) return;
    remoteLoadInFlight = true;
    const button = byId("refresh-planner");
    if (options.manual) button?.classList.add("is-loading");
    if (options.initial) setSyncStatus("connecting", "Connessione…");
    try {
        const result = await ipcRenderer.invoke("production-planner-load");
        if (!result?.ok) {
            setSyncStatus("offline", "Offline · dati locali", result?.error || "Backend non raggiungibile");
            return;
        }
        const snapshot = result.snapshot;
        if (!snapshot?.state && Number(snapshot?.revision) === 0) {
            localDirty = true;
            localChangeVersion += 1;
            await pushPlannerState();
            return;
        }
        if (
            options.manual ||
            Number(snapshot?.revision) > remoteRevision ||
            remoteRevision === 0
        ) {
            applyRemoteSnapshot(snapshot, !!options.manual);
        } else {
            setSyncStatus(
                "online",
                syncedNowLabel(),
                snapshotSyncDetail(snapshot),
            );
            if (options.manual) notify("I dati sono già aggiornati");
        }
    } catch (error) {
        setSyncStatus("offline", "Offline · dati locali", String(error));
    } finally {
        remoteLoadInFlight = false;
        button?.classList.remove("is-loading");
    }
}

async function checkForRemoteUpdates() {
    if (remoteLoadInFlight || remoteSaveInFlight || localDirty) return;
    try {
        const result = await ipcRenderer.invoke("production-planner-check");
        if (!result?.ok) {
            setSyncStatus("offline", "Offline · dati locali", result?.error || "Backend non raggiungibile");
            return;
        }
        if (Number(result.snapshot?.revision) > remoteRevision) {
            await loadLatestPlanner();
        } else {
            setSyncStatus(
                "online",
                syncedNowLabel(),
                snapshotSyncDetail(result.snapshot),
            );
        }
    } catch (error) {
        setSyncStatus("offline", "Offline · dati locali", String(error));
    }
}

function notify(message: string) {
    const toast = byId("toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.add("is-visible");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2200);
}

function getFilters() {
    return {
        article: inputValue("article-filter").trim(),
        details: inputValue("details-filter").trim().toLocaleLowerCase("it"),
        departments: selectedDepartments,
        categories: selectedCategories,
        machines: selectedMachines,
        materials: selectedMaterials,
    };
}

function isArchivedJob(job: ProductionJob) {
    if (
        job.workStatus !== "done" ||
        (job.progressDays || 0) < Math.max(1, job.durationDays || 1) ||
        !job.completedAt
    ) {
        return false;
    }
    const completedAt = new Date(job.completedAt);
    if (Number.isNaN(completedAt.getTime())) return false;
    const oneMonthAgo = new Date();
    oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
    return completedAt < oneMonthAgo;
}

function jobMatches(job: ProductionJob) {
    const filters = getFilters();
    const machine = state.machines.find((item) => item.id === job.machineId);
    if (!showArchived && isArchivedJob(job)) return false;
    if (
        filters.article &&
        !matchesArticleWildcard(
            String(job.article || "").trim(),
            filters.article,
        )
    ) {
        return false;
    }
    const detailValues = [
        job.customer,
        job.phase,
        job.materialAlloy,
        machine?.name,
        machine?.department,
        machine?.category,
        job.dueDate,
        job.firstDeliveryDate,
        job.quantity,
        job.unit,
        job.barKgBundles,
        job.materialOwner,
        materialLabels[job.materialStatus],
        workLabels[job.workStatus],
        job.priority,
        job.notes,
    ].map((value) => String(value || "").trim().toLocaleLowerCase("it"));
    if (filters.details && !detailValues.includes(filters.details)) return false;
    if (filters.departments.size && (!machine || !filters.departments.has(machine.department))) return false;
    if (filters.categories.size && (!machine || !filters.categories.has(machine.category))) return false;
    if (filters.machines.size && !filters.machines.has(job.machineId)) return false;
    if (filters.materials.size && !filters.materials.has(job.materialStatus)) return false;
    return true;
}

function isVisible(job: ProductionJob) {
    if (!job.machineId || !job.start || !job.end) return false;
    const rangeEnd = addDays(visibleStart, visibleDays);
    return parseDate(job.end) >= visibleStart && parseDate(job.start) < rangeEnd;
}

function isLate(job: ProductionJob) {
    if (!job.firstDeliveryDate || job.workStatus === "done") return false;
    const firstDelivery = parseDate(job.firstDeliveryDate);
    const today = parseDate(new Date());
    const plannedEnd = job.end ? parseDate(job.end) : today;
    const effectiveCompletion =
        plannedEnd.getTime() > today.getTime() ? plannedEnd : today;
    return effectiveCompletion.getTime() > firstDelivery.getTime();
}

function assignTracks(jobs: ProductionJob[]) {
    const trackEnds: Date[] = [];
    const result = new Map<string, number>();
    jobs
        .slice()
        .sort((a, b) => parseDate(a.start).getTime() - parseDate(b.start).getTime())
        .forEach((job) => {
            const start = parseDate(job.start);
            let track = trackEnds.findIndex((end) => end < start);
            if (track < 0) track = trackEnds.length;
            trackEnds[track] = parseDate(job.end);
            result.set(job.id, track);
        });
    return { tracks: result, count: Math.max(1, trackEnds.length) };
}

function replaceSet<T>(target: Set<T>, source: Set<T>) {
    target.clear();
    source.forEach((value) => target.add(value));
}

function resourceFilterSelections() {
    return resourceFilterDraftActive
        ? {
              departments: pendingDepartments,
              categories: pendingCategories,
              machines: pendingMachines,
          }
        : {
              departments: selectedDepartments,
              categories: selectedCategories,
              machines: selectedMachines,
          };
}

function machineMatchesResourceGroups(
    machine: Machine,
    departments: Set<string>,
    categories: Set<string>,
) {
    return (
        (!departments.size || departments.has(machine.department)) &&
        (!categories.size || categories.has(machine.category))
    );
}

function clearIncompatibleMachines(
    departments: Set<string>,
    categories: Set<string>,
    machines: Set<string>,
) {
    [...machines].forEach((machineId) => {
        const machine = state.machines.find((item) => item.id === machineId);
        if (
            !machine ||
            !machineMatchesResourceGroups(machine, departments, categories)
        ) {
            machines.delete(machineId);
        }
    });
}

function updateResourceFilterSummary() {
    const parts: string[] = [];
    if (selectedDepartments.size) {
        parts.push(
            `${selectedDepartments.size} ${
                selectedDepartments.size === 1 ? "reparto" : "reparti"
            }`,
        );
    }
    if (selectedCategories.size) {
        parts.push(
            `${selectedCategories.size} ${
                selectedCategories.size === 1 ? "categoria" : "categorie"
            }`,
        );
    }
    if (selectedMachines.size) {
        parts.push(
            `${selectedMachines.size} ${
                selectedMachines.size === 1 ? "macchina" : "macchine"
            }`,
        );
    }
    const summary = byId("resource-filter-summary");
    if (summary) {
        summary.textContent =
            parts.length
                ? parts.join(" · ")
                : "Tutti i reparti, categorie e macchine";
    }
}

function renderResourceFilter(
    departments: string[],
    categories: string[],
    preserveMachineScroll = true,
) {
    const selections = resourceFilterSelections();
    const renderChips = (
        containerId: string,
        items: string[],
        selected: Set<string>,
        type: "department" | "category",
    ) => {
        const container = byId(containerId);
        if (!container) return;
        container.innerHTML = items.length
            ? items
                  .map(
                      (item) => `
                <button class="resource-filter__chip ${
                    selected.has(item) ? "is-active" : ""
                }" type="button" data-resource-type="${type}"
                    data-resource-value="${escapeHtml(item)}">${escapeHtml(item)}</button>`,
                  )
                  .join("")
            : '<div class="resource-filter__empty">Nessuna voce disponibile.</div>';
    };

    renderChips(
        "department-filter-options",
        departments,
        selections.departments,
        "department",
    );
    renderChips(
        "category-filter-options",
        categories,
        selections.categories,
        "category",
    );

    const list = byId("machine-filter-options");
    if (list) {
        const previousScrollTop = preserveMachineScroll ? list.scrollTop : 0;
        const search = String(
            (byId("resource-filter-search") as HTMLInputElement | null)?.value ||
                "",
        )
            .trim()
            .toLocaleLowerCase("it");
        const machines = state.machines
            .filter((machine) =>
                machineMatchesResourceGroups(
                    machine,
                    selections.departments,
                    selections.categories,
                ),
            )
            .filter(
                (machine) =>
                    !search ||
                    [machine.name, machine.department, machine.category].some(
                        (value) =>
                            String(value || "")
                                .toLocaleLowerCase("it")
                                .includes(search),
                    ),
            );
        list.innerHTML = machines.length
            ? machines
                  .map(
                      (machine) => `
                <button class="resource-filter__machine ${
                    selections.machines.has(machine.id) ? "is-active" : ""
                }" type="button" data-resource-type="machine"
                    data-resource-value="${escapeHtml(machine.id)}">
                    <i style="background:${escapeHtml(
                        machine.color || "#78a6c8",
                    )}"></i>
                    <span>
                        <strong>${escapeHtml(machine.name)}</strong>
                        <small>${escapeHtml(machine.department)} · ${escapeHtml(
                            machine.category,
                        )}</small>
                    </span>
                    <b>${selections.machines.has(machine.id) ? "✓" : ""}</b>
                </button>`,
                  )
                  .join("")
            : '<div class="resource-filter__empty">Nessuna macchina corrisponde ai filtri.</div>';
        list.scrollTop = Math.min(
            previousScrollTop,
            Math.max(0, list.scrollHeight - list.clientHeight),
        );
    }
    updateResourceFilterSummary();
}

function renderFilters() {
    const departments = [...new Set(state.machines.map((machine) => machine.department))].sort((a, b) => a.localeCompare(b));
    [...selectedDepartments].forEach((item) => {
        if (!departments.includes(item)) selectedDepartments.delete(item);
    });
    const machinesInDepartments = state.machines.filter(
        (machine) =>
            !selectedDepartments.size ||
            selectedDepartments.has(machine.department),
    );
    const categories = [
        ...new Set(machinesInDepartments.map((machine) => machine.category)),
    ].sort((a, b) => a.localeCompare(b));
    [...selectedCategories].forEach((item) => {
        if (!categories.includes(item)) selectedCategories.delete(item);
    });
    const availableMachines = machinesInDepartments.filter(
        (machine) =>
            !selectedCategories.size ||
            selectedCategories.has(machine.category),
    );
    [...selectedMachines].forEach((item) => {
        if (!availableMachines.some((machine) => machine.id === item)) {
            selectedMachines.delete(item);
        }
    });

    const renderOptions = (
        containerId: string,
        items: Array<{ value: string; label: string }>,
        selected: Set<string>,
    ) => {
        const container = byId(containerId);
        if (!container) return;
        container.innerHTML = items.length
            ? items.map((item) => `<label class="multi-filter__option">
                <input type="checkbox" data-filter-value="${escapeHtml(item.value)}" ${selected.has(item.value) ? "checked" : ""}>
                <span>${escapeHtml(item.label)}</span>
            </label>`).join("")
            : `<div class="multi-filter__empty">Nessuna voce disponibile.</div>`;
    };

    renderOptions(
        "department-filter-options",
        departments.map((department) => ({
            value: department,
            label: department,
        })),
        selectedDepartments,
    );
    renderOptions(
        "category-filter-options",
        categories.map((category) => ({ value: category, label: category })),
        selectedCategories,
    );
    renderOptions(
        "machine-filter-options",
        availableMachines.map((machine) => ({
            value: machine.id,
            label: `${machine.department} · ${machine.category} · ${machine.name}`,
        })),
        selectedMachines,
    );
    renderOptions(
        "material-filter-options",
        Object.entries(materialLabels).map(([value, label]) => ({ value, label })),
        selectedMaterials,
    );

    const updateSummary = (id: string, baseLabel: string, count: number) => {
        const summary = byId(id)?.querySelector("summary");
        if (summary) summary.textContent = count ? `${baseLabel} (${count})` : baseLabel;
    };
    updateSummary("department-filter", "Reparti", selectedDepartments.size);
    updateSummary("category-filter", "Categorie", selectedCategories.size);
    updateSummary("machine-filter", "Macchine", selectedMachines.size);
    updateSummary("material-filter", "Disponibilità materiale", selectedMaterials.size);
}

function renderMachineSelect() {
    const select = byId("job-machine") as HTMLSelectElement | null;
    if (!select) return;
    const selected = select.value;
    select.innerHTML = `<option value="">Da pianificare</option>${state.machines.map((machine) => `<option value="${escapeHtml(machine.id)}">${escapeHtml(machine.department)} · ${escapeHtml(machine.category)} · ${escapeHtml(machine.name)}</option>`).join("")}`;
    select.value = state.machines.some((machine) => machine.id === selected) ? selected : "";
    updateJobMachinePickerTrigger();
}

function updateJobMachinePickerTrigger() {
    const machineId = inputValue("job-machine");
    const machine = state.machines.find((item) => item.id === machineId);
    const color = byId("job-machine-picker-color");
    byId("job-machine-picker-name")!.textContent =
        machine?.name || "Da pianificare";
    byId("job-machine-picker-detail")!.textContent = machine
        ? `${machine.department} · ${machine.category}`
        : "Nessuna macchina selezionata";
    if (color) {
        color.style.background = machine?.color || "";
        color.classList.toggle("is-empty", !machine);
    }
    byId("job-machine-picker")?.classList.toggle("has-selection", !!machine);
}

function uniqueMachineValues(
    getter: (machine: Machine) => string,
    machines = state.machines,
) {
    const seen = new Set<string>();
    return machines
        .map(getter)
        .filter((value) => {
            const key = value.toLocaleLowerCase("it");
            if (!value || seen.has(key)) return false;
            seen.add(key);
            return true;
        });
}

function renderMachinePicker() {
    const departments = uniqueMachineValues((machine) => machine.department);
    const categorySource = machinePickerDepartment
        ? state.machines.filter(
            (machine) => machine.department === machinePickerDepartment,
        )
        : state.machines;
    const categories = uniqueMachineValues(
        (machine) => machine.category,
        categorySource,
    );
    if (
        machinePickerCategory
        && !categories.includes(machinePickerCategory)
    ) {
        machinePickerCategory = "";
    }
    const renderChips = (
        values: string[],
        selected: string,
        attribute: "department" | "category",
    ) => values.map((value) => `
        <button class="${selected === value ? "is-active" : ""}" type="button"
            data-machine-picker-${attribute}="${escapeHtml(value)}">${escapeHtml(value)}</button>
    `).join("");
    byId("machine-picker-departments")!.innerHTML = renderChips(
        departments,
        machinePickerDepartment,
        "department",
    );
    byId("machine-picker-categories")!.innerHTML = renderChips(
        categories,
        machinePickerCategory,
        "category",
    );

    const query = machinePickerSearch.trim().toLocaleLowerCase("it");
    const machines = state.machines.filter((machine) => {
        if (
            machinePickerDepartment
            && machine.department !== machinePickerDepartment
        ) return false;
        if (
            machinePickerCategory
            && machine.category !== machinePickerCategory
        ) return false;
        if (!query) return true;
        return [machine.name, machine.department, machine.category]
            .some((value) => String(value || "").toLocaleLowerCase("it").includes(query));
    });
    const selectedMachineId = inputValue("job-machine");
    byId("machine-picker-summary")!.textContent =
        `${machines.length} ${machines.length === 1 ? "macchina disponibile" : "macchine disponibili"} · ordine condiviso del Gantt`;
    byId("machine-picker-list")!.innerHTML = `
        <button class="machine-picker-card machine-picker-card--unplanned ${selectedMachineId ? "" : "is-selected"}"
            type="button" data-machine-picker-id="">
            <i></i>
            <span><strong>Da pianificare</strong><small>Assegna la macchina in un secondo momento</small></span>
            <b>${selectedMachineId ? "" : "✓"}</b>
        </button>
        ${machines.map((machine, index) => `
            <button class="machine-picker-card ${selectedMachineId === machine.id ? "is-selected" : ""}"
                type="button" data-machine-picker-id="${escapeHtml(machine.id)}">
                <i style="background:${escapeHtml(machine.color)}"></i>
                <span><strong>${escapeHtml(machine.name)}</strong><small>${escapeHtml(machine.department)} · ${escapeHtml(machine.category)}</small></span>
                <em>#${state.machines.indexOf(machine) + 1}</em>
                <b>${selectedMachineId === machine.id ? "✓" : ""}</b>
            </button>
        `).join("") || '<div class="machine-picker__empty">Nessuna macchina corrisponde ai filtri selezionati.</div>'}`;
}

function openMachinePicker() {
    machinePickerDepartment = "";
    machinePickerCategory = "";
    machinePickerSearch = "";
    const search = byId("machine-picker-search") as HTMLInputElement | null;
    if (search) search.value = "";
    renderMachinePicker();
    openDialog("machine-picker-dialog");
    requestAnimationFrame(() => search?.focus());
}

function closeMachinePicker() {
    closeDialog("machine-picker-dialog");
    restoreJobFormInteractivity(false);
}

function selectJobMachine(machineId: string) {
    const select = byId("job-machine") as HTMLSelectElement | null;
    if (!select) return;
    select.value = state.machines.some((machine) => machine.id === machineId)
        ? machineId
        : "";
    updateJobMachinePickerTrigger();
    updateJobStartAvailability();
    closeMachinePicker();
}

function renderBacklog() {
    const list = byId("backlog-list");
    if (!list) return;
    const backlog = byId("backlog-dropzone");
    const help = byId("backlog-help");
    document.querySelectorAll<HTMLElement>("[data-backlog-view]").forEach((button) => {
        const active = button.dataset.backlogView === backlogView;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-selected", String(active));
    });
    backlog?.classList.toggle("is-navigation-mode", backlogView === "filtered");

    if (backlogView === "filtered") {
        const jobs = state.jobs
            .filter(jobMatches)
            .sort((left, right) => {
                const leftPlanned = !!left.machineId && !!left.start;
                const rightPlanned = !!right.machineId && !!right.start;
                if (leftPlanned !== rightPlanned) return leftPlanned ? -1 : 1;
                if (leftPlanned && rightPlanned) {
                    const dateOrder = parseDate(left.start).getTime() - parseDate(right.start).getTime();
                    if (dateOrder) return dateOrder;
                }
                return jobTitle(left).localeCompare(jobTitle(right), "it", {
                    numeric: true,
                    sensitivity: "base",
                });
            });
        if (help) help.textContent = "Clicca una lavorazione per raggiungerla nel Gantt. La lista segue tutti i filtri attivi.";
        byId("backlog-count")!.textContent = String(jobs.length);
        list.innerHTML = jobs.length
            ? jobs.map((job) => {
                const machine = state.machines.find((item) => item.id === job.machineId);
                const planned = !!machine && !!job.start;
                const position = planned
                    ? `${machine.name} · ${formatLongDate(job.start)}`
                    : "Non ancora assegnata a una macchina";
                return `<button class="filtered-job-card material-${job.materialStatus} ${planned ? "" : "is-unplanned"}"
                    data-job-navigate="${escapeHtml(job.id)}" type="button">
                    <em class="filtered-job-card__state">${planned ? "NEL GANTT" : "IN CODA"}</em>
                    <strong>${escapeHtml(jobTitle(job))}</strong>
                    <span>${escapeHtml(job.customer)}</span>
                    <small>${escapeHtml(position)} · ${job.durationDays || 1} gg lav.</small>
                </button>`;
            }).join("")
            : `<div class="backlog-empty">Nessuna lavorazione corrisponde ai filtri.</div>`;
        return;
    }

    const jobs = state.jobs.filter((job) => !job.machineId && jobMatches(job));
    if (help) help.textContent = "Trascina una lavorazione su una macchina e sul giorno desiderato.";
    byId("backlog-count")!.textContent = String(jobs.length);
    list.innerHTML = jobs.length
        ? jobs.map((job) => `
            <article class="backlog-card material-${job.materialStatus}" draggable="true" data-job-id="${escapeHtml(job.id)}" tabindex="0">
                ${job.previousJobId ? `<button class="backlog-link backlog-link--previous" draggable="false" data-link-navigate="${escapeHtml(job.previousJobId)}" type="button" title="Vai alla lavorazione precedente">‹</button>` : ""}
                ${job.nextJobId ? `<button class="backlog-link backlog-link--next" draggable="false" data-link-navigate="${escapeHtml(job.nextJobId)}" type="button" title="Vai alla lavorazione successiva">›</button>` : ""}
                ${job.priority !== "normal" ? `<b class="priority-badge">${job.priority === "urgent" ? "URGENTE" : "ALTA"}</b>` : ""}
                <strong>${escapeHtml(jobTitle(job))}</strong>
                <span>${escapeHtml(job.customer)}</span>
                <small>${job.durationDays || 1} gg lav. · ${job.quantity || 0} ${escapeHtml(job.unit)}</small>
            </article>`).join("")
        : `<div class="backlog-empty">Nessuna lavorazione in attesa.</div>`;
}

function renderTimeline() {
    const timeline = byId("timeline");
    if (!timeline) return;
    const timelineScroll = byId("timeline-scroll");
    const labelWidth = 220;
    const availableDaysWidth = Math.max(1, (timelineScroll?.clientWidth || labelWidth + visibleDays * 92) - labelWidth);
    dayWidth = Math.max(16, availableDaysWidth / visibleDays);
    timeline.dataset.range = String(visibleDays);
    document.documentElement.style.setProperty("--days", String(visibleDays));
    document.documentElement.style.setProperty("--day-width", `${dayWidth}px`);
    byId("period-label")!.textContent = formatPeriod(visibleStart, visibleDays);

    const today = dateKey(new Date());
    const dayHeadings = Array.from({ length: visibleDays }, (_, index) => {
        const date = addDays(visibleStart, index);
        const day = date.getDay();
        return `<div class="day-heading ${day === 0 || day === 6 ? "is-weekend" : ""} ${dateKey(date) === today ? "is-today" : ""}">
            <span>${new Intl.DateTimeFormat("it-IT", { weekday: "short" }).format(date).replace(".", "")}</span>
            <strong>${date.getDate()}</strong>
            <span>${new Intl.DateTimeFormat("it-IT", { month: "short" }).format(date).replace(".", "")}</span>
        </div>`;
    }).join("");
    const dayGridCells = Array.from({ length: visibleDays }, (_, index) => {
        const date = addDays(visibleStart, index);
        return `<i class="day-grid-cell${isWeekend(date) ? " is-weekend" : ""}"></i>`;
    }).join("");

    const todayOffset = diffDays(new Date(), visibleStart);
    const activeFilters = getFilters();
    const hasJobContentFilters =
        !!activeFilters.article ||
        !!activeFilters.details ||
        activeFilters.materials.size > 0;
    const machines = state.machines.filter((machine) => {
        if (selectedDepartments.size && !selectedDepartments.has(machine.department)) return false;
        if (selectedCategories.size && !selectedCategories.has(machine.category)) return false;
        if (selectedMachines.size && !selectedMachines.has(machine.id)) return false;
        if (hasJobContentFilters) {
            return state.jobs.some(
                (job) => job.machineId === machine.id && isVisible(job) && jobMatches(job),
            );
        }
        return true;
    });

    const rows = machines.map((machine) => {
        const jobs = state.jobs.filter((job) => job.machineId === machine.id && isVisible(job) && jobMatches(job));
        const trackData = assignTracks(jobs);
        const rowHeight = Math.max(82, trackData.count * 62 + 14);
        const unavailabilityBlocks = state.unavailabilities
            .filter((item) => item.machineId === machine.id && parseDate(item.end) >= visibleStart && parseDate(item.start) < addDays(visibleStart, visibleDays))
            .map((item) => {
                const clippedStart = Math.max(0, diffDays(item.start, visibleStart));
                const clippedEnd = Math.min(visibleDays - 1, diffDays(item.end, visibleStart));
                const widthDays = Math.max(1, clippedEnd - clippedStart + 1);
                const label = item.title || unavailabilityLabels[item.type];
                return `<div class="unavailability-block unavailability-block--${item.type}"
                    data-unavailability-edit="${escapeHtml(item.id)}"
                    style="left:${clippedStart * dayWidth + 2}px;width:${widthDays * dayWidth - 4}px"
                    title="${escapeHtml(label)} · ${formatLongDate(item.start)} — ${formatLongDate(item.end)} · Tasto destro per modificare">
                    <span>${escapeHtml(label)}</span>
                </div>`;
            }).join("");
        const bars = jobs.map((job) => {
            const rawStart = diffDays(job.start, visibleStart);
            const rawEnd = diffDays(job.end, visibleStart);
            const continuesBefore = rawStart < 0;
            const continuesAfter = rawEnd >= visibleDays;
            const clippedStart = Math.max(0, rawStart);
            const clippedEnd = Math.min(visibleDays - 1, rawEnd);
            const widthDays = Math.max(1, clippedEnd - clippedStart + 1);
            const track = trackData.tracks.get(job.id) || 0;
            const firstDelivery = job.firstDeliveryDate
                ? `<span>1ª cons. ${formatShortDate(job.firstDeliveryDate)}${job.firstDeliveryQuantity ? ` · ${job.firstDeliveryQuantity} ${escapeHtml(job.unit)}` : ""}</span>`
                : "";
            const processedDays = job.workStatus === "done"
                ? job.durationDays
                : Math.min(job.durationDays || 1, Math.max(0, job.progressDays || 0));
            const progressPercent = Math.round((processedDays / Math.max(1, job.durationDays || 1)) * 100);
            const progressLabel = processedDays > 0
                ? `<span>${processedDays}/${job.durationDays || 1} gg · ${progressPercent}%</span>`
                : "";
            return `<article class="job-bar material-${job.materialStatus} ${isLate(job) ? "is-late" : ""} ${continuesBefore ? "continues-before" : ""} ${continuesAfter ? "continues-after" : ""}"
                draggable="true" tabindex="0" data-job-id="${escapeHtml(job.id)}" data-status="${job.workStatus}"
                style="left:${clippedStart * dayWidth + 3}px;width:${Math.max(10, widthDays * dayWidth - 6)}px;top:${track * 62 + 12}px;--job-progress:${progressPercent}%"
                aria-label="${escapeHtml(job.customer)} · ${escapeHtml(jobTitle(job))}">
                <i class="job-bar__progress"></i>
                ${continuesBefore ? '<i class="job-bar__continuation job-bar__continuation--before" aria-hidden="true">‹‹</i>' : ""}
                ${continuesAfter ? '<i class="job-bar__continuation job-bar__continuation--after" aria-hidden="true">››</i>' : ""}
                <i class="job-resize job-resize--start" data-resize-edge="start"></i>
                ${job.previousJobId ? `<button class="job-link-point job-link-point--previous" draggable="false" data-link-navigate="${escapeHtml(job.previousJobId)}" type="button" title="Vai alla lavorazione precedente" aria-label="Vai alla lavorazione precedente"></button>` : ""}
                <strong>${escapeHtml(jobTitle(job))}</strong>
                <small>${escapeHtml(job.customer)} · ${job.durationDays || 1} gg lav. · ${job.quantity || 0} ${escapeHtml(job.unit)}</small>
                <em class="job-bar__meta">${progressLabel}${firstDelivery}</em>
                <i class="job-resize job-resize--end" data-resize-edge="end"></i>
                ${job.nextJobId ? `<button class="job-link-point job-link-point--next" draggable="false" data-link-navigate="${escapeHtml(job.nextJobId)}" type="button" title="Vai alla lavorazione successiva" aria-label="Vai alla lavorazione successiva"></button>` : ""}
                <i class="job-bar__status"></i>
            </article>`;
        }).join("");
        const todayLine = todayOffset >= 0 && todayOffset < visibleDays
            ? `<i class="today-line" style="left:${todayOffset * dayWidth + dayWidth / 2}px"></i>`
            : "";
        return `<div class="machine-row" style="min-height:${rowHeight}px">
            <div class="machine-label" style="--machine-color:${escapeHtml(machine.color)}">
                <i class="machine-label__color"></i>
                <div><strong>${escapeHtml(machine.name)}</strong><span>${escapeHtml(machine.department)} · ${escapeHtml(machine.category)}</span></div>
            </div>
            <div class="machine-days" data-machine-id="${escapeHtml(machine.id)}" style="min-height:${rowHeight}px"><div class="machine-days__grid" aria-hidden="true">${dayGridCells}</div>${unavailabilityBlocks}${todayLine}${bars}</div>
        </div>`;
    }).join("");

    timeline.innerHTML = `
        <div class="timeline-header">
            <div class="timeline-header__label">MACCHINA / REPARTO / CATEGORIA</div>
            <div class="days-header">${dayHeadings}</div>
        </div>
        ${rows || `<div class="backlog-empty">Nessuna macchina corrisponde ai filtri.</div>`}`;
    requestAnimationFrame(renderJobLinks);
}

function renderJobLinks() {
    const timeline = byId("timeline");
    if (!timeline) return;
    timeline.querySelector(".job-links-layer")?.remove();
    const timelineRect = timeline.getBoundingClientRect();
    const daysRect = timeline.querySelector(".days-header")?.getBoundingClientRect();
    if (!timelineRect.width || !timelineRect.height) return;
    const gridLeft = (daysRect?.left || timelineRect.left + 220) - timelineRect.left + 3;
    const gridRight = (daysRect?.right || timelineRect.right) - timelineRect.left - 3;
    const rangeEnd = addDays(visibleStart, visibleDays - 1);
    const paths: string[] = [];
    const pointFor = (bar: HTMLElement, selector: string, fallbackEdge: "left" | "right") => {
        const point = bar.querySelector<HTMLElement>(selector);
        const rect = (point || bar).getBoundingClientRect();
        return {
            x: point
                ? rect.left + rect.width / 2 - timelineRect.left
                : (fallbackEdge === "left" ? rect.left : rect.right) - timelineRect.left,
            y: rect.top + rect.height / 2 - timelineRect.top,
        };
    };
    const hiddenBoundary = (hiddenJob: ProductionJob, fallback: "left" | "right") => {
        if (hiddenJob.end && parseDate(hiddenJob.end) < visibleStart) return gridLeft;
        if (hiddenJob.start && parseDate(hiddenJob.start) > rangeEnd) return gridRight;
        return fallback === "left" ? gridLeft : gridRight;
    };
    state.jobs.forEach((job) => {
        if (!job.nextJobId) return;
        const nextJob = state.jobs.find((item) => item.id === job.nextJobId);
        if (!nextJob) return;
        const from = timeline.querySelector<HTMLElement>(`.job-bar[data-job-id="${CSS.escape(job.id)}"]`);
        const to = timeline.querySelector<HTMLElement>(`.job-bar[data-job-id="${CSS.escape(job.nextJobId)}"]`);
        if (!from && !to) return;
        const fromPoint = from
            ? pointFor(from, ".job-link-point--next", "right")
            : {
                x: hiddenBoundary(job, "left"),
                y: pointFor(to!, ".job-link-point--previous", "left").y,
            };
        const toPoint = to
            ? pointFor(to, ".job-link-point--previous", "left")
            : {
                x: hiddenBoundary(nextJob, "right"),
                y: fromPoint.y,
            };
        const startX = fromPoint.x;
        const startY = fromPoint.y;
        const endX = toPoint.x;
        const endY = toPoint.y;
        const bend = Math.max(24, Math.abs(endX - startX) * 0.35);
        const firstControl = endX >= startX ? startX + bend : startX + 24;
        const secondControl = endX >= startX ? endX - bend : endX - 24;
        const continuation = !from || !to;
        paths.push(`<path class="${continuation ? "is-continuation" : ""}" d="M ${startX} ${startY} C ${firstControl} ${startY}, ${secondControl} ${endY}, ${endX} ${endY}"></path>`);
        if (continuation) {
            const edgePoint = from ? toPoint : fromPoint;
            paths.push(`<circle class="job-link-continuation" cx="${edgePoint.x}" cy="${edgePoint.y}" r="4"></circle>`);
        }
    });
    if (!paths.length) return;
    timeline.insertAdjacentHTML(
        "beforeend",
        `<svg class="job-links-layer" width="${timelineRect.width}" height="${timelineRect.height}" aria-hidden="true">${paths.join("")}</svg>`,
    );
}

function renderStats() {
    const filteredJobs = state.jobs.filter(jobMatches);
    byId("stat-planned")!.textContent = String(
        filteredJobs.filter(
            (job) => !!job.machineId && job.workStatus !== "done",
        ).length,
    );
    byId("stat-backlog")!.textContent = String(filteredJobs.filter((job) => !job.machineId).length);
    byId("stat-late")!.textContent = String(filteredJobs.filter(isLate).length);
}

function renderMachinesDialog() {
    const list = byId("machine-list");
    if (!list) return;
    list.innerHTML = state.machines.map((machine) => `
        <div class="machine-item" data-machine-id="${escapeHtml(machine.id)}" style="--machine-color:${escapeHtml(machine.color)}">
            <button class="machine-drag-handle" draggable="true" type="button"
                aria-label="Trascina per riordinare ${escapeHtml(machine.name)}"
                title="Trascina per riordinare"><span></span><span></span><span></span><span></span><span></span><span></span></button>
            <i></i>
            <input data-machine-field="name" value="${escapeHtml(machine.name)}" aria-label="Nome macchina">
            <input data-machine-field="department" value="${escapeHtml(machine.department)}" aria-label="Reparto">
            <input data-machine-field="category" value="${escapeHtml(machine.category)}" aria-label="Categoria">
            <button class="machine-remove" data-remove-machine type="button">Rimuovi</button>
        </div>`).join("");
}

function clearMachineDropIndicators() {
    document.querySelectorAll<HTMLElement>("#machine-list .machine-item").forEach((row) => {
        row.classList.remove("is-dragging", "drop-before", "drop-after");
    });
}

function stopMachineListAutoScroll() {
    machineAutoScrollVelocity = 0;
    if (machineAutoScrollFrame !== null) {
        cancelAnimationFrame(machineAutoScrollFrame);
        machineAutoScrollFrame = null;
    }
    byId("machine-list")?.classList.remove(
        "is-auto-scrolling-up",
        "is-auto-scrolling-down",
    );
}

function runMachineListAutoScroll() {
    const list = byId("machine-list");
    if (!list || !draggedMachineId || !machineAutoScrollVelocity) {
        stopMachineListAutoScroll();
        return;
    }
    list.scrollTop += machineAutoScrollVelocity;
    machineAutoScrollFrame = requestAnimationFrame(runMachineListAutoScroll);
}

function updateMachineListAutoScroll(clientY: number) {
    const list = byId("machine-list");
    if (!list || !draggedMachineId) {
        stopMachineListAutoScroll();
        return;
    }
    const rect = list.getBoundingClientRect();
    const edgeSize = Math.min(90, Math.max(54, rect.height * 0.2));
    const topDistance = clientY - rect.top;
    const bottomDistance = rect.bottom - clientY;
    let velocity = 0;
    if (topDistance < edgeSize && clientY <= rect.bottom) {
        const intensity = Math.max(0, Math.min(1, (edgeSize - topDistance) / edgeSize));
        velocity = -(2 + 22 * intensity * intensity);
    } else if (bottomDistance < edgeSize && clientY >= rect.top) {
        const intensity = Math.max(0, Math.min(1, (edgeSize - bottomDistance) / edgeSize));
        velocity = 2 + 22 * intensity * intensity;
    }
    machineAutoScrollVelocity = velocity;
    list.classList.toggle("is-auto-scrolling-up", velocity < 0);
    list.classList.toggle("is-auto-scrolling-down", velocity > 0);
    if (!velocity) {
        stopMachineListAutoScroll();
        return;
    }
    if (machineAutoScrollFrame === null) {
        machineAutoScrollFrame = requestAnimationFrame(runMachineListAutoScroll);
    }
}

function reorderMachine(
    machineId: string,
    targetMachineId: string,
    placeAfter: boolean,
) {
    if (!machineId || !targetMachineId || machineId === targetMachineId) return false;
    const originalOrder = state.machines.map((machine) => machine.id).join("|");
    const sourceIndex = state.machines.findIndex((machine) => machine.id === machineId);
    if (sourceIndex < 0) return false;
    const [machine] = state.machines.splice(sourceIndex, 1);
    const targetIndex = state.machines.findIndex((item) => item.id === targetMachineId);
    if (targetIndex < 0) {
        state.machines.splice(sourceIndex, 0, machine);
        return false;
    }
    state.machines.splice(targetIndex + (placeAfter ? 1 : 0), 0, machine);
    return originalOrder !== state.machines.map((item) => item.id).join("|");
}

function refreshMachineDialogColors() {
    document.querySelectorAll<HTMLElement>("#machine-list [data-machine-id]").forEach((row) => {
        const machine = state.machines.find((item) => item.id === row.dataset.machineId);
        if (machine) row.style.setProperty("--machine-color", machine.color);
    });
}

function restoreMachineDialogFocus() {
    const dialog = byId("machines-dialog");
    if (!dialog?.classList.contains("is-open")) return;
    cancelActivePointerInteractions({ render: false });
    document.body.classList.remove("is-calendar-panning");
    void focusNativePlannerWindow().finally(() => {
        requestAnimationFrame(() => {
            const input = byId("machine-name") as HTMLInputElement | null;
            if (!input || !dialog.classList.contains("is-open")) return;
            input.focus({ preventScroll: true });
        });
    });
}

function renderUnavailabilityMachineSelect() {
    const select = byId("unavailability-machine") as HTMLSelectElement | null;
    if (!select) return;
    const selected = select.value;
    select.innerHTML = state.machines
        .map((machine) => `<option value="${escapeHtml(machine.id)}">${escapeHtml(machine.department)} · ${escapeHtml(machine.category)} · ${escapeHtml(machine.name)}</option>`)
        .join("");
    if (state.machines.some((machine) => machine.id === selected)) select.value = selected;
}

function renderUnavailabilityList() {
    const list = byId("unavailability-list");
    if (!list) return;
    const items = state.unavailabilities
        .filter((item) => item.type === "breakdown" || item.type === "maintenance")
        .slice()
        .sort((left, right) => parseDate(left.start).getTime() - parseDate(right.start).getTime());
    list.innerHTML = items.length
        ? items.map((item) => {
            const machine = state.machines.find((entry) => entry.id === item.machineId);
            return `<article class="unavailability-item" data-unavailability-id="${escapeHtml(item.id)}" data-type="${item.type}">
                <i></i>
                <div>
                    <strong>${escapeHtml(item.title || unavailabilityLabels[item.type])} · ${escapeHtml(machine?.name || "Macchina rimossa")}</strong>
                    <small>${formatLongDate(item.start)} — ${formatLongDate(item.end)} · ${unavailabilityLabels[item.type]}</small>
                </div>
                <button class="unavailability-remove" data-remove-unavailability type="button">Rimuovi</button>
            </article>`;
        }).join("")
        : `<div class="unavailability-empty">Nessun fermo macchina inserito.</div>`;
}

function getClosureTargetMachineIds() {
    if ((byId("closure-all") as HTMLInputElement | null)?.checked) {
        return new Set(state.machines.map((machine) => machine.id));
    }
    const departments = new Set(
        [...document.querySelectorAll<HTMLInputElement>("[data-closure-department]:checked")]
            .map((input) => input.value),
    );
    const machineIds = new Set(
        [...document.querySelectorAll<HTMLInputElement>("[data-closure-machine]:checked")]
            .map((input) => input.value),
    );
    state.machines.forEach((machine) => {
        if (departments.has(machine.department)) machineIds.add(machine.id);
    });
    return machineIds;
}

function updateClosureSelection() {
    const allSelected = !!(byId("closure-all") as HTMLInputElement | null)?.checked;
    byId("closure-targets")?.classList.toggle("is-disabled", allSelected);
    const count = getClosureTargetMachineIds().size;
    const label = byId("closure-selection-count");
    if (label) label.textContent = count
        ? `${count} ${count === 1 ? "macchina selezionata" : "macchine selezionate"}`
        : "Nessuna macchina selezionata";
}

function renderClosureTargets() {
    const departments = [...new Set(state.machines.map((machine) => machine.department))]
        .sort((left, right) => left.localeCompare(right));
    const departmentList = byId("closure-departments");
    const machineList = byId("closure-machines");
    if (departmentList) {
        departmentList.innerHTML = departments.map((department) => `
            <label class="closure-target-option">
                <input type="checkbox" value="${escapeHtml(department)}" data-closure-department>
                <span>${escapeHtml(department)}</span>
            </label>`).join("");
    }
    if (machineList) {
        machineList.innerHTML = state.machines.map((machine) => `
            <label class="closure-target-option">
                <input type="checkbox" value="${escapeHtml(machine.id)}" data-closure-machine>
                <span>${escapeHtml(machine.department)} · ${escapeHtml(machine.name)}</span>
            </label>`).join("");
    }
    (byId("closure-all") as HTMLInputElement | null)!.checked = false;
    updateClosureSelection();
}

function renderClosureList() {
    const list = byId("closure-list");
    if (!list) return;
    const groups = new Map<string, MachineUnavailability[]>();
    state.unavailabilities
        .filter((item) => item.type === "vacation" || item.type === "closure")
        .forEach((item) => {
            const key = item.groupId || item.id;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key)!.push(item);
        });
    const entries = [...groups.entries()].sort((left, right) =>
        parseDate(left[1][0].start).getTime() - parseDate(right[1][0].start).getTime(),
    );
    list.innerHTML = entries.length
        ? entries.map(([groupId, items]) => {
            const item = items[0];
            const machineNames = items
                .map((entry) => state.machines.find((machine) => machine.id === entry.machineId)?.name)
                .filter(Boolean);
            const scope = item.scopeLabel
                || (machineNames.length === state.machines.length
                    ? "Tutta l'azienda"
                    : machineNames.join(", "));
            return `<article class="closure-item" data-closure-group-id="${escapeHtml(groupId)}" data-type="${item.type}">
                <i></i>
                <div>
                    <strong>${escapeHtml(item.title || unavailabilityLabels[item.type])} · ${escapeHtml(scope)}</strong>
                    <small>${formatLongDate(item.start)} — ${formatLongDate(item.end)} · ${items.length} ${items.length === 1 ? "macchina" : "macchine"}</small>
                </div>
                <button class="unavailability-remove" data-remove-closure type="button">Rimuovi</button>
            </article>`;
        }).join("")
        : `<div class="unavailability-empty">Nessuna chiusura o ferie inserita.</div>`;
}

function openUnavailabilityRangeEditor(itemId: string) {
    const item = state.unavailabilities.find((entry) => entry.id === itemId);
    if (!item) return;
    const isSharedRule =
        (item.type === "closure" || item.type === "vacation")
        && !!item.groupId;
    const items = isSharedRule
        ? state.unavailabilities.filter(
            (entry) => (entry.groupId || entry.id) === item.groupId,
        )
        : [item];
    if (!items.length) return;
    rangeEditItemIds = items.map((entry) => entry.id);
    rangeEditRevision = remoteRevision;
    const machineNames = items
        .map((entry) => state.machines.find((machine) => machine.id === entry.machineId)?.name)
        .filter(Boolean);
    const departments = [...new Set(items
        .map((entry) => state.machines.find((machine) => machine.id === entry.machineId)?.department)
        .filter(Boolean))];
    const typeLabel = item.title || unavailabilityLabels[item.type];
    byId("unavailability-range-title")!.textContent = typeLabel;
    byId("unavailability-range-scope")!.textContent = isSharedRule
        ? `${unavailabilityLabels[item.type]} condivisa: il nuovo periodo verrà applicato a ${items.length} ${items.length === 1 ? "macchina" : "macchine"}${departments.length ? ` nei reparti ${departments.join(", ")}` : ""}.`
        : `${unavailabilityLabels[item.type]} sulla macchina ${machineNames[0] || "selezionata"}.`;
    (byId("unavailability-range-start") as HTMLInputElement).value = item.start;
    (byId("unavailability-range-end") as HTMLInputElement).value = item.end;
    byId("unavailability-range-error")!.textContent = "";
    openDialog("unavailability-range-dialog");
    requestAnimationFrame(() => {
        (byId("unavailability-range-start") as HTMLInputElement | null)?.focus();
    });
}

function closeUnavailabilityRangeEditor() {
    rangeEditItemIds = [];
    closeDialog("unavailability-range-dialog");
}

async function saveUnavailabilityRange(event: SubmitEvent) {
    event.preventDefault();
    const error = byId("unavailability-range-error");
    const start = inputValue("unavailability-range-start");
    const end = inputValue("unavailability-range-end");
    if (!start || !end) return;
    if (parseDate(end) < parseDate(start)) {
        if (error) error.textContent = "La fine del periodo non può precedere l’inizio.";
        return;
    }
    if (rangeEditRevision !== remoteRevision) {
        if (error) {
            error.textContent =
                "Il pianificatore è stato aggiornato da un altro operatore. Chiudi e riapri l’editor prima di salvare.";
        }
        return;
    }
    const items = state.unavailabilities.filter((item) =>
        rangeEditItemIds.includes(item.id),
    );
    if (!items.length) {
        closeUnavailabilityRangeEditor();
        return;
    }
    const reference = items[0];
    const shared =
        (reference.type === "closure" || reference.type === "vacation")
        && !!reference.groupId;
    const targetLabel = shared
        ? `${unavailabilityLabels[reference.type].toLowerCase()} su ${items.length} macchine`
        : `${unavailabilityLabels[reference.type].toLowerCase()} sulla macchina selezionata`;
    if (!await nativeConfirm(
        `Confermi il nuovo periodo dal ${formatLongDate(start)} al ${formatLongDate(end)} per ${targetLabel}?`,
    )) return;
    const machineIds = new Set(items.map((item) => item.machineId));
    const newlyBlockedByMachine = new Map(
        [...machineIds].map((machineId) => [
            machineId,
            newlyBlockedProductionDates(machineId, start, end),
        ]),
    );
    items.forEach((item) => {
        item.start = start;
        item.end = end;
    });
    machineIds.forEach((machineId) => {
        insertMachineDowntime(machineId, newlyBlockedByMachine.get(machineId) || []);
        recalculateMachineSchedule(machineId);
    });
    saveState();
    closeUnavailabilityRangeEditor();
    renderUnavailabilityList();
    renderClosureList();
    renderAll();
    notify(shared
        ? `Periodo aggiornato su ${items.length} macchine`
        : "Periodo indisponibilità aggiornato");
}

function renderAll() {
    hideJobTooltip();
    renderFilters();
    renderMachineSelect();
    renderUnavailabilityMachineSelect();
    renderBacklog();
    renderTimeline();
    renderStats();
}

async function focusNativePlannerWindow() {
    const request = ++nativeFocusRequest;
    try {
        await ipcRenderer.invoke("focus-sender-window");
    } catch (error) {
        console.warn(
            "[production-planner] Impossibile richiedere il focus nativo",
            error,
        );
    }
    if (request !== nativeFocusRequest) return false;
    window.focus();
    return document.hasFocus();
}

async function nativeMessage(
    message: string,
    options: {
        detail?: string;
        type?: "none" | "info" | "warning" | "error" | "question";
        confirmLabel?: string;
        destructive?: boolean;
    } = {},
) {
    const [primary, ...detailParts] = String(message).split(/\n\s*\n/);
    await focusNativePlannerWindow();
    const result = await ipcRenderer.invoke("show-message-box", {
        type: options.type || "question",
        message: primary,
        detail: options.detail || detailParts.join("\n\n"),
        buttons: options.confirmLabel
            ? ["Annulla", options.confirmLabel]
            : ["OK"],
        defaultId: options.confirmLabel && !options.destructive ? 1 : 0,
        cancelId: 0,
        noLink: true,
    });
    await focusNativePlannerWindow();
    return result;
}

async function nativeConfirm(
    message: string,
    confirmLabel = "Conferma",
    destructive = false,
) {
    const result = await nativeMessage(message, {
        confirmLabel,
        destructive,
        type: destructive ? "warning" : "question",
    });
    return Number(result?.response) === 1;
}

async function nativeAlert(message: string) {
    await nativeMessage(message, { type: "warning" });
}

function openDialog(id: string) {
    const dialog = byId(id);
    if (!dialog) return;
    cancelActivePointerInteractions({ render: false });
    closeContextMenu();
    hideJobTooltip();
    dialog.classList.add("is-open");
    dialog.setAttribute("aria-hidden", "false");
    dialog.removeAttribute("inert");
    void focusNativePlannerWindow();
}

function closeDialog(id: string) {
    const dialog = byId(id);
    if (!dialog) return;
    if (id === "machines-dialog") {
        stopMachineListAutoScroll();
        draggedMachineId = "";
        clearMachineDropIndicators();
    }
    dialog.classList.remove("is-open");
    dialog.setAttribute("aria-hidden", "true");
}

function releaseCapturedPointer(
    target: HTMLElement | undefined,
    pointerId: number | undefined,
) {
    if (!target || pointerId === undefined) return;
    try {
        if (target.hasPointerCapture?.(pointerId)) {
            target.releasePointerCapture(pointerId);
        }
    } catch {
        // Il nodo potrebbe essere stato ridisegnato durante il trascinamento.
    }
}

function cancelActivePointerInteractions(
    options: { render?: boolean } = {},
) {
    const hadResize = !!resizeSession;
    releaseCapturedPointer(
        resizeSession?.captureTarget,
        resizeSession?.pointerId,
    );
    releaseCapturedPointer(
        calendarPanSession?.captureTarget,
        calendarPanSession?.pointerId,
    );
    if (resizeSession?.bar) {
        resizeSession.bar.draggable = true;
        resizeSession.bar.classList.remove("is-resizing");
    }
    resizeSession = null;
    calendarPanSession = null;
    draggedJobId = "";
    if (draggedMachineId) {
        stopMachineListAutoScroll();
        draggedMachineId = "";
        clearMachineDropIndicators();
    }
    document.body.classList.remove("is-calendar-panning");
    clearDragPreview();
    if (hadResize && options.render !== false) renderAll();
}

function updateJobStartAvailability() {
    const machine = byId("job-machine") as HTMLSelectElement | null;
    const start = byId("job-start") as HTMLInputElement | null;
    const field = byId("job-start-field");
    const hint = byId("job-start-hint");
    if (!machine || !start) return;
    const isPlanned = !!machine.value;
    start.disabled = !isPlanned;
    field?.classList.toggle("is-disabled", !isPlanned);
    if (!isPlanned) start.value = "";
    else if (!start.value) start.value = dateKey(new Date());
    if (hint) {
        hint.textContent = isPlanned
            ? "Data prevista di avvio produzione."
            : "Disponibile dopo aver scelto una macchina.";
    }
    updateJobMachinePickerTrigger();
}

function restoreJobFormInteractivity(focusFirstField = true) {
    const backdrop = byId("job-dialog");
    const form = byId("job-form") as HTMLFormElement | null;
    if (!backdrop || !form) return;
    backdrop.removeAttribute("inert");
    form.removeAttribute("inert");
    backdrop.style.pointerEvents = "auto";
    form.style.pointerEvents = "auto";
    form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement>(
        "input, select, textarea, button",
    ).forEach((control) => {
        control.style.pointerEvents = "auto";
        if (control.id !== "job-start") control.disabled = false;
        if (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement) {
            control.readOnly = false;
        }
    });
    updateJobStartAvailability();
    const focusFirstFormField = () => {
        if (!backdrop.classList.contains("is-open")) return;
        const article = byId("job-article") as HTMLInputElement | null;
        article?.focus({ preventScroll: true });
    };
    void focusNativePlannerWindow().finally(() => {
        if (!focusFirstField) return;
        requestAnimationFrame(() => {
            focusFirstFormField();
            window.setTimeout(focusFirstFormField, 40);
            window.setTimeout(focusFirstFormField, 140);
        });
    });
}

function restorePlannerWindowFocus() {
    const active = document.activeElement as HTMLElement | null;
    if (active?.closest(".dialog-backdrop")) active.blur();
    window.setTimeout(() => {
        void focusNativePlannerWindow();
    }, 0);
}

function openJob(job?: ProductionJob, asCopy = false) {
    cancelActivePointerInteractions();
    closeContextMenu();
    (byId("job-form") as HTMLFormElement | null)?.reset();
    const today = dateKey(new Date());
    jobFormRevision = remoteRevision;
    (byId("job-id") as HTMLInputElement).value = asCopy ? uid("job") : job?.id || "";
    (byId("job-customer") as HTMLInputElement).value = job?.customer || "";
    (byId("job-article") as HTMLInputElement).value = job?.article || "";
    (byId("job-phase") as HTMLInputElement).value = job?.phase || "";
    (byId("job-material-alloy") as HTMLInputElement).value = job?.materialAlloy || "";
    (byId("job-quantity") as HTMLInputElement).value = job?.quantity ? String(job.quantity) : "";
    (byId("job-unit") as HTMLSelectElement).value = job?.unit || "pz";
    (byId("job-bar-kg-bundles") as HTMLInputElement).value = job?.barKgBundles || "";
    (byId("job-material-owner") as HTMLInputElement).value = job?.materialOwner || "";
    (byId("job-machine") as HTMLSelectElement).value = job?.machineId || "";
    (byId("job-priority") as HTMLSelectElement).value = job?.priority || "normal";
    (byId("job-start") as HTMLInputElement).value = job ? job.start : today;
    (byId("job-duration") as HTMLInputElement).value = String(job?.durationDays || 1);
    (byId("job-due") as HTMLInputElement).value = job?.dueDate || "";
    (byId("job-first-delivery") as HTMLInputElement).value = job?.firstDeliveryDate || "";
    (byId("job-first-delivery-quantity") as HTMLInputElement).value = job?.firstDeliveryQuantity ? String(job.firstDeliveryQuantity) : "";
    (byId("job-material") as HTMLSelectElement).value = job?.materialStatus || "available";
    (byId("job-status") as HTMLSelectElement).value = job?.workStatus || "not_started";
    (byId("job-notes") as HTMLTextAreaElement).value = job?.notes || "";
    updateJobStartAvailability();
    byId("job-dialog-title")!.textContent = asCopy ? "Copia lavorazione" : job ? "Modifica lavorazione" : "Nuova lavorazione";
    byId("job-form-error")!.textContent = "";
    byId("delete-job")!.classList.toggle("button--hidden", !job || asCopy);
    openDialog("job-dialog");
    restoreJobFormInteractivity();
}

async function saveJobFromForm(event: SubmitEvent) {
    event.preventDefault();
    const editingId = inputValue("job-id");
    if (
        state.jobs.some((item) => item.id === editingId) &&
        jobFormRevision !== remoteRevision
    ) {
        byId("job-form-error")!.textContent =
            "Il planner è stato aggiornato da un altro operatore mentre modificavi questa lavorazione. Chiudi e riapri il form per lavorare sui dati più recenti.";
        return;
    }
    const machineId = inputValue("job-machine");
    const rawStart = inputValue("job-start");
    const start = rawStart ? dateKey(nextWeekday(rawStart)) : "";
    const durationDays = Math.max(1, Math.round(Number(inputValue("job-duration")) || 1));
    const error = byId("job-form-error")!;
    if (machineId && !start) {
        error.textContent = "Per una lavorazione pianificata serve la data di inizio.";
        return;
    }

    const id = inputValue("job-id") || uid("job");
    const previous = state.jobs.find((item) => item.id === id);
    const scheduleChanged = !previous
        || previous.durationDays !== durationDays
        || previous.start !== start
        || previous.machineId !== machineId;
    const end = start
        ? scheduleChanged
            ? dateKey(endForProductionDuration(start, durationDays, machineId))
            : previous.end
        : "";
    const baseSpanDays = start && end ? Math.max(1, diffDays(end, start) + 1) : 1;
    const workStatus = inputValue("job-status") as WorkStatus;
    const progressDays = workStatus === "done"
        ? durationDays
        : workStatus === "running"
            ? Math.min(durationDays, Math.max(1, previous?.progressDays || 1))
            : 0;
    const completedAt = workStatus === "done"
        ? previous?.workStatus === "done" && previous.completedAt
            ? previous.completedAt
            : new Date().toISOString()
        : "";
    const job: ProductionJob = {
        id,
        customer: inputValue("job-customer").trim(),
        article: inputValue("job-article").trim(),
        phase: inputValue("job-phase").trim(),
        materialAlloy: inputValue("job-material-alloy").trim(),
        quantity: Number(inputValue("job-quantity")) || 0,
        unit: inputValue("job-unit") as "pz" | "kg",
        barKgBundles: inputValue("job-bar-kg-bundles").trim(),
        materialOwner: inputValue("job-material-owner").trim(),
        machineId,
        start,
        end,
        durationDays,
        baseSpanDays,
        dueDate: inputValue("job-due"),
        firstDeliveryDate: inputValue("job-first-delivery"),
        firstDeliveryQuantity: Number(inputValue("job-first-delivery-quantity")) || 0,
        materialStatus: inputValue("job-material") as MaterialStatus,
        workStatus,
        progressDays,
        completedAt,
        priority: inputValue("job-priority") as Priority,
        notes: inputValue("job-notes").trim(),
        previousJobId: previous?.previousJobId || "",
        nextJobId: previous?.nextJobId || "",
    };
    const index = state.jobs.findIndex((item) => item.id === id);
    const confirmation = index >= 0
        ? `Confermi il salvataggio delle modifiche a "${jobTitle(job)}"?`
        : `Confermi la creazione della lavorazione "${jobTitle(job)}"?`;
    if (!await nativeConfirm(confirmation, "Salva")) {
        restoreJobFormInteractivity();
        return;
    }
    if (index >= 0) state.jobs[index] = job;
    else state.jobs.push(job);
    saveState();
    closeDialog("job-dialog");
    restorePlannerWindowFocus();
    renderAll();
    notify(index >= 0 ? "Lavorazione aggiornata" : "Lavorazione creata");
}

async function deleteCurrentJob() {
    const id = inputValue("job-id");
    if (await deleteJobWithConfirmation(id)) {
        closeDialog("job-dialog");
        restorePlannerWindowFocus();
    }
}

async function deleteJobWithConfirmation(id: string) {
    const job = state.jobs.find((item) => item.id === id);
    if (!job) return false;
    const confirmed = await nativeConfirm(
        `Eliminare definitivamente la lavorazione "${jobTitle(job)}"?\n\nQuesta operazione non può essere annullata.`,
        "Elimina",
        true,
    );
    if (!confirmed) return false;
    state.jobs.forEach((item) => {
        if (item.previousJobId === id) item.previousJobId = "";
        if (item.nextJobId === id) item.nextJobId = "";
    });
    state.jobs = state.jobs.filter((item) => item.id !== id);
    saveState();
    renderAll();
    notify("Lavorazione eliminata definitivamente");
    return true;
}

async function requestCloseJobDialog() {
    const dialog = byId("job-dialog");
    if (!dialog?.classList.contains("is-open")) return;
    const currentId = inputValue("job-id");
    const job = state.jobs.find((item) => item.id === currentId);
    const message = job
        ? `Annullare le modifiche a "${jobTitle(job)}"?\n\nLe modifiche non salvate verranno perse.`
        : "Annullare l'inserimento della nuova lavorazione?\n\nI dati inseriti verranno persi.";
    if (!await nativeConfirm(message, "Annulla modifiche", true)) {
        restoreJobFormInteractivity();
        return;
    }
    closeDialog("job-dialog");
    restorePlannerWindowFocus();
}

function closeContextMenu() {
    const menu = byId("job-context-menu");
    if (!menu) return;
    menu.querySelectorAll(".context-menu__entry").forEach((entry) => {
        entry.classList.remove("is-open", "is-hovered");
    });
    menu.classList.remove("is-open");
    menu.classList.remove("context-menu--flip");
    menu.classList.remove("context-menu--link-picker");
    menu.setAttribute("aria-hidden", "true");
    contextJobId = "";
}

function keepContextMenuInViewport() {
    const menu = byId("job-context-menu");
    if (!menu) return;
    const rect = menu.getBoundingClientRect();
    const left = Math.min(Number.parseFloat(menu.style.left) || 8, window.innerWidth - rect.width - 8);
    const top = Math.min(Number.parseFloat(menu.style.top) || 8, window.innerHeight - rect.height - 8);
    menu.style.left = `${Math.max(8, left)}px`;
    menu.style.top = `${Math.max(8, top)}px`;
}

function positionVisibleContextSubmenus() {
    const menu = byId("job-context-menu");
    if (!menu?.classList.contains("is-open")) return;
    const submenus = [...menu.querySelectorAll(".context-submenu")] as HTMLElement[];
    submenus.forEach((submenu) => {
        submenu.style.setProperty("--submenu-shift-x", "0px");
        submenu.style.setProperty("--submenu-shift-y", "0px");
    });
    submenus.forEach((submenu) => {
        if (window.getComputedStyle(submenu).display === "none") return;
        const rect = submenu.getBoundingClientRect();
        const margin = 8;
        let shiftX = 0;
        let shiftY = 0;
        if (rect.right > window.innerWidth - margin) shiftX -= rect.right - (window.innerWidth - margin);
        if (rect.left + shiftX < margin) shiftX += margin - (rect.left + shiftX);
        if (rect.bottom > window.innerHeight - margin) shiftY -= rect.bottom - (window.innerHeight - margin);
        if (rect.top + shiftY < margin) shiftY += margin - (rect.top + shiftY);
        submenu.style.setProperty("--submenu-shift-x", `${Math.round(shiftX)}px`);
        submenu.style.setProperty("--submenu-shift-y", `${Math.round(shiftY)}px`);
    });
}

function wouldCreateLink(previousId: string, nextId: string) {
    if (!previousId || !nextId || previousId === nextId) return true;
    const visited = new Set<string>();
    let currentId = nextId;
    while (currentId && !visited.has(currentId)) {
        if (currentId === previousId) return true;
        visited.add(currentId);
        currentId = state.jobs.find((job) => job.id === currentId)?.nextJobId || "";
    }
    return false;
}

function linkCandidates(job: ProductionJob, direction: "previous" | "next") {
    if (job.workStatus === "done") return [];
    const today = parseDate(new Date());
    return state.jobs
        .filter((candidate) => {
            if (candidate.id === job.id || candidate.workStatus === "done") return false;
            const isWaitingOrFuture = !candidate.machineId || !candidate.start || parseDate(candidate.start) >= today;
            if (!isWaitingOrFuture) return false;
            if (direction === "previous") {
                return !job.previousJobId
                    && !candidate.nextJobId
                    && !wouldCreateLink(candidate.id, job.id);
            }
            return !job.nextJobId
                && !candidate.previousJobId
                && !wouldCreateLink(job.id, candidate.id);
        })
        .sort((left, right) => {
            if (!left.start && right.start) return 1;
            if (left.start && !right.start) return -1;
            return String(left.start).localeCompare(String(right.start))
                || jobTitle(left).localeCompare(jobTitle(right), "it");
        });
}

function setJobLink(jobId: string, targetId: string, direction: "previous" | "next") {
    const job = state.jobs.find((item) => item.id === jobId);
    const target = state.jobs.find((item) => item.id === targetId);
    if (!job || !target) return false;
    if (direction === "previous") {
        if (job.previousJobId || target.nextJobId || wouldCreateLink(target.id, job.id)) return false;
        job.previousJobId = target.id;
        target.nextJobId = job.id;
    } else {
        if (job.nextJobId || target.previousJobId || wouldCreateLink(job.id, target.id)) return false;
        job.nextJobId = target.id;
        target.previousJobId = job.id;
    }
    saveState();
    renderAll();
    return true;
}

function unlinkJob(jobId: string, direction: "previous" | "next") {
    const job = state.jobs.find((item) => item.id === jobId);
    if (!job) return;
    const targetId = direction === "previous" ? job.previousJobId : job.nextJobId;
    const target = state.jobs.find((item) => item.id === targetId);
    if (direction === "previous") {
        job.previousJobId = "";
        if (target?.nextJobId === job.id) target.nextJobId = "";
    } else {
        job.nextJobId = "";
        if (target?.previousJobId === job.id) target.previousJobId = "";
    }
    saveState();
    renderAll();
}

function unlinkAllJobs(jobId: string) {
    const job = state.jobs.find((item) => item.id === jobId);
    if (!job) return 0;
    const previousId = job.previousJobId;
    const nextId = job.nextJobId;
    const previous = state.jobs.find((item) => item.id === previousId);
    const next = state.jobs.find((item) => item.id === nextId);
    if (previous?.nextJobId === job.id) previous.nextJobId = "";
    if (next?.previousJobId === job.id) next.previousJobId = "";
    job.previousJobId = "";
    job.nextJobId = "";
    const removed = Number(!!previousId) + Number(!!nextId);
    if (removed) {
        saveState();
        renderAll();
    }
    return removed;
}

function filteredLinkCandidates(job: ProductionJob) {
    return linkCandidates(job, linkPickerDirection).filter((candidate) => {
        if (linkPickerCustomer && candidate.customer !== linkPickerCustomer) return false;
        if (linkPickerDeliveryFrom && (!candidate.firstDeliveryDate || candidate.firstDeliveryDate < linkPickerDeliveryFrom)) return false;
        if (linkPickerDeliveryTo && (!candidate.firstDeliveryDate || candidate.firstDeliveryDate > linkPickerDeliveryTo)) return false;
        if (linkPickerProductionFrom && (!candidate.end || candidate.end < linkPickerProductionFrom)) return false;
        if (linkPickerProductionTo && (!candidate.start || candidate.start > linkPickerProductionTo)) return false;
        return true;
    });
}

function linkPickerResultsMarkup(job: ProductionJob) {
    const currentId = linkPickerDirection === "previous" ? job.previousJobId : job.nextJobId;
    const current = state.jobs.find((item) => item.id === currentId);
    if (current) {
        return `
            <div class="context-link-picker__current">
                <span>COLLEGAMENTO ATTUALE</span>
                <strong>${escapeHtml(jobTitle(current) || current.customer)}</strong>
                <small>${current.start ? formatLongDate(current.start) : "Da pianificare"}</small>
                <button type="button" data-context-action="unlink:${linkPickerDirection}">Scollega</button>
            </div>`;
    }
    const candidates = filteredLinkCandidates(job);
    return candidates.length
        ? candidates.map((candidate) => `
            <button class="context-link-result" type="button" data-context-action="link:${linkPickerDirection}:${escapeHtml(candidate.id)}">
                <span>↗</span>
                <div>
                    <strong>${escapeHtml(candidate.article || jobTitle(candidate) || "Senza articolo")}</strong>
                    <small>${escapeHtml(candidate.customer)} · ${candidate.start ? formatLongDate(candidate.start) : "Da pianificare"}</small>
                </div>
            </button>`).join("")
        : `<div class="context-submenu__empty">Nessuna lavorazione corrisponde ai filtri.</div>`;
}

function updateLinkPickerResults() {
    const job = state.jobs.find((item) => item.id === contextJobId);
    const results = byId("context-link-results");
    if (!job || !results) return;
    results.innerHTML = linkPickerResultsMarkup(job);
    keepContextMenuInViewport();
}

function renderContextMenu(view: "main" | "material" | "work" | "progress" | "links" = "main") {
    const menu = byId("job-context-menu");
    const job = state.jobs.find((item) => item.id === contextJobId);
    if (!menu || !job) return;
    menu.classList.toggle("context-menu--link-picker", view === "links");

    const menuButton = (action: string, icon: string, title: string, detail: string, danger = false) => `
        <button class="${danger ? "context-menu__danger" : ""}" type="button" data-context-action="${action}" role="menuitem">
            <span>${icon}</span>
            <div><strong>${escapeHtml(title)}</strong><small>${escapeHtml(detail)}</small></div>
        </button>`;

    if (view === "main") {
        menu.innerHTML = `
            ${menuButton("edit", "✎", "Modifica", "Apri tutte le informazioni")}
            ${menuButton("copy", "⧉", "Copia", "Crea una nuova lavorazione precompilata")}
            ${menuButton("links-view", "↔", "Collega lavorazione", "Cerca per articolo e cliente")}
            ${menuButton(
                "unlink-all",
                "⊘",
                "Scollega",
                job.previousJobId || job.nextJobId
                    ? `${Number(!!job.previousJobId) + Number(!!job.nextJobId)} ${job.previousJobId && job.nextJobId ? "collegamenti presenti" : "collegamento presente"}`
                    : "Nessun collegamento presente",
            )}
            <div class="context-menu__entry" data-context-section="material">
                <button type="button" data-context-toggle="material" role="menuitem">
                    <span>●</span>
                    <div><strong>Disponibilità materiale</strong><small>${escapeHtml(materialLabels[job.materialStatus])}</small></div>
                    <b class="context-menu__chevron">⌄</b>
                </button>
                <div class="context-submenu">
                    ${Object.entries(materialLabels).map(([status, label]) =>
                        menuButton(`material:${status}`, status === job.materialStatus ? "✓" : "·", label, status === job.materialStatus ? "Stato attuale" : "Imposta questo stato"),
                    ).join("")}
                </div>
            </div>
            <div class="context-menu__entry" data-context-section="work">
                <button type="button" data-context-toggle="work" role="menuitem">
                    <span>◷</span>
                    <div><strong>Lavorazione</strong><small>${escapeHtml(workLabels[job.workStatus])}</small></div>
                    <b class="context-menu__chevron">⌄</b>
                </button>
                <div class="context-submenu context-submenu--work">
                    ${menuButton("work:not_started", job.workStatus === "not_started" ? "✓" : "·", "Non ancora iniziato", "0 giorni processati")}
                    <div class="context-menu__entry" data-context-section="progress">
                        <button type="button" data-context-toggle="progress" role="menuitem">
                            <span>${job.workStatus === "running" ? "✓" : "·"}</span>
                            <div><strong>In corso</strong><small>${job.progressDays || 0}/${job.durationDays || 1} giorni processati</small></div>
                            <b class="context-menu__chevron">⌄</b>
                        </button>
                        <div class="context-submenu context-submenu--progress">
                            <div class="context-menu__heading">
                                <span>GIORNI PROCESSATI</span>
                                <span class="context-menu__current">${job.progressDays || 0}/${job.durationDays || 1}</span>
                            </div>
                            <div class="context-progress">
                                <p>Seleziona il numero di giorni già completati.</p>
                                <div class="context-progress__days">
                                    ${Array.from({ length: Math.max(1, job.durationDays || 1) }, (_, index) => {
                                        const day = index + 1;
                                        const current = Math.min(job.durationDays || 1, Math.max(0, job.progressDays || 0));
                                        return `<button type="button" data-context-action="progress:${day}"
                                            class="${day <= current ? "is-processed" : ""} ${day === current ? "is-current" : ""}">${day}</button>`;
                                    }).join("")}
                                </div>
                            </div>
                        </div>
                    </div>
                    ${menuButton("work:done", job.workStatus === "done" ? "✓" : "·", "Terminato", `${job.durationDays || 1}/${job.durationDays || 1} giorni processati`)}
                </div>
            </div>
            ${menuButton("delete", "×", "Elimina", "Rimuovi definitivamente", true)}`;
    } else if (view === "links") {
        const candidates = linkCandidates(job, linkPickerDirection);
        const customers = [...new Set(candidates.map((candidate) => candidate.customer).filter(Boolean))]
            .sort((left, right) => left.localeCompare(right, "it"));
        menu.innerHTML = `
            <div class="context-menu__heading">
                <button type="button" data-context-action="main-view" aria-label="Indietro">‹</button>
                <span>COLLEGA LAVORAZIONE</span>
            </div>
            <div class="context-link-picker">
                <div class="context-link-picker__direction">
                    <button type="button" data-link-direction="previous" class="${linkPickerDirection === "previous" ? "is-active" : ""}">← Precedente</button>
                    <button type="button" data-link-direction="next" class="${linkPickerDirection === "next" ? "is-active" : ""}">Successiva →</button>
                </div>
                <label>
                    <span>Cliente</span>
                    <select id="context-link-customer">
                        <option value="">Tutti i clienti</option>
                        ${customers.map((customer) => `<option value="${escapeHtml(customer)}" ${customer === linkPickerCustomer ? "selected" : ""}>${escapeHtml(customer)}</option>`).join("")}
                    </select>
                </label>
                <fieldset class="context-link-picker__period">
                    <legend>Data prima consegna</legend>
                    <label>
                        <span>Da</span>
                        <input id="context-link-delivery-from" type="date" value="${escapeHtml(linkPickerDeliveryFrom)}">
                    </label>
                    <label>
                        <span>A</span>
                        <input id="context-link-delivery-to" type="date" value="${escapeHtml(linkPickerDeliveryTo)}">
                    </label>
                </fieldset>
                <fieldset class="context-link-picker__period">
                    <legend>Data di produzione</legend>
                    <label>
                        <span>Da</span>
                        <input id="context-link-production-from" type="date" value="${escapeHtml(linkPickerProductionFrom)}">
                    </label>
                    <label>
                        <span>A</span>
                        <input id="context-link-production-to" type="date" value="${escapeHtml(linkPickerProductionTo)}">
                    </label>
                </fieldset>
                <div class="context-link-picker__results" id="context-link-results">
                    ${linkPickerResultsMarkup(job)}
                </div>
            </div>`;
    } else if (view === "material") {
        menu.innerHTML = `
            <div class="context-menu__heading">
                <button type="button" data-context-action="main-view" aria-label="Indietro">‹</button>
                <span>DISPONIBILITÀ MATERIALE</span>
            </div>
            ${Object.entries(materialLabels).map(([status, label]) =>
                menuButton(`material:${status}`, status === job.materialStatus ? "✓" : "·", label, status === job.materialStatus ? "Stato attuale" : "Imposta rapidamente"),
            ).join("")}`;
    } else if (view === "work") {
        menu.innerHTML = `
            <div class="context-menu__heading">
                <button type="button" data-context-action="main-view" aria-label="Indietro">‹</button>
                <span>STATO LAVORAZIONE</span>
            </div>
            ${menuButton("work:not_started", job.workStatus === "not_started" ? "✓" : "·", "Non ancora iniziato", "0 giorni processati")}
            ${menuButton("work:running", job.workStatus === "running" ? "✓" : "·", "In corso", `${job.progressDays || 0}/${job.durationDays || 1} giorni processati`)}
            ${menuButton("work:done", job.workStatus === "done" ? "✓" : "·", "Terminato", `${job.durationDays || 1}/${job.durationDays || 1} giorni processati`)}`;
    } else {
        const current = Math.min(job.durationDays || 1, Math.max(0, job.progressDays || 0));
        menu.innerHTML = `
            <div class="context-menu__heading">
                <button type="button" data-context-action="work-view" aria-label="Indietro">‹</button>
                <span>GIORNI PROCESSATI</span>
                <span class="context-menu__current">${current}/${job.durationDays || 1}</span>
            </div>
            <div class="context-progress">
                <p>Seleziona quanti giorni di produzione sono già stati completati.</p>
                <div class="context-progress__days">
                    ${Array.from({ length: Math.max(1, job.durationDays || 1) }, (_, index) => {
                        const day = index + 1;
                        return `<button type="button" data-context-action="progress:${day}"
                            class="${day <= current ? "is-processed" : ""} ${day === current ? "is-current" : ""}">${day}</button>`;
                    }).join("")}
                </div>
            </div>`;
    }
    keepContextMenuInViewport();
}

function openContextMenu(jobId: string, event: MouseEvent) {
    const menu = byId("job-context-menu");
    if (!menu || !state.jobs.some((item) => item.id === jobId)) return;
    event.preventDefault();
    cancelActivePointerInteractions();
    hideJobTooltip();
    contextJobId = jobId;
    menu.classList.toggle("context-menu--flip", event.clientX + 520 > window.innerWidth);
    menu.style.left = `${Math.max(8, event.clientX)}px`;
    menu.style.top = `${Math.max(8, event.clientY)}px`;
    renderContextMenu("main");
    menu.classList.add("is-open");
    menu.setAttribute("aria-hidden", "false");
    keepContextMenuInViewport();
    (menu.querySelector("[data-context-action='edit']") as HTMLButtonElement | null)?.focus();
}

function scheduleJob(jobId: string, machineId: string, startDate: Date) {
    const job = state.jobs.find((item) => item.id === jobId);
    if (!job) return;
    const scheduledStart = nextWeekday(startDate);
    job.machineId = machineId;
    job.start = dateKey(scheduledStart);
    job.end = dateKey(endForProductionDuration(scheduledStart, job.durationDays || 1, machineId));
    job.baseSpanDays = Math.max(1, diffDays(job.end, job.start) + 1);
    saveState();
    renderAll();
    notify("Lavorazione pianificata");
}

function unscheduleJob(jobId: string) {
    const job = state.jobs.find((item) => item.id === jobId);
    if (!job) return;
    job.machineId = "";
    saveState();
    renderAll();
    notify("Lavorazione spostata nella coda");
}

function tooltipMarkup(job: ProductionJob) {
    const machine = state.machines.find((item) => item.id === job.machineId);
    const previous = state.jobs.find((item) => item.id === job.previousJobId);
    const next = state.jobs.find((item) => item.id === job.nextJobId);
    const firstDelivery = job.firstDeliveryDate
        ? `${formatLongDate(job.firstDeliveryDate)}${job.firstDeliveryQuantity ? ` · ${job.firstDeliveryQuantity} ${job.unit}` : ""}`
        : "—";
    return `
        <div class="job-tooltip__top">
            <strong>${escapeHtml(jobTitle(job))}</strong>
            <span>${escapeHtml(workLabels[job.workStatus] || job.workStatus)}</span>
        </div>
        <dl class="job-tooltip__grid">
            <dt>Cliente</dt><dd>${escapeHtml(job.customer)}</dd>
            <dt>Fase</dt><dd>${escapeHtml(job.phase || "—")}</dd>
            <dt>Materiale / Lega</dt><dd>${escapeHtml(job.materialAlloy || "—")}</dd>
            <dt>Macchina</dt><dd>${escapeHtml(machine?.name || "Da pianificare")}</dd>
            <dt>Periodo</dt><dd>${formatLongDate(job.start)} — ${formatLongDate(job.end)}</dd>
            <dt>Durata</dt><dd>${job.durationDays || 1} giorni lavorativi</dd>
            <dt>Progresso</dt><dd>${job.progressDays || 0}/${job.durationDays || 1} giorni · ${Math.round(((job.progressDays || 0) / Math.max(1, job.durationDays || 1)) * 100)}%</dd>
            <dt>Quantità</dt><dd>${job.quantity || 0} ${escapeHtml(job.unit)}</dd>
            ${job.barKgBundles ? `<dt>Kg / Fasci di barra</dt><dd>${escapeHtml(job.barKgBundles)}</dd>` : ""}
            ${job.materialOwner ? `<dt>Proprietario materiale</dt><dd>${escapeHtml(job.materialOwner)}</dd>` : ""}
            <dt>Prima consegna</dt><dd>${escapeHtml(firstDelivery)}</dd>
            <dt>Consegna finale</dt><dd>${formatLongDate(job.dueDate)}</dd>
            <dt>Disponibilità materiale</dt><dd>${escapeHtml(materialLabels[job.materialStatus])}</dd>
            ${previous ? `<dt>Precedente</dt><dd>${escapeHtml(jobTitle(previous))}</dd>` : ""}
            ${next ? `<dt>Successiva</dt><dd>${escapeHtml(jobTitle(next))}</dd>` : ""}
        </dl>
        ${job.notes ? `
            <div class="job-tooltip__notes">
                <strong>Note</strong>
                <span>${escapeHtml(job.notes)}</span>
            </div>
        ` : ""}
    `;
}

function positionTooltip(event: MouseEvent) {
    const tooltip = byId("job-tooltip");
    if (!tooltip || !tooltip.classList.contains("is-visible")) return;
    const gap = 14;
    const rect = tooltip.getBoundingClientRect();
    let left = event.clientX + gap;
    let top = event.clientY + gap;
    if (left + rect.width > window.innerWidth - 8) left = event.clientX - rect.width - gap;
    if (top + rect.height > window.innerHeight - 8) top = event.clientY - rect.height - gap;
    tooltip.style.left = `${Math.max(8, left)}px`;
    tooltip.style.top = `${Math.max(8, top)}px`;
}

function showJobTooltip(jobId: string, event: MouseEvent) {
    if (resizeSession) return;
    const job = state.jobs.find((item) => item.id === jobId);
    const tooltip = byId("job-tooltip");
    if (!job || !tooltip) return;
    tooltip.innerHTML = tooltipMarkup(job);
    tooltip.classList.add("is-visible");
    positionTooltip(event);
}

function hideJobTooltip() {
    byId("job-tooltip")?.classList.remove("is-visible");
}

function startJobResize(event: PointerEvent, handle: HTMLElement) {
    const bar = handle.closest(".job-bar") as HTMLElement | null;
    const edge = handle.dataset.resizeEdge as "start" | "end" | undefined;
    const job = state.jobs.find((item) => item.id === bar?.dataset.jobId);
    if (!bar || !edge || !job) return;
    event.preventDefault();
    event.stopPropagation();
    hideJobTooltip();
    bar.draggable = false;
    bar.classList.add("is-resizing");
    resizeSession = {
        jobId: job.id,
        edge,
        originX: event.clientX,
        originalStart: job.start,
        originalEnd: job.end,
        bar,
        originalLeft: Number.parseFloat(bar.style.left) || 0,
        originalWidth: Number.parseFloat(bar.style.width) || dayWidth,
        deltaDays: 0,
        pointerId: event.pointerId,
        captureTarget: handle,
    };
    handle.setPointerCapture?.(event.pointerId);
}

function updateJobResize(event: PointerEvent) {
    if (!resizeSession) return;
    const duration = Math.max(0, diffDays(resizeSession.originalEnd, resizeSession.originalStart));
    let delta = Math.round((event.clientX - resizeSession.originX) / dayWidth);
    const minimumBarWidth = Math.max(10, dayWidth - 6);
    if (resizeSession.edge === "start") {
        delta = Math.min(delta, duration);
        resizeSession.bar.style.left = `${resizeSession.originalLeft + delta * dayWidth}px`;
        resizeSession.bar.style.width = `${Math.max(minimumBarWidth, resizeSession.originalWidth - delta * dayWidth)}px`;
    } else {
        delta = Math.max(delta, -duration);
        resizeSession.bar.style.width = `${Math.max(minimumBarWidth, resizeSession.originalWidth + delta * dayWidth)}px`;
    }
    resizeSession.deltaDays = delta;
}

function finishJobResize() {
    if (!resizeSession) return;
    const session = resizeSession;
    const job = state.jobs.find((item) => item.id === session.jobId);
    if (job && session.deltaDays !== 0) {
        if (session.edge === "start") job.start = dateKey(addDays(session.originalStart, session.deltaDays));
        else job.end = dateKey(addDays(session.originalEnd, session.deltaDays));
        job.baseSpanDays = Math.max(1, diffDays(job.end, job.start) + 1);
        job.durationDays = Math.max(1, countProductionDays(job.start, job.end, job.machineId));
        job.progressDays = job.workStatus === "done"
            ? job.durationDays
            : job.workStatus === "running"
                ? Math.min(job.durationDays, Math.max(1, job.progressDays || 1))
                : 0;
        saveState();
        notify(session.edge === "start" ? "Data di inizio aggiornata" : "Data di fine aggiornata");
    }
    session.bar.draggable = true;
    session.bar.classList.remove("is-resizing");
    releaseCapturedPointer(session.captureTarget, session.pointerId);
    resizeSession = null;
    suppressJobClickUntil = Date.now() + 300;
    renderAll();
}

function clearDragPreview() {
    document.querySelectorAll(".drag-preview").forEach((preview) => preview.remove());
    document.querySelectorAll(".machine-days.is-drop-target").forEach((lane) => lane.classList.remove("is-drop-target"));
}

function stopJobDragAutoScroll() {
    jobDragHorizontalDirection = 0;
    jobDragHorizontalIntensity = 0;
    jobDragVerticalVelocity = 0;
    jobDragLastHorizontalStep = 0;
    jobDragMachineId = "";
    jobDragAutoScrollReadyAt = 0;
    jobDragAutoScrollSignature = "";
    if (jobDragAutoScrollFrame !== null) {
        cancelAnimationFrame(jobDragAutoScrollFrame);
        jobDragAutoScrollFrame = null;
    }
    byId("timeline-scroll")?.classList.remove(
        "is-job-auto-scrolling-left",
        "is-job-auto-scrolling-right",
        "is-job-auto-scrolling-up",
        "is-job-auto-scrolling-down",
    );
}

function runJobDragAutoScroll(timestamp: number) {
    const timelineScroll = byId("timeline-scroll");
    if (!timelineScroll || !draggedJobId) {
        stopJobDragAutoScroll();
        return;
    }

    if (timestamp < jobDragAutoScrollReadyAt) {
        jobDragAutoScrollFrame = requestAnimationFrame(runJobDragAutoScroll);
        return;
    }

    if (jobDragVerticalVelocity) {
        timelineScroll.scrollTop += jobDragVerticalVelocity;
    }

    if (jobDragHorizontalDirection) {
        const interval = 360 - jobDragHorizontalIntensity * 250;
        if (!jobDragLastHorizontalStep || timestamp - jobDragLastHorizontalStep >= interval) {
            const scrollTop = timelineScroll.scrollTop;
            visibleStart = addDays(visibleStart, jobDragHorizontalDirection);
            renderTimeline();
            timelineScroll.scrollTop = scrollTop;
            const lane = document.querySelector<HTMLElement>(
                `.machine-days[data-machine-id="${CSS.escape(jobDragMachineId)}"]`,
            );
            if (lane) showDragPreview(lane, jobDragClientX);
            jobDragLastHorizontalStep = timestamp;
        }
    }

    if (!jobDragHorizontalDirection && !jobDragVerticalVelocity) {
        stopJobDragAutoScroll();
        return;
    }
    jobDragAutoScrollFrame = requestAnimationFrame(runJobDragAutoScroll);
}

function updateJobDragAutoScroll(lane: HTMLElement, clientX: number, clientY: number) {
    const timelineScroll = byId("timeline-scroll");
    if (!timelineScroll || !draggedJobId) {
        stopJobDragAutoScroll();
        return;
    }

    jobDragClientX = clientX;
    jobDragMachineId = lane.dataset.machineId || "";

    const laneRect = lane.getBoundingClientRect();
    const horizontalEdge = Math.min(125, Math.max(52, laneRect.width * 0.14));
    const leftDistance = clientX - laneRect.left;
    const rightDistance = laneRect.right - clientX;
    let horizontalDirection = 0;
    let horizontalIntensity = 0;
    if (leftDistance < horizontalEdge && clientX <= laneRect.right) {
        horizontalDirection = -1;
        horizontalIntensity = Math.max(0, Math.min(1, (horizontalEdge - leftDistance) / horizontalEdge));
    } else if (rightDistance < horizontalEdge && clientX >= laneRect.left) {
        horizontalDirection = 1;
        horizontalIntensity = Math.max(0, Math.min(1, (horizontalEdge - rightDistance) / horizontalEdge));
    }

    const scrollRect = timelineScroll.getBoundingClientRect();
    const rowsTop = Math.min(scrollRect.bottom, scrollRect.top + 58);
    const verticalEdge = Math.min(100, Math.max(58, (scrollRect.height - 58) * 0.16));
    const topDistance = clientY - rowsTop;
    const bottomDistance = scrollRect.bottom - clientY;
    let verticalVelocity = 0;
    if (topDistance < verticalEdge && clientY >= scrollRect.top && clientY <= scrollRect.bottom) {
        const intensity = Math.max(0, Math.min(1, (verticalEdge - topDistance) / verticalEdge));
        verticalVelocity = -(2 + 20 * intensity * intensity);
    } else if (bottomDistance < verticalEdge && clientY >= scrollRect.top && clientY <= scrollRect.bottom) {
        const intensity = Math.max(0, Math.min(1, (verticalEdge - bottomDistance) / verticalEdge));
        verticalVelocity = 2 + 20 * intensity * intensity;
    }

    jobDragHorizontalDirection = horizontalDirection;
    jobDragHorizontalIntensity = horizontalIntensity;
    jobDragVerticalVelocity = verticalVelocity;
    const autoScrollSignature = `${horizontalDirection}:${Math.sign(verticalVelocity)}`;
    if (autoScrollSignature !== jobDragAutoScrollSignature) {
        jobDragAutoScrollSignature = autoScrollSignature;
        jobDragAutoScrollReadyAt = performance.now() + JOB_DRAG_AUTO_SCROLL_DELAY_MS;
        jobDragLastHorizontalStep = 0;
    }
    timelineScroll.classList.toggle("is-job-auto-scrolling-left", horizontalDirection < 0);
    timelineScroll.classList.toggle("is-job-auto-scrolling-right", horizontalDirection > 0);
    timelineScroll.classList.toggle("is-job-auto-scrolling-up", verticalVelocity < 0);
    timelineScroll.classList.toggle("is-job-auto-scrolling-down", verticalVelocity > 0);

    if (!horizontalDirection && !verticalVelocity) {
        stopJobDragAutoScroll();
        return;
    }
    if (jobDragAutoScrollFrame === null) {
        jobDragAutoScrollFrame = requestAnimationFrame(runJobDragAutoScroll);
    }
}

function showDragPreview(lane: HTMLElement, clientX: number) {
    const job = state.jobs.find((item) => item.id === draggedJobId);
    const machineId = lane.dataset.machineId || "";
    if (!job || !machineId) return;
    document.querySelectorAll(".machine-days").forEach((item) => {
        if (item !== lane) {
            item.classList.remove("is-drop-target");
            item.querySelector(".drag-preview")?.remove();
        }
    });

    const rect = lane.getBoundingClientRect();
    const dayIndex = Math.max(0, Math.min(visibleDays - 1, Math.floor((clientX - rect.left) / dayWidth)));
    const requestedDate = addDays(visibleStart, dayIndex);
    const scheduledStart = nextWeekday(requestedDate);
    const scheduledEnd = endForProductionDuration(scheduledStart, job.durationDays || 1, machineId);
    const rawStartIndex = diffDays(scheduledStart, visibleStart);
    const rawEndIndex = diffDays(scheduledEnd, visibleStart);
    const clippedStart = Math.max(0, Math.min(visibleDays - 1, rawStartIndex));
    const clippedEnd = Math.max(clippedStart, Math.min(visibleDays - 1, rawEndIndex));
    const widthDays = Math.max(1, clippedEnd - clippedStart + 1);

    let preview = lane.querySelector(".drag-preview") as HTMLElement | null;
    if (!preview) {
        preview = document.createElement("article");
        preview.className = "drag-preview";
        lane.appendChild(preview);
    }
    preview.style.left = `${clippedStart * dayWidth + 3}px`;
    preview.style.width = `${Math.max(10, widthDays * dayWidth - 6)}px`;
    preview.style.top = "12px";
    preview.innerHTML = `
        <strong>${escapeHtml(jobTitle(job))}</strong>
        <small>${formatLongDate(scheduledStart)} — ${formatLongDate(scheduledEnd)} · ${job.durationDays || 1} gg lav.</small>`;
    lane.classList.add("is-drop-target");
}

function startCalendarPan(event: PointerEvent) {
    if (event.button !== 0) return;
    event.preventDefault();
    hideJobTooltip();
    closeContextMenu();
    const captureTarget = byId("timeline");
    if (!captureTarget) return;
    calendarPanSession = {
        originX: event.clientX,
        originStart: parseDate(visibleStart),
        lastDeltaDays: 0,
        pointerId: event.pointerId,
        captureTarget,
    };
    captureTarget.setPointerCapture?.(event.pointerId);
    document.body.classList.add("is-calendar-panning");
}

function updateCalendarPan(event: PointerEvent) {
    if (!calendarPanSession) return;
    event.preventDefault();
    const deltaDays = Math.round((calendarPanSession.originX - event.clientX) / Math.max(1, dayWidth));
    if (deltaDays === calendarPanSession.lastDeltaDays) return;
    calendarPanSession.lastDeltaDays = deltaDays;
    visibleStart = addDays(calendarPanSession.originStart, deltaDays);
    renderAll();
}

function finishCalendarPan() {
    if (!calendarPanSession) return;
    releaseCapturedPointer(
        calendarPanSession.captureTarget,
        calendarPanSession.pointerId,
    );
    calendarPanSession = null;
    document.body.classList.remove("is-calendar-panning");
}

function navigateToLinkedJob(jobId: string) {
    const job = state.jobs.find((item) => item.id === jobId);
    if (!job) {
        notify("La lavorazione collegata non è più disponibile");
        return;
    }
    if (isArchivedJob(job) && !showArchived) {
        showArchived = true;
        const archiveToggle = byId("show-archive") as HTMLInputElement | null;
        if (archiveToggle) archiveToggle.checked = true;
    }
    if (!jobMatches(job)) {
        selectedDepartments.clear();
        selectedCategories.clear();
        selectedMachines.clear();
        selectedMaterials.clear();
        const articleFilter = byId("article-filter") as HTMLInputElement | null;
        const detailsFilter = byId("details-filter") as HTMLInputElement | null;
        if (articleFilter) articleFilter.value = "";
        if (detailsFilter) detailsFilter.value = "";
    }
    if (job.machineId && job.start) showDateInSecondColumn(job.start);
    renderAll();
    requestAnimationFrame(() => {
        const selector = `[data-job-id="${CSS.escape(job.id)}"]`;
        const target = (job.machineId ? byId("timeline") : byId("backlog-list"))?.querySelector<HTMLElement>(selector);
        target?.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
        target?.focus({ preventScroll: true });
        target?.classList.add("is-link-target");
        setTimeout(() => target?.classList.remove("is-link-target"), 1400);
    });
}

function navigateToFilteredJob(jobId: string) {
    const job = state.jobs.find((item) => item.id === jobId);
    if (!job) {
        notify("La lavorazione non è più disponibile");
        return;
    }
    if (!job.machineId || !job.start) {
        backlogView = "queue";
        renderBacklog();
        requestAnimationFrame(() => {
            const target = byId("backlog-list")?.querySelector<HTMLElement>(
                `[data-job-id="${CSS.escape(job.id)}"]`,
            );
            target?.scrollIntoView({ behavior: "smooth", block: "center" });
            target?.focus({ preventScroll: true });
            target?.classList.add("is-link-target");
            setTimeout(() => target?.classList.remove("is-link-target"), 1400);
        });
        notify("La lavorazione è ancora da pianificare");
        return;
    }
    showDateInSecondColumn(job.start);
    renderAll();
    requestAnimationFrame(() => {
        const target = byId("timeline")?.querySelector<HTMLElement>(
            `[data-job-id="${CSS.escape(job.id)}"]`,
        );
        target?.scrollIntoView({
            behavior: "smooth",
            block: "center",
            inline: "center",
        });
        target?.focus({ preventScroll: true });
        target?.classList.add("is-link-target");
        setTimeout(() => target?.classList.remove("is-link-target"), 1400);
    });
}

function bindGlobalEvents() {
    document.addEventListener("pointerdown", (event) => {
        const openDialog = (event.target as HTMLElement).closest(
            ".dialog-backdrop.is-open",
        );
        if (!openDialog) {
            return;
        }
        cancelActivePointerInteractions({ render: false });
        closeContextMenu();
        hideJobTooltip();
        if (openDialog.id === "job-dialog") {
            restoreJobFormInteractivity(false);
        }
    }, true);

    byId("new-job")?.addEventListener("click", () => openJob());
    byId("refresh-planner")?.addEventListener("click", () => {
        void loadLatestPlanner({ manual: true });
    });
    byId("undo-planner")?.addEventListener("click", () => {
        closeContextMenu();
        undoLastPlannerChange();
    });
    byId("open-production-analysis")?.addEventListener("click", () => {
        ipcRenderer.send("open-production-planner-analysis-window");
    });
    document.querySelector(".backlog-view-switch")?.addEventListener("click", (event) => {
        const button = (event.target as HTMLElement).closest<HTMLElement>("[data-backlog-view]");
        if (!button) return;
        backlogView = button.dataset.backlogView === "filtered" ? "filtered" : "queue";
        renderBacklog();
    });
    byId("backlog-list")?.addEventListener("click", (event) => {
        const target = (event.target as HTMLElement).closest<HTMLElement>("[data-job-navigate]");
        if (!target) return;
        event.preventDefault();
        navigateToFilteredJob(target.dataset.jobNavigate || "");
    });
    byId("job-machine")?.addEventListener("change", updateJobStartAvailability);
    byId("job-machine-picker")?.addEventListener("click", openMachinePicker);
    document.querySelectorAll("[data-close-machine-picker]").forEach((button) => {
        button.addEventListener("click", closeMachinePicker);
    });
    byId("machine-picker-search")?.addEventListener("input", (event) => {
        machinePickerSearch = (event.target as HTMLInputElement).value;
        renderMachinePicker();
    });
    byId("machine-picker-reset")?.addEventListener("click", () => {
        machinePickerDepartment = "";
        machinePickerCategory = "";
        machinePickerSearch = "";
        const search = byId("machine-picker-search") as HTMLInputElement | null;
        if (search) search.value = "";
        renderMachinePicker();
        search?.focus();
    });
    byId("machine-picker-departments")?.addEventListener("click", (event) => {
        const button = (event.target as HTMLElement).closest(
            "[data-machine-picker-department]",
        ) as HTMLElement | null;
        if (!button) return;
        const value = button.dataset.machinePickerDepartment || "";
        machinePickerDepartment =
            machinePickerDepartment === value ? "" : value;
        renderMachinePicker();
    });
    byId("machine-picker-categories")?.addEventListener("click", (event) => {
        const button = (event.target as HTMLElement).closest(
            "[data-machine-picker-category]",
        ) as HTMLElement | null;
        if (!button) return;
        const value = button.dataset.machinePickerCategory || "";
        machinePickerCategory =
            machinePickerCategory === value ? "" : value;
        renderMachinePicker();
    });
    byId("machine-picker-list")?.addEventListener("click", (event) => {
        const card = (event.target as HTMLElement).closest(
            "[data-machine-picker-id]",
        ) as HTMLElement | null;
        if (!card) return;
        selectJobMachine(card.dataset.machinePickerId || "");
    });
    byId("job-form")?.addEventListener("submit", saveJobFromForm);
    byId("delete-job")?.addEventListener("click", deleteCurrentJob);

    document.querySelectorAll("[data-close-dialog]").forEach((button) => {
        button.addEventListener("click", requestCloseJobDialog);
    });
    document.querySelectorAll("[data-close-machines]").forEach((button) => {
        button.addEventListener("click", () => {
            closeDialog("machines-dialog");
            renderAll();
        });
    });
    document.querySelectorAll("[data-close-unavailability]").forEach((button) => {
        button.addEventListener("click", () => closeDialog("unavailability-dialog"));
    });
    document.querySelectorAll("[data-close-closures]").forEach((button) => {
        button.addEventListener("click", () => closeDialog("closures-dialog"));
    });
    document.querySelectorAll("[data-close-unavailability-range]").forEach((button) => {
        button.addEventListener("click", closeUnavailabilityRangeEditor);
    });
    byId("unavailability-range-form")?.addEventListener(
        "submit",
        saveUnavailabilityRange,
    );

    byId("manage-machines")?.addEventListener("click", () => {
        renderMachinesDialog();
        openDialog("machines-dialog");
    });

    byId("manage-unavailability")?.addEventListener("click", () => {
        renderUnavailabilityMachineSelect();
        renderUnavailabilityList();
        const today = dateKey(new Date());
        (byId("unavailability-start") as HTMLInputElement).value = today;
        (byId("unavailability-end") as HTMLInputElement).value = today;
        openDialog("unavailability-dialog");
    });

    byId("manage-closures")?.addEventListener("click", () => {
        renderClosureTargets();
        renderClosureList();
        const today = dateKey(new Date());
        (byId("closure-start") as HTMLInputElement).value = today;
        (byId("closure-end") as HTMLInputElement).value = today;
        (byId("closure-title") as HTMLInputElement).value = "";
        openDialog("closures-dialog");
    });

    byId("closures-dialog")?.addEventListener("change", (event) => {
        const input = event.target as HTMLInputElement;
        if (input.id === "closure-all" || input.matches("[data-closure-department], [data-closure-machine]")) {
            updateClosureSelection();
        }
    });

    byId("closure-form")?.addEventListener("submit", async (event) => {
        event.preventDefault();
        const type = inputValue("closure-type") as "vacation" | "closure";
        const start = inputValue("closure-start");
        const end = inputValue("closure-end");
        const targetIds = getClosureTargetMachineIds();
        if (!start || !end) return;
        if (parseDate(end) < parseDate(start)) {
            await nativeAlert("La fine della regola non può precedere l'inizio.");
            return;
        }
        if (!targetIds.size) {
            await nativeAlert("Seleziona tutta l'azienda, almeno un reparto oppure almeno una macchina.");
            return;
        }

        const allSelected = !!(byId("closure-all") as HTMLInputElement | null)?.checked;
        const selectedDepartmentNames = [...document.querySelectorAll<HTMLInputElement>("[data-closure-department]:checked")]
            .map((input) => input.value);
        const selectedMachineNames = [...document.querySelectorAll<HTMLInputElement>("[data-closure-machine]:checked")]
            .map((input) => state.machines.find((machine) => machine.id === input.value)?.name)
            .filter(Boolean);
        const scopeParts = [];
        if (selectedDepartmentNames.length) scopeParts.push(`Reparti: ${selectedDepartmentNames.join(", ")}`);
        if (selectedMachineNames.length) scopeParts.push(`Macchine: ${selectedMachineNames.join(", ")}`);
        const scopeLabel = allSelected ? "Tutta l'azienda" : scopeParts.join(" · ");
        if (!await nativeConfirm(
            `Applicare ${unavailabilityLabels[type].toLowerCase()} dal ${formatLongDate(start)} al ${formatLongDate(end)} a ${targetIds.size} ${targetIds.size === 1 ? "macchina" : "macchine"}?`,
        )) return;

        const groupId = uid("closure-group");
        const title = inputValue("closure-title").trim();
        const newlyBlockedByMachine = new Map(
            [...targetIds].map((machineId) => [
                machineId,
                newlyBlockedProductionDates(machineId, start, end),
            ]),
        );
        targetIds.forEach((machineId) => {
            state.unavailabilities.push({
                id: uid("unavailability"),
                groupId,
                machineId,
                type,
                start,
                end,
                title,
                scopeLabel,
            });
        });
        targetIds.forEach((machineId) => {
            insertMachineDowntime(machineId, newlyBlockedByMachine.get(machineId) || []);
        });
        saveState();
        renderClosureList();
        renderAll();
        notify(`${unavailabilityLabels[type]} applicata a ${targetIds.size} ${targetIds.size === 1 ? "macchina" : "macchine"}`);
    });

    byId("closure-list")?.addEventListener("click", async (event) => {
        const button = (event.target as HTMLElement).closest("[data-remove-closure]");
        const row = button?.closest("[data-closure-group-id]") as HTMLElement | null;
        const groupId = row?.dataset.closureGroupId;
        if (!groupId) return;
        const items = state.unavailabilities.filter((item) => (item.groupId || item.id) === groupId);
        if (!items.length) return;
        if (!await nativeConfirm(
            `Rimuovere definitivamente questa regola da ${items.length} ${items.length === 1 ? "macchina" : "macchine"}?`,
            "Rimuovi",
            true,
        )) return;
        const machineIds = new Set(items.map((item) => item.machineId));
        state.unavailabilities = state.unavailabilities.filter((item) => (item.groupId || item.id) !== groupId);
        machineIds.forEach(recalculateMachineSchedule);
        saveState();
        renderClosureList();
        renderAll();
        notify("Regola collettiva rimossa");
    });

    byId("unavailability-form")?.addEventListener("submit", async (event) => {
        event.preventDefault();
        const machineId = inputValue("unavailability-machine");
        const start = inputValue("unavailability-start");
        const end = inputValue("unavailability-end");
        const type = inputValue("unavailability-type") as UnavailabilityType;
        if (!machineId || !start || !end) return;
        if (parseDate(end) < parseDate(start)) {
            await nativeAlert("La fine dell'indisponibilità non può precedere l'inizio.");
            return;
        }
        const machine = state.machines.find((item) => item.id === machineId);
        if (!await nativeConfirm(
            `Aggiungere ${unavailabilityLabels[type].toLowerCase()} per ${machine?.name || "la macchina"} dal ${formatLongDate(start)} al ${formatLongDate(end)}?`,
            "Aggiungi",
        )) return;
        const newlyBlockedDates = newlyBlockedProductionDates(machineId, start, end);
        state.unavailabilities.push({
            id: uid("unavailability"),
            machineId,
            type,
            start,
            end,
            title: inputValue("unavailability-title").trim(),
        });
        insertMachineDowntime(machineId, newlyBlockedDates);
        saveState();
        (byId("unavailability-title") as HTMLInputElement).value = "";
        renderUnavailabilityList();
        renderAll();
        notify("Indisponibilità aggiunta e pianificazione aggiornata");
    });

    byId("unavailability-list")?.addEventListener("click", async (event) => {
        const button = (event.target as HTMLElement).closest("[data-remove-unavailability]");
        const row = button?.closest("[data-unavailability-id]") as HTMLElement | null;
        const item = state.unavailabilities.find((entry) => entry.id === row?.dataset.unavailabilityId);
        if (!item) return;
        if (!await nativeConfirm(
            `Rimuovere definitivamente ${unavailabilityLabels[item.type].toLowerCase()} dal ${formatLongDate(item.start)} al ${formatLongDate(item.end)}?`,
            "Rimuovi",
            true,
        )) return;
        state.unavailabilities = state.unavailabilities.filter((entry) => entry.id !== item.id);
        recalculateMachineSchedule(item.machineId);
        saveState();
        renderUnavailabilityList();
        renderAll();
        notify("Indisponibilità rimossa e pianificazione aggiornata");
    });

    byId("job-context-menu")?.addEventListener("click", (event) => {
        event.stopPropagation();
        const target = event.target as HTMLElement;
        const directionButton = target.closest("[data-link-direction]") as HTMLElement | null;
        if (directionButton) {
            event.preventDefault();
            event.stopPropagation();
            linkPickerDirection = directionButton.dataset.linkDirection as "previous" | "next";
            linkPickerCustomer = "";
            linkPickerDeliveryFrom = "";
            linkPickerDeliveryTo = "";
            linkPickerProductionFrom = "";
            linkPickerProductionTo = "";
            renderContextMenu("links");
            requestAnimationFrame(() => (byId("context-link-customer") as HTMLSelectElement | null)?.focus());
            return;
        }
        const toggle = target.closest("[data-context-toggle]") as HTMLElement | null;
        if (toggle) {
            event.preventDefault();
            event.stopPropagation();
            if (toggle.dataset.contextToggle === "progress" && contextJobId) {
                const job = state.jobs.find((item) => item.id === contextJobId);
                if (job) {
                    job.workStatus = "running";
                    job.progressDays = 0;
                    job.completedAt = "";
                    saveState();
                    renderAll();
                    closeContextMenu();
                    notify(`Lavorazione in corso · 0/${job.durationDays || 1} giorni`);
                }
                return;
            }
            const entry = toggle.closest(".context-menu__entry");
            const willOpen = !entry?.classList.contains("is-open");
            const siblings = entry?.parentElement?.querySelectorAll(":scope > .context-menu__entry.is-open") || [];
            siblings.forEach((item) => {
                if (item !== entry) item.classList.remove("is-open");
            });
            if (willOpen) entry?.classList.add("is-open");
            keepContextMenuInViewport();
            requestAnimationFrame(positionVisibleContextSubmenus);
            return;
        }
        const action = target.closest("[data-context-action]") as HTMLElement | null;
        if (!action || !contextJobId) return;
        const actionName = action.dataset.contextAction || "";
        const jobId = contextJobId;
        const job = state.jobs.find((item) => item.id === jobId);
        if (!job) {
            closeContextMenu();
            return;
        }
        if (actionName === "main-view") {
            renderContextMenu("main");
        } else if (actionName === "links-view") {
            linkPickerDirection = !job.nextJobId ? "next" : !job.previousJobId ? "previous" : "next";
            linkPickerCustomer = "";
            linkPickerDeliveryFrom = "";
            linkPickerDeliveryTo = "";
            linkPickerProductionFrom = "";
            linkPickerProductionTo = "";
            renderContextMenu("links");
            requestAnimationFrame(() => (byId("context-link-customer") as HTMLSelectElement | null)?.focus());
        } else if (actionName === "material-view") {
            renderContextMenu("material");
        } else if (actionName === "work-view") {
            renderContextMenu("work");
        } else if (actionName === "edit") {
            closeContextMenu();
            const job = state.jobs.find((item) => item.id === jobId);
            if (job) openJob(job);
        } else if (actionName === "copy") {
            closeContextMenu();
            openJob({ ...job }, true);
        } else if (actionName === "unlink-all") {
            closeContextMenu();
            const removed = unlinkAllJobs(jobId);
            notify(removed ? `${removed} ${removed === 1 ? "collegamento rimosso" : "collegamenti rimossi"}` : "Nessun collegamento da rimuovere");
        } else if (actionName === "delete") {
            closeContextMenu();
            deleteJobWithConfirmation(jobId);
        } else if (actionName.startsWith("link:")) {
            const [, direction, targetId] = actionName.split(":");
            closeContextMenu();
            if (setJobLink(jobId, targetId, direction as "previous" | "next")) {
                notify(direction === "previous" ? "Lavorazione precedente collegata" : "Lavorazione successiva collegata");
            } else {
                notify("Collegamento non disponibile");
            }
        } else if (actionName.startsWith("unlink:")) {
            const direction = actionName.split(":")[1] as "previous" | "next";
            closeContextMenu();
            unlinkJob(jobId, direction);
            notify(direction === "previous" ? "Precedente scollegata" : "Successiva scollegata");
        } else if (actionName.startsWith("material:")) {
            job.materialStatus = actionName.split(":")[1] as MaterialStatus;
            saveState();
            closeContextMenu();
            renderAll();
            notify(`Materiale: ${materialLabels[job.materialStatus]}`);
        } else if (actionName === "work:running" || actionName === "progress-view") {
            renderContextMenu("progress");
        } else if (actionName === "work:not_started") {
            job.workStatus = "not_started";
            job.progressDays = 0;
            job.completedAt = "";
            saveState();
            closeContextMenu();
            renderAll();
            notify("Lavorazione non ancora iniziata");
        } else if (actionName === "work:done") {
            job.workStatus = "done";
            job.progressDays = job.durationDays || 1;
            job.completedAt = job.completedAt || new Date().toISOString();
            saveState();
            closeContextMenu();
            renderAll();
            notify("Lavorazione terminata");
        } else if (actionName.startsWith("progress:")) {
            const days = Number(actionName.split(":")[1]) || 1;
            job.workStatus = "running";
            job.progressDays = Math.min(job.durationDays || 1, Math.max(1, days));
            job.completedAt = "";
            saveState();
            closeContextMenu();
            renderAll();
            notify(`${job.progressDays}/${job.durationDays || 1} giorni processati`);
        }
    });

    byId("job-context-menu")?.addEventListener("change", (event) => {
        const input = event.target as HTMLInputElement | HTMLSelectElement;
        if (input.id === "context-link-customer") linkPickerCustomer = input.value;
        else if (input.id === "context-link-delivery-from") linkPickerDeliveryFrom = input.value;
        else if (input.id === "context-link-delivery-to") linkPickerDeliveryTo = input.value;
        else if (input.id === "context-link-production-from") linkPickerProductionFrom = input.value;
        else if (input.id === "context-link-production-to") linkPickerProductionTo = input.value;
        else return;
        updateLinkPickerResults();
    });

    byId("job-context-menu")?.addEventListener("mouseover", (event) => {
        const menu = event.currentTarget as HTMLElement;
        const target = event.target as HTMLElement;
        const level = (target.closest(".context-submenu") as HTMLElement | null) || menu;
        const closestEntry = target.closest(".context-menu__entry") as HTMLElement | null;
        const entry = closestEntry?.parentElement === level ? closestEntry : null;
        level.querySelectorAll(":scope > .context-menu__entry").forEach((item) => {
            if (item === entry) return;
            const sibling = item as HTMLElement;
            const siblingTimer = contextHoverTimers.get(sibling);
            if (siblingTimer) clearTimeout(siblingTimer);
            contextHoverTimers.delete(sibling);
            sibling.classList.remove("is-hovered", "is-open");
        });
        if (!entry) return;
        if (entry.contains(event.relatedTarget as Node)) return;
        const timer = contextHoverTimers.get(entry);
        if (timer) clearTimeout(timer);
        entry.classList.add("is-hovered");
        requestAnimationFrame(positionVisibleContextSubmenus);
    });

    byId("job-context-menu")?.addEventListener("mouseout", (event) => {
        const entry = (event.target as HTMLElement).closest(".context-menu__entry") as HTMLElement | null;
        if (!entry || entry.contains(event.relatedTarget as Node)) return;
        const previousTimer = contextHoverTimers.get(entry);
        if (previousTimer) clearTimeout(previousTimer);
        const timer = setTimeout(() => {
            entry.classList.remove("is-hovered");
            contextHoverTimers.delete(entry);
        }, 380);
        contextHoverTimers.set(entry, timer);
    });

    byId("machine-form")?.addEventListener("submit", (event) => {
        event.preventDefault();
        const name = inputValue("machine-name").trim();
        const department = inputValue("machine-department").trim();
        const category = inputValue("machine-category").trim();
        if (!name || !department || !category) return;
        const machine: Machine = {
            id: uid("machine"),
            name,
            department,
            category,
            color: "",
        };
        assignColorForMachineGroup(machine);
        state.machines.push(machine);
        saveState();
        (byId("machine-form") as HTMLFormElement).reset();
        renderMachinesDialog();
        renderAll();
    });

    byId("machine-list")?.addEventListener("dragstart", (event) => {
        const handle = (event.target as HTMLElement).closest(".machine-drag-handle");
        const row = handle?.closest("[data-machine-id]") as HTMLElement | null;
        if (!handle || !row?.dataset.machineId) {
            event.preventDefault();
            return;
        }
        event.stopPropagation();
        stopMachineListAutoScroll();
        draggedMachineId = row.dataset.machineId;
        row.classList.add("is-dragging");
        event.dataTransfer?.setData("text/x-aypi-machine", draggedMachineId);
        event.dataTransfer?.setData("text/plain", draggedMachineId);
        if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setDragImage(row, 18, row.offsetHeight / 2);
        }
    });

    byId("machine-list")?.addEventListener("dragover", (event) => {
        if (!draggedMachineId) return;
        event.preventDefault();
        event.stopPropagation();
        updateMachineListAutoScroll(event.clientY);
        const row = (event.target as HTMLElement).closest("[data-machine-id]") as HTMLElement | null;
        if (!row || row.dataset.machineId === draggedMachineId) {
            if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
            return;
        }
        document.querySelectorAll<HTMLElement>("#machine-list .machine-item").forEach((item) => {
            item.classList.remove("drop-before", "drop-after");
        });
        const placeAfter = event.clientY > row.getBoundingClientRect().top + row.offsetHeight / 2;
        row.classList.add(placeAfter ? "drop-after" : "drop-before");
        if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    });

    byId("machine-list")?.addEventListener("dragleave", (event) => {
        const list = event.currentTarget as HTMLElement;
        if (list.contains(event.relatedTarget as Node)) return;
        stopMachineListAutoScroll();
        document.querySelectorAll<HTMLElement>("#machine-list .machine-item").forEach((item) => {
            item.classList.remove("drop-before", "drop-after");
        });
    });

    byId("machine-list")?.addEventListener("drop", (event) => {
        if (!draggedMachineId) return;
        stopMachineListAutoScroll();
        const list = event.currentTarget as HTMLElement;
        let row = (event.target as HTMLElement).closest("[data-machine-id]") as HTMLElement | null;
        if (!row) {
            const rows = [...list.querySelectorAll<HTMLElement>("[data-machine-id]")];
            row = event.clientY < list.getBoundingClientRect().top + list.clientHeight / 2
                ? rows[0] || null
                : rows.at(-1) || null;
        }
        if (!row?.dataset.machineId || row.dataset.machineId === draggedMachineId) {
            clearMachineDropIndicators();
            draggedMachineId = "";
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        const sourceId = draggedMachineId;
        const targetId = row.dataset.machineId;
        const placeAfter = row.classList.contains("drop-after")
            || event.clientY > row.getBoundingClientRect().top + row.offsetHeight / 2;
        clearMachineDropIndicators();
        draggedMachineId = "";
        window.setTimeout(() => {
            if (!reorderMachine(sourceId, targetId, placeAfter)) return;
            saveState();
            renderMachinesDialog();
            renderAll();
            notify("Ordine macchine aggiornato per tutti gli utenti");
        }, 0);
    });

    byId("machine-list")?.addEventListener("dragend", (event) => {
        event.stopPropagation();
        stopMachineListAutoScroll();
        draggedMachineId = "";
        clearMachineDropIndicators();
    });

    byId("machine-list")?.addEventListener("change", (event) => {
        const input = event.target as HTMLInputElement;
        const row = input.closest("[data-machine-id]") as HTMLElement | null;
        if (!row || !input.dataset.machineField) return;
        const machine = state.machines.find((item) => item.id === row.dataset.machineId);
        if (!machine) return;
        const value = input.value.trim();
        const previousGroupKey = machineGroupKey(machine.department, machine.category);
        machine[input.dataset.machineField] = input.dataset.machineField === "category"
            ? value || "Senza categoria"
            : value;
        const groupChanged = previousGroupKey
            !== machineGroupKey(machine.department, machine.category);
        if (groupChanged) assignColorForMachineGroup(machine, true);
        saveState();
        refreshMachineDialogColors();
        renderAll();
    });

    byId("machine-list")?.addEventListener("click", async (event) => {
        const button = (event.target as HTMLElement).closest("[data-remove-machine]");
        if (!button) return;
        event.preventDefault();
        event.stopPropagation();
        const row = button.closest("[data-machine-id]") as HTMLElement | null;
        const machine = state.machines.find((item) => item.id === row?.dataset.machineId);
        if (!machine) return;
        const assigned = state.jobs.filter((job) => job.machineId === machine.id).length;
        const detail = assigned ? ` Le ${assigned} lavorazioni assegnate torneranno nella coda.` : "";
        if (!await nativeConfirm(
            `Rimuovere ${machine.name}?${detail}`,
            "Rimuovi",
            true,
        )) {
            restoreMachineDialogFocus();
            return;
        }
        const machineId = machine.id;
        (button as HTMLButtonElement).disabled = true;
        window.setTimeout(() => {
            state.jobs.forEach((job) => {
                if (job.machineId === machineId) job.machineId = "";
            });
            state.unavailabilities = state.unavailabilities.filter((item) => item.machineId !== machineId);
            state.machines = state.machines.filter((item) => item.id !== machineId);
            saveState();
            renderMachinesDialog();
            renderAll();
            restoreMachineDialogFocus();
        }, 0);
    });

    byId("article-filter")?.addEventListener("input", renderAll);
    byId("details-filter")?.addEventListener("input", renderAll);
    byId("show-archive")?.addEventListener("change", () => {
        showArchived = !!(byId("show-archive") as HTMLInputElement | null)?.checked;
        renderAll();
    });
    document.querySelector(".filters")?.addEventListener("change", (event) => {
        const input = event.target as HTMLInputElement;
        if (!input.matches("[data-filter-value]")) return;
        const details = input.closest(".multi-filter") as HTMLElement | null;
        const value = input.dataset.filterValue || "";
        const selected =
            details?.id === "department-filter"
                ? selectedDepartments
                : details?.id === "category-filter"
                  ? selectedCategories
                  : details?.id === "machine-filter"
                    ? selectedMachines
                    : selectedMaterials;
        if (input.checked) selected.add(value);
        else selected.delete(value);
        renderAll();
    });
    document.querySelectorAll(".multi-filter").forEach((details) => {
        details.addEventListener("toggle", () => {
            if (!(details as HTMLDetailsElement).open) return;
            document.querySelectorAll(".multi-filter").forEach((other) => {
                if (other !== details) (other as HTMLDetailsElement).open = false;
            });
        });
    });

    byId("range-select")?.addEventListener("change", () => {
        visibleDays = Number(inputValue("range-select")) || 14;
        renderAll();
    });
    byId("previous-period")?.addEventListener("click", () => {
        visibleStart = addDays(visibleStart, -1);
        renderAll();
    });
    byId("next-period")?.addEventListener("click", () => {
        visibleStart = addDays(visibleStart, 1);
        renderAll();
    });
    byId("today")?.addEventListener("click", () => {
        showDateInSecondColumn(new Date());
        renderAll();
    });
    byId("today")?.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        event.stopPropagation();
        const picker = byId("quick-date-picker") as HTMLInputElement | null;
        if (!picker) return;
        picker.value = dateKey(new Date());
        if (typeof picker.showPicker === "function") picker.showPicker();
        else picker.click();
    });
    byId("quick-date-picker")?.addEventListener("change", () => {
        const selected = inputValue("quick-date-picker");
        if (!selected) return;
        showDateInSecondColumn(selected);
        renderAll();
        notify(`Calendario spostato al ${formatLongDate(selected)}`);
    });

    document.addEventListener("click", (event) => {
        const linkPoint = (event.target as HTMLElement).closest("[data-link-navigate]") as HTMLElement | null;
        if (linkPoint) {
            event.preventDefault();
            event.stopPropagation();
            navigateToLinkedJob(linkPoint.dataset.linkNavigate || "");
            return;
        }
        if (!(event.target as HTMLElement).closest(".multi-filter")) {
            document.querySelectorAll(".multi-filter[open]").forEach((details) => {
                (details as HTMLDetailsElement).open = false;
            });
        }
        if (!(event.target as HTMLElement).closest("#job-context-menu")) closeContextMenu();
        const card = (event.target as HTMLElement).closest("[data-job-id]") as HTMLElement | null;
        if (!card || draggedJobId || Date.now() < suppressJobClickUntil) return;
        if ((event.target as HTMLElement).closest("[data-resize-edge]")) return;
        const job = state.jobs.find((item) => item.id === card.dataset.jobId);
        if (job) openJob(job);
    });

    byId("timeline")?.addEventListener("pointerdown", (event) => {
        const handle = (event.target as HTMLElement).closest("[data-resize-edge]") as HTMLElement | null;
        if (handle) {
            startJobResize(event as PointerEvent, handle);
            return;
        }
        if ((event.target as HTMLElement).closest(".days-header")) {
            startCalendarPan(event as PointerEvent);
        }
    });
    document.addEventListener("pointermove", (event) => {
        updateJobResize(event as PointerEvent);
        updateCalendarPan(event as PointerEvent);
    });
    document.addEventListener("pointerup", () => {
        finishJobResize();
        finishCalendarPan();
    });
    document.addEventListener("pointercancel", () => {
        finishJobResize();
        finishCalendarPan();
    });

    byId("timeline")?.addEventListener("mouseover", (event) => {
        const bar = (event.target as HTMLElement).closest(".job-bar") as HTMLElement | null;
        if (!bar || bar.contains(event.relatedTarget as Node)) return;
        showJobTooltip(bar.dataset.jobId || "", event as MouseEvent);
    });
    byId("timeline")?.addEventListener("mousemove", (event) => positionTooltip(event as MouseEvent));
    byId("timeline")?.addEventListener("mouseout", (event) => {
        const bar = (event.target as HTMLElement).closest(".job-bar") as HTMLElement | null;
        if (!bar || bar.contains(event.relatedTarget as Node)) return;
        hideJobTooltip();
    });
    document.addEventListener("mousemove", (event) => {
        if (!(event.target as HTMLElement).closest?.(".job-bar")) hideJobTooltip();
    });
    document.addEventListener("mouseleave", hideJobTooltip);
    window.addEventListener("blur", hideJobTooltip);

    document.addEventListener("keydown", (event) => {
        if (
            (event.ctrlKey || event.metaKey)
            && !event.shiftKey
            && event.key.toLocaleLowerCase() === "z"
        ) {
            const target = event.target as HTMLElement | null;
            const isEditingText = !!target?.closest(
                "input, textarea, select, [contenteditable='true']",
            );
            const hasOpenDialog = !!document.querySelector(".dialog-backdrop.is-open");
            if (!isEditingText && !hasOpenDialog) {
                event.preventDefault();
                closeContextMenu();
                undoLastPlannerChange();
            }
            return;
        }
        if (event.key === "Escape") {
            if (byId("job-context-menu")?.classList.contains("is-open")) {
                closeContextMenu();
                return;
            }
            if (byId("machine-picker-dialog")?.classList.contains("is-open")) {
                closeMachinePicker();
                return;
            }
            requestCloseJobDialog();
            closeDialog("machines-dialog");
            closeDialog("unavailability-dialog");
            closeDialog("closures-dialog");
            closeUnavailabilityRangeEditor();
        }
        if ((event.key === "Enter" || event.key === " ") && event.target instanceof HTMLElement) {
            if (event.target.closest("[data-link-navigate]")) return;
            const card = event.target.closest("[data-job-id]") as HTMLElement | null;
            if (!card) return;
            event.preventDefault();
            const job = state.jobs.find((item) => item.id === card.dataset.jobId);
            if (job) openJob(job);
        }
    });

    document.addEventListener("contextmenu", (event) => {
        const unavailableBlock = (event.target as HTMLElement).closest(
            "[data-unavailability-edit]",
        ) as HTMLElement | null;
        const closureRow = (event.target as HTMLElement).closest(
            "[data-closure-group-id]",
        ) as HTMLElement | null;
        const unavailableRow = (event.target as HTMLElement).closest(
            "[data-unavailability-id]",
        ) as HTMLElement | null;
        let unavailableId = unavailableBlock?.dataset.unavailabilityEdit
            || unavailableRow?.dataset.unavailabilityId
            || "";
        if (!unavailableId && closureRow?.dataset.closureGroupId) {
            unavailableId = state.unavailabilities.find(
                (item) => (item.groupId || item.id)
                    === closureRow.dataset.closureGroupId,
            )?.id || "";
        }
        if (unavailableId) {
            event.preventDefault();
            event.stopPropagation();
            closeContextMenu();
            hideJobTooltip();
            openUnavailabilityRangeEditor(unavailableId);
            return;
        }
        const card = (event.target as HTMLElement).closest("[data-job-id]") as HTMLElement | null;
        if (!card) {
            closeContextMenu();
            return;
        }
        openContextMenu(card.dataset.jobId || "", event as MouseEvent);
    });
    window.addEventListener("blur", () => {
        closeContextMenu();
        cancelActivePointerInteractions();
    });
    window.addEventListener("resize", () => {
        closeContextMenu();
        if (resizeRenderTimer) clearTimeout(resizeRenderTimer);
        resizeRenderTimer = setTimeout(renderAll, 80);
    });
    byId("timeline-scroll")?.addEventListener("scroll", closeContextMenu);
    byId("backlog-list")?.addEventListener("scroll", closeContextMenu);

    document.addEventListener("dragstart", (event) => {
        if ((event.target as HTMLElement).closest("[data-resize-edge], [data-link-navigate]")) {
            event.preventDefault();
            return;
        }
        const card = (event.target as HTMLElement).closest("[data-job-id]") as HTMLElement | null;
        if (!card) return;
        hideJobTooltip();
        stopJobDragAutoScroll();
        draggedJobId = card.dataset.jobId || "";
        event.dataTransfer?.setData("text/plain", draggedJobId);
        if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
    });
    document.addEventListener("dragend", () => {
        stopJobDragAutoScroll();
        draggedJobId = "";
        clearDragPreview();
        document.querySelectorAll(".is-drop-target").forEach((node) => node.classList.remove("is-drop-target"));
    });

    byId("timeline")?.addEventListener("dragover", (event) => {
        const lane = (event.target as HTMLElement).closest(".machine-days") as HTMLElement | null;
        if (!lane) return;
        event.preventDefault();
        showDragPreview(lane, event.clientX);
        updateJobDragAutoScroll(lane, event.clientX, event.clientY);
    });
    byId("timeline")?.addEventListener("dragleave", (event) => {
        const lane = (event.target as HTMLElement).closest(".machine-days") as HTMLElement | null;
        if (!lane || lane.contains(event.relatedTarget as Node)) return;
        lane.classList.remove("is-drop-target");
        lane.querySelector(".drag-preview")?.remove();
    });
    byId("timeline")?.addEventListener("drop", (event) => {
        const lane = (event.target as HTMLElement).closest(".machine-days") as HTMLElement | null;
        if (!lane) return;
        event.preventDefault();
        const jobId = event.dataTransfer?.getData("text/plain") || draggedJobId;
        stopJobDragAutoScroll();
        clearDragPreview();
        const rect = lane.getBoundingClientRect();
        const dayIndex = Math.max(0, Math.min(visibleDays - 1, Math.floor((event.clientX - rect.left) / dayWidth)));
        draggedJobId = "";
        scheduleJob(jobId, lane.dataset.machineId || "", addDays(visibleStart, dayIndex));
    });

    const backlog = byId("backlog-dropzone");
    backlog?.addEventListener("dragover", (event) => {
        if (backlogView !== "queue") return;
        event.preventDefault();
        stopJobDragAutoScroll();
        clearDragPreview();
        backlog.classList.add("is-drop-target");
    });
    backlog?.addEventListener("dragleave", () => backlog.classList.remove("is-drop-target"));
    backlog?.addEventListener("drop", (event) => {
        if (backlogView !== "queue") return;
        event.preventDefault();
        const jobId = event.dataTransfer?.getData("text/plain") || draggedJobId;
        stopJobDragAutoScroll();
        backlog.classList.remove("is-drop-target");
        draggedJobId = "";
        unscheduleJob(jobId);
    });
}

document.addEventListener("DOMContentLoaded", () => {
    bindGlobalEvents();
    updateUndoButton();
    renderAll();
    requestAnimationFrame(renderAll);
    void loadLatestPlanner({ initial: true });
    remotePollTimer = setInterval(() => {
        if (!realtimeConnected) void checkForRemoteUpdates();
    }, 10000);
    ipcRenderer.on("aypi-realtime-status", (_event, realtimeStatus) => {
        realtimeConnected = realtimeStatus?.state === "connected";
        if (
            !realtimeConnected &&
            !localDirty &&
            !remoteSaveInFlight
        ) {
            setSyncStatus(
                "offline",
                realtimeStatus?.state === "connecting"
                    ? "Connessione realtime…"
                    : "Realtime offline · controllo periodico",
                realtimeStatus?.detail || "",
            );
        }
    });
    ipcRenderer.on("aypi-realtime-event", (_event, realtimeEvent) => {
        if (
            realtimeEvent?.module !== "production-planner" &&
            realtimeEvent?.module !== "*"
        ) {
            return;
        }
        void checkForRemoteUpdates();
    });
    void ipcRenderer.invoke("aypi-realtime-status-get").then((realtimeStatus) => {
        realtimeConnected = realtimeStatus?.state === "connected";
    });
    document.addEventListener("visibilitychange", () => {
        if (!document.hidden) void checkForRemoteUpdates();
    });
    window.addEventListener("beforeunload", () => {
        if (remotePollTimer) clearInterval(remotePollTimer);
        if (remoteSaveTimer) clearTimeout(remoteSaveTimer);
    });
});
