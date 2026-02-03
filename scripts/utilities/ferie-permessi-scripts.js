const { ipcRenderer } = require("electron");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const fpBaseDir = path.join(__dirname, "..", "..", "scripts", "utilities", "ferie-permessi");
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

const {
    BASE_DIR,
    REQUESTS_PATH,
    HOLIDAYS_PATH,
    BALANCES_PATH,
    CLOSURES_PATH,
    ADMINS_PATH,
    CONFIG_PATH,
} = bootRequire(path.join(fpBaseDir, "config", "paths"));
const {
    AUTO_REFRESH_MS,
    OTP_EXPIRY_MS,
    OTP_RESEND_MS,
    COLOR_STORAGE_KEY,
    THEME_STORAGE_KEY,
    GUIDE_URL,
    GUIDE_SEARCH_PARAM,
    DEFAULT_TYPE_COLORS,
} = bootRequire(path.join(fpBaseDir, "config", "constants"));
const {
    getAuthenticator,
    otpState,
    resetOtpState,
    isHashingAvailable,
    hashPassword,
} = bootRequire(path.join(fpBaseDir, "config", "security"));
const {
    loadAdminCredentials,
    saveAdminCredentials,
    verifyAdminPassword,
    findAdminByName,
    isValidEmail,
    isValidPhone,
} = bootRequire(path.join(fpBaseDir, "services", "admins"));
const { loadAssigneeOptions, saveAssigneeOptions } = bootRequire(path.join(fpBaseDir, "services", "assignees"));
const {
    normalizeBalances,
    applyMissingRequestDeductions,
    getBalanceImpact,
    applyBalanceForApproval,
    applyBalanceForDeletion,
    applyBalanceForUpdate,
    loadPayload,
    savePayload,
} = bootRequire(path.join(fpBaseDir, "services", "balances"));
const { showDialog } = bootRequire(path.join(fpBaseDir, "services", "dialogs"));
const { ensureFolderFor } = bootRequire(path.join(fpBaseDir, "services", "storage"));
const { isMailerAvailable, getMailerError, saveMailConfig, sendTestEmail, sendOtpEmail } = bootRequire(
    path.join(fpBaseDir, "services", "otp-mail")
);

window.addEventListener("error", (event) => {
    const detail = event?.error?.stack || event?.message || "Errore sconosciuto";
    showDialog("error", "Errore JS Ferie/Permessi.", detail);
});

window.addEventListener("unhandledrejection", (event) => {
    const reason = event?.reason;
    const detail = reason?.stack || reason?.message || String(reason || "Errore sconosciuto");
    showDialog("error", "Errore promessa non gestita (Ferie/Permessi).", detail);
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
const { createAssigneesModal } = bootRequire(path.join(fpUiDir, "assignees-modal"));
const { createSettingsModal } = bootRequire(path.join(fpUiDir, "settings-modal"));
const { createGuideModal } = bootRequire(path.join(fpUiDir, "guide-modal"));
const { createApprovalModal } = bootRequire(path.join(fpUiDir, "approval-modal"));
const { createEditModal } = bootRequire(path.join(fpUiDir, "edit-modal"));
const { createRequestForm } = bootRequire(path.join(fpUiDir, "request-form"));
const { createHolidaysModal } = bootRequire(path.join(fpUiDir, "holidays-modal"));
const { createClosuresModal } = bootRequire(path.join(fpUiDir, "closures-modal"));
const { createPendingPanel } = bootRequire(path.join(fpUiDir, "pending-panel"));
const { createSummary } = bootRequire(path.join(fpUiDir, "summary"));
const { createRenderer } = bootRequire(path.join(fpUiDir, "rendering"));
const { createConfigModal } = bootRequire(path.join(fpUiDir, "config-modal"));
const { createRefreshController } = bootRequire(path.join(fpBaseDir, "services", "refresh"));
const { formatDate, formatDateTime, formatDateParts } = bootRequire(path.join(fpBaseDir, "utils", "date-format"));
const { createRangeLine } = bootRequire(path.join(fpUiDir, "range-line"));
const { getRequestDates } = bootRequire(path.join(fpBaseDir, "utils", "requests"));
const { buildExportRows } = bootRequire(path.join(fpBaseDir, "utils", "export"));
const { getTypeLabel } = bootRequire(path.join(fpBaseDir, "utils", "labels"));
const { UI_TEXTS } = bootRequire(path.join(fpBaseDir, "utils", "ui-texts"));
const {
    DEFAULT_ACCESS_CONFIG,
    normalizeAccessConfig,
    loadAccessConfig,
    saveAccessConfig,
} = bootRequire(path.join(fpBaseDir, "services", "access-config"));

const BACKUP_BASE_DIR = "\\\\Dl360\\pubbliche\\TECH\\AyPi\\AGPRESS";
const BACKUP_ROOT_DIR = path.join(BACKUP_BASE_DIR, "Backup AyPi Calendar");

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
let editingDepartment = null;
let editingEmployee = null;
let typeColors = { ...DEFAULT_TYPE_COLORS };
let cachedData = { requests: [] };
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
let passwordFailCount = 0;
let legendEditingType = null;
let legendColorSnapshot = null;
let legendPreviewTimer = null;
let runExport = null;
let accessConfig = normalizeAccessConfig(loadAccessConfig());

function setAccessConfig(next) {
    accessConfig = normalizeAccessConfig(next);
    return accessConfig;
}

function ensureAccessConfigFile() {
    if (!CONFIG_PATH) return;
    try {
        if (!fs.existsSync(CONFIG_PATH)) {
            saveAccessConfig(accessConfig);
        }
    } catch (err) {
        console.error("Errore verifica config calendario:", err);
    }
}

function getAccessConfig() {
    return accessConfig;
}

function persistAccessConfig(next) {
    const saved = saveAccessConfig(next);
    setAccessConfig(saved);
    return saved;
}

function isAdminRequiredForCreate(type) {
    return !!accessConfig?.operations?.create?.[type];
}

function isAdminRequiredForFilter(type) {
    const key = type === "overtime" ? "straordinari" : type;
    return !!accessConfig?.operations?.filters?.[key];
}

function isAdminRequiredForPendingAccess() {
    return !!accessConfig?.operations?.pending?.access;
}

function isAdminRequiredForPendingApprove() {
    return !!accessConfig?.operations?.pending?.approve;
}

function isAdminRequiredForPendingReject() {
    return !!accessConfig?.operations?.pending?.reject;
}

function isAdminRequiredForEditApproved() {
    return !!accessConfig?.operations?.editApproved;
}

function isAdminRequiredForDeleteApproved() {
    return !!accessConfig?.operations?.deleteApproved;
}

function isAdminRequiredForManageAccess() {
    return !!accessConfig?.operations?.manageAccess;
}

function isAdminRequiredForDaysAccess() {
    return !!accessConfig?.operations?.daysAccess;
}

function isAdminRequiredForExport() {
    return !!accessConfig?.operations?.export;
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


function normalizeHexColor(value, fallback) {
    if (typeof value !== "string") return fallback;
    const cleaned = value.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(cleaned)) return cleaned.toLowerCase();
    return fallback;
}

function loadColorSettings() {
    try {
        const raw = window.localStorage?.getItem(COLOR_STORAGE_KEY);
        if (!raw) return { ...DEFAULT_TYPE_COLORS };
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object") return { ...DEFAULT_TYPE_COLORS };
        const legacyRetribuito = parsed.retribuito ?? parsed.giustificato;
        return {
            ferie: normalizeHexColor(parsed.ferie, DEFAULT_TYPE_COLORS.ferie),
            permesso: normalizeHexColor(parsed.permesso, DEFAULT_TYPE_COLORS.permesso),
            straordinari: normalizeHexColor(parsed.straordinari, DEFAULT_TYPE_COLORS.straordinari),
            mutua: normalizeHexColor(parsed.mutua, DEFAULT_TYPE_COLORS.mutua),
            speciale: normalizeHexColor(parsed.speciale, DEFAULT_TYPE_COLORS.speciale),
            retribuito: normalizeHexColor(legacyRetribuito, DEFAULT_TYPE_COLORS.retribuito),
        };
    } catch (err) {
        return { ...DEFAULT_TYPE_COLORS };
    }
}

function saveColorSettings(colors) {
    try {
        if (!window.localStorage) return;
        window.localStorage.setItem(COLOR_STORAGE_KEY, JSON.stringify(colors));
    } catch (err) {
        console.error("Errore salvataggio impostazioni colori:", err);
    }
}

function getTypeColor(type) {
    return typeColors[type] || DEFAULT_TYPE_COLORS[type] || "#1a73e8";
}

function getTypeColors() {
    return { ...typeColors };
}

function setTypeColors(next) {
    typeColors = { ...next };
}

function applyTypeColors() {
    const ferieDot = document.querySelector(".fp-legend__dot--ferie");
    const permessoDot = document.querySelector(".fp-legend__dot--permesso");
    const straordinariDot = document.querySelector(".fp-legend__dot--straordinari");
    const mutuaDot = document.querySelector(".fp-legend__dot--mutua");
    const specialeDot = document.querySelector(".fp-legend__dot--speciale");
    const retribuitoDot = document.querySelector(".fp-legend__dot--retribuito");
    if (ferieDot) ferieDot.style.background = getTypeColor("ferie");
    if (permessoDot) permessoDot.style.background = getTypeColor("permesso");
    if (straordinariDot) straordinariDot.style.background = getTypeColor("straordinari");
    if (mutuaDot) mutuaDot.style.background = getTypeColor("mutua");
    if (specialeDot) specialeDot.style.background = getTypeColor("speciale");
    if (retribuitoDot) retribuitoDot.style.background = getTypeColor("retribuito");
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
    editor.classList.remove("is-hidden");
}

function closeLegendEditor(revert) {
    const editor = document.getElementById("fp-legend-editor");
    if (!editor) return;
    editor.classList.add("is-hidden");
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
    if (straordinariInput) straordinariInput.value = getTypeColor("straordinari");
    if (mutuaInput) mutuaInput.value = getTypeColor("mutua");
}

function loadThemeSetting() {
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
    try {
        if (!window.localStorage) return;
        const next = theme === "dark" || theme === "aypi" ? theme : "light";
        window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch (err) {
        console.error("Errore salvataggio tema:", err);
    }
}

function applyTheme(theme) {
    const mode = theme === "dark" ? "dark" : theme === "aypi" ? "aypi" : "light";
    document.body.classList.toggle("fp-dark", mode === "dark");
    document.body.classList.toggle("fp-aypi", mode === "aypi");
    applyCalendarButtonStyles(document);
    applyCalendarListStyles(document);
    applyCalendarListHoverStyles(document);
}

function setAdminMessage(id, text, isError = false) {
    const el = document.getElementById(id);
    if (!el) return;
    setMessage(el, text, isError);
}

function ensureDataFolder() {
    ensureFolderFor(REQUESTS_PATH);
    ensureFolderFor(HOLIDAYS_PATH);
    ensureFolderFor(BALANCES_PATH);
    ensureFolderFor(CLOSURES_PATH);
}

function migrateRetribuitoTypes(payload) {
    if (!payload || !Array.isArray(payload.requests)) return { payload, changed: false };
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
    const parsed = loadPayload();
    const normalized = normalizeBalances(parsed, assigneeGroups);
    const deductions = applyMissingRequestDeductions(normalized.payload);
    const migration = migrateRetribuitoTypes(deductions.payload);
    const payload = migration.payload;
    const changed = normalized.changed || deductions.changed || migration.changed;
    if (changed) {
        saveData(payload);
    }
    return payload;
}

function saveData(payload) {
    ensureDataFolder();
    const ok = savePayload(payload);
    if (!ok) {
        showDialog("warning", UI_TEXTS.dataSaveFailure, "Errore scrittura file.");
    }
}

function syncData(updateFn) {
    const data = loadData();
    const next = updateFn ? updateFn(data) || data : data;
    const normalized = normalizeBalances(next, assigneeGroups);
    const deductions = applyMissingRequestDeductions(normalized.payload);
    const migration = migrateRetribuitoTypes(deductions.payload);
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

function formatBackupDate(date) {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
}

function ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

function copyDirectory(sourceDir, targetDir, options) {
    ensureDir(targetDir);
    const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
    entries.forEach((entry) => {
        const name = entry.name;
        if (options && typeof options.exclude === "function" && options.exclude(name, sourceDir)) {
            return;
        }
        const srcPath = path.join(sourceDir, name);
        const dstPath = path.join(targetDir, name);
        if (entry.isDirectory()) {
            copyDirectory(srcPath, dstPath, options);
            return;
        }
        if (entry.isFile()) {
            fs.copyFileSync(srcPath, dstPath);
        }
    });
}

function parseBackupFolderDate(name) {
    if (!name) return null;
    const match = String(name).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (!year || !month || !day) return null;
    const date = new Date(year, month - 1, day);
    if (Number.isNaN(date.getTime())) return null;
    return date;
}

function listBackupFolders() {
    if (!fs.existsSync(BACKUP_ROOT_DIR)) return [];
    return fs
        .readdirSync(BACKUP_ROOT_DIR, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => {
            const fullPath = path.join(BACKUP_ROOT_DIR, entry.name);
            const parsedDate = parseBackupFolderDate(entry.name);
            let mtime = null;
            try {
                const stat = fs.statSync(fullPath);
                mtime = stat.mtime;
            } catch (err) {
                mtime = null;
            }
            return {
                name: entry.name,
                fullPath,
                date: parsedDate,
                mtime,
            };
        });
}

function getLatestBackupInfo() {
    const folders = listBackupFolders();
    if (!folders.length) return null;
    folders.sort((a, b) => {
        const dateA = a.date ? a.date.getTime() : (a.mtime ? a.mtime.getTime() : 0);
        const dateB = b.date ? b.date.getTime() : (b.mtime ? b.mtime.getTime() : 0);
        return dateB - dateA;
    });
    return folders[0];
}

function pruneOldBackups(maxCount) {
    const limit = Number.isFinite(maxCount) ? maxCount : 10;
    const folders = listBackupFolders();
    if (folders.length <= limit) return;
    folders.sort((a, b) => {
        const dateA = a.date ? a.date.getTime() : (a.mtime ? a.mtime.getTime() : 0);
        const dateB = b.date ? b.date.getTime() : (b.mtime ? b.mtime.getTime() : 0);
        return dateA - dateB;
    });
    const toDelete = folders.slice(0, Math.max(0, folders.length - limit));
    toDelete.forEach((entry) => {
        try {
            fs.rmSync(entry.fullPath, { recursive: true, force: true });
        } catch (err) {
            console.error("Errore rimozione backup:", entry.fullPath, err);
        }
    });
}

function formatRange(request) {
    if (!request) return "";
    if (request.allDay) {
        if (request.start === request.end || !request.end) {
            return `Giornata intera (${request.start})`;
        }
        return `Giornata intera (${request.start} - ${request.end})`;
    }
    if (request.start && request.end) {
        return `${request.start} - ${request.end}`;
    }
    return request.start || "";
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
        lines.push(`${formatDateTime(request.start)} - ${formatDateTime(request.end)}`);
    }
    if (request.approvedBy) {
        if (request.type === "mutua") {
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

function showLoginRequired() {
    showInfoModal(UI_TEXTS.adminLoginTitle, UI_TEXTS.adminLoginRequired, { showLogin: true });
}

function requireAdminAccess(action) {
    if (isAdminLoggedIn()) {
        if (typeof action === "function") action();
        return;
    }
    pendingAdminAction = typeof action === "function" ? action : null;
    showLoginRequired();
}

function consumePendingAdminAction() {
    const action = pendingAdminAction;
    pendingAdminAction = null;
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
    const assigneesModal = document.getElementById("fp-assignees-modal");
    if (assigneesModal) hideModal(assigneesModal);
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
    loadData,
    renderAll,
    autoRefreshMs: AUTO_REFRESH_MS,
});

function insertApprovedRequest(request, admin, options = {}) {
    if (!request) return;
    const { balanceHours = null } = options;
    const updated = syncData((payload) => {
        payload.requests = payload.requests || [];
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
        payload.requests.push(next);
        return payload;
    });
    renderAll(updated);
    return updated;
}

function handleMutuaCreate(admin, request) {
    const updated = insertApprovedRequest(request, admin, { balanceHours: 0 });
    const message = document.getElementById("fp-form-message");
    setMessage(message, UI_TEXTS.mutuaInserted, false);
    if (requestFormUi && typeof requestFormUi.resetNewRequestForm === "function") {
        requestFormUi.resetNewRequestForm();
    }
    return updated;
}

function handleRetribuitoCreate(admin, request) {
    const updated = insertApprovedRequest(request, admin, { balanceHours: 0 });
    const message = document.getElementById("fp-form-message");
    setMessage(message, UI_TEXTS.retribuitoInserted, false);
    if (requestFormUi && typeof requestFormUi.resetNewRequestForm === "function") {
        requestFormUi.resetNewRequestForm();
    }
    return updated;
}

function handleSpecialeCreate(admin, request) {
    const updated = insertApprovedRequest(request, admin);
    const message = document.getElementById("fp-form-message");
    setMessage(message, UI_TEXTS.requestSent, false);
    if (requestFormUi && typeof requestFormUi.resetNewRequestForm === "function") {
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
    isAdminRequiredForAction: (action) => {
        const type = action?.type || "";
        if (type === "mutua-create") return isAdminRequiredForCreate("mutua");
        if (type === "retribuito-create" || type === "giustificato-create") return isAdminRequiredForCreate("retribuito");
        if (type === "speciale-create") return isAdminRequiredForCreate("speciale");
        if (type === "holiday-create" || type === "holiday-remove" || type === "holiday-update") return isAdminRequiredForDaysAccess();
        if (type === "closure-create" || type === "closure-remove" || type === "closure-update") return isAdminRequiredForDaysAccess();
        if (type === "export") return isAdminRequiredForExport();
        if (type === "manage-access" || type === "assignees-access") return isAdminRequiredForManageAccess();
        if (type === "days-access") return isAdminRequiredForDaysAccess();
        return true;
    },
    isHashingAvailable,
    loadAdminCredentials,
    verifyAdminPassword,
    loadData,
    syncData,
    renderAll,
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
            assigneesUi.openAssigneesModal();
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
            const overtimeToggle = document.getElementById("fp-filter-overtime");
            if (overtimeToggle) overtimeToggle.checked = true;
            renderer.renderCalendar(cachedData);
            return;
        }
        if (filter === "mutua") {
            calendarFilters.mutua = true;
            filterUnlocked.mutua = true;
            const mutuaToggle = document.getElementById("fp-filter-mutua");
            if (mutuaToggle) mutuaToggle.checked = true;
            renderer.renderCalendar(cachedData);
            return;
        }
        if (filter === "speciale") {
            calendarFilters.speciale = true;
            filterUnlocked.speciale = true;
            const specialeToggle = document.getElementById("fp-filter-speciale");
            if (specialeToggle) specialeToggle.checked = true;
            renderer.renderCalendar(cachedData);
            return;
        }
        if (filter === "retribuito") {
            calendarFilters.retribuito = true;
            filterUnlocked.retribuito = true;
            const retribuitoToggle = document.getElementById("fp-filter-retribuito");
            if (retribuitoToggle) retribuitoToggle.checked = true;
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
        const handled = consumePendingAdminAction();
        if (!handled) {
            showInfoModal(UI_TEXTS.adminLoginTitle, UI_TEXTS.adminLoginSuccess(admin?.name || ""), {
                showLogin: false,
            });
        }
    },
    onMutuaCreate: (admin, request) => handleMutuaCreate(admin, request),
    onRetribuitoCreate: (admin, request) => handleRetribuitoCreate(admin, request),
    onSpecialeCreate: (admin, request) => handleSpecialeCreate(admin, request),
    onHolidayCreate: (_admin, dates, name) => {
        if (!Array.isArray(dates) || !dates.length) return;
        const updated = syncData((payload) => {
            const existing = Array.isArray(payload.holidays) ? payload.holidays.slice() : [];
            const map = new Map();
            existing.forEach((item) => {
                if (typeof item === "string") {
                    map.set(item, { date: item, name: "" });
                } else if (item && typeof item.date === "string") {
                    map.set(item.date, { date: item.date, name: item.name || "" });
                }
            });
            let added = 0;
            dates.forEach((date) => {
                if (!map.has(date)) {
                    map.set(date, { date, name: name || "" });
                    added += 1;
                }
            });
            payload.holidays = Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
            payload.holidaysAdded = added;
            return payload;
        });
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
    onHolidayRemove: (_admin, date) => {
        if (!date) return;
        const updated = syncData((payload) => {
            const existing = Array.isArray(payload.holidays) ? payload.holidays.slice() : [];
            payload.holidays = existing.filter((item) => (typeof item === "string" ? item : item?.date) !== date);
            return payload;
        });
        holidaysUi.renderHolidayList(updated);
        setMessage(document.getElementById("fp-holidays-message"), UI_TEXTS.holidayRemoved, false);
        renderAll(updated);
    },
    onHolidayUpdate: (_admin, date, nextDate, nextName) => {
        if (!date || !nextDate) return;
        const updated = syncData((payload) => {
            const existing = Array.isArray(payload.holidays) ? payload.holidays.slice() : [];
            const normalized = existing.map((item) => {
                if (typeof item === "string") return { date: item, name: "" };
                if (item && typeof item.date === "string") return { date: item.date, name: item.name || "" };
                return null;
            }).filter(Boolean);
            const hasConflict = normalized.some((item) => item.date === nextDate && item.date !== date);
            if (hasConflict) {
                payload.holidaysUpdated = false;
                return payload;
            }
            payload.holidays = normalized.map((item) => {
                if (item.date !== date) return item;
                return { date: nextDate, name: nextName || "" };
            });
            payload.holidaysUpdated = true;
            return payload;
        });
        holidaysUi.renderHolidayList(updated);
        if (updated.holidaysUpdated) {
            setMessage(document.getElementById("fp-holidays-message"), UI_TEXTS.holidayUpdated, false);
        } else {
            setMessage(document.getElementById("fp-holidays-message"), UI_TEXTS.holidayAlreadyExists, true);
        }
        delete updated.holidaysUpdated;
        renderAll(updated);
    },
    onClosureCreate: (_admin, entry) => {
        if (!entry || !entry.start) return;
        const updated = syncData((payload) => {
            const existing = Array.isArray(payload.closures) ? payload.closures.slice() : [];
            const key = `${entry.start}|${entry.end || entry.start}`;
            const map = new Map();
            existing.forEach((item) => {
                if (!item) return;
                const start = typeof item.start === "string" ? item.start : "";
                const end = typeof item.end === "string" ? item.end : start;
                if (!start) return;
                map.set(`${start}|${end || start}`, { start, end: end || start, name: item.name || "" });
            });
            if (!map.has(key)) {
                map.set(key, { start: entry.start, end: entry.end || entry.start, name: entry.name || "" });
                payload.closureAdded = true;
            } else {
                payload.closureAdded = false;
            }
            payload.closures = Array.from(map.values()).sort((a, b) => a.start.localeCompare(b.start));
            return payload;
        });
        closuresUi.renderClosureList(updated, { containerId: "fp-closures-future-list", futureOnly: true });
        const message = document.getElementById("fp-closures-message");
        if (updated.closureAdded) {
            setMessage(message, UI_TEXTS.closureAdded, false);
        } else {
            setMessage(message, UI_TEXTS.closureAlreadyExists, true);
        }
        delete updated.closureAdded;
        renderAll(updated);
    },
    onClosureRemove: (_admin, entry) => {
        if (!entry) return;
        const key = `${entry.start}|${entry.end || entry.start}`;
        const updated = syncData((payload) => {
            const existing = Array.isArray(payload.closures) ? payload.closures.slice() : [];
            payload.closures = existing.filter((item) => {
                if (!item) return false;
                const start = typeof item.start === "string" ? item.start : "";
                const end = typeof item.end === "string" ? item.end : start;
                return `${start}|${end || start}` !== key;
            });
            return payload;
        });
        closuresUi.renderClosureList(updated, { containerId: "fp-closures-future-list", futureOnly: true });
        setMessage(document.getElementById("fp-closures-message"), UI_TEXTS.closureRemoved, false);
        renderAll(updated);
    },
    onClosureUpdate: (_admin, entry, next) => {
        if (!entry || !entry.start || !next || !next.start) return;
        const key = `${entry.start}|${entry.end || entry.start}`;
        const nextKey = `${next.start}|${next.end || next.start}`;
        const updated = syncData((payload) => {
            const existing = Array.isArray(payload.closures) ? payload.closures.slice() : [];
            const normalized = existing.map((item) => {
                if (!item) return null;
                const start = typeof item.start === "string" ? item.start : "";
                const end = typeof item.end === "string" ? item.end : start;
                if (!start) return null;
                return { start, end: end || start, name: item.name || "" };
            }).filter(Boolean);
            const hasConflict = normalized.some((item) => `${item.start}|${item.end}` === nextKey && `${item.start}|${item.end}` !== key);
            if (hasConflict) {
                payload.closureUpdated = false;
                return payload;
            }
            payload.closures = normalized.map((item) => {
                if (`${item.start}|${item.end}` !== key) return item;
                return { start: next.start, end: next.end || next.start, name: next.name || "" };
            });
            payload.closureUpdated = true;
            return payload;
        });
        closuresUi.renderClosureList(updated, { containerId: "fp-closures-future-list", futureOnly: true });
        if (updated.closureUpdated) {
            setMessage(document.getElementById("fp-closures-message"), UI_TEXTS.closureUpdated, false);
        } else {
            setMessage(document.getElementById("fp-closures-message"), UI_TEXTS.closureAlreadyExists, true);
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
    requireDaysAccess: (action) => requireAccess(isAdminRequiredForDaysAccess(), action),
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
    requireDaysAccess: (action) => requireAccess(isAdminRequiredForDaysAccess(), action),
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
    requireEditAccess: (action) => requireAccess(isAdminRequiredForEditApproved(), action),
    requireDeleteAccess: (action) => requireAccess(isAdminRequiredForDeleteApproved(), action),
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
    verifyAdminPassword,
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
openAdminModalHandler = adminUi.openAdminModal;
openPasswordModalHandler = approvalUi.openPasswordModal;

function openInitialSetupWizard() {
    const setupModal = document.getElementById("fp-setup-modal");
    if (!setupModal) {
        showDialog("info", UI_TEXTS.setupAdminTitle, UI_TEXTS.setupAdminMessage);
        adminUi.openAdminAddModal();
        return;
    }
    const alreadyInit = setupModal.dataset.fpSetupInit === "1";

    const intro = document.getElementById("fp-setup-intro");
    const pathLabel = document.getElementById("fp-setup-path");
    const noteLabel = document.getElementById("fp-setup-note");
    const mailOpen = document.getElementById("fp-setup-mail-open");
    const mailSkip = document.getElementById("fp-setup-mail-skip");
    const mailSection = document.getElementById("fp-setup-mail-section");
    const mailSave = document.getElementById("fp-mail-save");
    const mailTest = document.getElementById("fp-mail-test-send");
    const mailMessage = document.getElementById("fp-setup-mail-message");
    const continueBtn = document.getElementById("fp-setup-continue");

    if (intro) intro.textContent = UI_TEXTS.setupWizardMessage || UI_TEXTS.setupAdminMessage;
    if (pathLabel) pathLabel.textContent = BASE_DIR || path.dirname(REQUESTS_PATH);
    if (noteLabel) noteLabel.textContent = UI_TEXTS.setupPathNote || "";

    if (alreadyInit) {
        showModal(setupModal);
        return;
    }

    const toggleMailSection = (show) => {
        if (!mailSection) return;
        mailSection.classList.toggle("is-hidden", !show);
    };

    const getMailFormData = () => ({
        host: document.getElementById("fp-mail-host")?.value || "",
        port: document.getElementById("fp-mail-port")?.value || "",
        secure: !!document.getElementById("fp-mail-secure")?.checked,
        user: document.getElementById("fp-mail-user")?.value || "",
        pass: document.getElementById("fp-mail-pass")?.value || "",
        from: document.getElementById("fp-mail-from")?.value || "",
    });

    const getTestEmail = () => document.getElementById("fp-mail-test")?.value || "";

    const setMailMessage = (text, isError) => {
        if (!mailMessage) return;
        setMessage(mailMessage, text, isError);
    };

    const proceedToAdmin = () => {
        hideModal(setupModal);
        adminUi.openAdminAddModal();
    };

    if (mailOpen) {
        mailOpen.addEventListener("click", () => {
            toggleMailSection(true);
        });
    }

    if (mailSkip) {
        mailSkip.addEventListener("click", () => {
            toggleMailSection(false);
        });
    }

    if (mailTest) {
        mailTest.addEventListener("click", async () => {
            const payload = getMailFormData();
            const testEmail = getTestEmail();
            if (!isMailerAvailable()) {
                setMailMessage(UI_TEXTS.mailModuleMissing, true);
                return;
            }
            try {
                setMailMessage("", false);
                await sendTestEmail(payload, testEmail);
                setMailMessage(UI_TEXTS.mailTestSent, false);
            } catch (err) {
                setMailMessage(UI_TEXTS.mailTestError(err.message || String(err)), true);
            }
        });
    }

    if (mailSave) {
        mailSave.addEventListener("click", () => {
            const payload = getMailFormData();
            try {
                setMailMessage("", false);
                saveMailConfig(payload);
                setMailMessage(UI_TEXTS.mailConfigSaved, false);
                proceedToAdmin();
            } catch (err) {
                setMailMessage(UI_TEXTS.mailConfigError(err.message || String(err)), true);
            }
        });
    }

    if (continueBtn) {
        continueBtn.addEventListener("click", proceedToAdmin);
    }

    setupModal.dataset.fpSetupInit = "1";
    showModal(setupModal);
}

const assigneesUi = createAssigneesModal({
    document,
    showModal,
    hideModal,
    renderDepartmentList,
    renderEmployeesList,
    renderDepartmentSelect,
    populateEmployees,
    saveAssigneeOptions,
    syncBalancesAfterAssignees,
    getAssigneeGroups: () => assigneeGroups,
    setAssigneeGroups: (next) => {
        assigneeGroups = next;
    },
    setAssigneeOptions: (next) => {
        assigneeOptions = next;
    },
    setEditingDepartment: (next) => {
        editingDepartment = next;
    },
    setEditingEmployee: (next) => {
        editingEmployee = next;
    },
    onOpenAttempt: () => {
        if (!isAdminRequiredForManageAccess()) {
            assigneesUi.openAssigneesModal();
            return;
        }
        requireAdminAccess(() => {
            if (assigneesUnlocked || manageUnlocked) {
                assigneesUi.openAssigneesModal();
                return;
            }
            assigneesOpenPending = true;
            approvalUi.openPasswordModal({
                type: "assignees-access",
                id: "assignees-access",
                title: "Gestione dipendenti",
                description: UI_TEXTS.adminAccessDescription,
            });
        });
    },
});

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
    loadAccessConfig: () => loadAccessConfig(),
    saveAccessConfig: (config) => persistAccessConfig(config),
    normalizeAccessConfig,
    onConfigUpdated: (config) => {
        setAccessConfig(config);
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
    onDirectRetribuitoCreate: (request) => handleRetribuitoCreate(null, request),
    onDirectSpecialeCreate: (request) => handleSpecialeCreate(null, request),
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

function isAdminFileMissingOrEmpty() {
    try {
        if (!ADMINS_PATH || !fs.existsSync(ADMINS_PATH)) return true;
        const raw = fs.readFileSync(ADMINS_PATH, "utf8");
        if (!raw) return true;
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
            return !parsed.some((item) => item && item.name && (item.password || item.passwordHash));
        }
        if (parsed && Array.isArray(parsed.admins)) {
            return !parsed.admins.some((item) => item && item.name && (item.password || item.passwordHash));
        }
        if (parsed && typeof parsed === "object") {
            return Object.keys(parsed).length === 0;
        }
        return true;
    } catch (err) {
        console.error("Errore lettura file admin:", err);
        return true;
    }
}

function buildRequestFromForm(prefix, requestId, allowPast = false) {
    const department = getFieldValue(`${prefix}-department`);
    const employee = getFieldValue(`${prefix}-employee`);
    const type = getFieldValue(`${prefix}-type`) || "ferie";
    const allDay = isChecked(`${prefix}-all-day`);
    const startDate = getFieldValue(`${prefix}-start-date`);
    const endDate = getFieldValue(`${prefix}-end-date`);
    const startTime = getFieldValue(`${prefix}-start-time`);
    const endTime = getFieldValue(`${prefix}-end-time`);
    const note = getFieldValue(`${prefix}-note`).trim();

    if (!employee || !startDate || !endDate) {
        return { error: UI_TEXTS.requestMissingFields };
    }

    const today = new Date();
    const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const maxYear = today.getFullYear() + 2;
    const parseStrictDate = (value) => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
        const date = new Date(`${value}T00:00:00`);
        if (Number.isNaN(date.getTime())) return null;
        return date;
    };
    const startParsed = parseStrictDate(startDate);
    const endParsed = parseStrictDate(endDate);
    if (!startParsed || !endParsed) {
        return { error: UI_TEXTS.requestInvalidDateFormat };
    }
    if (startParsed.getFullYear() > maxYear || endParsed.getFullYear() > maxYear) {
        return { error: `L'anno non puo superare ${maxYear}.` };
    }
    const allowPastDates = allowPast || type === "mutua";
    if (!allowPastDates) {
        if (startParsed < todayMidnight || endParsed < todayMidnight) {
            return { error: UI_TEXTS.requestNoPastDates };
        }
    }
    if (endParsed < startParsed) {
        return { error: UI_TEXTS.requestEndBeforeStart };
    }
    if (!allDay && startDate !== endDate) {
        return { error: UI_TEXTS.requestMultiDayAllDayOnly };
    }

    if (!allDay) {
        if (!startTime || !endTime) {
            return { error: UI_TEXTS.requestMissingTimes };
        }
        const startValue = `${startDate}T${startTime}`;
        const endValue = `${endDate}T${endTime}`;
        if (endValue < startValue) {
            return { error: UI_TEXTS.requestEndTimeBeforeStart };
        }
        return {
            request: {
                id: requestId || `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
                employee,
                department,
                type,
                allDay: false,
                start: startValue,
                end: endValue,
                note,
                status: requestId ? "approved" : "pending",
                createdAt: requestId ? null : new Date().toISOString(),
            }
        };
    }

    return {
        request: {
            id: requestId || `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
            employee,
            department,
            type,
            allDay: true,
            start: startDate,
            end: endDate,
            note,
            status: requestId ? "approved" : "pending",
            createdAt: requestId ? null : new Date().toISOString(),
        }
    };
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
        cleanup();
    };
    const onLogin = () => {
        cleanup();
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
    const exists = Array.from(select.options).some((opt) => opt.value === value);
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
    const groups = assigneeGroups && Object.keys(assigneeGroups).length ? assigneeGroups : loadAssigneeOptions().groups;
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
        const employees = Array.isArray(groups[selected]) ? [...groups[selected]].sort((a, b) => a.localeCompare(b)) : [];
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

function renderDepartmentSelect() {
    const select = document.getElementById("fp-employee-department");
    if (!select) return;
    select.innerHTML = "";
    Object.keys(assigneeGroups).sort((a, b) => a.localeCompare(b)).forEach((group) => {
        const option = document.createElement("option");
        option.value = group;
        option.textContent = group;
        select.appendChild(option);
    });
}

function renderDepartmentList() {
    const list = document.getElementById("fp-departments-list");
    if (!list) return;
    list.innerHTML = "";
    const groups = Object.keys(assigneeGroups).sort((a, b) => a.localeCompare(b));
    if (!groups.length) {
        list.textContent = UI_TEXTS.emptyDepartment;
        return;
    }
    groups.forEach((group) => {
        const row = document.createElement("div");
        row.className = "fp-assignees-row";

        const actions = document.createElement("div");
        actions.className = "fp-assignees-row__actions";

        if (editingDepartment === group) {
            const input = document.createElement("input");
            input.className = "fp-field__input";
            input.value = group;
            input.addEventListener("keydown", (event) => {
                if (event.key === "Enter") {
                    event.preventDefault();
                    save.click();
                }
            });

            const save = document.createElement("button");
            save.type = "button";
            save.className = "fp-assignees-link";
            save.textContent = "Salva";
            save.addEventListener("click", () => {
                const trimmed = input.value.trim();
                if (!trimmed || trimmed === group) {
                    editingDepartment = null;
                    renderDepartmentList();
                    return;
                }
                if (assigneeGroups[trimmed]) return;
                assigneeGroups[trimmed] = assigneeGroups[group];
                delete assigneeGroups[group];
                if (editingEmployee && editingEmployee.group === group) {
                    editingEmployee = { ...editingEmployee, group: trimmed };
                }
                assigneeOptions = Object.values(assigneeGroups).flat();
                saveAssigneeOptions(assigneeGroups);
                syncBalancesAfterAssignees();
                editingDepartment = null;
                renderDepartmentList();
                renderEmployeesList();
                renderDepartmentSelect();
                populateEmployees();
            });

            const cancel = document.createElement("button");
            cancel.type = "button";
            cancel.className = "fp-assignees-link fp-assignees-link--danger";
            cancel.textContent = "Annulla";
            cancel.addEventListener("click", () => {
                editingDepartment = null;
                renderDepartmentList();
            });

            row.appendChild(input);
            actions.appendChild(save);
            actions.appendChild(cancel);
        } else {
            const label = document.createElement("div");
            label.textContent = group;

            const edit = document.createElement("button");
            edit.type = "button";
            edit.className = "fp-assignees-link";
            edit.textContent = "Modifica";
            edit.addEventListener("click", () => {
                editingDepartment = group;
                renderDepartmentList();
            });

            const remove = document.createElement("button");
            remove.type = "button";
            remove.className = "fp-assignees-link fp-assignees-link--danger";
            remove.textContent = "Rimuovi";
            remove.addEventListener("click", () => {
                if (!window.confirm(`Rimuovere il reparto \"${group}\"?`)) return;
                delete assigneeGroups[group];
                assigneeOptions = Object.values(assigneeGroups).flat();
                saveAssigneeOptions(assigneeGroups);
                syncBalancesAfterAssignees();
                renderDepartmentList();
                renderDepartmentSelect();
                populateEmployees();
            });

            row.appendChild(label);
            actions.appendChild(edit);
            actions.appendChild(remove);
        }

        row.appendChild(actions);
        list.appendChild(row);
    });
}

function renderEmployeesList() {
    const list = document.getElementById("fp-employees-list");
    if (!list) return;
    list.innerHTML = "";
    const groups = Object.keys(assigneeGroups).sort((a, b) => a.localeCompare(b));
    const employees = [];
    groups.forEach((group) => {
        (assigneeGroups[group] || []).forEach((name) => {
            employees.push({ group, name });
        });
    });
    if (!employees.length) {
        list.textContent = UI_TEXTS.emptyEmployee;
        return;
    }
    employees.sort((a, b) => {
        const nameCompare = a.name.localeCompare(b.name);
        if (nameCompare !== 0) return nameCompare;
        return a.group.localeCompare(b.group);
    });
    employees.forEach((employee) => {
        const row = document.createElement("div");
        row.className = "fp-assignees-row";

        const actions = document.createElement("div");
        actions.className = "fp-assignees-row__actions";

        if (editingEmployee && editingEmployee.name === employee.name && editingEmployee.group === employee.group) {
            const select = document.createElement("select");
            select.className = "fp-field__input";
            Object.keys(assigneeGroups).sort((a, b) => a.localeCompare(b)).forEach((group) => {
                const option = document.createElement("option");
                option.value = group;
                option.textContent = group;
                if (group === employee.group) option.selected = true;
                select.appendChild(option);
            });

            const input = document.createElement("input");
            input.className = "fp-field__input";
            input.value = employee.name;
            input.addEventListener("keydown", (event) => {
                if (event.key === "Enter") {
                    event.preventDefault();
                    save.click();
                }
            });

            const save = document.createElement("button");
            save.type = "button";
            save.className = "fp-assignees-link";
            save.textContent = "Salva";
            save.addEventListener("click", () => {
                const trimmedName = input.value.trim();
                const trimmedGroup = select.value;
                if (!trimmedName || !trimmedGroup) return;
                assigneeGroups[employee.group] = (assigneeGroups[employee.group] || []).filter((n) => n !== employee.name);
                if (!assigneeGroups[trimmedGroup]) assigneeGroups[trimmedGroup] = [];
                assigneeGroups[trimmedGroup].push(trimmedName);
                assigneeGroups[trimmedGroup].sort((a, b) => a.localeCompare(b));
                if (assigneeGroups[employee.group].length === 0) delete assigneeGroups[employee.group];
                assigneeOptions = Object.values(assigneeGroups).flat();
                saveAssigneeOptions(assigneeGroups);
                syncBalancesAfterAssignees();
                editingEmployee = null;
                renderEmployeesList();
                renderDepartmentList();
                renderDepartmentSelect();
                populateEmployees();
            });

            const cancel = document.createElement("button");
            cancel.type = "button";
            cancel.className = "fp-assignees-link fp-assignees-link--danger";
            cancel.textContent = "Annulla";
            cancel.addEventListener("click", () => {
                editingEmployee = null;
                renderEmployeesList();
            });

            row.appendChild(select);
            row.appendChild(input);
            actions.appendChild(save);
            actions.appendChild(cancel);
        } else {
            const label = document.createElement("div");
            label.textContent = `${employee.name} (${employee.group})`;

            const edit = document.createElement("button");
            edit.type = "button";
            edit.className = "fp-assignees-link";
            edit.textContent = "Modifica";
            edit.addEventListener("click", () => {
                editingEmployee = { name: employee.name, group: employee.group };
                renderEmployeesList();
            });

            const remove = document.createElement("button");
            remove.type = "button";
            remove.className = "fp-assignees-link fp-assignees-link--danger";
            remove.textContent = "Rimuovi";
            remove.addEventListener("click", () => {
                if (!window.confirm(`Rimuovere \"${employee.name}\"?`)) return;
                assigneeGroups[employee.group] = (assigneeGroups[employee.group] || []).filter((n) => n !== employee.name);
                if (assigneeGroups[employee.group].length === 0) delete assigneeGroups[employee.group];
                assigneeOptions = Object.values(assigneeGroups).flat();
                saveAssigneeOptions(assigneeGroups);
                syncBalancesAfterAssignees();
                renderEmployeesList();
                renderDepartmentList();
                renderDepartmentSelect();
                populateEmployees();
            });

            row.appendChild(label);
            actions.appendChild(edit);
            actions.appendChild(remove);
        }

        row.appendChild(actions);
        list.appendChild(row);
    });
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

function init() {
    ipcRenderer.send("resize-normale");
    accessConfig = normalizeAccessConfig(loadAccessConfig());
    ensureAccessConfigFile();
    typeColors = loadColorSettings();
    applyTypeColors();
    applyTheme(loadThemeSetting());
    const assigneesData = loadAssigneeOptions();
    assigneeOptions = assigneesData.options;
    assigneeGroups = assigneesData.groups;
    populateEmployees();
    calendar = initCalendar({
        document,
        FullCalendar: window.FullCalendar,
        onEventSelect: (eventId) => {
            selectedEventId = eventId;
        },
        getRequestById: (eventId) => (cachedData.requests || []).find((req) => req.id === eventId),
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
        if (typeSelect.value === "mutua") {
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
    if (isAdminFileMissingOrEmpty()) {
        initialSetupActive = true;
        document.body.classList.add("fp-initial-setup");
        openInitialSetupWizard();
    }

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
                showInfoModal(UI_TEXTS.adminLoginTitle, UI_TEXTS.adminLogoffSuccess, { showLogin: false });
                return;
            }
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

    assigneesUi.initAssigneesModal();
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
                assigneesUi.openAssigneesModal();
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
    const exportRangeRadios = document.querySelectorAll("input[name='fp-export-range']");
    const backupOpen = document.getElementById("fp-backup-open");
    const backupClose = document.getElementById("fp-backup-close");
    const backupRun = document.getElementById("fp-backup-run");
    const backupRestore = document.getElementById("fp-backup-restore");
    const backupModal = document.getElementById("fp-backup-modal");
    const backupMessage = document.getElementById("fp-backup-message");

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
            await showDialog("error", UI_TEXTS.exportModuleMissingTitle, UI_TEXTS.exportModuleMissingDetail);
            return;
        }
        const rangeMode = document.querySelector("input[name='fp-export-range']:checked")?.value || "all";
        const startDate = exportUi.parseDateInput(document.getElementById("fp-export-start")?.value || "");
        const endDate = exportUi.parseDateInput(document.getElementById("fp-export-end")?.value || "");
        if (rangeMode === "custom" && (!startDate || !endDate || endDate < startDate)) {
            setMessage(document.getElementById("fp-export-message"), UI_TEXTS.exportInvalidRange, true);
            return;
        }
        const includeFerie = !!document.getElementById("fp-export-ferie")?.checked;
        const includePermessi = !!document.getElementById("fp-export-permessi")?.checked;
        const includeStraordinari = !!document.getElementById("fp-export-straordinari")?.checked;
        const includeMutua = !!document.getElementById("fp-export-mutua")?.checked;
        const includeSpeciale = !!document.getElementById("fp-export-speciale")?.checked;
        const includeRetribuito = !!document.getElementById("fp-export-retribuito")?.checked;
        if (!includeFerie && !includePermessi && !includeStraordinari && !includeMutua && !includeSpeciale && !includeRetribuito) {
            setMessage(document.getElementById("fp-export-message"), UI_TEXTS.exportSelectType, true);
            return;
        }
        const departments = exportUi.getExportSelectedDepartments();

        const payload = loadData();
        const raw = payload.requests || [];
        const approved = raw.filter((req) => req.status === "approved");
        const filtered = approved.filter((req) => {
            if (req.type === "ferie" && !includeFerie) return false;
            if (req.type === "permesso" && !includePermessi) return false;
            if (req.type === "straordinari" && !includeStraordinari) return false;
            if (req.type === "mutua" && !includeMutua) return false;
            if (req.type === "speciale" && !includeSpeciale) return false;
            if (req.type === "retribuito" && !includeRetribuito) return false;
            if (departments.length && req.department && !departments.includes(req.department)) return false;
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
            setMessage(document.getElementById("fp-export-message"), UI_TEXTS.exportNoData, true);
            return;
        }

        const rows = buildExportRows(filtered, payload.holidays, payload.closures);
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(rows);
        const dateColumns = ["C", "D"];
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
            await showDialog("error", "Errore selezione file di destinazione.", err.message || String(err));
            return;
        }
        if (!outputPath) return;

        const dirOut = path.dirname(outputPath);
        if (!fs.existsSync(dirOut)) {
            fs.mkdirSync(dirOut, { recursive: true });
        }

        XLSX.writeFile(wb, outputPath, { cellDates: true });
        setMessage(document.getElementById("fp-export-message"), UI_TEXTS.exportSuccess, false);
    };

    const createBackup = async (options = {}) => {
        try {
            const isSilent = !!options.silent;
            if (!isSilent) {
                setMessage(backupMessage, "");
            }
            ensureDir(BACKUP_ROOT_DIR);
            const dateLabel = formatBackupDate(new Date());
            let targetDir = path.join(BACKUP_ROOT_DIR, dateLabel);
            let suffix = 1;
            while (fs.existsSync(targetDir)) {
                suffix += 1;
                targetDir = path.join(BACKUP_ROOT_DIR, `${dateLabel}-${suffix}`);
            }
            ensureDir(targetDir);
            copyDirectory(BACKUP_BASE_DIR, targetDir, {
                exclude: (name, parent) =>
                    parent === BACKUP_BASE_DIR && name.toLowerCase() === "backup aypi calendar",
            });
            pruneOldBackups(10);
            if (!isSilent) {
                setMessage(backupMessage, UI_TEXTS.backupCreateSuccess(targetDir), false);
            }
        } catch (err) {
            if (!options.silent) {
                setMessage(backupMessage, UI_TEXTS.backupCreateError(err.message || String(err)), true);
            }
        }
    };

    const restoreBackup = async () => {
        try {
            setMessage(backupMessage, "");
            const confirm = await showDialog(
                "warning",
                "Ripristino backup",
                UI_TEXTS.backupRestoreConfirm,
                ["Annulla", "Ripristina"]
            );
            if (!confirm || confirm.response !== 1) return;
            let folder;
            try {
                folder = await ipcRenderer.invoke("select-root-folder");
            } catch (err) {
                setMessage(backupMessage, UI_TEXTS.backupRestoreError(err.message || String(err)), true);
                return;
            }
            if (!folder) return;
            copyDirectory(folder, BACKUP_BASE_DIR, {
                exclude: (name) => name.toLowerCase() === "backup aypi calendar",
            });
            renderAll(loadData());
            pruneOldBackups(10);
            setMessage(backupMessage, UI_TEXTS.backupRestoreSuccess, false);
        } catch (err) {
            setMessage(backupMessage, UI_TEXTS.backupRestoreError(err.message || String(err)), true);
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
        try {
            const latest = getLatestBackupInfo();
            if (!latest) {
                createBackup({ silent: true });
                return;
            }
            const latestDate = latest.date || latest.mtime;
            if (!latestDate) {
                createBackup({ silent: true });
                return;
            }
            const now = new Date();
            const diffMs = now.getTime() - latestDate.getTime();
            const diffDays = diffMs / (24 * 60 * 60 * 1000);
            if (diffDays > 7) {
                createBackup({ silent: true });
            }
            pruneOldBackups(10);
        } catch (err) {
            console.error("Errore controllo backup:", err);
        }
    };

    pendingUi.closePendingPanel();

    const ferieToggle = document.getElementById("fp-filter-ferie");
    const permessoToggle = document.getElementById("fp-filter-permesso");
    const overtimeToggle = document.getElementById("fp-filter-overtime");
    const mutuaToggle = document.getElementById("fp-filter-mutua");
    const specialeToggle = document.getElementById("fp-filter-speciale");
    const retribuitoToggle = document.getElementById("fp-filter-retribuito");
    if (ferieToggle) ferieToggle.checked = true;
    if (permessoToggle) permessoToggle.checked = true;
    if (overtimeToggle) overtimeToggle.checked = false;
    if (mutuaToggle) mutuaToggle.checked = false;
    if (specialeToggle) specialeToggle.checked = false;
    if (retribuitoToggle) retribuitoToggle.checked = false;
    calendarFilters.ferie = true;
    calendarFilters.permesso = true;
    calendarFilters.overtime = false;
    calendarFilters.mutua = false;
    calendarFilters.speciale = false;
    calendarFilters.retribuito = false;
    const applyFerieFilter = () => {
        if (ferieToggle) {
            calendarFilters.ferie = !!ferieToggle.checked;
            renderer.renderCalendar(cachedData);
        }
    };
    const applyPermessoFilter = () => {
        if (permessoToggle) {
            calendarFilters.permesso = !!permessoToggle.checked;
            renderer.renderCalendar(cachedData);
        }
    };
    const requestFilterAccess = () => {};
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
                    renderer.renderCalendar(cachedData);
                });
                return;
            }
            calendarFilters[type] = nextChecked;
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
            const cell = event.target.closest("[data-date]");
            if (!cell) return;
            const date = cell.getAttribute("data-date");
            if (!date) return;
            const holidays = Array.isArray(cachedData.holidays) ? cachedData.holidays : [];
            const match = holidays.find((item) => (typeof item === "string" ? item : item?.date) === date);
            if (match) {
                event.preventDefault();
                requireAccess(isAdminRequiredForDaysAccess(), () => {
                    holidaysUi.openHolidaysListModal(date);
                });
                return;
            }
            const closures = Array.isArray(cachedData.closures) ? cachedData.closures : [];
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
        if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
            return;
        }
        if (!selectedEventId) return;
        requireAccess(isAdminRequiredForDeleteApproved(), () => {
            const targetId = selectedEventId;
            const snapshot = (cachedData.requests || []).find((req) => req.id === targetId);
            const typeLabel = snapshot ? getTypeLabel(snapshot.type) : "richiesta";
            const employeeLabel = snapshot?.employee ? ` di <strong>${escapeHtml(snapshot.employee)}</strong>` : "";
            const message = `Confermi l'eliminazione della <strong>${escapeHtml(typeLabel)}</strong>${employeeLabel}?`;
            openConfirmModal(message).then((ok) => {
                if (!ok) return;
                const updated = syncData((payload) => {
                    const target = (payload.requests || []).find((req) => req.id === targetId);
                    if (target && typeof applyBalanceForDeletion === "function") {
                        applyBalanceForDeletion(payload, target);
                    }
                    payload.requests = (payload.requests || []).filter((req) => req.id !== targetId);
                    return payload;
                });
                renderAll(updated);
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
            const target = event.target.closest(".fp-legend__item");
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
        if (!legendEditor || legendEditor.classList.contains("is-hidden")) return;
        if (event.target.closest("#fp-legend-editor")) return;
        if (event.target.closest(".fp-legend__item")) return;
        // no-op: keep editor open; close only via "Chiudi"
    });

    if (legendColorInput) {
        legendColorInput.addEventListener("input", () => {
            if (!legendEditingType) return;
            const next = normalizeHexColor(legendColorInput.value, getTypeColor(legendEditingType));
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
            const next = DEFAULT_TYPE_COLORS[legendEditingType] || getTypeColor(legendEditingType);
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
        showDialog("error", UI_TEXTS.initErrorTitle, err.message || String(err));
    }
});

const guideLocalPath = path.resolve(__dirname, "..", "..", "Guida", "index.html");
const guideLocalUrl = fs.existsSync(guideLocalPath) ? `${pathToFileURL(guideLocalPath).toString()}?embed=1` : "";

const guideUi = createGuideModal({
    document,
    showModal,
    hideModal,
    setMessage,
    guideUrl: GUIDE_URL || guideLocalUrl,
    guideSearchParam: GUIDE_SEARCH_PARAM,
    getTheme: () => loadThemeSetting(),
});

