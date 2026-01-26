const { ipcRenderer } = require("electron");
const fs = require("fs");
const path = require("path");

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

const { REQUESTS_PATH, HOLIDAYS_PATH, BALANCES_PATH } = bootRequire(path.join(fpBaseDir, "config", "paths"));
const {
    AUTO_REFRESH_MS,
    OTP_EXPIRY_MS,
    OTP_RESEND_MS,
    COLOR_STORAGE_KEY,
    THEME_STORAGE_KEY,
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
const { isMailerAvailable, getMailerError, sendOtpEmail } = bootRequire(path.join(fpBaseDir, "services", "otp-mail"));
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
const { createApprovalModal } = bootRequire(path.join(fpUiDir, "approval-modal"));
const { createEditModal } = bootRequire(path.join(fpUiDir, "edit-modal"));
const { createRequestForm } = bootRequire(path.join(fpUiDir, "request-form"));
const { createHolidaysModal } = bootRequire(path.join(fpUiDir, "holidays-modal"));
const { createPendingPanel } = bootRequire(path.join(fpUiDir, "pending-panel"));
const { createSummary } = bootRequire(path.join(fpUiDir, "summary"));
const { createRenderer } = bootRequire(path.join(fpUiDir, "rendering"));
const { createRefreshController } = bootRequire(path.join(fpBaseDir, "services", "refresh"));
const { formatDate, formatDateTime, formatDateParts } = bootRequire(path.join(fpBaseDir, "utils", "date-format"));
const { createRangeLine } = bootRequire(path.join(fpUiDir, "range-line"));
const { getRequestDates } = bootRequire(path.join(fpBaseDir, "utils", "requests"));
const { buildExportRows } = bootRequire(path.join(fpBaseDir, "utils", "export"));
const { getTypeLabel } = bootRequire(path.join(fpBaseDir, "utils", "labels"));
const { UI_TEXTS } = bootRequire(path.join(fpBaseDir, "utils", "ui-texts"));

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
let lastNonListViewType = "dayGridMonth";
let handlingListRedirect = false;
let assigneeOptions = [];
let assigneeGroups = {};
let editingDepartment = null;
let editingEmployee = null;
let typeColors = { ...DEFAULT_TYPE_COLORS };
let cachedData = { requests: [] };
let calendarFilters = {
    leave: true,
    overtime: true,
    mutua: true,
};
let editingAdminName = "";
let adminCache = [];
let adminEditingIndex = -1;
let passwordFailCount = 0;
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
        return {
            ferie: normalizeHexColor(parsed.ferie, DEFAULT_TYPE_COLORS.ferie),
            permesso: normalizeHexColor(parsed.permesso, DEFAULT_TYPE_COLORS.permesso),
            straordinari: normalizeHexColor(parsed.straordinari, DEFAULT_TYPE_COLORS.straordinari),
            mutua: normalizeHexColor(parsed.mutua, DEFAULT_TYPE_COLORS.mutua),
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

function applyTypeColors() {
    const ferieDot = document.querySelector(".fp-legend__dot--ferie");
    const permessoDot = document.querySelector(".fp-legend__dot--permesso");
    const straordinariDot = document.querySelector(".fp-legend__dot--straordinari");
    const mutuaDot = document.querySelector(".fp-legend__dot--mutua");
    if (ferieDot) ferieDot.style.background = getTypeColor("ferie");
    if (permessoDot) permessoDot.style.background = getTypeColor("permesso");
    if (straordinariDot) straordinariDot.style.background = getTypeColor("straordinari");
    if (mutuaDot) mutuaDot.style.background = getTypeColor("mutua");
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
}

function loadData() {
    const parsed = loadPayload();
    const normalized = normalizeBalances(parsed, assigneeGroups);
    const deductions = applyMissingRequestDeductions(normalized.payload);
    const payload = deductions.payload;
    const changed = normalized.changed || deductions.changed;
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
    saveData(deductions.payload);
    return deductions.payload;
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

const summaryUi = createSummary({ document });

const pendingUi = createPendingPanel({
    document,
    createRangeLine,
    syncData,
    renderAll,
    openPasswordModal: (action) => {
        if (openPasswordModalHandler) openPasswordModalHandler(action);
    },
    applyBalanceForApproval,
    getBalanceImpact,
    loadData,
    confirmNegativeBalance,
    getPendingUnlocked: () => pendingUnlocked,
    getPendingUnlockedBy: () => pendingUnlockedBy,
    getPendingPanelOpen: () => pendingPanelOpen,
    setPendingPanelOpen: (next) => {
        pendingPanelOpen = next;
    },
    updatePendingBadge: (count) => summaryUi.updatePendingBadge(count),
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
        return calendarFilters.leave;
    },
});

const refreshUi = createRefreshController({
    loadData,
    renderAll,
    autoRefreshMs: AUTO_REFRESH_MS,
});

const approvalUi = createApprovalModal({
    document,
    showModal,
    hideModal,
    showDialog,
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
    onMutuaCreate: (admin, request) => {
        if (!request) return;
        const updated = syncData((payload) => {
            payload.requests = payload.requests || [];
            const next = {
                ...request,
                status: "approved",
                approvedAt: new Date().toISOString(),
                approvedBy: admin?.name || UI_TEXTS.defaultAdminLabel,
                balanceHours: 0,
                balanceAppliedAt: new Date().toISOString(),
            };
            payload.requests.push(next);
            return payload;
        });
        const message = document.getElementById("fp-form-message");
        setMessage(message, UI_TEXTS.mutuaInserted, false);
        if (requestFormUi && typeof requestFormUi.resetNewRequestForm === "function") {
            requestFormUi.resetNewRequestForm();
        }
        renderAll(updated);
    },
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
            dates.forEach((date, index) => {
                if (!map.has(date)) {
                    map.set(date, { date, name: index === 0 ? (name || "") : "" });
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
    syncData,
    renderAll,
    openPasswordModal: (action) => approvalUi.openPasswordModal(action),
    getEditingRequestId: () => editingRequestId,
    setEditingRequestId: (next) => {
        editingRequestId = next;
    },
    getEditingAdminName: () => editingAdminName,
    setEditingAdminName: (next) => {
        editingAdminName = next;
    },
    applyBalanceForUpdate,
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
});
openAdminModalHandler = adminUi.openAdminModal;
openPasswordModalHandler = approvalUi.openPasswordModal;

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
    getTypeColors: () => typeColors,
    setTypeColors: (next) => {
        typeColors = next;
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

function init() {
    ipcRenderer.send("resize-normale");
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

    adminUi.initAdminModals();

    const approveRecover = document.getElementById("fp-approve-recover");
    approvalUi.initApprovalModal();
    if (approveRecover) {
        approveRecover.addEventListener("click", () => {
            approvalUi.closeApprovalModal();
            otpUi.openOtpModal();
        });
    }

    otpUi.initOtpModals();

    editUi.initEditModal();

    pendingUi.initPendingPanel();

    assigneesUi.initAssigneesModal();
    holidaysUi.initHolidaysModal();

    const hoursManage = document.getElementById("fp-hours-manage");
    if (hoursManage) {
        hoursManage.addEventListener("click", () => {
            approvalUi.openPasswordModal({
                type: "hours-access",
                id: "hours-access",
                title: "Gestione ore",
                description: UI_TEXTS.adminAccessDescription,
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

    if (exportOpen) {
        exportOpen.addEventListener("click", () => {
            exportUi.openExportModal();
        });
    }

    if (exportClose) {
        exportClose.addEventListener("click", () => {
            exportUi.closeExportModal();
        });
    }

    if (exportModal) {
        exportModal.addEventListener("click", (event) => {
            if (event.target === exportModal) exportUi.closeExportModal();
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

    if (exportRun) {
        exportRun.addEventListener("click", async () => {
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
            if (!includeFerie && !includePermessi && !includeStraordinari && !includeMutua) {
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

            const rows = buildExportRows(filtered, payload.holidays);
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

            const outputPath = await ipcRenderer.invoke("select-output-file", {
                defaultName: "ferie_permessi.xlsx",
                filters: [{ name: "File Excel", extensions: ["xlsx"] }],
            });
            if (!outputPath) return;

            const dirOut = path.dirname(outputPath);
            if (!fs.existsSync(dirOut)) {
                fs.mkdirSync(dirOut, { recursive: true });
            }

            XLSX.writeFile(wb, outputPath, { cellDates: true });
            setMessage(document.getElementById("fp-export-message"), UI_TEXTS.exportSuccess, false);
        });
    }

    pendingUi.closePendingPanel();

    const leaveToggle = document.getElementById("fp-filter-leave");
    const overtimeToggle = document.getElementById("fp-filter-overtime");
    const mutuaToggle = document.getElementById("fp-filter-mutua");
    const applyCalendarFilters = () => {
        if (leaveToggle) {
            calendarFilters.leave = !!leaveToggle.checked;
        }
        if (overtimeToggle) {
            calendarFilters.overtime = !!overtimeToggle.checked;
        }
        if (mutuaToggle) {
            calendarFilters.mutua = !!mutuaToggle.checked;
        }
               renderer.renderCalendar(cachedData);
    };
    if (leaveToggle) {
        leaveToggle.addEventListener("change", applyCalendarFilters);
    }
    if (overtimeToggle) {
        overtimeToggle.addEventListener("change", applyCalendarFilters);
    }
    if (mutuaToggle) {
        mutuaToggle.addEventListener("change", applyCalendarFilters);
    }

    const calendarRoot = document.getElementById("fp-calendar");
    if (calendarRoot) {
        calendarRoot.addEventListener("contextmenu", (event) => {
            const cell = event.target.closest("[data-date]");
            if (!cell) return;
            const date = cell.getAttribute("data-date");
            if (!date) return;
            const holidays = Array.isArray(cachedData.holidays) ? cachedData.holidays : [];
            const match = holidays.find((item) => (typeof item === "string" ? item : item?.date) === date);
            if (!match) return;
            event.preventDefault();
            holidaysUi.openHolidaysListModal(date);
        });
    }

    document.addEventListener("keydown", (event) => {
        if (event.key !== "Delete") return;
        const target = event.target;
        if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
            return;
        }
        if (!selectedEventId) return;
        approvalUi.openPasswordModal({
            type: "delete",
            id: selectedEventId,
            title: "Elimina richiesta",
            description: UI_TEXTS.requestDeletePasswordDescription,
        });
    });

    refreshUi.refreshData();
    refreshUi.scheduleAutoRefresh();

}

document.addEventListener("DOMContentLoaded", () => {
    try {
        init();
    } catch (err) {
        showDialog("error", UI_TEXTS.initErrorTitle, err.message || String(err));
    }
});
