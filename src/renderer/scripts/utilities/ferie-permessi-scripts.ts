// @ts-nocheck
require("../shared/dev-guards");
import { ipcRenderer } from "electron";
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { requestBackend } from "../shared/backend-client";
import { initBlueArchivePointerEffects } from "../shared/bluearchive-pointer-effects";
import {
    isValidEmail,
    isValidItalianPhone as isValidPhone,
} from "../shared/validation";
import { normalizeAdminEntry } from "../shared/admin-data";
import { buildCalendarRequest } from "./ferie-permessi/domain/request-builder";
import {
    createTypeColorStore,
    normalizeHexColor,
} from "./ferie-permessi/state/type-colors";
import {
    createCalendarApi,
    resolveCalendarBackendBaseUrl,
} from "./ferie-permessi/services/calendar-api";
import { createCalendarFilterState } from "./ferie-permessi/state/filter-state";
import { createCalendarAccessPolicy } from "./ferie-permessi/services/access-policy";

const IS_BLUE_ARCHIVE_CALENDAR =
    new URLSearchParams(window.location.search).get("theme") === "bluearchive";

initBlueArchivePointerEffects(IS_BLUE_ARCHIVE_CALENDAR);

const fpBaseDir = path.join(
    __dirname,
    "..",
    "..",
    "scripts",
    "utilities",
    "ferie-permessi",
);
const bootRequire = (modulePath) => {
    try {
        return require(modulePath);
    } catch (err) {
        ipcRenderer.invoke("show-message-box", {
            type: "error",
            message: "Errore caricamento modulo ferie/permessi.",
            detail: `${modulePath}\n${err.message || err}`,
        });
        throw err;
    }
};
const unwrapModule = (mod) => {
    if (!mod || typeof mod !== "object") return mod;
    if ("default" in mod && Object.keys(mod).length === 1) return mod.default;
    return mod;
};
const requireModule = (modulePath) => unwrapModule(bootRequire(modulePath));

const constantsModule =
    requireModule(path.join(fpBaseDir, "config", "constants")) || {};
const {
    AUTO_REFRESH_MS,
    OTP_EXPIRY_MS,
    OTP_RESEND_MS,
    COLOR_STORAGE_KEY,
    THEME_STORAGE_KEY,
    GUIDE_URL,
    GUIDE_SEARCH_PARAM,
    DEFAULT_TYPE_COLORS = {
        ferie: "#2f9e44",
        permesso: "#f08c00",
        straordinari: "#1a73e8",
        mutua: "#00acc1",
        speciale: "#9e9d24",
        retribuito: "#c2185b",
    },
} = constantsModule;
const {
    getAuthenticator,
    otpState,
    resetOtpState,
    isHashingAvailable,
    hashPassword,
} = bootRequire(path.join(fpBaseDir, "config", "security"));
const {
    normalizeBalances,
    applyMissingRequestDeductions,
    getBalanceImpact,
    applyBalanceForApproval,
    applyBalanceForDeletion,
    applyBalanceForUpdate,
} = bootRequire(path.join(fpBaseDir, "services", "balances"));
const { showDialog } = bootRequire(path.join(fpBaseDir, "services", "dialogs"));
const {
    isMailerAvailable,
    getMailerError,
    sendOtpEmail,
} = bootRequire(path.join(fpBaseDir, "services", "otp-mail"));

window.addEventListener("error", (event) => {
    const detail =
        event?.error?.stack || event?.message || "Errore sconosciuto";
    showDialog("error", "Errore JS Ferie/Permessi.", detail);
});

window.addEventListener("unhandledrejection", (event) => {
    const reason = event?.reason;
    const detail =
        reason?.stack ||
        reason?.message ||
        String(reason || "Errore sconosciuto");
    showDialog(
        "error",
        "Errore promessa non gestita (Ferie/Permessi).",
        detail,
    );
});

const fpUiDir = path.join(fpBaseDir, "ui");
const { createModalHelpers } = bootRequire(path.join(fpUiDir, "modals"));
const { createExportController } = bootRequire(path.join(fpUiDir, "export"));
const {
    applyCalendarButtonStyles,
    applyCalendarListStyles,
    applyCalendarListHoverStyles,
    initCalendar,
} = bootRequire(path.join(fpUiDir, "calendar"));
const { createAdminModals } = bootRequire(path.join(fpUiDir, "admin-modals"));
const { createOtpModals } = bootRequire(path.join(fpUiDir, "otp-modals"));
const { createSettingsModal } = bootRequire(
    path.join(fpUiDir, "settings-modal"),
);
const { createGuideModal } = bootRequire(path.join(fpUiDir, "guide-modal"));
const { createApprovalModal } = bootRequire(
    path.join(fpUiDir, "approval-modal"),
);
const { createEditModal } = bootRequire(path.join(fpUiDir, "edit-modal"));
const { createRequestForm } = bootRequire(path.join(fpUiDir, "request-form"));
const { createHolidaysModal } = bootRequire(
    path.join(fpUiDir, "holidays-modal"),
);
const { createClosuresModal } = bootRequire(
    path.join(fpUiDir, "closures-modal"),
);
const { createPendingPanel } = bootRequire(path.join(fpUiDir, "pending-panel"));
const { createSummary } = bootRequire(path.join(fpUiDir, "summary"));
const { createRenderer } = bootRequire(path.join(fpUiDir, "rendering"));
const { createConfigModal } = bootRequire(path.join(fpUiDir, "config-modal"));
const { createRefreshController } = bootRequire(
    path.join(fpBaseDir, "services", "refresh"),
);
const { formatDate, formatDateTime, formatDateParts } = bootRequire(
    path.join(fpBaseDir, "utils", "date-format"),
);
const { createRangeLine } =
    requireModule(path.join(fpUiDir, "range-line")) || {};
const { initCustomSelects: initCustomSelectsUi } = bootRequire(
    path.join(fpUiDir, "custom-select"),
);
const { getRequestDates } = bootRequire(
    path.join(fpBaseDir, "utils", "requests"),
);
const { buildExportRows } = bootRequire(
    path.join(fpBaseDir, "utils", "export"),
);
const { getTypeLabel } = bootRequire(path.join(fpBaseDir, "utils", "labels"));
const {
    UI_TEXTS = { initErrorTitle: "Errore inizializzazione ferie/permessi." },
} = requireModule(path.join(fpBaseDir, "utils", "ui-texts")) || {};
const {
    DEFAULT_ACCESS_CONFIG,
    normalizeAccessConfig,
} = requireModule(path.join(fpBaseDir, "services", "access-config")) || {};

let calendar = null;
let XLSX;
try {
    XLSX = require("xlsx");
} catch (err) {
    console.error("Modulo 'xlsx' non trovato. Esegui: npm install xlsx");
}
let pendingAction = null;
const { showModal, hideModal, forceUnlockUI } = createModalHelpers({
    document,
    clearPendingAction: () => {
        pendingAction = null;
    },
});
let selectedEventId = null;
let editingRequestId = null;
let pendingPanelOpen = false;
let pendingUnlocked = false;
let pendingUnlockedBy = "";
let filterUnlocked = {
    overtime: false,
    mutua: false,
    speciale: false,
    retribuito: false,
};
let assigneesUnlocked = false;
let assigneesOpenPending = false;
let manageUnlocked = false;
let manageOpenPending = false;
let daysUnlocked = false;
let daysOpenPending = false;
let initialSetupActive = false;
let adminSession = { loggedIn: false, name: "" };
let lastNonListViewType = "dayGridMonth";
let handlingListRedirect = false;
let assigneeOptions = [];
let assigneeGroups = {};
let assigneeEmails = {};
let cachedData = { requests: [] };
const FP_BACKEND_BASE_URL = resolveCalendarBackendBaseUrl(ipcRenderer);
let calendarFilters = {
    ferie: true,
    permesso: true,
    overtime: false,
    mutua: false,
    speciale: false,
    retribuito: false,
};
let editingAdminName = "";
let adminCache = [];
let adminEditingIndex = -1;

function loadAdminCredentials() {
    return Array.isArray(adminCache) ? adminCache.map(normalizeAdminEntry) : [];
}

async function saveAdminCredentials(admins) {
    const payload = await requestBackend("/api/shared/admins", {
        method: "PUT",
        body: { admins: Array.isArray(admins) ? admins : [] },
    });
    adminCache = Array.isArray(payload?.admins)
        ? payload.admins.map(normalizeAdminEntry)
        : Array.isArray(admins)
          ? admins.map(normalizeAdminEntry)
          : [];
    return loadAdminCredentials();
}

function findAdminByName(name, adminSource) {
    const source =
        Array.isArray(adminSource) && adminSource.length
            ? adminSource
            : loadAdminCredentials();
    const lower = String(name || "")
        .trim()
        .toLowerCase();
    return (
        source.find(
            (admin) =>
                String(admin?.name || "")
                    .trim()
                    .toLowerCase() === lower,
        ) || null
    );
}

async function hydrateAdminCacheRemote() {
    const payload = await requestBackend("/api/shared/admins");
    adminCache = Array.isArray(payload?.admins)
        ? payload.admins.map(normalizeAdminEntry)
        : [];
    return adminCache;
}

async function verifyAdminPasswordRemote(password, targetName) {
    const payload = await requestBackend("/api/shared/admins/verify", {
        method: "POST",
        body: {
            password,
            targetName: targetName || null,
        },
    }).catch(() => null);
    if (!payload?.ok || !payload?.admin) return null;
    const admin = normalizeAdminEntry(payload.admin);
    const names = new Set(
        loadAdminCredentials()
            .map((item) =>
                String(item?.name || "")
                    .trim()
                    .toLowerCase(),
            )
            .filter(Boolean),
    );
    const nextCache = loadAdminCredentials();
    if (!names.has(admin.name.trim().toLowerCase())) {
        nextCache.push(admin);
    } else {
        const index = nextCache.findIndex(
            (item) =>
                String(item?.name || "")
                    .trim()
                    .toLowerCase() === admin.name.trim().toLowerCase(),
        );
        if (index >= 0) nextCache[index] = admin;
    }
    adminCache = nextCache.map(normalizeAdminEntry);
    return {
        admin,
        admins: adminCache,
    };
}

function hasCalendarAccess(admin) {
    return !(admin && admin.accessCalendar === false);
}

async function loadAssigneeOptionsRemote() {
    const payload = await requestBackend("/api/shared/assignees");
    return {
        options: Object.values(payload?.groups || {}).flat(),
        groups: payload?.groups && typeof payload.groups === "object" ? payload.groups : {},
        emails: payload?.emails && typeof payload.emails === "object" ? payload.emails : {},
    };
}

async function saveAssigneeOptionsRemote(data) {
    const payload = await requestBackend("/api/shared/assignees", {
        method: "PUT",
        body: {
            groups: data?.groups || {},
            emails: data?.emails || {},
        },
    });
    const next = payload?.data || {};
    assigneeGroups = next?.groups && typeof next.groups === "object" ? next.groups : {};
    assigneeEmails = next?.emails && typeof next.emails === "object" ? next.emails : {};
    assigneeOptions = Object.values(assigneeGroups).flat();
    return {
        options: assigneeOptions,
        groups: assigneeGroups,
        emails: assigneeEmails,
    };
}

async function verifyCalendarAdminPassword(
    password: string,
    targetName?: string | null,
) {
    const result = await verifyAdminPasswordRemote(password, targetName);
    if (!result || !result.admin) return null;
    if (!hasCalendarAccess(result.admin)) return null;
    return result;
}
let passwordFailCount = 0;
let legendEditingType = null;
let legendColorSnapshot = null;
let legendPreviewTimer = null;
let runExport = null;
let accessConfig = normalizeAccessConfig(DEFAULT_ACCESS_CONFIG);

function setAccessConfig(next) {
    accessConfig = normalizeAccessConfig(next);
    return accessConfig;
}

const accessPolicy = createCalendarAccessPolicy({
    request: requestBackend,
    normalize: normalizeAccessConfig,
    getConfig: () => accessConfig,
    setConfig: setAccessConfig,
});

const filterStateController = createCalendarFilterState({
    document,
    getStorage: () => window.localStorage,
    filters: calendarFilters,
    isAdminLoggedIn,
    getAdminName: () => adminSession.name || "",
    isAdminRequiredForFilter,
    render: () => renderer?.renderCalendar?.(cachedData),
});

function persistFilterState() {
    return filterStateController.persist();
}

function applyFilterDefaultsFromAccessConfig() {
    return filterStateController.applyDefaults();
}

function applyStoredFilterStateForCurrentUser() {
    return filterStateController.applyStored();
}

async function loadAccessConfigRemote() {
    return accessPolicy.load();
}

async function persistAccessConfigRemote(next) {
    return accessPolicy.persist(next);
}

function isAdminRequiredForCreate(type) {
    return accessPolicy.create(type);
}

function isAdminRequiredForFilter(type) {
    return accessPolicy.filter(type);
}

function isAdminRequiredForPendingAccess() {
    return accessPolicy.pendingAccess();
}

function isAdminRequiredForPendingApprove() {
    return accessPolicy.pendingApprove();
}

function isAdminRequiredForPendingReject() {
    return accessPolicy.pendingReject();
}

function isAdminRequiredForEditApproved() {
    return accessPolicy.editApproved();
}

function isAdminRequiredForDeleteApproved() {
    return accessPolicy.deleteApproved();
}

function isAdminRequiredForManageAccess() {
    return accessPolicy.manageAccess();
}

function isAdminRequiredForDaysAccess() {
    return accessPolicy.daysAccess();
}

function isAdminRequiredForExport() {
    return accessPolicy.exportData();
}

function requireAccess(required, action) {
    if (!required) {
        if (typeof action === "function") action();
        return;
    }
    requireAdminAccess(action);
}

function getApproverName(admin) {
    if (admin?.name) return admin.name;
    if (isAdminLoggedIn()) return adminSession.name || "";
    return "";
}

const exportUi = createExportController({
    document,
    showModal,
    hideModal,
    setMessage,
    getAssigneeGroups: () => assigneeGroups,
});

const typeColorStore = createTypeColorStore({
    storage: window.localStorage,
    storageKey: COLOR_STORAGE_KEY,
    defaults: DEFAULT_TYPE_COLORS,
});
const loadColorSettings = () => typeColorStore.load();
const saveColorSettings = (colors) => typeColorStore.save(colors);
const getTypeColor = (type) => typeColorStore.get(type);
const getTypeColors = () => typeColorStore.getAll();
const setTypeColors = (next) => typeColorStore.set(next);

function applyTypeColors() {
    const ferieDot = document.querySelector(".fp-legend__dot--ferie");
    const permessoDot = document.querySelector(".fp-legend__dot--permesso");
    const straordinariDot = document.querySelector(
        ".fp-legend__dot--straordinari",
    );
    const mutuaDot = document.querySelector(".fp-legend__dot--mutua");
    const specialeDot = document.querySelector(".fp-legend__dot--speciale");
    const retribuitoDot = document.querySelector(".fp-legend__dot--retribuito");
    if (ferieDot) ferieDot.style.background = getTypeColor("ferie");
    if (permessoDot) permessoDot.style.background = getTypeColor("permesso");
    if (straordinariDot)
        straordinariDot.style.background = getTypeColor("straordinari");
    if (mutuaDot) mutuaDot.style.background = getTypeColor("mutua");
    if (specialeDot) specialeDot.style.background = getTypeColor("speciale");
    if (retribuitoDot)
        retribuitoDot.style.background = getTypeColor("retribuito");
}

function openLegendEditor(type) {
    const editor = document.getElementById("fp-legend-editor");
    const title = document.getElementById("fp-legend-editor-title");
    const colorInput = document.getElementById("fp-legend-color-input");
    if (!editor || !colorInput) return;
    legendEditingType = type;
    legendColorSnapshot = getTypeColors();
    colorInput.value = getTypeColor(type);
    if (title) {
        const label = getTypeLabel(type) || "Colore legenda";
        title.textContent = `Colore ${label}`;
    }
    document
        .querySelectorAll(".fp-legend__item.is-editing")
        .forEach((item) => item.classList.remove("is-editing"));
    document
        .querySelector(`.fp-legend__item[data-type="${type}"]`)
        ?.classList.add("is-editing");
    editor.classList.remove("is-hidden");
}

function closeLegendEditor(revert) {
    const editor = document.getElementById("fp-legend-editor");
    if (!editor) return;
    editor.classList.add("is-hidden");
    document
        .querySelectorAll(".fp-legend__item.is-editing")
        .forEach((item) => item.classList.remove("is-editing"));
    if (revert && legendColorSnapshot) {
        setTypeColors(legendColorSnapshot);
        applyTypeColors();
        renderAll(loadData());
    }
    legendEditingType = null;
    legendColorSnapshot = null;
}

function setSettingsInputsFromColors() {
    const ferieInput = document.getElementById("fp-color-ferie");
    const permessoInput = document.getElementById("fp-color-permesso");
    const straordinariInput = document.getElementById("fp-color-straordinari");
    const mutuaInput = document.getElementById("fp-color-mutua");
    if (ferieInput) ferieInput.value = getTypeColor("ferie");
    if (permessoInput) permessoInput.value = getTypeColor("permesso");
    if (straordinariInput)
        straordinariInput.value = getTypeColor("straordinari");
    if (mutuaInput) mutuaInput.value = getTypeColor("mutua");
}

function loadThemeSetting() {
    if (IS_BLUE_ARCHIVE_CALENDAR) return "bluearchive";
    try {
        const value = window.localStorage?.getItem(THEME_STORAGE_KEY);
        if (value === "dark" || value === "aypi") {
            return value;
        }
        return "light";
    } catch (err) {
        return "light";
    }
}

function saveThemeSetting(theme) {
    if (IS_BLUE_ARCHIVE_CALENDAR) return;
    try {
        if (!window.localStorage) return;
        const next = theme === "dark" || theme === "aypi" ? theme : "light";
        window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch (err) {
        console.error("Errore salvataggio tema:", err);
    }
}

function applyTheme(theme) {
    const mode =
        IS_BLUE_ARCHIVE_CALENDAR || theme === "bluearchive"
            ? "bluearchive"
            : theme === "dark"
              ? "dark"
              : theme === "aypi"
                ? "aypi"
                : "light";
    document.body.classList.toggle("fp-dark", mode === "dark");
    document.body.classList.toggle("fp-aypi", mode === "aypi");
    document.body.classList.toggle("fp-bluearchive", mode === "bluearchive");
    applyCalendarButtonStyles(document);
    applyCalendarListStyles(document);
    applyCalendarListHoverStyles(document);
}

function setAdminMessage(id, text, isError = false) {
    const el = document.getElementById(id);
    if (!el) return;
    setMessage(el, text, isError);
}

function logFpDebug(action, payload = {}) {
    const entry = {
        action,
        at: new Date().toISOString(),
        ...payload,
    };
    try {
        ipcRenderer.send("fp-debug-log", entry);
    } catch (err) {
        // ignore debug bridge failures
    }
}

function clonePayload(payload) {
    return JSON.parse(JSON.stringify(payload || { requests: [] }));
}

const calendarApi = createCalendarApi({
    baseUrl: FP_BACKEND_BASE_URL,
    getUser: () => getLoggedAdminName?.() || "guest",
    getCachedData: () => cachedData,
    setCachedData: (data) => {
        cachedData = data;
    },
    render: (data) => renderAll(data),
    debug: logFpDebug,
    showDialog,
});
const fetchFpBackend = (endpoint = "", options = {}) =>
    calendarApi.request(endpoint, options);
const getBackendUnavailableMessage = (err) =>
    calendarApi.unavailableMessage(err);
const loadDataFromBackend = () => calendarApi.loadData();
const saveDataToBackend = (payload) => calendarApi.saveData(payload);
const createRequestAtomic = (request) => calendarApi.createRequest(request);
const updateRequestAtomic = (requestId, request) =>
    calendarApi.updateRequest(requestId, request);
const approveRequestAtomic = (requestId, actor) =>
    calendarApi.approveRequest(requestId, actor);
const rejectRequestAtomic = (requestId, actor) =>
    calendarApi.rejectRequest(requestId, actor);
const deleteRequestAtomic = (requestId, actor) =>
    calendarApi.deleteRequest(requestId, actor);
const createHolidaysAtomic = (dates, name) =>
    calendarApi.createHolidays(dates, name);
const deleteHolidayAtomic = (date) => calendarApi.deleteHoliday(date);
const updateHolidayAtomic = (date, nextDate, nextName) =>
    calendarApi.updateHoliday(date, nextDate, nextName);
const createClosureAtomic = (entry) => calendarApi.createClosure(entry);
const deleteClosureAtomic = (entry) => calendarApi.deleteClosure(entry);
const updateClosureAtomic = (entry, next) =>
    calendarApi.updateClosure(entry, next);

function migrateRetribuitoTypes(payload) {
    if (!payload || !Array.isArray(payload.requests))
        return { payload, changed: false };
    let changed = false;
    payload.requests = payload.requests.map((request) => {
        if (request && request.type === "giustificato") {
            changed = true;
            return { ...request, type: "retribuito" };
        }
        return request;
    });
    return { payload, changed };
}

function loadData() {
    return cachedData;
}

function saveData(payload) {
    cachedData = clonePayload(payload);
    logFpDebug("backend.save.optimistic", {
        requests: Array.isArray(payload?.requests)
            ? payload.requests.length
            : 0,
        holidays: Array.isArray(payload?.holidays)
            ? payload.holidays.length
            : 0,
        closures: Array.isArray(payload?.closures)
            ? payload.closures.length
            : 0,
        balances: payload?.balances ? Object.keys(payload.balances).length : 0,
    });
    saveDataToBackend(cachedData).catch((err) => {
        logFpDebug("backend.error.save", {
            detail: err?.message || String(err),
        });
        showDialog(
            "warning",
            "Salvataggio backend non riuscito.",
            getBackendUnavailableMessage(err),
        );
    });
}

function syncData(updateFn) {
    const data = clonePayload(cachedData);
    const next = updateFn ? updateFn(data) || data : data;
    const normalized = normalizeBalances(next, assigneeGroups);
    const deductions = applyMissingRequestDeductions(normalized.payload);
    const migration = migrateRetribuitoTypes(deductions.payload);
    cachedData = clonePayload(migration.payload);
    saveData(migration.payload);
    return migration.payload;
}

function syncBalancesAfterAssignees() {
    syncData((payload) => payload);
}

function setMessage(el, text, isError = false) {
    if (!el) return;
    if (!text) {
        el.classList.add("is-hidden");
        el.textContent = "";
        el.classList.remove("fp-message--error");
        return;
    }
    el.textContent = text;
    el.classList.remove("is-hidden");
    if (isError) {
        el.classList.add("fp-message--error");
    } else {
        el.classList.remove("fp-message--error");
    }
}

function buildHoverText(request) {
    if (!request) return "";
    const lines = [];
    const dept = request.department ? ` - ${request.department}` : "";
    const employee = request.employee || "Dipendente";
    lines.push(`${employee}${dept}`);
    lines.push(getTypeLabel(request.type));
    if (request.allDay) {
        const startLabel = formatDate(request.start);
        const endLabel = formatDate(request.end || request.start);
        if (endLabel && endLabel !== startLabel) {
            lines.push(`${startLabel} - ${endLabel}`);
        } else {
            lines.push(startLabel);
        }
    } else {
        lines.push(
            `${formatDateTime(request.start)} - ${formatDateTime(request.end)}`,
        );
    }
    if (request.approvedBy) {
        if (request.type === "mutua" || request.type === "infortunio") {
            lines.push(`Inserito da: ${request.approvedBy}`);
        } else {
            lines.push(`Approvato da: ${request.approvedBy}`);
        }
    }
    if (request.modifiedBy) {
        lines.push(`Modificato da: ${request.modifiedBy}`);
    }
    if (request.note) {
        lines.push(`Nota: ${request.note}`);
    }
    return lines.filter(Boolean).join("\n");
}

let renderer = null;

function renderAll(data) {
    if (!renderer) return;
    renderer.renderAll(data);
}

let openEditModalHandler = null;
let openAdminModalHandler = null;
let openPasswordModalHandler = null;
let openBackupModalHandler = null;
let pendingAdminAction = null;
let pendingAdminActionArmed = false;
let loginFromPrompt = false;

function showLoginRequired() {
    showInfoModal(UI_TEXTS.adminLoginTitle, UI_TEXTS.adminLoginRequired, {
        showLogin: true,
        clearPendingAction: true,
    });
}

function requireAdminAccess(action) {
    if (isAdminLoggedIn()) {
        if (typeof action === "function") action();
        return;
    }
    pendingAdminAction = typeof action === "function" ? action : null;
    pendingAdminActionArmed = true;
    showLoginRequired();
}

function clearPendingAdminAction() {
    pendingAdminAction = null;
    pendingAdminActionArmed = false;
}

function consumePendingAdminAction(fromPrompt) {
    if (!pendingAdminAction || !pendingAdminActionArmed || !fromPrompt) {
        clearPendingAdminAction();
        return false;
    }
    const action = pendingAdminAction;
    clearPendingAdminAction();
    if (typeof action === "function") {
        action();
        return true;
    }
    return false;
}

function isAdminLoggedIn() {
    return !!adminSession.loggedIn;
}

function getLoggedAdminName() {
    return adminSession.loggedIn ? adminSession.name : "";
}

function getLoggedAdmin() {
    if (!adminSession.loggedIn) return null;
    return { name: adminSession.name || UI_TEXTS.defaultAdminLabel };
}

function updateAdminToggleButton() {
    const toggle = document.getElementById("fp-admin-toggle");
    if (!toggle) return;
    toggle.textContent = adminSession.loggedIn ? "Logoff" : "Login";
}

function lockAdminAreas() {
    pendingUnlocked = false;
    manageUnlocked = false;
    daysUnlocked = false;
    assigneesUnlocked = false;
    filterUnlocked = {
        overtime: false,
        mutua: false,
        speciale: false,
        retribuito: false,
    };

    const overtimeToggle = document.getElementById("fp-filter-overtime");
    const mutuaToggle = document.getElementById("fp-filter-mutua");
    const specialeToggle = document.getElementById("fp-filter-speciale");
    const retribuitoToggle = document.getElementById("fp-filter-retribuito");
    if (overtimeToggle) overtimeToggle.checked = false;
    if (mutuaToggle) mutuaToggle.checked = false;
    if (specialeToggle) specialeToggle.checked = false;
    if (retribuitoToggle) retribuitoToggle.checked = false;
    calendarFilters.overtime = false;
    calendarFilters.mutua = false;
    calendarFilters.speciale = false;
    calendarFilters.retribuito = false;
    renderer?.renderCalendar?.(cachedData);

    pendingUi.closePendingPanel();

    const manageModal = document.getElementById("fp-manage-modal");
    if (manageModal) hideModal(manageModal);
    const daysModal = document.getElementById("fp-days-picker-modal");
    if (daysModal) hideModal(daysModal);
}

function setAdminSession(admin) {
    adminSession = {
        loggedIn: !!admin,
        name: admin?.name ? String(admin.name) : "",
    };
    updateAdminToggleButton();
}
const summaryUi = createSummary({ document });

const pendingUi = createPendingPanel({
    document,
    createRangeLine,
    syncData,
    renderAll,
    applyBalanceForApproval,
    getBalanceImpact,
    loadData,
    confirmNegativeBalance,
    getPendingUnlockedBy: () => pendingUnlockedBy,
    getPendingPanelOpen: () => pendingPanelOpen,
    setPendingPanelOpen: (next) => {
        pendingPanelOpen = next;
    },
    updatePendingBadge: (count) => summaryUi.updatePendingBadge(count),
    getLoggedAdminName,
    onAccessDenied: () => {
        showLoginRequired();
    },
    requireAdminAccess,
    requireAccess: (required, action) => requireAccess(required, action),
    isAdminRequiredForPendingAccess,
    isAdminRequiredForPendingApprove,
    isAdminRequiredForPendingReject,
    approveRequest: (requestId, actor) =>
        approveRequestAtomic(requestId, actor),
    rejectRequest: (requestId, actor) => rejectRequestAtomic(requestId, actor),
});

renderer = createRenderer({
    document,
    getCalendar: () => calendar,
    setCachedData: (next) => {
        cachedData = next;
    },
    summaryUi,
    pendingUi,
    applyCalendarListStyles,
    applyCalendarListHoverStyles,
    getTypeColor,
    shouldIncludeRequest: (request) => {
        if (!request || !request.type) return false;
        if (request.type === "straordinari") {
            return calendarFilters.overtime;
        }
        if (request.type === "mutua") {
            return calendarFilters.mutua;
        }
        if (request.type === "infortunio") {
            return calendarFilters.mutua;
        }
        if (request.type === "speciale") {
            return calendarFilters.speciale;
        }
        if (request.type === "retribuito") {
            return calendarFilters.retribuito;
        }
        if (request.type === "ferie") {
            return calendarFilters.ferie;
        }
        if (request.type === "permesso") {
            return calendarFilters.permesso;
        }
        return true;
    },
});

const refreshUi = createRefreshController({
    loadData: () => loadDataFromBackend(),
    renderAll,
    autoRefreshMs: AUTO_REFRESH_MS,
});

async function insertApprovedRequest(request, admin, options = {}) {
    if (!request) return;
    const { balanceHours = null } = options;
    const next = {
        ...request,
        status: "approved",
        approvedAt: new Date().toISOString(),
        approvedBy: getApproverName(admin),
    };
    if (typeof balanceHours === "number") {
        next.balanceHours = balanceHours;
        next.balanceAppliedAt = new Date().toISOString();
    }
    return createRequestAtomic(next);
}

async function handleMutuaCreate(admin, request) {
    const updated = await insertApprovedRequest(request, admin, {
        balanceHours: 0,
    });
    const message = document.getElementById("fp-form-message");
    setMessage(message, UI_TEXTS.mutuaInserted, false);
    if (
        requestFormUi &&
        typeof requestFormUi.resetNewRequestForm === "function"
    ) {
        requestFormUi.resetNewRequestForm();
    }
    return updated;
}

async function handleInfortunioCreate(admin, request) {
    const updated = await insertApprovedRequest(request, admin, {
        balanceHours: 0,
    });
    const message = document.getElementById("fp-form-message");
    setMessage(message, UI_TEXTS.infortunioInserted, false);
    if (
        requestFormUi &&
        typeof requestFormUi.resetNewRequestForm === "function"
    ) {
        requestFormUi.resetNewRequestForm();
    }
    return updated;
}

async function handleRetribuitoCreate(admin, request) {
    const updated = await insertApprovedRequest(request, admin, {
        balanceHours: 0,
    });
    const message = document.getElementById("fp-form-message");
    setMessage(message, UI_TEXTS.retribuitoInserted, false);
    if (
        requestFormUi &&
        typeof requestFormUi.resetNewRequestForm === "function"
    ) {
        requestFormUi.resetNewRequestForm();
    }
    return updated;
}

async function handleSpecialeCreate(admin, request) {
    const updated = await insertApprovedRequest(request, admin);
    const message = document.getElementById("fp-form-message");
    setMessage(message, UI_TEXTS.requestSent, false);
    if (
        requestFormUi &&
        typeof requestFormUi.resetNewRequestForm === "function"
    ) {
        requestFormUi.resetNewRequestForm();
    }
    return updated;
}

const approvalUi = createApprovalModal({
    document,
    showModal,
    hideModal,
    showDialog,
    showInfoModal,
    requireAdminAccess,
    isAdminRequiredForAction: (action) => accessPolicy.action(action),
    isHashingAvailable,
    loadAdminCredentials,
    verifyAdminPassword: verifyCalendarAdminPassword,
    loadData,
    syncData,
    renderAll,
    approveRequest: (requestId, actor) =>
        approveRequestAtomic(requestId, actor),
    rejectRequest: (requestId, actor) => rejectRequestAtomic(requestId, actor),
    deleteRequest: (requestId, actor) => deleteRequestAtomic(requestId, actor),
    openEditModal: (request) => {
        if (openEditModalHandler) openEditModalHandler(request);
    },
    openPendingPanel: () => pendingUi.openPendingPanel(),
    setPendingUnlocked: (next) => {
        pendingUnlocked = next;
    },
    setPendingUnlockedBy: (next) => {
        pendingUnlockedBy = next;
    },
    openAdminModal: () => {
        if (openAdminModalHandler) openAdminModalHandler();
    },
    getPendingAction: () => pendingAction,
    setPendingAction: (next) => {
        pendingAction = next;
    },
    getPasswordFailCount: () => passwordFailCount,
    setPasswordFailCount: (next) => {
        passwordFailCount = next;
    },
    setEditingRequestId: (next) => {
        editingRequestId = next;
    },
    setEditingAdminName: (next) => {
        editingAdminName = next;
    },
    getAdminCache: () => adminCache,
    setAdminCache: (next) => {
        adminCache = next;
    },
    saveAdminCredentials,
    renderAdminList: () => adminUi.renderAdminList(),
    setAdminMessage,
    forceUnlockUI,
    applyBalanceForApproval,
    applyBalanceForDeletion,
    getBalanceImpact,
    confirmNegativeBalance,
    onHoursAccess: () => {
        ipcRenderer.send("open-ferie-permessi-hours-window");
    },
    onAssigneesAccess: (_admin) => {
        assigneesUnlocked = true;
        if (assigneesOpenPending) {
            assigneesOpenPending = false;
            ipcRenderer.send("open-assignees-manager-window");
        }
    },
    onManageAccess: (_admin) => {
        manageUnlocked = true;
        if (manageOpenPending) {
            manageOpenPending = false;
            const manageModal = document.getElementById("fp-manage-modal");
            if (manageModal) showModal(manageModal);
        }
    },
    onDaysAccess: (_admin) => {
        daysUnlocked = true;
        if (daysOpenPending) {
            daysOpenPending = false;
            const daysModal = document.getElementById("fp-days-picker-modal");
            if (daysModal) showModal(daysModal);
        }
    },
    onFilterAccess: (_admin, filter) => {
        if (filter === "overtime") {
            calendarFilters.overtime = true;
            filterUnlocked.overtime = true;
            const overtimeToggle =
                document.getElementById("fp-filter-overtime");
            if (overtimeToggle) overtimeToggle.checked = true;
            persistFilterState();
            renderer.renderCalendar(cachedData);
            return;
        }
        if (filter === "mutua") {
            calendarFilters.mutua = true;
            filterUnlocked.mutua = true;
            const mutuaToggle = document.getElementById("fp-filter-mutua");
            if (mutuaToggle) mutuaToggle.checked = true;
            persistFilterState();
            renderer.renderCalendar(cachedData);
            return;
        }
        if (filter === "speciale") {
            calendarFilters.speciale = true;
            filterUnlocked.speciale = true;
            const specialeToggle =
                document.getElementById("fp-filter-speciale");
            if (specialeToggle) specialeToggle.checked = true;
            persistFilterState();
            renderer.renderCalendar(cachedData);
            return;
        }
        if (filter === "retribuito") {
            calendarFilters.retribuito = true;
            filterUnlocked.retribuito = true;
            const retribuitoToggle = document.getElementById(
                "fp-filter-retribuito",
            );
            if (retribuitoToggle) retribuitoToggle.checked = true;
            persistFilterState();
            renderer.renderCalendar(cachedData);
        }
    },
    onExport: () => {
        if (typeof runExport === "function") {
            runExport();
        }
    },
    onBackupAccess: () => {
        if (openBackupModalHandler) {
            openBackupModalHandler();
        }
    },
    onConfigAccess: () => {
        if (configUi) {
            configUi.openConfigModal();
        }
    },
    isAdminLoggedIn,
    getLoggedAdmin,
    onAdminLogin: (admin) => {
        if (!admin) return;
        setAdminSession(admin);
        if (!applyStoredFilterStateForCurrentUser()) {
            applyFilterDefaultsFromAccessConfig();
        }
        const handled = consumePendingAdminAction(loginFromPrompt);
        loginFromPrompt = false;
        if (!handled) {
            showInfoModal(
                UI_TEXTS.adminLoginTitle,
                UI_TEXTS.adminLoginSuccess(admin?.name || ""),
                {
                    showLogin: false,
                },
            );
        }
    },
    onMutuaCreate: (admin, request) => handleMutuaCreate(admin, request),
    onInfortunioCreate: (admin, request) =>
        handleInfortunioCreate(admin, request),
    onRetribuitoCreate: (admin, request) =>
        handleRetribuitoCreate(admin, request),
    onSpecialeCreate: (admin, request) => handleSpecialeCreate(admin, request),
    onHolidayCreate: async (_admin, dates, name) => {
        if (!Array.isArray(dates) || !dates.length) return;
        const updated = await createHolidaysAtomic(dates, name);
        holidaysUi.renderHolidayList(updated);
        const message = document.getElementById("fp-holidays-message");
        if (updated.holidaysAdded && updated.holidaysAdded > 0) {
            setMessage(message, UI_TEXTS.holidayAdded, false);
        } else {
            setMessage(message, UI_TEXTS.holidayAlreadyExists, true);
        }
        delete updated.holidaysAdded;
        renderAll(updated);
    },
    onHolidayRemove: async (_admin, date) => {
        if (!date) return;
        const updated = await deleteHolidayAtomic(date);
        holidaysUi.renderHolidayList(updated);
        setMessage(
            document.getElementById("fp-holidays-message"),
            UI_TEXTS.holidayRemoved,
            false,
        );
        renderAll(updated);
    },
    onHolidayUpdate: async (_admin, date, nextDate, nextName) => {
        if (!date || !nextDate) return;
        const updated = await updateHolidayAtomic(date, nextDate, nextName);
        holidaysUi.renderHolidayList(updated);
        if (updated.holidaysUpdated) {
            setMessage(
                document.getElementById("fp-holidays-message"),
                UI_TEXTS.holidayUpdated,
                false,
            );
        } else {
            setMessage(
                document.getElementById("fp-holidays-message"),
                UI_TEXTS.holidayAlreadyExists,
                true,
            );
        }
        delete updated.holidaysUpdated;
        renderAll(updated);
    },
    onClosureCreate: async (_admin, entry) => {
        if (!entry || !entry.start) return;
        const updated = await createClosureAtomic(entry);
        closuresUi.renderClosureList(updated, {
            containerId: "fp-closures-future-list",
            futureOnly: true,
        });
        const message = document.getElementById("fp-closures-message");
        if (updated.closureAdded) {
            setMessage(message, UI_TEXTS.closureAdded, false);
        } else {
            setMessage(message, UI_TEXTS.closureAlreadyExists, true);
        }
        delete updated.closureAdded;
        renderAll(updated);
    },
    onClosureRemove: async (_admin, entry) => {
        if (!entry) return;
        const updated = await deleteClosureAtomic(entry);
        closuresUi.renderClosureList(updated, {
            containerId: "fp-closures-future-list",
            futureOnly: true,
        });
        setMessage(
            document.getElementById("fp-closures-message"),
            UI_TEXTS.closureRemoved,
            false,
        );
        renderAll(updated);
    },
    onClosureUpdate: async (_admin, entry, next) => {
        if (!entry || !entry.start || !next || !next.start) return;
        const updated = await updateClosureAtomic(entry, next);
        closuresUi.renderClosureList(updated, {
            containerId: "fp-closures-future-list",
            futureOnly: true,
        });
        if (updated.closureUpdated) {
            setMessage(
                document.getElementById("fp-closures-message"),
                UI_TEXTS.closureUpdated,
                false,
            );
        } else {
            setMessage(
                document.getElementById("fp-closures-message"),
                UI_TEXTS.closureAlreadyExists,
                true,
            );
        }
        delete updated.closureUpdated;
        renderAll(updated);
    },
});

const holidaysUi = createHolidaysModal({
    document,
    showModal,
    hideModal,
    setMessage,
    syncData,
    renderAll,
    loadData,
    openPasswordModal: (action) => approvalUi.openPasswordModal(action),
    requireDaysAccess: (action) =>
        requireAccess(isAdminRequiredForDaysAccess(), action),
    confirmAction: (message) => openConfirmModal(message),
});

const closuresUi = createClosuresModal({
    document,
    showModal,
    hideModal,
    setMessage,
    syncData,
    renderAll,
    loadData,
    openPasswordModal: (action) => approvalUi.openPasswordModal(action),
    requireDaysAccess: (action) =>
        requireAccess(isAdminRequiredForDaysAccess(), action),
    confirmAction: (message) => openConfirmModal(message),
});

const editUi = createEditModal({
    document,
    showModal,
    hideModal,
    setMessage,
    setInlineError,
    fillFormFromRequest,
    toggleAllDayStateFor,
    updateAllDayLock,
    buildRequestFromForm,
    openConfirmModal,
    escapeHtml,
    getTypeLabel,
    formatDate,
    formatDateTime,
    syncData,
    renderAll,
    updateRequest: (requestId, request) =>
        updateRequestAtomic(requestId, request),
    deleteRequest: (requestId, actor) => deleteRequestAtomic(requestId, actor),
    getEditingRequestId: () => editingRequestId,
    setEditingRequestId: (next) => {
        editingRequestId = next;
    },
    getEditingAdminName: () => editingAdminName,
    setEditingAdminName: (next) => {
        editingAdminName = next;
    },
    applyBalanceForUpdate,
    applyBalanceForDeletion,
    requireEditAccess: (action) =>
        requireAccess(isAdminRequiredForEditApproved(), action),
    requireDeleteAccess: (action) =>
        requireAccess(isAdminRequiredForDeleteApproved(), action),
});
openEditModalHandler = editUi.openEditModal;

const otpUi = createOtpModals({
    document,
    showModal,
    hideModal,
    setMessage,
    showDialog,
    isMailerAvailable,
    getMailerError,
    sendOtpEmail,
    findAdminByName,
    getAdminCache: () => adminCache,
    loadAdminCredentials,
    saveAdminCredentials,
    getAuthenticator,
    otpState,
    resetOtpState,
    isHashingAvailable,
    hashPassword,
    OTP_EXPIRY_MS,
    OTP_RESEND_MS,
});

const adminUi = createAdminModals({
    document,
    showModal,
    hideModal,
    setAdminMessage,
    openConfirmModal,
    escapeHtml,
    openPasswordModal: (action) => approvalUi.openPasswordModal(action),
    openOtpModal: () => otpUi.openOtpModal(),
    loadAdminCredentials,
    saveAdminCredentials,
    verifyAdminPassword: verifyCalendarAdminPassword,
    hashPassword,
    isHashingAvailable,
    isValidEmail,
    isValidPhone,
    showDialog,
    getAdminCache: () => adminCache,
    setAdminCache: (next) => {
        adminCache = next;
    },
    getAdminEditingIndex: () => adminEditingIndex,
    setAdminEditingIndex: (next) => {
        adminEditingIndex = next;
    },
    isInitialSetupActive: () => initialSetupActive,
    onInitialSetupComplete: () => {
        initialSetupActive = false;
        document.body.classList.remove("fp-initial-setup");
    },
});
openAdminModalHandler = () => {
    ipcRenderer.send("open-admin-manager-window");
};
openPasswordModalHandler = approvalUi.openPasswordModal;

const settingsUi = createSettingsModal({
    document,
    showModal,
    hideModal,
    setMessage,
    loadThemeSetting,
    saveThemeSetting,
    loadColorSettings,
    saveColorSettings,
    setSettingsInputsFromColors,
    applyTypeColors,
    applyTheme,
    renderAll,
    loadData,
    normalizeHexColor,
    DEFAULT_TYPE_COLORS,
    getTypeColors,
    setTypeColors,
    openPasswordModal: (action) => approvalUi.openPasswordModal(action),
});

const configUi = createConfigModal({
    document,
    showModal,
    hideModal,
    setMessage,
    loadAccessConfig: () => accessConfig,
    saveAccessConfig: (config) => {
        setAccessConfig(config);
        void persistAccessConfigRemote(config).catch((err) => {
            showDialog(
                "warning",
                "Salvataggio configurazione non riuscito.",
                err?.message || String(err),
            );
        });
    },
    normalizeAccessConfig,
    onConfigUpdated: (config) => {
        setAccessConfig(config);
        applyFilterDefaultsFromAccessConfig();
    },
});

const requestFormUi = createRequestForm({
    document,
    setMessage,
    setInlineError,
    toggleAllDayState,
    updateAllDayLock,
    buildRequestFromForm,
    escapeHtml,
    getTypeLabel,
    formatDate,
    formatDateTime,
    openConfirmModal,
    confirmNegativeBalance,
    getBalanceImpact: (request) => getBalanceImpact(loadData(), request),
    openPasswordModal: (action) => approvalUi.openPasswordModal(action),
    requireAdminAccess,
    isAdminRequiredForCreate,
    onDirectMutuaCreate: (request) => handleMutuaCreate(null, request),
    onDirectInfortunioCreate: (request) =>
        handleInfortunioCreate(null, request),
    onDirectRetribuitoCreate: (request) =>
        handleRetribuitoCreate(null, request),
    onDirectSpecialeCreate: (request) => handleSpecialeCreate(null, request),
    createRequest: (request) => createRequestAtomic(request),
    syncData,
    renderAll,
    refreshData: () => refreshUi.refreshData(),
    resetForm,
});

function getFieldValue(id) {
    return document.getElementById(id)?.value || "";
}

function isChecked(id) {
    return !!document.getElementById(id)?.checked;
}

function buildRequestFromForm(prefix, requestId, allowPast = false) {
    return buildCalendarRequest(
        {
            department: getFieldValue(`${prefix}-department`),
            employee: getFieldValue(`${prefix}-employee`),
            type: getFieldValue(`${prefix}-type`) || "ferie",
            allDay: isChecked(`${prefix}-all-day`),
            startDate: getFieldValue(`${prefix}-start-date`),
            endDate: getFieldValue(`${prefix}-end-date`),
            startTime: getFieldValue(`${prefix}-start-time`),
            endTime: getFieldValue(`${prefix}-end-time`),
            note: getFieldValue(`${prefix}-note`).trim(),
        },
        { requestId, messages: UI_TEXTS },
    );
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function openConfirmModal(message) {
    const modal = document.getElementById("fp-confirm-modal");
    const text = document.getElementById("fp-confirm-message");
    const okBtn = document.getElementById("fp-confirm-ok");
    const cancelBtn = document.getElementById("fp-confirm-cancel");
    if (!modal || !text || !okBtn || !cancelBtn) {
        return Promise.resolve(false);
    }
    text.innerHTML = message;
    showModal(modal);
    okBtn.focus();
    return new Promise((resolve) => {
        const cleanup = () => {
            okBtn.removeEventListener("click", onOk);
            cancelBtn.removeEventListener("click", onCancel);
            modal.removeEventListener("click", onBackdrop);
            document.removeEventListener("keydown", onKeydown);
            hideModal(modal);
        };
        const onOk = () => {
            cleanup();
            resolve(true);
        };
        const onCancel = () => {
            cleanup();
            resolve(false);
        };
        const onBackdrop = (event) => {
            event.stopPropagation();
        };
        const onKeydown = (event) => {
            if (event.key === "Escape") {
                event.preventDefault();
                cleanup();
                resolve(false);
            }
        };
        okBtn.addEventListener("click", onOk);
        cancelBtn.addEventListener("click", onCancel);
        modal.addEventListener("click", onBackdrop);
        document.addEventListener("keydown", onKeydown);
    });
}

function showInfoModal(title, message, options = {}) {
    const modal = document.getElementById("fp-info-modal");
    const titleEl = document.getElementById("fp-info-title");
    const text = document.getElementById("fp-info-message");
    const okBtn = document.getElementById("fp-info-ok");
    const loginBtn = document.getElementById("fp-info-login");
    if (!modal || !text || !okBtn) {
        return;
    }
    const opts = options === true ? { showLogin: true } : options;
    if (titleEl) titleEl.textContent = title || "Avviso";
    text.textContent = message || "";
    if (loginBtn) {
        if (opts.showLogin) {
            loginBtn.classList.remove("is-hidden");
            loginBtn.style.display = "";
        } else {
            loginBtn.classList.add("is-hidden");
            loginBtn.style.display = "none";
        }
    }
    showModal(modal);
    if (opts.showLogin && loginBtn) {
        loginBtn.focus();
    } else {
        okBtn.focus();
    }
    const cleanup = () => {
        okBtn.removeEventListener("click", onOk);
        if (loginBtn) loginBtn.removeEventListener("click", onLogin);
        modal.removeEventListener("click", onBackdrop);
        document.removeEventListener("keydown", onKeydown);
        hideModal(modal);
    };
    const onOk = () => {
        if (opts.clearPendingAction) {
            clearPendingAdminAction();
        }
        cleanup();
    };
    const onLogin = () => {
        cleanup();
        loginFromPrompt = true;
        if (openPasswordModalHandler) {
            openPasswordModalHandler({
                type: "admin-login",
                id: "admin-login",
                title: UI_TEXTS.adminLoginTitle,
                description: UI_TEXTS.adminLoginDescription,
            });
        }
    };
    const onBackdrop = (event) => {
        event.stopPropagation();
    };
    const onKeydown = (event) => {
        if (event.key === "Escape") {
            event.preventDefault();
            if (opts.clearPendingAction) {
                clearPendingAdminAction();
            }
            cleanup();
        }
    };
    okBtn.addEventListener("click", onOk);
    if (loginBtn && opts.showLogin) {
        loginBtn.addEventListener("click", onLogin);
    }
    modal.addEventListener("click", onBackdrop);
    document.addEventListener("keydown", onKeydown);
}

function formatBalanceValue(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return "0";
    return num.toFixed(2);
}

function confirmNegativeBalance(impact) {
    if (!impact || !impact.negative) {
        return Promise.resolve(true);
    }
    const before = formatBalanceValue(impact.hoursBefore);
    const delta = formatBalanceValue(impact.hoursDelta);
    const after = formatBalanceValue(impact.hoursAfter);
    const message =
        `<strong>Ore sotto zero.</strong><br>` +
        `Il dipendente ha <strong>${before}</strong> ore disponibili. ` +
        `La richiesta ne consuma <strong>${delta}</strong> e porterebbe il saldo a <strong>${after}</strong>.` +
        "<br>Vuoi procedere comunque?";
    return openConfirmModal(message);
}

function resetForm(prefix) {
    const note = document.getElementById(`${prefix}-note`);
    if (note) note.value = "";
}

function updateAllDayLock(startDate, endDate, allDayToggle, prefix = "fp") {
    if (!startDate || !endDate || !allDayToggle) return;
    if (!startDate.value || !endDate.value) {
        allDayToggle.disabled = false;
        return;
    }
    if (endDate.value !== startDate.value) {
        allDayToggle.checked = true;
        allDayToggle.disabled = true;
        if (prefix === "fp-edit") {
            toggleAllDayStateFor(prefix, true);
        } else {
            toggleAllDayState(true);
        }
        return;
    }
    allDayToggle.disabled = false;
}

function setInlineError(id, message) {
    const el = document.getElementById(id);
    if (!el) return;
    if (!message) {
        el.classList.add("is-hidden");
        el.textContent = "";
        return;
    }
    el.textContent = message;
    el.classList.remove("is-hidden");
}

function toggleAllDayState(isAllDay) {
    const startTime = document.getElementById("fp-start-time");
    const endTime = document.getElementById("fp-end-time");
    if (startTime) {
        startTime.disabled = false;
        startTime.readOnly = isAllDay;
    }
    if (endTime) {
        endTime.disabled = false;
        endTime.readOnly = isAllDay;
    }
}

function toggleAllDayStateFor(prefix, isAllDay) {
    const startTime = document.getElementById(`${prefix}-start-time`);
    const endTime = document.getElementById(`${prefix}-end-time`);
    if (startTime) {
        startTime.disabled = false;
        startTime.readOnly = isAllDay;
    }
    if (endTime) {
        endTime.disabled = false;
        endTime.readOnly = isAllDay;
    }
}

function ensureSelectOption(select, value) {
    if (!select || !value) return;
    const exists = Array.from(select.options).some(
        (opt) => opt.value === value,
    );
    if (!exists) {
        const opt = document.createElement("option");
        opt.value = value;
        opt.textContent = value;
        select.appendChild(opt);
    }
}

function fillFormFromRequest(prefix, request) {
    const department = document.getElementById(`${prefix}-department`);
    const employee = document.getElementById(`${prefix}-employee`);
    const type = document.getElementById(`${prefix}-type`);
    const allDay = document.getElementById(`${prefix}-all-day`);
    const startDate = document.getElementById(`${prefix}-start-date`);
    const endDate = document.getElementById(`${prefix}-end-date`);
    const startTime = document.getElementById(`${prefix}-start-time`);
    const endTime = document.getElementById(`${prefix}-end-time`);
    const note = document.getElementById(`${prefix}-note`);

    if (department) {
        ensureSelectOption(department, request.department);
        department.value = request.department || department.value;
        department.dispatchEvent(new Event("change"));
    }
    if (employee) {
        ensureSelectOption(employee, request.employee);
        employee.value = request.employee || employee.value;
    }
    if (type) type.value = request.type || "ferie";
    if (allDay) {
        allDay.checked = !!request.allDay;
        toggleAllDayStateFor(prefix, allDay.checked);
    }
    if (request.allDay) {
        if (startDate) startDate.value = request.start || "";
        if (endDate) endDate.value = request.end || request.start || "";
    } else {
        if (request.start && request.start.includes("T")) {
            const [date, time] = request.start.split("T");
            if (startDate) startDate.value = date;
            if (startTime) startTime.value = time.slice(0, 5);
        }
        if (request.end && request.end.includes("T")) {
            const [date, time] = request.end.split("T");
            if (endDate) endDate.value = date;
            if (endTime) endTime.value = time.slice(0, 5);
        }
    }
    if (note) note.value = request.note || "";
    if (prefix === "fp-edit") {
        updateAllDayLock(startDate, endDate, allDay, "fp-edit");
    }
}

function populateEmployees() {
    const groups = assigneeGroups && typeof assigneeGroups === "object" ? assigneeGroups : {};
    assigneeGroups = groups;
    populateEmployeesFor("fp", groups);
    populateEmployeesFor("fp-edit", groups);
}

function populateEmployeesFor(prefix, groups) {
    const departmentSelect = document.getElementById(`${prefix}-department`);
    const employeeSelect = document.getElementById(`${prefix}-employee`);
    if (!departmentSelect || !employeeSelect) return;

    const departments = Object.keys(groups).sort((a, b) => a.localeCompare(b));
    departmentSelect.innerHTML = "";
    if (departments.length === 0) {
        const opt = document.createElement("option");
        opt.value = "Altro";
        opt.textContent = "Altro";
        departmentSelect.appendChild(opt);
        employeeSelect.innerHTML = "";
        const emptyOpt = document.createElement("option");
        emptyOpt.value = "";
        emptyOpt.textContent = UI_TEXTS.emptyAssignee;
        employeeSelect.appendChild(emptyOpt);
        return;
    }

    departments.forEach((dept) => {
        const opt = document.createElement("option");
        opt.value = dept;
        opt.textContent = dept;
        departmentSelect.appendChild(opt);
    });

    const updateEmployees = () => {
        const selected = departmentSelect.value;
        const employees = Array.isArray(groups[selected])
            ? [...groups[selected]].sort((a, b) => a.localeCompare(b))
            : [];
        employeeSelect.innerHTML = "";
        if (employees.length === 0) {
            const emptyOpt = document.createElement("option");
            emptyOpt.value = "";
            emptyOpt.textContent = UI_TEXTS.emptyAssignee;
            employeeSelect.appendChild(emptyOpt);
            return;
        }
        employees.forEach((emp) => {
            const opt = document.createElement("option");
            opt.value = emp;
            opt.textContent = emp;
            employeeSelect.appendChild(opt);
        });
    };

    departmentSelect.addEventListener("change", updateEmployees);
    updateEmployees();
}

function initDaysPicker(holidaysUi, closuresUi) {
    const openBtn = document.getElementById("fp-days-manage");
    const modal = document.getElementById("fp-days-picker-modal");
    const closeBtn = document.getElementById("fp-days-picker-close");
    const holidayBtn = document.getElementById("fp-days-picker-holiday");
    const closureBtn = document.getElementById("fp-days-picker-closure");
    if (openBtn) {
        openBtn.addEventListener("click", () => {
            if (!isAdminRequiredForDaysAccess()) {
                if (modal) showModal(modal);
                return;
            }
            requireAdminAccess(() => {
                if (daysUnlocked) {
                    if (modal) showModal(modal);
                    return;
                }
                daysOpenPending = true;
                approvalUi.openPasswordModal({
                    type: "days-access",
                    id: "days-access",
                    title: "Festivita e chiusure",
                    description: UI_TEXTS.adminAccessDescription,
                });
            });
        });
    }
    if (closeBtn) {
        closeBtn.addEventListener("click", () => {
            if (modal) hideModal(modal);
        });
    }
    if (holidayBtn) {
        holidayBtn.addEventListener("click", () => {
            requireAccess(isAdminRequiredForDaysAccess(), () => {
                if (modal) hideModal(modal);
                holidaysUi?.openHolidaysModal?.();
            });
        });
    }
    if (closureBtn) {
        closureBtn.addEventListener("click", () => {
            requireAccess(isAdminRequiredForDaysAccess(), () => {
                if (modal) hideModal(modal);
                closuresUi?.openClosuresModal?.();
            });
        });
    }
    if (modal) {
        modal.addEventListener("click", (event) => {
            event.stopPropagation();
        });
    }
}

async function init() {
    if (IS_BLUE_ARCHIVE_CALENDAR) {
        document.body.classList.add("fp-bluearchive");
        document
            .getElementById("fp-settings-theme-open")
            ?.closest(".fp-export-section")
            ?.remove();
        document.getElementById("fp-settings-theme-modal")?.remove();
    }
    ipcRenderer.send("resize-normale");
    void hydrateAdminCacheRemote().catch(() => {
        adminCache = [];
    });
    try {
        accessConfig = await loadAccessConfigRemote();
    } catch (err) {
        accessConfig = normalizeAccessConfig(DEFAULT_ACCESS_CONFIG);
    }
    loadColorSettings();
    applyTypeColors();
    applyTheme(loadThemeSetting());
    const assigneesData = await loadAssigneeOptionsRemote();
    assigneeOptions = assigneesData.options;
    assigneeGroups = assigneesData.groups;
    assigneeEmails = assigneesData.emails || {};
    populateEmployees();
    initCustomSelectsUi({ document, selector: "select" });
    const selectObserver = new MutationObserver(() => {
        initCustomSelectsUi({ document, selector: "select" });
    });
    selectObserver.observe(document.body, { childList: true, subtree: true });
    initCustomSelectsUi({ document, selector: "select" });
    calendar = initCalendar({
        document,
        FullCalendar: window.FullCalendar,
        onEventSelect: (eventId) => {
            selectedEventId = eventId;
        },
        getRequestById: (eventId) =>
            (cachedData.requests || []).find((req) => req.id === eventId),
        buildHoverText,
        openPasswordModal: (action) => approvalUi.openPasswordModal(action),
        openEditModal: (request) => {
            requireAccess(isAdminRequiredForEditApproved(), () => {
                editingAdminName = isAdminLoggedIn() ? adminSession.name : "";
                if (openEditModalHandler) openEditModalHandler(request);
            });
        },
        getLastNonListViewType: () => lastNonListViewType,
        setLastNonListViewType: (value) => {
            lastNonListViewType = value;
        },
        getHandlingListRedirect: () => handlingListRedirect,
        setHandlingListRedirect: (value) => {
            handlingListRedirect = value;
        },
    });

    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const maxYear = now.getFullYear() + 2;
    const maxDate = `${maxYear}-12-31`;
    const startDate = document.getElementById("fp-start-date");
    const endDate = document.getElementById("fp-end-date");
    const editStartDateInit = document.getElementById("fp-edit-start-date");
    const editEndDateInit = document.getElementById("fp-edit-end-date");
    if (startDate) startDate.value = today;
    if (endDate) endDate.value = today;
    if (startDate) {
        startDate.setAttribute("min", today);
        startDate.setAttribute("max", maxDate);
        startDate.disabled = false;
        startDate.readOnly = false;
    }
    if (endDate) {
        endDate.setAttribute("min", today);
        endDate.setAttribute("max", maxDate);
        endDate.disabled = false;
        endDate.readOnly = false;
    }
    if (editStartDateInit) {
        editStartDateInit.setAttribute("max", maxDate);
        editStartDateInit.disabled = false;
        editStartDateInit.readOnly = false;
    }
    if (editEndDateInit) {
        editEndDateInit.setAttribute("max", maxDate);
        editEndDateInit.disabled = false;
        editEndDateInit.readOnly = false;
    }

    const typeSelect = document.getElementById("fp-type");
    const updateDateBounds = () => {
        if (!startDate || !endDate || !typeSelect) return;
        if (typeSelect.value === "mutua" || typeSelect.value === "infortunio") {
            startDate.removeAttribute("min");
            endDate.removeAttribute("min");
            return;
        }
        startDate.setAttribute("min", today);
        endDate.setAttribute("min", today);
    };
    if (typeSelect) {
        typeSelect.addEventListener("change", updateDateBounds);
        updateDateBounds();
    }

    const allDayToggle = document.getElementById("fp-all-day");
    updateAllDayLock(startDate, endDate, allDayToggle, "fp");
    if (allDayToggle) {
        toggleAllDayState(allDayToggle.checked);
        allDayToggle.addEventListener("change", () => {
            toggleAllDayState(allDayToggle.checked);
        });
    }
    requestFormUi.initRequestForm();

    settingsUi.initSettingsModal();
    configUi.initConfigModal();
    guideUi.initGuideModal();

    const guideNews = document.getElementById("fp-guide-news");
    if (guideNews) {
        guideNews.addEventListener("click", () => {
            if (guideUi?.openGuideModalAtPath) {
                guideUi.openGuideModalAtPath("aypi-calendar/novita.html");
            } else if (guideUi?.openGuideModalWithQuery) {
                guideUi.openGuideModalWithQuery("Novita");
            } else {
                guideUi.openGuideModal();
            }
        });
    }

    adminUi.initAdminModals();
    initialSetupActive = false;
    document.body.classList.remove("fp-initial-setup");

    const approveRecover = document.getElementById("fp-approve-recover");
    approvalUi.initApprovalModal();
    if (approveRecover) {
        approveRecover.addEventListener("click", () => {
            approvalUi.closeApprovalModal();
            otpUi.openOtpModal();
        });
    }

    otpUi.initOtpModals();

    const adminToggle = document.getElementById("fp-admin-toggle");
    if (adminToggle) {
        updateAdminToggleButton();
        adminToggle.addEventListener("click", () => {
            if (isAdminLoggedIn()) {
                setAdminSession(null);
                lockAdminAreas();
                if (!applyStoredFilterStateForCurrentUser()) {
                    applyFilterDefaultsFromAccessConfig();
                }
                showInfoModal(
                    UI_TEXTS.adminLoginTitle,
                    UI_TEXTS.adminLogoffSuccess,
                    { showLogin: false },
                );
                return;
            }
            clearPendingAdminAction();
            loginFromPrompt = false;
            approvalUi.openPasswordModal({
                type: "admin-login",
                id: "admin-login",
                title: UI_TEXTS.adminLoginTitle,
                description: UI_TEXTS.adminLoginDescription,
            });
        });
    }

    editUi.initEditModal();

    pendingUi.initPendingPanel();

    holidaysUi.initHolidaysModal();
    closuresUi.initClosuresModal();
    initDaysPicker(holidaysUi, closuresUi);

    const manageOpen = document.getElementById("fp-manage-open");
    const manageModal = document.getElementById("fp-manage-modal");
    const manageClose = document.getElementById("fp-manage-close");
    const manageAssignees = document.getElementById("fp-manage-assignees");
    const manageHours = document.getElementById("fp-manage-hours");

    if (manageOpen) {
        manageOpen.addEventListener("click", () => {
            if (!isAdminRequiredForManageAccess()) {
                if (manageModal) showModal(manageModal);
                return;
            }
            requireAdminAccess(() => {
                if (manageUnlocked) {
                    if (manageModal) showModal(manageModal);
                    return;
                }
                manageOpenPending = true;
                approvalUi.openPasswordModal({
                    type: "manage-access",
                    id: "manage-access",
                    title: "Gestione",
                    description: UI_TEXTS.adminAccessDescription,
                });
            });
        });
    }
    if (manageClose) {
        manageClose.addEventListener("click", () => {
            if (manageModal) hideModal(manageModal);
        });
    }
    if (manageModal) {
        manageModal.addEventListener("click", (event) => {
            if (event.target === manageModal) {
                // no-op: keep modal open on backdrop click
            }
        });
    }
    if (manageAssignees) {
        manageAssignees.addEventListener("click", () => {
            requireAccess(isAdminRequiredForManageAccess(), () => {
                if (manageModal) hideModal(manageModal);
                ipcRenderer.send("open-assignees-manager-window");
            });
        });
    }
    if (manageHours) {
        manageHours.addEventListener("click", () => {
            requireAccess(isAdminRequiredForManageAccess(), () => {
                if (manageModal) hideModal(manageModal);
                ipcRenderer.send("open-ferie-permessi-hours-window");
            });
        });
    }

    const exportOpen = document.getElementById("fp-export-open");
    const exportClose = document.getElementById("fp-export-close");
    const exportRun = document.getElementById("fp-export-run");
    const exportModal = document.getElementById("fp-export-modal");
    const exportSelectAll = document.getElementById("fp-export-select-all");
    const exportSelectNone = document.getElementById("fp-export-select-none");
    const exportRangeRadios = document.querySelectorAll(
        "input[name='fp-export-range']",
    );
    const backupOpen = document.getElementById("fp-backup-open");
    const backupClose = document.getElementById("fp-backup-close");
    const backupRun = document.getElementById("fp-backup-run");
    const backupRestore = document.getElementById("fp-backup-restore");
    const backupModal = document.getElementById("fp-backup-modal");
    const backupMessage = document.getElementById("fp-backup-message");
    const analysisOpen = document.getElementById("fp-analysis-open");

    if (exportOpen) {
        exportOpen.addEventListener("click", () => {
            requireAccess(isAdminRequiredForExport(), () => {
                exportUi.openExportModal();
            });
        });
    }

    if (exportClose) {
        exportClose.addEventListener("click", () => {
            exportUi.closeExportModal();
        });
    }

    if (exportModal) {
        exportModal.addEventListener("click", (event) => {
            if (event.target === exportModal) {
                // no-op: keep modal open on backdrop click
            }
        });
    }

    const openBackupModal = () => {
        if (!backupModal) return;
        setMessage(backupMessage, "");
        showModal(backupModal);
    };

    const closeBackupModal = () => {
        if (!backupModal) return;
        hideModal(backupModal);
    };

    if (backupOpen) {
        backupOpen.addEventListener("click", () => {
            requireAdminAccess(() => {
                approvalUi.openPasswordModal({
                    type: "backup-access",
                    id: "backup-access",
                    title: "Backup calendario",
                    description: UI_TEXTS.backupPasswordDescription,
                });
            });
        });
    }

    if (backupClose) {
        backupClose.addEventListener("click", () => {
            closeBackupModal();
        });
    }

    if (backupModal) {
        backupModal.addEventListener("click", (event) => {
            if (event.target === backupModal) {
                // no-op: keep modal open on backdrop click
            }
        });
    }

    if (analysisOpen) {
        analysisOpen.addEventListener("click", () => {
            requireAdminAccess(() => {
                ipcRenderer.send("open-ferie-permessi-analysis-window");
            });
        });
    }

    if (exportSelectAll) {
        exportSelectAll.addEventListener("click", () => {
            exportUi.setExportDepartmentsChecked(true);
        });
    }

    if (exportSelectNone) {
        exportSelectNone.addEventListener("click", () => {
            exportUi.setExportDepartmentsChecked(false);
        });
    }

    if (exportRangeRadios.length) {
        exportRangeRadios.forEach((radio) => {
            radio.addEventListener("change", exportUi.updateExportDateState);
        });
    }

    runExport = async () => {
        const needsAdmin = isAdminRequiredForExport();
        if (needsAdmin && !isAdminLoggedIn()) {
            requireAdminAccess(() => runExport());
            return;
        }
        if (!XLSX) {
            await showDialog(
                "error",
                UI_TEXTS.exportModuleMissingTitle,
                UI_TEXTS.exportModuleMissingDetail,
            );
            return;
        }
        const rangeMode =
            document.querySelector("input[name='fp-export-range']:checked")
                ?.value || "all";
        const startDate = exportUi.parseDateInput(
            document.getElementById("fp-export-start")?.value || "",
        );
        const endDate = exportUi.parseDateInput(
            document.getElementById("fp-export-end")?.value || "",
        );
        if (
            rangeMode === "custom" &&
            (!startDate || !endDate || endDate < startDate)
        ) {
            setMessage(
                document.getElementById("fp-export-message"),
                UI_TEXTS.exportInvalidRange,
                true,
            );
            return;
        }
        const includeFerie =
            !!document.getElementById("fp-export-ferie")?.checked;
        const includePermessi =
            !!document.getElementById("fp-export-permessi")?.checked;
        const includeStraordinari = !!document.getElementById(
            "fp-export-straordinari",
        )?.checked;
        const includeMutua =
            !!document.getElementById("fp-export-mutua")?.checked;
        const includeInfortunio = !!document.getElementById(
            "fp-export-infortunio",
        )?.checked;
        const includeSpeciale =
            !!document.getElementById("fp-export-speciale")?.checked;
        const includeRetribuito = !!document.getElementById(
            "fp-export-retribuito",
        )?.checked;
        if (
            !includeFerie &&
            !includePermessi &&
            !includeStraordinari &&
            !includeMutua &&
            !includeInfortunio &&
            !includeSpeciale &&
            !includeRetribuito
        ) {
            setMessage(
                document.getElementById("fp-export-message"),
                UI_TEXTS.exportSelectType,
                true,
            );
            return;
        }
        const departments = exportUi.getExportSelectedDepartments();
        if (!departments.length) {
            setMessage(
                document.getElementById("fp-export-message"),
                UI_TEXTS.exportSelectDepartment,
                true,
            );
            return;
        }

        const payload = loadData();
        const raw = payload.requests || [];
        const exportable = raw.filter(
            (req) =>
                req.status === "approved" ||
                req.status === "rejected" ||
                req.status === "deleted",
        );
        const filtered = exportable.filter((req) => {
            if (req.type === "ferie" && !includeFerie) return false;
            if (req.type === "permesso" && !includePermessi) return false;
            if (req.type === "straordinari" && !includeStraordinari)
                return false;
            if (req.type === "mutua" && !includeMutua) return false;
            if (req.type === "infortunio" && !includeInfortunio) return false;
            if (req.type === "speciale" && !includeSpeciale) return false;
            if (req.type === "retribuito" && !includeRetribuito) return false;
            if (req.department && !departments.includes(req.department))
                return false;
            if (rangeMode === "custom") {
                const { start, end } = getRequestDates(req);
                if (!start || !end) return false;
                const rangeStart = new Date(startDate);
                const rangeEnd = new Date(endDate);
                rangeEnd.setHours(23, 59, 59, 999);
                return start <= rangeEnd && end >= rangeStart;
            }
            return true;
        });

        if (!filtered.length) {
            setMessage(
                document.getElementById("fp-export-message"),
                UI_TEXTS.exportNoData,
                true,
            );
            return;
        }

        const rows = buildExportRows(
            filtered,
            payload.holidays,
            payload.closures,
        );
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(rows);
        const dateColumns = ["C", "D", "N", "P"];
        dateColumns.forEach((col) => {
            rows.forEach((_, idx) => {
                const cell = ws[`${col}${idx + 2}`];
                if (cell && cell.t === "d") {
                    cell.z = "dd/mm/yyyy hh:mm";
                }
            });
        });
        rows.forEach((_, idx) => {
            const hoursCell = ws[`E${idx + 2}`];
            const mutuaCell = ws[`F${idx + 2}`];
            if (hoursCell && hoursCell.t === "n") {
                hoursCell.z = "0.00";
            }
            if (mutuaCell && mutuaCell.t === "n") {
                mutuaCell.z = "0.00";
            }
        });
        XLSX.utils.book_append_sheet(wb, ws, "Ferie e Permessi");

        let outputPath;
        try {
            outputPath = await ipcRenderer.invoke("select-output-file", {
                defaultName: "ferie_permessi.xlsx",
                filters: [{ name: "File Excel", extensions: ["xlsx"] }],
            });
        } catch (err) {
            await showDialog(
                "error",
                "Errore selezione file di destinazione.",
                err.message || String(err),
            );
            return;
        }
        if (!outputPath) return;

        const dirOut = path.dirname(outputPath);
        if (!fs.existsSync(dirOut)) {
            fs.mkdirSync(dirOut, { recursive: true });
        }

        XLSX.writeFile(wb, outputPath, { cellDates: true });
        setMessage(
            document.getElementById("fp-export-message"),
            UI_TEXTS.exportSuccess,
            false,
        );
    };

    const createBackup = async (options = {}) => {
        try {
            const isSilent = !!options.silent;
            if (!isSilent) {
                setMessage(backupMessage, "");
            }
            const result = await fetchFpBackend("/backups", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    mode: options.mode === "calendar" ? "calendar" : "full",
                }),
            });
            if (!isSilent) {
                setMessage(
                    backupMessage,
                    UI_TEXTS.backupCreateSuccess(
                        result?.path || result?.name || "",
                    ),
                    false,
                );
            }
        } catch (err) {
            if (!options.silent) {
                setMessage(
                    backupMessage,
                    UI_TEXTS.backupCreateError(err.message || String(err)),
                    true,
                );
            }
        }
    };

    const restoreBackup = async () => {
        try {
            setMessage(backupMessage, "");

            const confirm = await showDialog(
                "warning",
                "Ripristino backup",
                "Cosa vuoi ripristinare?",
                ["Annulla", "Solo Calendar", "Tutta AGPRESS"],
            );

            if (!confirm || confirm.response === 0) return;
            const restoreMode = confirm.response === 2 ? "full" : "calendar";
            const list = await fetchFpBackend("/backups");
            const items = Array.isArray(list?.items) ? list.items : [];
            if (!items.length) {
                setMessage(backupMessage, "Nessun backup disponibile.", true);
                return;
            }
            const names = items.map((item) => item.name).filter(Boolean);
            const selectedName = window.prompt(
                `Inserisci il nome del backup da ripristinare:\n${names.join("\n")}`,
                names[0] || "",
            );
            if (!selectedName) return;
            await createBackup({ silent: true, mode: "full" });
            await fetchFpBackend(
                `/backups/${encodeURIComponent(selectedName)}/restore`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({ mode: restoreMode }),
                },
            );
            renderAll(loadData());
            setMessage(backupMessage, UI_TEXTS.backupRestoreSuccess, false);
        } catch (err) {
            setMessage(
                backupMessage,
                UI_TEXTS.backupRestoreError(err.message || String(err)),
                true,
            );
        }
    };

    if (exportRun) {
        exportRun.addEventListener("click", () => {
            requireAccess(isAdminRequiredForExport(), () => {
                approvalUi.openPasswordModal({
                    type: "export",
                    id: "export",
                    title: "Export calendario",
                    description: UI_TEXTS.exportPasswordDescription,
                });
            });
        });
    }

    if (backupRun) {
        backupRun.addEventListener("click", () => {
            requireAdminAccess(() => {
                createBackup();
            });
        });
    }

    if (backupRestore) {
        backupRestore.addEventListener("click", () => {
            requireAdminAccess(() => {
                restoreBackup();
            });
        });
    }

    openBackupModalHandler = () => openBackupModal();

    const ensureRecentBackup = () => {
        return;
    };

    pendingUi.closePendingPanel();

    const ferieToggle = document.getElementById("fp-filter-ferie");
    const permessoToggle = document.getElementById("fp-filter-permesso");
    const overtimeToggle = document.getElementById("fp-filter-overtime");
    const mutuaToggle = document.getElementById("fp-filter-mutua");
    const specialeToggle = document.getElementById("fp-filter-speciale");
    const retribuitoToggle = document.getElementById("fp-filter-retribuito");
    if (!applyStoredFilterStateForCurrentUser()) {
        applyFilterDefaultsFromAccessConfig();
    }
    const handleFilterToggle = (type, toggleEl) => {
        if (!toggleEl) return;
        toggleEl.addEventListener("change", () => {
            const needsAdmin = isAdminRequiredForFilter(type);
            const nextChecked = !!toggleEl.checked;
            if (needsAdmin && !isAdminLoggedIn()) {
                toggleEl.checked = !nextChecked;
                requireAccess(true, () => {
                    toggleEl.checked = nextChecked;
                    calendarFilters[type] = nextChecked;
                    persistFilterState();
                    renderer.renderCalendar(cachedData);
                });
                return;
            }
            calendarFilters[type] = nextChecked;
            persistFilterState();
            renderer.renderCalendar(cachedData);
        });
    };
    handleFilterToggle("ferie", ferieToggle);
    handleFilterToggle("permesso", permessoToggle);
    handleFilterToggle("overtime", overtimeToggle);
    handleFilterToggle("mutua", mutuaToggle);
    handleFilterToggle("speciale", specialeToggle);
    handleFilterToggle("retribuito", retribuitoToggle);

    const calendarRoot = document.getElementById("fp-calendar");
    if (calendarRoot) {
        calendarRoot.addEventListener("contextmenu", (event) => {
            const cell = event.target?.closest?.("[data-date]");
            if (!cell) return;
            const date = cell.getAttribute("data-date");
            if (!date) return;
            const holidays = Array.isArray(cachedData.holidays)
                ? cachedData.holidays
                : [];
            const match = holidays.find(
                (item) =>
                    (typeof item === "string" ? item : item?.date) === date,
            );
            if (match) {
                event.preventDefault();
                requireAccess(isAdminRequiredForDaysAccess(), () => {
                    holidaysUi.openHolidaysListModal(date);
                });
                return;
            }
            const closures = Array.isArray(cachedData.closures)
                ? cachedData.closures
                : [];
            const hasClosure = closures.some((entry) => {
                if (!entry) return false;
                const start = entry.start || "";
                const end = entry.end || entry.start || "";
                if (!start) return false;
                const from = start <= end ? start : end;
                const to = start <= end ? end : start;
                return date >= from && date <= to;
            });
            if (!hasClosure) return;
            event.preventDefault();
            requireAccess(isAdminRequiredForDaysAccess(), () => {
                closuresUi.openClosuresListModal(date);
            });
        });
    }

    document.addEventListener("keydown", (event) => {
        if (event.key === "F1") {
            event.preventDefault();
            guideUi.openGuideModal();
            return;
        }
        if (event.key !== "Delete") return;
        const target = event.target;
        if (
            target &&
            (target.tagName === "INPUT" ||
                target.tagName === "TEXTAREA" ||
                target.isContentEditable)
        ) {
            return;
        }
        if (!selectedEventId) return;
        requireAccess(isAdminRequiredForDeleteApproved(), () => {
            const targetId = selectedEventId;
            const snapshot = (cachedData.requests || []).find(
                (req) => req.id === targetId,
            );
            const typeLabel = snapshot
                ? getTypeLabel(snapshot.type)
                : "richiesta";
            const employeeLabel = snapshot?.employee
                ? ` di <strong>${escapeHtml(snapshot.employee)}</strong>`
                : "";
            const message = `Confermi l'eliminazione della <strong>${escapeHtml(typeLabel)}</strong>${employeeLabel}?`;
            openConfirmModal(message)
                .then(async (ok) => {
                    if (!ok) return;
                    const updated = await deleteRequestAtomic(
                        targetId,
                        getLoggedAdminName() || "guest",
                    );
                    renderAll(updated);
                })
                .catch((err) => {
                    logFpDebug("backend.error.delete.shortcut", {
                        requestId: targetId || "",
                        detail: err?.message || String(err),
                    });
                    showDialog(
                        "error",
                        "Eliminazione richiesta non riuscita.",
                        err?.message || String(err),
                    );
                });
        });
    });

    refreshUi.refreshData();
    refreshUi.scheduleAutoRefresh();
    setTimeout(() => {
        ensureRecentBackup();
    }, 30000);

    window.addEventListener("message", (event) => {
        if (!event || !event.data) return;
        if (event.data.type === "guide-close") {
            const modal = document.getElementById("fp-guide-modal");
            if (modal) hideModal(modal);
        }
    });

    const legend = document.getElementById("fp-legend");
    const legendEditor = document.getElementById("fp-legend-editor");
    const legendColorInput = document.getElementById("fp-legend-color-input");
    const legendSave = document.getElementById("fp-legend-save");
    const legendDefault = document.getElementById("fp-legend-default");
    const legendCancel = document.getElementById("fp-legend-cancel");

    if (legend) {
        legend.addEventListener("click", (event) => {
            const target = event.target?.closest?.(".fp-legend__item");
            if (!target) return;
            const type = target.getAttribute("data-type");
            if (!type) return;
            openLegendEditor(type);
        });
    }

    if (legendEditor) {
        legendEditor.addEventListener("click", (event) => {
            event.stopPropagation();
        });
    }

    document.addEventListener("click", (event) => {
        if (!legendEditor || legendEditor.classList.contains("is-hidden"))
            return;
        if (event.target?.closest?.("#fp-legend-editor")) return;
        if (event.target?.closest?.(".fp-legend__item")) return;
        // no-op: keep editor open; close only via "Chiudi"
    });

    if (legendColorInput) {
        legendColorInput.addEventListener("input", () => {
            if (!legendEditingType) return;
            const next = normalizeHexColor(
                legendColorInput.value,
                getTypeColor(legendEditingType),
            );
            setTypeColors({ ...getTypeColors(), [legendEditingType]: next });
            applyTypeColors();
            if (legendPreviewTimer) {
                clearTimeout(legendPreviewTimer);
            }
            legendPreviewTimer = setTimeout(() => {
                renderer.renderCalendar(cachedData);
                legendPreviewTimer = null;
            }, 80);
        });
    }

    if (legendDefault) {
        legendDefault.addEventListener("click", () => {
            if (!legendEditingType) return;
            const next =
                DEFAULT_TYPE_COLORS[legendEditingType] ||
                getTypeColor(legendEditingType);
            if (legendColorInput) legendColorInput.value = next;
            setTypeColors({ ...getTypeColors(), [legendEditingType]: next });
            applyTypeColors();
            renderAll(loadData());
        });
    }

    if (legendSave) {
        legendSave.addEventListener("click", () => {
            saveColorSettings(getTypeColors());
            closeLegendEditor(false);
        });
    }

    if (legendCancel) {
        legendCancel.addEventListener("click", () => {
            closeLegendEditor(true);
        });
    }
}

document.addEventListener("DOMContentLoaded", () => {
    try {
        init();
    } catch (err) {
        const detail =
            err && typeof err === "object" && "stack" in err && err.stack
                ? String(err.stack)
                : err &&
                    typeof err === "object" &&
                    "message" in err &&
                    err.message
                  ? String(err.message)
                  : String(err);
        showDialog("error", UI_TEXTS.initErrorTitle, detail);
    }
});

ipcRenderer.on("pm-open-calendar-assignees", () => {
    ipcRenderer.send("open-assignees-manager-window");
});

ipcRenderer.on("pm-open-calendar-admins", () => {
    ipcRenderer.send("open-admin-manager-window");
});

const guideLocalPath = path.resolve(
    __dirname,
    "..",
    "..",
    "Guida",
    "index.html",
);
const guideLocalUrl = fs.existsSync(guideLocalPath)
    ? `${pathToFileURL(guideLocalPath).toString()}?embed=1`
    : "";

const guideUi = createGuideModal({
    document,
    showModal,
    hideModal,
    setMessage,
    guideUrl: GUIDE_URL || guideLocalUrl,
    guideSearchParam: GUIDE_SEARCH_PARAM,
    getTheme: () => loadThemeSetting(),
});
