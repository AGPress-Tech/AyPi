const { ipcRenderer } = require("electron");
const fs = require("fs");
const path = require("path");

let argon2;
try {
    argon2 = require("argon2");
} catch (err) {
    console.error("Modulo 'argon2' non trovato. Esegui: npm install argon2");
}

const DATA_PATH = "\\\\Dl360\\pubbliche\\TECH\\AyPi\\AGPRESS\\ferie-permessi.json";
const ASSIGNEES_PATH = "\\\\Dl360\\pubbliche\\TECH\\AyPi\\AGPRESS\\amministrazione-assignees.json";
const ADMINS_PATH = "\\\\Dl360\\pubbliche\\TECH\\AyPi\\AGPRESS\\ferie-permessi-admins.json";
const APPROVAL_PASSWORD = "AGPress";
const AUTO_REFRESH_MS = 15000;
const COLOR_STORAGE_KEY = "fpColorSettings";
const THEME_STORAGE_KEY = "fpTheme";
const DEFAULT_TYPE_COLORS = {
    ferie: "#2f9e44",
    permesso: "#f08c00",
    straordinari: "#1a73e8",
};

let calendar = null;
let XLSX;
try {
    XLSX = require("xlsx");
} catch (err) {
    console.error("Modulo 'xlsx' non trovato. Esegui: npm install xlsx");
}
let pendingAction = null;
let refreshTimer = null;
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
let settingsSnapshot = null;
let editingAdminName = "";
let adminCache = [];
let adminEditingIndex = -1;

function loadAdminCredentials() {
    try {
        if (!fs.existsSync(ADMINS_PATH)) {
            return [{ name: "Admin", password: APPROVAL_PASSWORD }];
        }
        const raw = fs.readFileSync(ADMINS_PATH, "utf8");
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
            return parsed
                .filter((item) => item && item.name && (item.password || item.passwordHash))
                .map((item) => ({
                    name: String(item.name),
                    password: item.password ? String(item.password) : undefined,
                    passwordHash: item.passwordHash ? String(item.passwordHash) : undefined,
                    email: item.email ? String(item.email) : "",
                    phone: item.phone ? String(item.phone) : "",
                }));
        }
        if (parsed && Array.isArray(parsed.admins)) {
            return parsed.admins
                .filter((item) => item && item.name && (item.password || item.passwordHash))
                .map((item) => ({
                    name: String(item.name),
                    password: item.password ? String(item.password) : undefined,
                    passwordHash: item.passwordHash ? String(item.passwordHash) : undefined,
                    email: item.email ? String(item.email) : "",
                    phone: item.phone ? String(item.phone) : "",
                }));
        }
        if (parsed && typeof parsed === "object") {
            return Object.entries(parsed)
                .filter(([name, password]) => name && password)
                .map(([name, password]) => {
                    const value = String(password);
                    return value.startsWith("$argon2")
                        ? { name: String(name), passwordHash: value, email: "", phone: "" }
                        : { name: String(name), password: value, email: "", phone: "" };
                });
        }
        return [{ name: "Admin", password: APPROVAL_PASSWORD }];
    } catch (err) {
        console.error("Errore caricamento admins:", err);
        return [{ name: "Admin", password: APPROVAL_PASSWORD }];
    }
}

function saveAdminCredentials(admins) {
    try {
        ensureDataFolder();
        const payload = admins.map((admin) => ({
            name: admin.name,
            passwordHash: admin.passwordHash,
            password: admin.passwordHash ? undefined : admin.password,
            email: admin.email || "",
            phone: admin.phone || "",
        }));
        fs.writeFileSync(ADMINS_PATH, JSON.stringify({ admins: payload }, null, 2), "utf8");
    } catch (err) {
        console.error("Errore salvataggio admins:", err);
        showDialog("warning", "Impossibile salvare la lista admin.", err.message || String(err));
    }
}

async function verifyAdminPassword(password, targetName) {
    if (!password) return null;
    const admins = loadAdminCredentials();
    for (const admin of admins) {
        if (targetName && admin.name !== targetName) continue;
        if (admin.passwordHash && argon2) {
            try {
                const ok = await argon2.verify(admin.passwordHash, password);
                if (ok) return { admin, admins };
            } catch (err) {
                console.error("Errore verifica argon2:", err);
            }
        } else if (admin.password && admin.password === password) {
            if (argon2) {
                try {
                    const hash = await argon2.hash(password);
                    admin.passwordHash = hash;
                    delete admin.password;
                    saveAdminCredentials(admins);
                } catch (err) {
                    console.error("Errore hashing argon2:", err);
                }
            }
            return { admin, admins };
        }
    }
    return null;
}

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
    if (ferieDot) ferieDot.style.background = getTypeColor("ferie");
    if (permessoDot) permessoDot.style.background = getTypeColor("permesso");
    if (straordinariDot) straordinariDot.style.background = getTypeColor("straordinari");
}

function setSettingsInputsFromColors() {
    const ferieInput = document.getElementById("fp-color-ferie");
    const permessoInput = document.getElementById("fp-color-permesso");
    const straordinariInput = document.getElementById("fp-color-straordinari");
    if (ferieInput) ferieInput.value = getTypeColor("ferie");
    if (permessoInput) permessoInput.value = getTypeColor("permesso");
    if (straordinariInput) straordinariInput.value = getTypeColor("straordinari");
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
    applyCalendarButtonStyles();
    applyCalendarListStyles();
    applyCalendarListHoverStyles();
}

function openSettingsModal() {
    const modal = document.getElementById("fp-settings-modal");
    const message = document.getElementById("fp-settings-message");
    if (!modal) return;
    const themeValue = loadThemeSetting();
    settingsSnapshot = {
        theme: themeValue,
        colors: { ...typeColors },
    };
    setSettingsInputsFromColors();
    const themeInputs = document.querySelectorAll("input[name='fp-theme']");
    themeInputs.forEach((input) => {
        input.checked = input.value === themeValue;
    });
    setMessage(message, "");
    showModal(modal);
}

function closeSettingsModal() {
    const modal = document.getElementById("fp-settings-modal");
    if (!modal) return;
    if (settingsSnapshot) {
        typeColors = { ...settingsSnapshot.colors };
        applyTypeColors();
        applyTheme(settingsSnapshot.theme);
        renderAll(loadData());
    }
    hideModal(modal);
}

function setAdminMessage(id, text, isError = false) {
    const el = document.getElementById(id);
    if (!el) return;
    setMessage(el, text, isError);
}

function isValidEmail(value) {
    if (!value) return true;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isValidPhone(value) {
    if (!value) return false;
    const trimmed = value.trim();
    if (!trimmed.startsWith("+39")) return false;
    const digits = trimmed.replace(/\D/g, "");
    return digits.length >= 11 && digits.length <= 13;
}

function renderAdminList() {
    const list = document.getElementById("fp-admin-list");
    if (!list) return;
    list.innerHTML = "";
    if (!adminCache.length) {
        const empty = document.createElement("div");
        empty.className = "fp-message";
        empty.textContent = "Nessun admin configurato.";
        list.appendChild(empty);
        return;
    }
    adminCache.forEach((admin, index) => {
        const row = document.createElement("div");
        row.className = "fp-admin-row";

        const name = document.createElement("div");
        name.textContent = admin.name;
        row.appendChild(name);

        const actions = document.createElement("div");
        actions.className = "fp-assignees-row__actions";

        const edit = document.createElement("button");
        edit.type = "button";
        edit.className = "fp-btn";
        edit.textContent = "Modifica";
        edit.addEventListener("click", () => {
            adminEditingIndex = index;
            const nameInput = document.getElementById("fp-admin-edit-name");
            if (nameInput) nameInput.value = admin.name;
            const emailInput = document.getElementById("fp-admin-edit-email");
            if (emailInput) emailInput.value = admin.email || "";
            const phoneInput = document.getElementById("fp-admin-edit-phone");
            if (phoneInput) phoneInput.value = admin.phone || "";
            const editModal = document.getElementById("fp-admin-edit-modal");
            const passwordPanel = document.getElementById("fp-admin-password-panel");
            if (passwordPanel) passwordPanel.classList.add("is-hidden");
            setAdminMessage("fp-admin-edit-message", "");
            if (editModal) showModal(editModal);
        });

        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "fp-btn fp-btn--danger";
        remove.textContent = "Rimuovi";
        remove.addEventListener("click", async () => {
            if (adminCache.length <= 1) {
                setAdminMessage("fp-admin-message", "Deve esserci almeno un admin.", true);
                return;
            }
            const confirmed = await openConfirmModal(
                `Confermi l'eliminazione dell'admin <strong>${escapeHtml(admin.name)}</strong>?`
            );
            if (!confirmed) return;
            openPasswordModal({
                type: "admin-delete",
                id: admin.name,
                adminName: admin.name,
                title: "Elimina admin",
                description: `Inserisci la password di ${admin.name} per confermare la rimozione.`,
            });
        });

        actions.appendChild(edit);
        actions.appendChild(remove);
        row.appendChild(actions);
        list.appendChild(row);
    });
}

function openAdminModal() {
    const modal = document.getElementById("fp-admin-modal");
    if (!modal) return;
    adminCache = loadAdminCredentials().sort((a, b) => a.name.localeCompare(b.name));
    renderAdminList();
    setAdminMessage("fp-admin-message", "");
    adminEditingIndex = -1;
    showModal(modal);
}

function closeAdminModal() {
    const modal = document.getElementById("fp-admin-modal");
    if (!modal) return;
    hideModal(modal);
    adminEditingIndex = -1;
}

function showModal(modal) {
    if (!modal) return;
    modal.classList.remove("is-hidden");
    modal.setAttribute("aria-hidden", "false");
    modal.style.display = "flex";
    modal.style.pointerEvents = "auto";
    modal.style.visibility = "visible";
}

function hideModal(modal) {
    if (!modal) return;
    modal.classList.add("is-hidden");
    modal.setAttribute("aria-hidden", "true");
    modal.style.display = "none";
    modal.style.pointerEvents = "none";
    modal.style.visibility = "hidden";
}

function forceUnlockUI() {
    document.querySelectorAll(".fp-modal").forEach((item) => hideModal(item));
    pendingAction = null;
    if (document.activeElement && typeof document.activeElement.blur === "function") {
        document.activeElement.blur();
    }
}

function showDialog(type, message, detail = "", buttons) {
    return ipcRenderer.invoke("show-message-box", {
        type,
        message,
        detail,
        buttons: Array.isArray(buttons) && buttons.length ? buttons : undefined,
    });
}

function ensureDataFolder() {
    const dir = path.dirname(DATA_PATH);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function loadAssigneeOptions() {
    try {
        if (!fs.existsSync(ASSIGNEES_PATH)) {
            return { groups: {}, options: [] };
        }
        const raw = fs.readFileSync(ASSIGNEES_PATH, "utf8");
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
            return { groups: { "Altro": parsed.map((name) => String(name)) }, options: parsed.map((name) => String(name)) };
        }
        if (Array.isArray(parsed.data)) {
            return { groups: { "Altro": parsed.data.map((name) => String(name)) }, options: parsed.data.map((name) => String(name)) };
        }
        if (parsed && typeof parsed === "object") {
            const rawGroups = parsed.groups && typeof parsed.groups === "object" ? parsed.groups : parsed;
            const groups = {};
            Object.keys(rawGroups).forEach((key) => {
                const list = Array.isArray(rawGroups[key]) ? rawGroups[key] : [];
                groups[key] = list.map((name) => String(name));
            });
            const options = Object.values(groups).flat();
            return { groups, options };
        }
        return { groups: {}, options: [] };
    } catch (err) {
        console.error("Errore caricamento assignees:", err);
        return { groups: {}, options: [] };
    }
}

function saveAssigneeOptions(groups) {
    try {
        ensureDataFolder();
        fs.writeFileSync(ASSIGNEES_PATH, JSON.stringify(groups, null, 2), "utf8");
    } catch (err) {
        console.error("Errore salvataggio assignees:", err);
        showDialog("warning", "Impossibile salvare la lista dipendenti.", err.message || String(err));
    }
}

function loadData() {
    try {
        if (!fs.existsSync(DATA_PATH)) {
            return { requests: [] };
        }
        const raw = fs.readFileSync(DATA_PATH, "utf8");
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.requests)) {
            return { requests: parsed.requests };
        }
        if (Array.isArray(parsed)) {
            return { requests: parsed };
        }
        return { requests: [] };
    } catch (err) {
        console.error("Errore caricamento dati ferie:", err);
        return { requests: [] };
    }
}

function saveData(payload) {
    try {
        ensureDataFolder();
        fs.writeFileSync(DATA_PATH, JSON.stringify(payload, null, 2), "utf8");
    } catch (err) {
        console.error("Errore salvataggio ferie:", err);
        showDialog("warning", "Impossibile salvare i dati sul server.", err.message || String(err));
    }
}

function syncData(updateFn) {
    const data = loadData();
    const next = updateFn ? updateFn(data) || data : data;
    saveData(next);
    return next;
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
        lines.push(`Approvato da: ${request.approvedBy}`);
    }
    if (request.modifiedBy) {
        lines.push(`Modificato da: ${request.modifiedBy}`);
    }
    return lines.filter(Boolean).join("\n");
}

function addDaysToDateString(dateStr, days) {
    if (!dateStr) return dateStr;
    const [year, month, day] = dateStr.split("-").map((v) => parseInt(v, 10));
    if (!year || !month || !day) return dateStr;
    const next = new Date(year, month - 1, day);
    next.setDate(next.getDate() + days);
    const yyyy = next.getFullYear();
    const mm = String(next.getMonth() + 1).padStart(2, "0");
    const dd = String(next.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
}

function buildEventFromRequest(request) {
    const title = request.employee || "Dipendente";
    const color = getTypeColor(request.type);
    if (request.allDay) {
        const endDate = request.end || request.start;
        return {
            id: request.id,
            title,
            start: request.start,
            end: addDaysToDateString(endDate, 1),
            allDay: true,
            backgroundColor: color,
            borderColor: color,
        };
    }
    return {
        id: request.id,
        title,
        start: request.start,
        end: request.end,
        allDay: false,
        backgroundColor: color,
        borderColor: color,
    };
}

function renderSummary(data) {
    const summaryEl = document.getElementById("fp-summary");
    if (!summaryEl) return;
    const requests = data.requests || [];
    const pending = requests.filter((req) => req.status === "pending").length;
    const approved = requests.filter((req) => req.status === "approved").length;
    summaryEl.textContent = `In attesa: ${pending} | Approvate: ${approved}`;
    updatePendingBadge(pending);
}

function updatePendingBadge(count) {
    const badge = document.getElementById("fp-pending-badge");
    if (!badge) return;
    badge.textContent = String(count);
    if (count > 0) {
        badge.classList.remove("is-hidden");
    } else {
        badge.classList.add("is-hidden");
    }
}

function renderPendingList(data) {
    const listEl = document.getElementById("fp-pending-list");
    if (!listEl) return;
    listEl.innerHTML = "";
    const pending = (data.requests || []).filter((req) => req.status === "pending");
    if (pending.length === 0) {
        const empty = document.createElement("p");
        empty.textContent = "Nessuna richiesta in attesa.";
        empty.className = "fp-message";
        listEl.appendChild(empty);
        return;
    }
    pending.forEach((request) => {
        const card = document.createElement("div");
        card.className = "fp-pending-item";

        const title = document.createElement("h3");
        const deptLabel = request.department ? ` - ${request.department}` : "";
        title.textContent = `${request.employee || "Dipendente"}${deptLabel}`;
        card.appendChild(title);

        const meta = document.createElement("p");
        const typeLabel = request.type === "permesso"
            ? "Permesso"
            : request.type === "straordinari"
                ? "Straordinari"
                : "Ferie";
        meta.textContent = typeLabel;
        card.appendChild(meta);

        card.appendChild(createRangeLine(request));

        if (request.note) {
            const note = document.createElement("p");
            note.textContent = request.note;
            card.appendChild(note);
        }

        const actions = document.createElement("div");
        actions.className = "fp-pending-actions";

        const approveBtn = document.createElement("button");
        approveBtn.type = "button";
        approveBtn.className = "fp-btn fp-btn--primary";
        approveBtn.textContent = "Approva";
        approveBtn.addEventListener("click", () => {
            if (pendingUnlocked) {
                const updated = syncData((payload) => {
                    const target = (payload.requests || []).find((req) => req.id === request.id);
                    if (target) {
                        target.status = "approved";
                        target.approvedAt = new Date().toISOString();
                        target.approvedBy = pendingUnlockedBy || target.approvedBy || "Admin";
                    }
                    return payload;
                });
                renderAll(updated);
                return;
            }
            openPasswordModal({
                type: "approve",
                id: request.id,
                title: "Approva richiesta",
                description: "Inserisci la password per approvare la richiesta.",
            });
        });

        const rejectBtn = document.createElement("button");
        rejectBtn.type = "button";
        rejectBtn.className = "fp-btn";
        rejectBtn.textContent = "Rifiuta";
        rejectBtn.addEventListener("click", () => {
            if (pendingUnlocked) {
                const updated = syncData((payload) => {
                    payload.requests = (payload.requests || []).filter((req) => req.id !== request.id);
                    return payload;
                });
                renderAll(updated);
                return;
            }
            openPasswordModal({
                type: "reject",
                id: request.id,
                title: "Rifiuta richiesta",
                description: "Inserisci la password per rifiutare la richiesta.",
            });
        });

        actions.appendChild(rejectBtn);
        actions.appendChild(approveBtn);
        card.appendChild(actions);
        listEl.appendChild(card);
    });
}

function renderCalendar(data) {
    if (!calendar) return;
    calendar.removeAllEvents();
    const approved = (data.requests || []).filter((req) => req.status === "approved");
    approved.forEach((request) => {
        calendar.addEvent(buildEventFromRequest(request));
    });
}

function renderAll(data) {
    cachedData = data || { requests: [] };
    renderSummary(data);
    renderPendingList(data);
    renderCalendar(data);
    applyCalendarListStyles();
    applyCalendarListHoverStyles();
}

function openPasswordModal(action) {
    const modal = document.getElementById("fp-approve-modal");
    const input = document.getElementById("fp-approve-password");
    const error = document.getElementById("fp-approve-error");
    const title = document.getElementById("fp-approve-title");
    const desc = document.getElementById("fp-approve-desc");
    if (!modal || !input) return;
    pendingAction = action;
    if (title && action?.title) title.textContent = action.title;
    if (desc && action?.description) desc.textContent = action.description;
    document.querySelectorAll(".fp-modal").forEach((item) => hideModal(item));
    showModal(modal);
    if (error) {
        error.classList.add("is-hidden");
    }
    input.value = "";
    input.disabled = false;
    input.readOnly = false;
    setTimeout(() => input.focus(), 0);
}

function closeApprovalModal() {
    const modal = document.getElementById("fp-approve-modal");
    const input = document.getElementById("fp-approve-password");
    const error = document.getElementById("fp-approve-error");
    if (!modal) return;
    hideModal(modal);
    if (input) input.value = "";
    if (error) error.classList.add("is-hidden");
    pendingAction = null;
    if (document.activeElement && typeof document.activeElement.blur === "function") {
        document.activeElement.blur();
    }
}

async function confirmApproval() {
    const input = document.getElementById("fp-approve-password");
    const error = document.getElementById("fp-approve-error");
    const password = input ? input.value : "";
    if (!argon2) {
        await showDialog("error", "Modulo 'argon2' non disponibile.", "Esegui 'npm install argon2' nella cartella del progetto.");
        return;
    }
    const result = await verifyAdminPassword(password);
    const admin = result ? result.admin : null;
    if (!admin) {
        if (error) error.classList.remove("is-hidden");
        return;
    }
    if (!pendingAction) {
        closeApprovalModal();
        return;
    }
    const actionType = pendingAction.type;
    const requestId = pendingAction.id;
    if (actionType === "approve") {
        const updated = syncData((payload) => {
            const target = (payload.requests || []).find((req) => req.id === requestId);
            if (target) {
                target.status = "approved";
                target.approvedAt = new Date().toISOString();
                target.approvedBy = admin.name;
            }
            return payload;
        });
        closeApprovalModal();
        renderAll(updated);
        return;
    }
    if (actionType === "reject") {
        const updated = syncData((payload) => {
            payload.requests = (payload.requests || []).filter((req) => req.id !== requestId);
            return payload;
        });
        closeApprovalModal();
        renderAll(updated);
        return;
    }
    if (actionType === "delete") {
        const updated = syncData((payload) => {
            payload.requests = (payload.requests || []).filter((req) => req.id !== requestId);
            return payload;
        });
        forceUnlockUI();
        renderAll(updated);
        return;
    }
    if (actionType === "edit") {
        closeApprovalModal();
        const data = loadData();
        const target = (data.requests || []).find((req) => req.id === requestId);
        if (target) {
            editingRequestId = requestId;
            editingAdminName = admin.name;
            openEditModal(target);
        }
    }
    if (actionType === "pending-access") {
        pendingUnlocked = true;
        pendingUnlockedBy = admin.name;
        closeApprovalModal();
        openPendingPanel();
        return;
    }
    if (actionType === "admin-access") {
        closeApprovalModal();
        openAdminModal();
        return;
    }
    if (actionType === "admin-delete") {
        const targetName = pendingAction?.adminName || pendingAction?.id || "";
        if (!targetName || admin.name !== targetName) {
            if (error) error.classList.remove("is-hidden");
            return;
        }
        adminCache = adminCache.length ? adminCache : loadAdminCredentials();
        if (adminCache.length <= 1) {
            closeApprovalModal();
            setAdminMessage("fp-admin-message", "Deve esserci almeno un admin.", true);
            return;
        }
        adminCache = adminCache.filter((item) => item.name !== targetName);
        saveAdminCredentials(adminCache);
        renderAdminList();
        closeApprovalModal();
        setAdminMessage("fp-admin-message", "Admin rimosso.", false);
    }
}

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
        return { error: "Compila dipendente e periodo richiesto." };
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
        return { error: "Formato data non valido." };
    }
    if (startParsed.getFullYear() > maxYear || endParsed.getFullYear() > maxYear) {
        return { error: `L'anno non puo superare ${maxYear}.` };
    }
    if (!allowPast) {
        if (startParsed < todayMidnight || endParsed < todayMidnight) {
            return { error: "Non puoi inserire date precedenti a oggi." };
        }
    }
    if (endParsed < startParsed) {
        return { error: "La data fine non puo essere precedente alla data inizio." };
    }
    if (!allDay && startDate !== endDate) {
        return { error: "Per periodi di piu giorni serve giornata intera." };
    }

    if (!allDay) {
        if (!startTime || !endTime) {
            return { error: "Inserisci orari di inizio e fine." };
        }
        const startValue = `${startDate}T${startTime}`;
        const endValue = `${endDate}T${endTime}`;
        if (endValue < startValue) {
            return { error: "L'orario di fine non puo essere precedente all'inizio." };
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

function getTypeLabel(value) {
    if (value === "permesso") return "Permesso";
    if (value === "straordinari") return "Straordinari";
    return "Ferie";
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

function resetForm(prefix) {
    const note = document.getElementById(`${prefix}-note`);
    if (note) note.value = "";
}

function resetNewRequestForm() {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const startDate = document.getElementById("fp-start-date");
    const endDate = document.getElementById("fp-end-date");
    const editStartDateInit = document.getElementById("fp-edit-start-date");
    const editEndDateInit = document.getElementById("fp-edit-end-date");
    const startTime = document.getElementById("fp-start-time");
    const endTime = document.getElementById("fp-end-time");
    const allDayToggle = document.getElementById("fp-all-day");
    const typeSelect = document.getElementById("fp-type");
    const departmentSelect = document.getElementById("fp-department");
    const employeeSelect = document.getElementById("fp-employee");

    if (startDate) startDate.value = today;
    if (endDate) endDate.value = today;
    if (startTime) startTime.value = "08:00";
    if (endTime) endTime.value = "17:30";
    if (allDayToggle) {
        allDayToggle.checked = false;
        toggleAllDayState(false);
    }
    if (typeSelect) typeSelect.selectedIndex = 0;
    if (departmentSelect) {
        departmentSelect.selectedIndex = 0;
        departmentSelect.dispatchEvent(new Event("change"));
    }
    if (employeeSelect) {
        employeeSelect.selectedIndex = 0;
    }
    resetForm("fp");
    updateAllDayLock(startDate, endDate, allDayToggle, "fp");
    setInlineError("fp-end-date-error", "");
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
        emptyOpt.textContent = "Nessun dipendente";
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
            emptyOpt.textContent = "Nessun dipendente";
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

function openEditModal(request) {
    const modal = document.getElementById("fp-edit-modal");
    const message = document.getElementById("fp-edit-message");
    if (!modal) return;
    showModal(modal);
    setMessage(message, "");
    setInlineError("fp-edit-end-date-error", "");
    fillFormFromRequest("fp-edit", request);
}

function closeEditModal() {
    const modal = document.getElementById("fp-edit-modal");
    const message = document.getElementById("fp-edit-message");
    if (!modal) return;
    hideModal(modal);
    setMessage(message, "");
    setInlineError("fp-edit-end-date-error", "");
    editingRequestId = null;
    editingAdminName = "";
}

function openExportModal() {
    const modal = document.getElementById("fp-export-modal");
    const rangeAll = document.querySelector("input[name='fp-export-range'][value='all']");
    if (!modal) return;
    showModal(modal);
    renderExportDepartments();
    setMessage(document.getElementById("fp-export-message"), "");
    if (rangeAll) {
        rangeAll.checked = true;
    }
    updateExportDateState();
}

function closeExportModal() {
    const modal = document.getElementById("fp-export-modal");
    if (!modal) return;
    hideModal(modal);
    setMessage(document.getElementById("fp-export-message"), "");
}

function renderExportDepartments() {
    const container = document.getElementById("fp-export-departments");
    if (!container) return;
    container.innerHTML = "";
    const groups = Object.keys(assigneeGroups);
    if (!groups.length) {
        const empty = document.createElement("div");
        empty.textContent = "Nessun reparto.";
        container.appendChild(empty);
        return;
    }
    groups.forEach((group) => {
        const label = document.createElement("label");
        label.className = "fp-export-choice";
        const input = document.createElement("input");
        input.type = "checkbox";
        input.value = group;
        input.checked = true;
        label.appendChild(input);
        label.append(` ${group}`);
        container.appendChild(label);
    });
}

function setExportDepartmentsChecked(value) {
    const container = document.getElementById("fp-export-departments");
    if (!container) return;
    container.querySelectorAll("input[type='checkbox']").forEach((input) => {
        input.checked = value;
    });
}

function updateExportDateState() {
    const rangeMode = document.querySelector("input[name='fp-export-range']:checked")?.value || "all";
    const startInput = document.getElementById("fp-export-start");
    const endInput = document.getElementById("fp-export-end");
    const isAll = rangeMode === "all";
    if (startInput) {
        startInput.disabled = isAll;
        startInput.readOnly = false;
    }
    if (endInput) {
        endInput.disabled = isAll;
        endInput.readOnly = false;
    }
}

function getExportSelectedDepartments() {
    const container = document.getElementById("fp-export-departments");
    if (!container) return [];
    const checked = Array.from(container.querySelectorAll("input[type='checkbox']:checked"));
    return checked.map((input) => input.value);
}

function parseDateInput(value) {
    if (!value) return null;
    const [year, month, day] = value.split("-").map((v) => parseInt(v, 10));
    if (!year || !month || !day) return null;
    return new Date(year, month - 1, day);
}

function formatDate(value) {
    if (!value) return "";
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleDateString("it-IT");
}

function formatDateTime(value) {
    if (!value) return "";
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const datePart = date.toLocaleDateString("it-IT");
    const timePart = date.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
    return `${datePart} ${timePart}`;
}

function formatDateParts(value) {
    if (!value) return { date: "", time: "" };
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return { date: "", time: "" };
    return {
        date: date.toLocaleDateString("it-IT"),
        time: date.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" }),
    };
}

function createRangeLine(request) {
    const line = document.createElement("p");
    line.className = "fp-pending-range";
    if (request.allDay) {
        const startLabel = formatDate(request.start);
        const endLabel = formatDate(request.end || request.start);
        const startStrong = document.createElement("strong");
        startStrong.textContent = startLabel;
        line.appendChild(startStrong);
        if (endLabel && endLabel !== startLabel) {
            line.appendChild(document.createTextNode(" - "));
            const endStrong = document.createElement("strong");
            endStrong.textContent = endLabel;
            line.appendChild(endStrong);
        }
        return line;
    }
    const startParts = formatDateParts(request.start);
    const endParts = formatDateParts(request.end);
    const startDate = document.createElement("strong");
    startDate.textContent = startParts.date;
    line.appendChild(startDate);
    if (startParts.time) {
        line.appendChild(document.createTextNode(` ${startParts.time}`));
    }
    line.appendChild(document.createTextNode(" - "));
    const endDate = document.createElement("strong");
    endDate.textContent = endParts.date;
    line.appendChild(endDate);
    if (endParts.time) {
        line.appendChild(document.createTextNode(` ${endParts.time}`));
    }
    return line;
}

function getRequestDates(request) {
    if (!request) return { start: null, end: null };
    if (request.allDay) {
        const start = request.start ? new Date(`${request.start}T00:00:00`) : null;
        const end = request.end ? new Date(`${request.end}T23:59:59`) : (request.start ? new Date(`${request.start}T23:59:59`) : null);
        return { start, end };
    }
    const start = request.start ? new Date(request.start) : null;
    const end = request.end ? new Date(request.end) : null;
    return { start, end };
}

function calculateHours(request) {
    if (!request) return 0;
    if (request.allDay) {
        const startDate = request.start ? new Date(`${request.start}T00:00:00`) : null;
        const endDate = request.end ? new Date(`${request.end}T00:00:00`) : startDate;
        if (!startDate || !endDate) return 0;
        const days = Math.floor((endDate - startDate) / 86400000) + 1;
        return days * 8;
    }
    const start = request.start ? new Date(request.start) : null;
    const end = request.end ? new Date(request.end) : null;
    if (!start || !end) return 0;
    const diffHours = (end - start) / 3600000;
    const hours = Math.max(0, Math.round(diffHours * 100) / 100);
    const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate());
    const days = Math.floor((endDay - startDay) / 86400000) + 1;
    const maxHours = Math.max(1, days) * 8;
    return Math.min(hours, maxHours);
}

function buildExportRows(requests) {
    return requests.map((request) => {
        const typeLabel = request.type === "permesso"
            ? "Permesso"
            : request.type === "straordinari"
                ? "Straordinari"
                : "Ferie";
        const startValue = request.allDay
            ? (request.start ? new Date(`${request.start}T00:00:00`) : null)
            : (request.start ? new Date(request.start) : null);
        const endValue = request.allDay
            ? (request.end ? new Date(`${request.end}T00:00:00`) : (request.start ? new Date(`${request.start}T00:00:00`) : null))
            : (request.end ? new Date(request.end) : null);
        const row = {
            "Nome Operatore": request.employee || "",
            "Reparto": request.department || "",
            "Data Inizio": startValue || "",
            "Data Fine": endValue || "",
            "Ore": calculateHours(request),
            "Tipo": typeLabel,
            "Approvato da": request.approvedBy || "",
            "Modificato da": request.modifiedBy || "",
        };
        return row;
    });
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
        list.textContent = "Nessun reparto.";
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
        list.textContent = "Nessun operatore.";
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

function openPendingPanel() {
    const panel = document.getElementById("fp-pending-panel");
    const toggle = document.getElementById("fp-pending-toggle");
    if (!panel || !toggle) return;
    panel.classList.add("is-open");
    panel.setAttribute("aria-hidden", "false");
    toggle.setAttribute("aria-expanded", "true");
    pendingPanelOpen = true;
}

function closePendingPanel() {
    const panel = document.getElementById("fp-pending-panel");
    const toggle = document.getElementById("fp-pending-toggle");
    if (!panel || !toggle) return;
    panel.classList.remove("is-open");
    panel.setAttribute("aria-hidden", "true");
    toggle.setAttribute("aria-expanded", "false");
    pendingPanelOpen = false;
}

function applyCalendarButtonStyles() {
    const root = document.getElementById("fp-calendar");
    if (!root) return;
    const getPalette = () => {
        const isDark = document.body.classList.contains("fp-dark");
        const isAyPi = document.body.classList.contains("fp-aypi");
        return {
            baseBackground: isDark ? "#15181d" : isAyPi ? "#2b2824" : "#ffffff",
            baseBorder: isDark ? "#2b2f36" : isAyPi ? "#4a433d" : "#dadce0",
            baseColor: isDark ? "#8ab4f8" : isAyPi ? "#f3e6d5" : "#1a73e8",
            hoverBackground: isDark ? "#1a1e24" : isAyPi ? "#3a3932" : "#f6f8fe",
            hoverBorder: isDark ? "#2b2f36" : isAyPi ? "#6a5d52" : "#d2e3fc",
            activeBackground: isDark ? "#1f2937" : isAyPi ? "#3a3328" : "#e8f0fe",
            activeBorder: isDark ? "#2b2f36" : isAyPi ? "#6a5d52" : "#d2e3fc",
            baseShadow: isDark ? "none" : isAyPi ? "0 2px 6px rgba(0, 0, 0, 0.45)" : "0 1px 2px rgba(60, 64, 67, 0.15)",
        };
    };
    const buttons = root.querySelectorAll(".fc .fc-button");
    buttons.forEach((btn) => {
        const palette = getPalette();
        btn.style.background = palette.baseBackground;
        btn.style.borderColor = palette.baseBorder;
        btn.style.color = palette.baseColor;
        btn.style.borderRadius = "999px";
        btn.style.padding = "7px 14px";
        btn.style.fontSize = "13px";
        btn.style.fontWeight = "600";
        btn.style.boxShadow = palette.baseShadow;
        btn.style.transition = "background 0.15s ease, border-color 0.15s ease, color 0.15s ease";
        btn.style.opacity = btn.disabled ? "0.5" : "1";

        const setBase = () => {
            if (btn.disabled) {
                btn.style.opacity = "0.5";
                return;
            }
            const current = getPalette();
            btn.style.background = current.baseBackground;
            btn.style.borderColor = current.baseBorder;
            btn.style.color = current.baseColor;
            btn.style.boxShadow = current.baseShadow;
        };

        const setHover = () => {
            if (btn.disabled) return;
            const current = getPalette();
            btn.style.background = current.hoverBackground;
            btn.style.borderColor = current.hoverBorder;
        };

        const setActive = () => {
            if (btn.disabled) return;
            if (btn.classList.contains("fc-button-active")) {
                const current = getPalette();
                btn.style.background = current.activeBackground;
                btn.style.borderColor = current.activeBorder;
                btn.style.boxShadow = "none";
            }
        };

        if (!btn.dataset.fpStyled) {
            btn.addEventListener("mouseenter", () => {
                if (btn.classList.contains("fc-button-active")) return;
                setHover();
            });
            btn.addEventListener("mouseleave", () => {
                if (btn.classList.contains("fc-button-active")) {
                    setActive();
                    return;
                }
                setBase();
            });
            btn.addEventListener("click", () => {
                setTimeout(() => {
                    if (btn.classList.contains("fc-button-active")) {
                        setActive();
                        return;
                    }
                    setBase();
                }, 0);
            });
            btn.dataset.fpStyled = "1";
        }

        if (btn.classList.contains("fc-button-active")) {
            const current = getPalette();
            btn.style.background = current.activeBackground;
            btn.style.borderColor = current.activeBorder;
            btn.style.boxShadow = "none";
        }
    });
}

function applyCalendarListStyles() {
    const root = document.getElementById("fp-calendar");
    if (!root) return;
    const isDark = document.body.classList.contains("fp-dark");
    const isAyPi = document.body.classList.contains("fp-aypi");
    if (!isDark && !isAyPi) return;
    const dayBg = isAyPi ? "#f0dfbf" : "#f1f3f4";
    const dayText = "#202124";
    const dayRows = root.querySelectorAll(".fc .fc-list-day");
    dayRows.forEach((row) => {
        row.style.background = dayBg;
        row.style.color = dayText;
        const cells = row.querySelectorAll("th, td");
        cells.forEach((cell) => {
            cell.style.background = dayBg;
            cell.style.color = dayText;
        });
        const texts = row.querySelectorAll(".fc-list-day-text, .fc-list-day-side-text");
        texts.forEach((text) => {
            text.style.color = dayText;
        });
    });
    const cushions = root.querySelectorAll(".fc .fc-list-day-cushion");
    cushions.forEach((item) => {
        item.style.background = dayBg;
        item.style.color = dayText;
    });
}

function applyCalendarListHoverStyles() {
    const root = document.getElementById("fp-calendar");
    if (!root) return;
    const isDark = document.body.classList.contains("fp-dark");
    const isAyPi = document.body.classList.contains("fp-aypi");
    const hoverBg = isAyPi ? "#3a3328" : isDark ? "#2a3037" : "#eef2ff";
    const rows = root.querySelectorAll(".fc .fc-list-table tbody tr.fc-list-event");
    rows.forEach((row) => {
        if (row.dataset.fpHoverBound) return;
        row.addEventListener("mouseenter", () => {
            row.querySelectorAll("td").forEach((cell) => {
                cell.style.background = hoverBg;
            });
        });
        row.addEventListener("mouseleave", () => {
            row.querySelectorAll("td").forEach((cell) => {
                cell.style.background = "";
            });
        });
        row.dataset.fpHoverBound = "1";
    });
}

function initCalendar() {
    const calendarEl = document.getElementById("fp-calendar");
    if (!calendarEl || !window.FullCalendar) return;
    calendar = new FullCalendar.Calendar(calendarEl, {
        initialView: "dayGridMonth",
        locale: "it",
        height: "100%",
        headerToolbar: {
            left: "prev,next today",
            center: "title",
            right: "dayGridMonth,timeGridWeek,timeGridDay,listWeek",
        },
        buttonText: {
            today: "Oggi",
            month: "Mese",
            week: "Settimana",
            day: "Giorno",
            list: "Lista",
            listWeek: "Lista",
        },
        businessHours: [
            { daysOfWeek: [1, 2, 3, 4, 5], startTime: "08:00", endTime: "12:00" },
            { daysOfWeek: [1, 2, 3, 4, 5], startTime: "13:30", endTime: "17:30" },
        ],
        eventTimeFormat: {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
        },
        dateClick: (info) => {
            const event = info?.jsEvent;
            const target = event?.target;
            if (target && target.closest && !target.closest(".fc-daygrid-day-number")) {
                return;
            }
            if (!event || event.detail !== 2) return;
            calendar.changeView("timeGridDay", info.dateStr);
            setTimeout(() => {
                if (calendar && typeof calendar.scrollToTime === "function") {
                    calendar.scrollToTime("08:00");
                }
            }, 0);
        },
        eventClick: (info) => {
            selectedEventId = info?.event?.id || null;
        },
        eventDidMount: (info) => {
            if (!info || !info.el) return;
            const request = (cachedData.requests || []).find((req) => req.id === info.event?.id);
            if (request) {
                info.el.title = buildHoverText(request);
            }
            info.el.addEventListener("dblclick", () => {
                const requestId = info.event?.id;
                if (!requestId) return;
                openPasswordModal({
                    type: "edit",
                    id: requestId,
                    title: "Modifica richiesta",
                    description: "Inserisci la password per modificare la richiesta.",
                });
            });
        },
        datesSet: (info) => {
            const viewType = info?.view?.type || "";
            const isList = viewType === "listWeek" || viewType === "listMonth";
            if (!isList) {
                lastNonListViewType = viewType;
                applyCalendarButtonStyles();
                applyCalendarListStyles();
                applyCalendarListHoverStyles();
                return;
            }
            if (handlingListRedirect) {
                handlingListRedirect = false;
                applyCalendarButtonStyles();
                applyCalendarListStyles();
                applyCalendarListHoverStyles();
                return;
            }
            if (viewType === "listWeek" && lastNonListViewType === "dayGridMonth") {
                handlingListRedirect = true;
                calendar.changeView("listMonth");
                applyCalendarButtonStyles();
                applyCalendarListStyles();
                applyCalendarListHoverStyles();
            }
            setTimeout(() => {
                applyCalendarListStyles();
                applyCalendarListHoverStyles();
            }, 0);
        },
    });
    calendar.render();
    applyCalendarButtonStyles();
    applyCalendarListStyles();
    applyCalendarListHoverStyles();
}

function refreshData() {
    const data = loadData();
    renderAll(data);
}

function scheduleAutoRefresh() {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(refreshData, AUTO_REFRESH_MS);
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
    initCalendar();

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

    const allDayToggle = document.getElementById("fp-all-day");
    updateAllDayLock(startDate, endDate, allDayToggle, "fp");
    if (allDayToggle) {
        toggleAllDayState(allDayToggle.checked);
        allDayToggle.addEventListener("change", () => {
            toggleAllDayState(allDayToggle.checked);
        });
    }
    const startTimeInput = document.getElementById("fp-start-time");
    const endTimeInput = document.getElementById("fp-end-time");
    const handleTimeFocus = () => {
        if (!allDayToggle || !allDayToggle.checked || allDayToggle.disabled) return;
        allDayToggle.checked = false;
        toggleAllDayState(false);
    };
    if (startTimeInput) startTimeInput.addEventListener("focus", handleTimeFocus);
    if (endTimeInput) endTimeInput.addEventListener("focus", handleTimeFocus);

    if (startDate && endDate) {
        const normalizeDates = () => {
            if (!startDate.value || !endDate.value) return;
            if (startDate.value.length !== 10 || endDate.value.length !== 10) return;
            if (endDate.value < startDate.value) {
                setInlineError("fp-end-date-error", "La data fine non puo essere precedente alla data inizio.");
            } else {
                setInlineError("fp-end-date-error", "");
            }
            if (endDate.value > startDate.value && allDayToggle) {
                allDayToggle.checked = true;
                toggleAllDayState(true);
            }
            updateAllDayLock(startDate, endDate, allDayToggle, "fp");
        };
        startDate.addEventListener("change", normalizeDates);
        endDate.addEventListener("input", normalizeDates);
        endDate.addEventListener("change", normalizeDates);
    }

    const form = document.getElementById("fp-request-form");
    const message = document.getElementById("fp-form-message");
    const saveRequest = async () => {
        setMessage(message, "");
        setInlineError("fp-end-date-error", "");
        const { request, error } = buildRequestFromForm("fp", null, false);
        if (error) {
            setMessage(message, error, true);
            if (error.includes("data fine")) {
                setInlineError("fp-end-date-error", error);
            }
            return;
        }
        const typeLabel = escapeHtml(getTypeLabel(request.type));
        const startLabel = escapeHtml(request.allDay ? formatDate(request.start) : formatDateTime(request.start));
        const endLabel = escapeHtml(request.allDay ? formatDate(request.end || request.start) : formatDateTime(request.end));
        const confirmMessage =
            `Confermi l'invio della richiesta di <strong>${typeLabel}</strong> ` +
            `dal <strong>${startLabel}</strong> al <strong>${endLabel}</strong>?`;
        const confirmed = await openConfirmModal(confirmMessage);
        if (!confirmed) {
            return;
        }
        const updated = syncData((payload) => {
            payload.requests = payload.requests || [];
            payload.requests.push(request);
            return payload;
        });
        setMessage(message, "Richiesta inviata.", false);
        resetNewRequestForm();
        renderAll(updated);
    };
    if (form) {
        form.addEventListener("submit", (event) => {
            event.preventDefault();
        });
    }
    const saveBtn = document.getElementById("fp-request-save");
    if (saveBtn) {
        saveBtn.addEventListener("click", () => {
            saveRequest();
        });
    }

    const refreshBtn = document.getElementById("fp-refresh");
    if (refreshBtn) {
        refreshBtn.addEventListener("click", () => {
            refreshData();
        });
    }

    const settingsBtn = document.getElementById("fp-settings");
    const settingsClose = document.getElementById("fp-settings-close");
    const settingsSave = document.getElementById("fp-settings-save");
    const settingsReset = document.getElementById("fp-settings-reset");
    const settingsModal = document.getElementById("fp-settings-modal");
    const settingsMessage = document.getElementById("fp-settings-message");
    const ferieInput = document.getElementById("fp-color-ferie");
    const permessoInput = document.getElementById("fp-color-permesso");
    const straordinariInput = document.getElementById("fp-color-straordinari");
    const themeInputs = document.querySelectorAll("input[name='fp-theme']");
    const adminOpen = document.getElementById("fp-admin-open");
    const adminModal = document.getElementById("fp-admin-modal");
    const adminClose = document.getElementById("fp-admin-close");
    const adminChange = document.getElementById("fp-admin-change");
    const adminForgot = document.getElementById("fp-admin-forgot");
    const adminEditName = document.getElementById("fp-admin-edit-name");
    const adminEditEmail = document.getElementById("fp-admin-edit-email");
    const adminEditPhone = document.getElementById("fp-admin-edit-phone");
    const adminEditSave = document.getElementById("fp-admin-edit-save");
    const adminEditCancel = document.getElementById("fp-admin-edit-cancel");
    const adminEditClose = document.getElementById("fp-admin-edit-close");
    const adminPasswordOpen = document.getElementById("fp-admin-password-open");
    const adminPasswordPanel = document.getElementById("fp-admin-password-panel");
    const adminAdd = document.getElementById("fp-admin-add");
    const adminAddOpen = document.getElementById("fp-admin-add-open");
    const adminAddCancel = document.getElementById("fp-admin-add-cancel");
    const adminAddClose = document.getElementById("fp-admin-add-close");
    const adminAddModal = document.getElementById("fp-admin-add-modal");
    const adminEditModal = document.getElementById("fp-admin-edit-modal");
    const adminNameInput = document.getElementById("fp-admin-name");
    const adminEmailInput = document.getElementById("fp-admin-email");
    const adminPhoneInput = document.getElementById("fp-admin-phone");
    const adminPasswordInput = document.getElementById("fp-admin-password");
    const adminPasswordConfirmInput = document.getElementById("fp-admin-password-confirm");
    const adminCurrentInput = document.getElementById("fp-admin-current");
    const adminNewInput = document.getElementById("fp-admin-new");
    const adminNewConfirmInput = document.getElementById("fp-admin-new-confirm");

    if (settingsBtn) {
        settingsBtn.addEventListener("click", () => {
            openSettingsModal();
        });
    }
    if (settingsClose) {
        settingsClose.addEventListener("click", () => {
            closeSettingsModal();
        });
    }
    if (settingsModal) {
        settingsModal.addEventListener("click", (event) => {
            if (event.target === settingsModal) closeSettingsModal();
        });
    }
    if (settingsSave) {
        settingsSave.addEventListener("click", () => {
            const nextColors = {
                ferie: normalizeHexColor(ferieInput?.value, DEFAULT_TYPE_COLORS.ferie),
                permesso: normalizeHexColor(permessoInput?.value, DEFAULT_TYPE_COLORS.permesso),
                straordinari: normalizeHexColor(straordinariInput?.value, DEFAULT_TYPE_COLORS.straordinari),
            };
            const selectedTheme = Array.from(themeInputs).find((input) => input.checked)?.value || "light";
            typeColors = { ...nextColors };
            saveColorSettings(typeColors);
            applyTypeColors();
            saveThemeSetting(selectedTheme);
            applyTheme(selectedTheme);
            renderAll(loadData());
            setMessage(settingsMessage, "");
            hideModal(settingsModal);
            settingsSnapshot = {
                theme: selectedTheme,
                colors: { ...nextColors },
            };
        });
    }

    themeInputs.forEach((input) => {
        input.addEventListener("change", () => {
            if (!input.checked) return;
            applyTheme(input.value);
        });
    });
    if (settingsReset) {
        settingsReset.addEventListener("click", () => {
            typeColors = { ...DEFAULT_TYPE_COLORS };
            saveColorSettings(typeColors);
            setSettingsInputsFromColors();
            applyTypeColors();
            renderAll(loadData());
            setMessage(settingsMessage, "Colori ripristinati.", false);
        });
    }

    const handleColorPreview = () => {
        const nextColors = {
            ferie: normalizeHexColor(ferieInput?.value, DEFAULT_TYPE_COLORS.ferie),
            permesso: normalizeHexColor(permessoInput?.value, DEFAULT_TYPE_COLORS.permesso),
            straordinari: normalizeHexColor(straordinariInput?.value, DEFAULT_TYPE_COLORS.straordinari),
        };
        typeColors = { ...nextColors };
        applyTypeColors();
        renderAll(loadData());
    };
    if (ferieInput) ferieInput.addEventListener("input", handleColorPreview);
    if (permessoInput) permessoInput.addEventListener("input", handleColorPreview);
    if (straordinariInput) straordinariInput.addEventListener("input", handleColorPreview);

    if (adminOpen) {
        adminOpen.addEventListener("click", () => {
            openPasswordModal({
                type: "admin-access",
                id: "admin-access",
                title: "Gestione admin",
                description: "Inserisci la password admin per aprire la gestione.",
            });
        });
    }
    if (adminClose) {
        adminClose.addEventListener("click", closeAdminModal);
    }
    if (adminModal) {
        adminModal.addEventListener("click", (event) => {
            event.stopPropagation();
        });
    }
    if (adminAddModal) {
        adminAddModal.addEventListener("click", (event) => {
            event.stopPropagation();
        });
    }
    if (adminEditModal) {
        adminEditModal.addEventListener("click", (event) => {
            event.stopPropagation();
        });
    }
    if (adminEditSave) {
        adminEditSave.addEventListener("click", () => {
            const name = adminEditName ? adminEditName.value.trim() : "";
            if (!name) {
                setAdminMessage("fp-admin-edit-message", "Inserisci un nome valido.", true);
                return;
            }
            if (adminEditingIndex < 0 || adminEditingIndex >= adminCache.length) {
                setAdminMessage("fp-admin-edit-message", "Seleziona un admin da modificare.", true);
                return;
            }
            const emailValue = adminEditEmail ? adminEditEmail.value.trim() : "";
            const phoneValue = adminEditPhone ? adminEditPhone.value.trim() : "";
            if (emailValue && !isValidEmail(emailValue)) {
                setAdminMessage("fp-admin-edit-message", "Email non valida.", true);
                return;
            }
            if (phoneValue && !isValidPhone(phoneValue)) {
                setAdminMessage("fp-admin-edit-message", "Numero telefono non valido (prefisso +39 obbligatorio).", true);
                return;
            }
            const exists = adminCache.some((admin, idx) => idx !== adminEditingIndex && admin.name.toLowerCase() === name.toLowerCase());
            if (exists) {
                setAdminMessage("fp-admin-edit-message", "Esiste gia un admin con questo nome.", true);
                return;
            }
            adminCache[adminEditingIndex].name = name;
            adminCache[adminEditingIndex].email = emailValue;
            adminCache[adminEditingIndex].phone = phoneValue;
            adminCache.sort((a, b) => a.name.localeCompare(b.name));
            adminEditingIndex = -1;
            saveAdminCredentials(adminCache);
            renderAdminList();
            if (adminEditModal) hideModal(adminEditModal);
            setAdminMessage("fp-admin-edit-message", "");
            setAdminMessage("fp-admin-message", "Admin aggiornato.", false);
        });
    }
    if (adminEditClose) {
        adminEditClose.addEventListener("click", () => {
            if (adminEditModal) hideModal(adminEditModal);
            if (adminPasswordPanel) adminPasswordPanel.classList.add("is-hidden");
            adminEditingIndex = -1;
            setAdminMessage("fp-admin-edit-message", "");
        });
    }
    if (adminAddOpen) {
        adminAddOpen.addEventListener("click", () => {
            if (adminAddModal) showModal(adminAddModal);
            setAdminMessage("fp-admin-add-message", "");
        });
    }
    if (adminAddClose) {
        adminAddClose.addEventListener("click", () => {
            if (adminAddModal) hideModal(adminAddModal);
            if (adminNameInput) adminNameInput.value = "";
            if (adminEmailInput) adminEmailInput.value = "";
            if (adminPhoneInput) adminPhoneInput.value = "";
            if (adminPasswordInput) adminPasswordInput.value = "";
            if (adminPasswordConfirmInput) adminPasswordConfirmInput.value = "";
            setAdminMessage("fp-admin-add-message", "");
        });
    }
    if (adminAddCancel) {
        adminAddCancel.addEventListener("click", () => {
            if (adminAddModal) hideModal(adminAddModal);
            if (adminNameInput) adminNameInput.value = "";
            if (adminEmailInput) adminEmailInput.value = "";
            if (adminPhoneInput) adminPhoneInput.value = "";
            if (adminPasswordInput) adminPasswordInput.value = "";
            if (adminPasswordConfirmInput) adminPasswordConfirmInput.value = "";
            setAdminMessage("fp-admin-add-message", "");
        });
    }
    if (adminAdd) {
        adminAdd.addEventListener("click", async () => {
            const name = adminNameInput ? adminNameInput.value.trim() : "";
            const pass = adminPasswordInput ? adminPasswordInput.value : "";
            const confirm = adminPasswordConfirmInput ? adminPasswordConfirmInput.value : "";
            const email = adminEmailInput ? adminEmailInput.value.trim() : "";
            const phone = adminPhoneInput ? adminPhoneInput.value.trim() : "";
            if (!name || !pass || !confirm) {
                setAdminMessage("fp-admin-add-message", "Compila tutti i campi.", true);
                return;
            }
            if (email && !isValidEmail(email)) {
                setAdminMessage("fp-admin-add-message", "Email non valida.", true);
                return;
            }
            if (phone && !isValidPhone(phone)) {
                setAdminMessage("fp-admin-add-message", "Numero telefono non valido (prefisso +39 obbligatorio).", true);
                return;
            }
            if (pass !== confirm) {
                setAdminMessage("fp-admin-add-message", "Le password non coincidono.", true);
                return;
            }
            if (!argon2) {
                await showDialog("error", "Modulo 'argon2' non disponibile.", "Esegui 'npm install argon2' nella cartella del progetto.");
                return;
            }
            const exists = adminCache.some((admin) => admin.name.toLowerCase() === name.toLowerCase());
            if (exists) {
                setAdminMessage("fp-admin-add-message", "Esiste gia un admin con questo nome.", true);
                return;
            }
            const hash = await argon2.hash(pass);
            adminCache.push({ name, passwordHash: hash, email, phone });
            adminCache.sort((a, b) => a.name.localeCompare(b.name));
            saveAdminCredentials(adminCache);
            renderAdminList();
            if (adminNameInput) adminNameInput.value = "";
            if (adminEmailInput) adminEmailInput.value = "";
            if (adminPhoneInput) adminPhoneInput.value = "";
            if (adminPasswordInput) adminPasswordInput.value = "";
            if (adminPasswordConfirmInput) adminPasswordConfirmInput.value = "";
            setAdminMessage("fp-admin-add-message", "Admin aggiunto.", false);
            if (adminAddModal) hideModal(adminAddModal);
        });
    }
    if (adminEditCancel) {
        adminEditCancel.addEventListener("click", () => {
            if (adminEditModal) hideModal(adminEditModal);
            if (adminPasswordPanel) adminPasswordPanel.classList.add("is-hidden");
            adminEditingIndex = -1;
            setAdminMessage("fp-admin-edit-message", "");
        });
    }
    if (adminPasswordOpen) {
        adminPasswordOpen.addEventListener("click", () => {
            if (adminPasswordPanel) adminPasswordPanel.classList.toggle("is-hidden");
        });
    }
    if (adminChange) {
        adminChange.addEventListener("click", async () => {
            const current = adminCurrentInput ? adminCurrentInput.value : "";
            const next = adminNewInput ? adminNewInput.value : "";
            const confirm = adminNewConfirmInput ? adminNewConfirmInput.value : "";
            if (adminEditingIndex < 0 || adminEditingIndex >= adminCache.length) {
                setAdminMessage("fp-admin-edit-message", "Seleziona un admin da modificare.", true);
                return;
            }
            if (!current || !next || !confirm) {
                setAdminMessage("fp-admin-edit-message", "Compila tutti i campi.", true);
                return;
            }
            if (next !== confirm) {
                setAdminMessage("fp-admin-edit-message", "Le nuove password non coincidono.", true);
                return;
            }
            if (!argon2) {
                await showDialog("error", "Modulo 'argon2' non disponibile.", "Esegui 'npm install argon2' nella cartella del progetto.");
                return;
            }
            const admin = adminCache[adminEditingIndex];
            const verify = await verifyAdminPassword(current, admin?.name);
            if (!admin || !verify) {
                setAdminMessage("fp-admin-edit-message", "Password attuale non valida.", true);
                return;
            }
            admin.passwordHash = await argon2.hash(next);
            delete admin.password;
            saveAdminCredentials(adminCache);
            if (adminCurrentInput) adminCurrentInput.value = "";
            if (adminNewInput) adminNewInput.value = "";
            if (adminNewConfirmInput) adminNewConfirmInput.value = "";
            setAdminMessage("fp-admin-edit-message", "Password aggiornata.", false);
        });
    }
    if (adminForgot) {
        adminForgot.addEventListener("click", () => {
            setAdminMessage("fp-admin-edit-message", "Funzione in arrivo.", false);
        });
    }

    const approveCancel = document.getElementById("fp-approve-cancel");
    const approveConfirm = document.getElementById("fp-approve-confirm");
    const approveModal = document.getElementById("fp-approve-modal");
    if (approveCancel) {
        approveCancel.addEventListener("click", closeApprovalModal);
    }
    if (approveConfirm) {
        approveConfirm.addEventListener("click", confirmApproval);
    }
    if (approveModal) {
        approveModal.addEventListener("click", (event) => {
            event.stopPropagation();
        });
    }

    const approvePassword = document.getElementById("fp-approve-password");
    if (approvePassword) {
        approvePassword.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                event.preventDefault();
                confirmApproval();
            } else if (event.key === "Escape") {
                event.preventDefault();
                closeApprovalModal();
            }
        });
    }

    const editModal = document.getElementById("fp-edit-modal");
    const editForm = document.getElementById("fp-edit-form");
    const editCancel = document.getElementById("fp-edit-cancel");
    const editDelete = document.getElementById("fp-edit-delete");
    const editMessage = document.getElementById("fp-edit-message");
    const editAllDay = document.getElementById("fp-edit-all-day");
    const editStartTime = document.getElementById("fp-edit-start-time");
    const editEndTime = document.getElementById("fp-edit-end-time");
    const editStartDate = document.getElementById("fp-edit-start-date");
    const editEndDate = document.getElementById("fp-edit-end-date");

    if (editAllDay) {
        toggleAllDayStateFor("fp-edit", editAllDay.checked);
        editAllDay.addEventListener("change", () => {
            toggleAllDayStateFor("fp-edit", editAllDay.checked);
        });
    }
    const handleEditTimeFocus = () => {
        if (!editAllDay || !editAllDay.checked || editAllDay.disabled) return;
        editAllDay.checked = false;
        toggleAllDayStateFor("fp-edit", false);
    };
    if (editStartTime) editStartTime.addEventListener("focus", handleEditTimeFocus);
    if (editEndTime) editEndTime.addEventListener("focus", handleEditTimeFocus);

    if (editStartDate && editEndDate) {
        const normalizeEditDates = () => {
            if (!editStartDate.value || !editEndDate.value) return;
            if (editStartDate.value.length !== 10 || editEndDate.value.length !== 10) return;
            if (editEndDate.value < editStartDate.value) {
                setInlineError("fp-edit-end-date-error", "La data fine non puo essere precedente alla data inizio.");
            } else {
                setInlineError("fp-edit-end-date-error", "");
            }
            if (editEndDate.value > editStartDate.value && editAllDay) {
                editAllDay.checked = true;
                toggleAllDayStateFor("fp-edit", true);
            }
            updateAllDayLock(editStartDate, editEndDate, editAllDay, "fp-edit");
        };
        editStartDate.addEventListener("change", normalizeEditDates);
        editEndDate.addEventListener("input", normalizeEditDates);
        editEndDate.addEventListener("change", normalizeEditDates);
    }

    if (editCancel) {
        editCancel.addEventListener("click", () => {
            closeEditModal();
        });
    }

    if (editDelete) {
        editDelete.addEventListener("click", () => {
            if (!editingRequestId) return;
            const targetId = editingRequestId;
            closeEditModal();
            openPasswordModal({
                type: "delete",
                id: targetId,
                title: "Elimina richiesta",
                description: "Inserisci la password per eliminare definitivamente la richiesta.",
            });
        });
    }

    if (editModal) {
        editModal.addEventListener("click", (event) => {
            event.stopPropagation();
        });
    }

    if (editForm) {
        editForm.addEventListener("submit", (event) => {
            event.preventDefault();
            if (!editingRequestId) return;
            setMessage(editMessage, "");
            const { request, error } = buildRequestFromForm("fp-edit", editingRequestId, true);
            if (error) {
                setMessage(editMessage, error, true);
                if (error.includes("data fine")) {
                    setInlineError("fp-edit-end-date-error", error);
                } else {
                    setInlineError("fp-edit-end-date-error", "");
                }
                return;
            }
            const updated = syncData((payload) => {
                payload.requests = payload.requests || [];
                const idx = payload.requests.findIndex((req) => req.id === editingRequestId);
                if (idx >= 0) {
                    const existing = payload.requests[idx];
                    payload.requests[idx] = {
                        ...existing,
                        ...request,
                        status: "approved",
                        approvedAt: existing.approvedAt || new Date().toISOString(),
                        createdAt: existing.createdAt || new Date().toISOString(),
                        modifiedAt: new Date().toISOString(),
                        modifiedBy: editingAdminName || existing.modifiedBy || "",
                    };
                }
                return payload;
            });
            setMessage(editMessage, "Richiesta aggiornata.", false);
            closeEditModal();
            editingAdminName = "";
            renderAll(updated);
        });
    }

    const pendingToggle = document.getElementById("fp-pending-toggle");
    const pendingClose = document.getElementById("fp-pending-close");
    if (pendingToggle) {
        pendingToggle.addEventListener("click", () => {
            if (pendingPanelOpen) {
                closePendingPanel();
                return;
            }
            if (pendingUnlocked) {
                openPendingPanel();
                return;
            }
            openPasswordModal({
                type: "pending-access",
                id: "pending-access",
                title: "Richieste in attesa",
                description: "Inserisci la password per visualizzare le richieste in attesa.",
            });
        });
    }
    if (pendingClose) {
        pendingClose.addEventListener("click", () => {
            closePendingPanel();
        });
    }

    const assigneesManage = document.getElementById("fp-assignees-manage");
    const assigneesModal = document.getElementById("fp-assignees-modal");
    const assigneesClose = document.getElementById("fp-assignees-close");
    const departmentInput = document.getElementById("fp-department-name");
    const departmentAdd = document.getElementById("fp-department-add");
    const employeeNameInput = document.getElementById("fp-employee-name");
    const employeeAdd = document.getElementById("fp-employee-add");

    const closeAssigneesModal = () => {
        if (!assigneesModal) return;
        hideModal(assigneesModal);
        if (departmentInput) departmentInput.value = "";
        if (employeeNameInput) employeeNameInput.value = "";
        editingDepartment = null;
        editingEmployee = null;
        renderDepartmentList();
        renderEmployeesList();
        renderDepartmentSelect();
    };

    if (assigneesManage && assigneesModal) {
        assigneesManage.addEventListener("click", () => {
            showModal(assigneesModal);
            renderDepartmentList();
            renderEmployeesList();
            renderDepartmentSelect();
            if (departmentInput) departmentInput.focus();
        });
    }

    if (assigneesClose) {
        assigneesClose.addEventListener("click", closeAssigneesModal);
    }

    if (assigneesModal) {
        assigneesModal.addEventListener("click", (event) => {
            if (event.target === assigneesModal) closeAssigneesModal();
        });
    }

    if (departmentAdd) {
        departmentAdd.addEventListener("click", () => {
            const name = departmentInput ? departmentInput.value.trim() : "";
            if (!name || assigneeGroups[name]) return;
            assigneeGroups[name] = [];
            assigneeOptions = Object.values(assigneeGroups).flat();
            saveAssigneeOptions(assigneeGroups);
            renderDepartmentList();
            renderDepartmentSelect();
            populateEmployees();
            if (departmentInput) departmentInput.value = "";
        });
    }

    if (employeeAdd) {
        employeeAdd.addEventListener("click", () => {
            const select = document.getElementById("fp-employee-department");
            const department = select ? select.value : "";
            const name = employeeNameInput ? employeeNameInput.value.trim() : "";
            if (!department || !name) return;
            if (!assigneeGroups[department]) assigneeGroups[department] = [];
            if (!assigneeGroups[department].includes(name)) {
                assigneeGroups[department].push(name);
                assigneeGroups[department].sort((a, b) => a.localeCompare(b));
            }
            assigneeOptions = Object.values(assigneeGroups).flat();
            saveAssigneeOptions(assigneeGroups);
            renderEmployeesList();
            populateEmployees();
            if (employeeNameInput) employeeNameInput.value = "";
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
            openExportModal();
        });
    }

    if (exportClose) {
        exportClose.addEventListener("click", () => {
            closeExportModal();
        });
    }

    if (exportModal) {
        exportModal.addEventListener("click", (event) => {
            if (event.target === exportModal) closeExportModal();
        });
    }

    if (exportSelectAll) {
        exportSelectAll.addEventListener("click", () => {
            setExportDepartmentsChecked(true);
        });
    }

    if (exportSelectNone) {
        exportSelectNone.addEventListener("click", () => {
            setExportDepartmentsChecked(false);
        });
    }

    if (exportRangeRadios.length) {
        exportRangeRadios.forEach((radio) => {
            radio.addEventListener("change", updateExportDateState);
        });
    }

    if (exportRun) {
        exportRun.addEventListener("click", async () => {
            if (!XLSX) {
                await showDialog("error", "Modulo 'xlsx' non trovato.", "Esegui 'npm install xlsx' nella cartella del progetto AyPi.");
                return;
            }
            const rangeMode = document.querySelector("input[name='fp-export-range']:checked")?.value || "all";
            const startDate = parseDateInput(document.getElementById("fp-export-start")?.value || "");
            const endDate = parseDateInput(document.getElementById("fp-export-end")?.value || "");
            if (rangeMode === "custom" && (!startDate || !endDate || endDate < startDate)) {
                setMessage(document.getElementById("fp-export-message"), "Seleziona un intervallo valido.", true);
                return;
            }
            const includeFerie = !!document.getElementById("fp-export-ferie")?.checked;
            const includePermessi = !!document.getElementById("fp-export-permessi")?.checked;
            const includeStraordinari = !!document.getElementById("fp-export-straordinari")?.checked;
            if (!includeFerie && !includePermessi && !includeStraordinari) {
                setMessage(document.getElementById("fp-export-message"), "Seleziona almeno un tipo.", true);
                return;
            }
            const departments = getExportSelectedDepartments();

            const raw = loadData().requests || [];
            const approved = raw.filter((req) => req.status === "approved");
            const filtered = approved.filter((req) => {
                if (req.type === "ferie" && !includeFerie) return false;
                if (req.type === "permesso" && !includePermessi) return false;
                if (req.type === "straordinari" && !includeStraordinari) return false;
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
                setMessage(document.getElementById("fp-export-message"), "Nessun dato da esportare.", true);
                return;
            }

            const rows = buildExportRows(filtered);
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
                const cell = ws[`E${idx + 2}`];
                if (cell && cell.t === "n") {
                    cell.z = "0.00";
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
            setMessage(document.getElementById("fp-export-message"), "File Excel creato con successo.", false);
        });
    }

    closePendingPanel();

    document.addEventListener("keydown", (event) => {
        if (event.key !== "Delete") return;
        const target = event.target;
        if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
            return;
        }
        if (!selectedEventId) return;
        openPasswordModal({
            type: "delete",
            id: selectedEventId,
            title: "Elimina richiesta",
            description: "Inserisci la password per eliminare definitivamente la richiesta.",
        });
    });

    refreshData();
    scheduleAutoRefresh();

}

document.addEventListener("DOMContentLoaded", init);
