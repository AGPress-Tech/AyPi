// @ts-nocheck
require("../shared/dev-guards");
import fs from "fs";
import path from "path";
import { loadStore, saveStore, DATA_PATH } from "./ticket-support/services/storage";
import { BASE_DIR, TICKET_DIR, CATEGORIES_PATH } from "./ticket-support/config/paths";
import { isMailerAvailable, getMailerError, sendMail } from "./ticket-support/services/mailer";
import { ipcRenderer } from "electron";
import { loadAssigneeOptions } from "./ferie-permessi/services/assignees";
import { loadAdminCredentials, saveAdminCredentials, verifyAdminPassword, findAdminByName, isValidEmail } from "./ferie-permessi/services/admins";
import { createOtpModals } from "./ferie-permessi/ui/otp-modals";
import { isHashingAvailable, hashPassword, getAuthenticator, otpState, resetOtpState } from "./ferie-permessi/config/security";
import { isMailerAvailable as isOtpMailerAvailable, getMailerError as getOtpMailerError, sendOtpEmail } from "./ferie-permessi/services/otp-mail";
import { OTP_EXPIRY_MS, OTP_RESEND_MS } from "./ferie-permessi/config/constants";
import { showDialog } from "./ferie-permessi/services/dialogs";
import { session, setSession, saveSession, loadSession, clearSession, applySharedSessionData, isAdmin, isEmployee, isLoggedIn } from "./product-manager/state/session";
import { renderLoginSelectors, renderAdminSelect } from "./product-manager/ui/login-selectors";

const ADMIN_EMAIL = "tech@agpress-srl.it";
const STATUS_LIST = ["Da prendere in carico", "Presa in carico", "In Attesa", "Risolto", "Chiuso"];
const FINAL_STATUSES = new Set(["Risolto", "Chiuso"]);
const FINAL_STATUS_KEEP_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_ISSUE_TYPES = ["Assistenza", "Bug", "Richiesta nuova funzione", "Altro"];
const DEFAULT_AREAS = ["Mail", "MES", "Gestionale", "Hardware", "Rete", "Altro"];
const params = new URLSearchParams(window.location.search || "");
const currentView = (params.get("tsView") || "form").toLowerCase() === "admin" ? "admin" : "form";

let store = loadStore();
let assigneeGroups = {};
let adminCache = [];
let statusEditingTicketId = "";
let editTicketId = "";
let editMode = "";
let adminLoginFailCount = 0;
const adminFilters = { search: "", status: "", area: "", priority: "" };
const operatorFilters = { search: "", status: "", area: "", priority: "" };
const TS_THEME_KEY = "ts-theme";
const TICKET_BACKUP_ROOT_DIR = path.join(BASE_DIR, "Backup Ticket");
let ticketCategories = { issueTypes: [...DEFAULT_ISSUE_TYPES], areas: [...DEFAULT_AREAS] };
const categoriesUiState = { issueTypesEditingName: null, areasEditingName: null };

function nowIso() {
    return new Date().toISOString();
}

function toKey(value) {
    return String(value || "").trim().toLowerCase();
}

function escapeHtml(value) {
    return String(value || "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll("\"", "&quot;")
        .replaceAll("'", "&#39;");
}

function formatDateTime(value) {
    if (!value) return "-";
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) return "-";
    return new Intl.DateTimeFormat("it-IT", { dateStyle: "short", timeStyle: "medium" }).format(date);
}

function setTheme(theme) {
    const mode = theme === "dark" || theme === "aypi" ? theme : "light";
    document.body.classList.remove("fp-dark", "fp-aypi");
    if (mode === "dark") document.body.classList.add("fp-dark");
    if (mode === "aypi") document.body.classList.add("fp-aypi");
    try {
        window.localStorage.setItem(TS_THEME_KEY, mode);
    } catch {}
}

function initTheme() {
    try {
        const saved = window.localStorage.getItem(TS_THEME_KEY);
        setTheme(saved || "light");
    } catch {
        setTheme("light");
    }
}

function ensureDir(targetDir) {
    if (!targetDir) return;
    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
}

function copyDirectory(sourceDir, targetDir) {
    if (!sourceDir || !targetDir) return;
    ensureDir(targetDir);
    const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
    entries.forEach((entry) => {
        const src = path.join(sourceDir, entry.name);
        const dst = path.join(targetDir, entry.name);
        if (entry.isDirectory()) {
            copyDirectory(src, dst);
            return;
        }
        if (entry.isFile()) {
            ensureDir(path.dirname(dst));
            fs.copyFileSync(src, dst);
        }
    });
}

function formatBackupDate(date) {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
}

function openSettingsModal() {
    if (!isLoggedIn()) {
        showWarning("Accesso richiesto.");
        openLoginModal();
        return;
    }
    openModal("ts-settings-modal");
}

function closeSettingsModal() {
    closeModal("ts-settings-modal");
}

function openThemeModal() {
    openModal("ts-theme-modal");
}

function closeThemeModal() {
    closeModal("ts-theme-modal");
}

function setBackupMessage(text, isError = false) {
    setMessage(document.getElementById("ts-backup-message"), text, isError);
}

function openBackupModal() {
    if (!isAdmin()) {
        showWarning("Accesso admin richiesto.");
        return;
    }
    setBackupMessage("");
    openModal("ts-backup-modal");
}

function closeBackupModal() {
    closeModal("ts-backup-modal");
}

function createTicketBackup() {
    try {
        setBackupMessage("");
        ensureDir(TICKET_DIR);
        ensureDir(TICKET_BACKUP_ROOT_DIR);
        const dateLabel = formatBackupDate(new Date());
        let targetDir = path.join(TICKET_BACKUP_ROOT_DIR, dateLabel);
        let suffix = 1;
        while (fs.existsSync(targetDir)) {
            suffix += 1;
            targetDir = path.join(TICKET_BACKUP_ROOT_DIR, `${dateLabel}-${suffix}`);
        }
        copyDirectory(TICKET_DIR, targetDir);
        setBackupMessage(`Backup creato: ${targetDir}`);
    } catch (err) {
        setBackupMessage(`Errore creazione backup: ${err.message || String(err)}`, true);
    }
}

async function restoreTicketBackup() {
    try {
        setBackupMessage("");
        const ok = window.confirm("Ripristinare un backup Ticket? I file correnti verranno sovrascritti.");
        if (!ok) return;
        const selected = await ipcRenderer.invoke("select-root-folder");
        if (!selected) return;
        ensureDir(TICKET_DIR);
        copyDirectory(selected, TICKET_DIR);
        store = loadStore();
        renderAll();
        setBackupMessage("Ripristino completato.");
    } catch (err) {
        setBackupMessage(`Errore ripristino backup: ${err.message || String(err)}`, true);
    }
}

function showInlineMessage(nodeId, text, type = "") {
    const node = document.getElementById(nodeId);
    if (!node) return;
    if (!text) {
        node.textContent = "";
        node.className = "pm-message is-hidden";
        return;
    }
    let className = "pm-message";
    if (type === "error") className += " pm-message--error";
    if (type === "success") className += " pm-message--success";
    node.className = className;
    node.textContent = text;
}

function setMessage(node, text, isError = false) {
    if (!node) return;
    if (!text) {
        node.classList.add("is-hidden");
        node.textContent = "";
        node.classList.remove("pm-message--error", "fp-message--error");
        return;
    }
    node.textContent = text;
    node.classList.remove("is-hidden");
    if (isError) {
        node.classList.add("pm-message--error", "fp-message--error");
    } else {
        node.classList.remove("pm-message--error", "fp-message--error");
    }
}

function showWarning(message) {
    const id = currentView === "admin" ? "ts-admin-message" : "ts-create-message";
    showInlineMessage(id, message, "error");
}

function normalizeList(values, fallback) {
    const items = Array.isArray(values) ? values : [];
    const seen = new Set();
    const normalized = items
        .map((item) => String(item || "").trim())
        .filter((item) => item)
        .filter((item) => {
            const key = toKey(item);
            if (!key || seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    if (!normalized.length) return [...fallback];
    return normalized;
}

function normalizeCategories(input) {
    const source = input && typeof input === "object" ? input : {};
    return {
        issueTypes: normalizeList(source.issueTypes, DEFAULT_ISSUE_TYPES),
        areas: normalizeList(source.areas, DEFAULT_AREAS),
    };
}

function loadTicketCategories() {
    try {
        ensureDir(TICKET_DIR);
        if (!fs.existsSync(CATEGORIES_PATH)) {
            const fallback = normalizeCategories({});
            fs.writeFileSync(CATEGORIES_PATH, JSON.stringify({ version: 1, ...fallback }, null, 2), "utf8");
            return fallback;
        }
        const raw = fs.readFileSync(CATEGORIES_PATH, "utf8");
        const parsed = JSON.parse(raw);
        return normalizeCategories(parsed);
    } catch (err) {
        console.error("[ticket-support] errore lettura categorie:", err);
        return normalizeCategories({});
    }
}

function saveTicketCategories(next) {
    try {
        ensureDir(TICKET_DIR);
        const payload = { version: 1, ...normalizeCategories(next) };
        fs.writeFileSync(CATEGORIES_PATH, JSON.stringify(payload, null, 2), "utf8");
        return true;
    } catch (err) {
        console.error("[ticket-support] errore salvataggio categorie:", err);
        showWarning("Errore salvataggio categorie.");
        return false;
    }
}

function setTicketCategories(next) {
    const normalized = normalizeCategories(next);
    if (saveTicketCategories(normalized)) {
        ticketCategories = normalized;
        renderCategorySelects();
        return true;
    }
    return false;
}

function getIssueTypes() {
    return Array.isArray(ticketCategories.issueTypes) ? ticketCategories.issueTypes : [...DEFAULT_ISSUE_TYPES];
}

function getAreas() {
    return Array.isArray(ticketCategories.areas) ? ticketCategories.areas : [...DEFAULT_AREAS];
}

function ensureOption(select, value, labelSuffix = " (legacy)") {
    if (!select || !value) return;
    const exists = Array.from(select.options).some((opt) => opt.value === value);
    if (exists) return;
    const option = document.createElement("option");
    option.value = value;
    option.textContent = `${value}${labelSuffix}`;
    option.dataset.legacy = "1";
    select.appendChild(option);
}

function renderSelectOptions(select, items, placeholder) {
    if (!select) return;
    const previousValue = select.value;
    select.innerHTML = "";
    if (placeholder) {
        const option = document.createElement("option");
        option.value = "";
        option.textContent = placeholder;
        select.appendChild(option);
    }
    items.forEach((item) => {
        const option = document.createElement("option");
        option.value = item;
        option.textContent = item;
        select.appendChild(option);
    });
    if (previousValue) {
        ensureOption(select, previousValue);
        select.value = previousValue;
    }
}

function renderCategorySelects() {
    const issueTypes = getIssueTypes();
    const areas = getAreas();

    renderSelectOptions(document.getElementById("ts-issue-type"), issueTypes, "Seleziona...");
    renderSelectOptions(document.getElementById("ts-area"), areas, "Seleziona...");
    renderSelectOptions(document.getElementById("ts-edit-type"), issueTypes, null);
    renderSelectOptions(document.getElementById("ts-edit-area"), areas, null);
    renderSelectOptions(document.getElementById("ts-admin-filter-area"), areas, "Tutti");
    renderSelectOptions(document.getElementById("ts-op-filter-area"), areas, "Tutti");

    const adminArea = document.getElementById("ts-admin-filter-area");
    if (adminArea) {
        ensureOption(adminArea, adminFilters.area);
        adminArea.value = adminFilters.area || "";
    }
    const opArea = document.getElementById("ts-op-filter-area");
    if (opArea) {
        ensureOption(opArea, operatorFilters.area);
        opArea.value = operatorFilters.area || "";
    }
}

function renderEditableList({
    listId,
    items,
    editingValue,
    setEditingValue,
    onRename,
    onRemove,
    onReorder,
    emptyLabel,
}) {
    const list = document.getElementById(listId);
    if (!list) return;
    list.innerHTML = "";
    items.forEach((item, index) => {
        const row = document.createElement("div");
        row.className = "fp-assignees-row pm-type-row";
        row.dataset.value = item;
        row.dataset.index = String(index);
        const isEditing = editingValue() === item;
        if (!isEditing) {
            row.setAttribute("draggable", "true");
            row.addEventListener("dragstart", (event) => {
                row.classList.add("is-dragging");
                const dataTransfer = event.dataTransfer;
                if (!dataTransfer) return;
                dataTransfer.effectAllowed = "move";
                dataTransfer.setData("text/plain", row.dataset.index || "");
            });
            row.addEventListener("dragend", () => {
                row.classList.remove("is-dragging");
            });
            row.addEventListener("dragover", (event) => {
                event.preventDefault();
                row.classList.add("is-drop-target");
            });
            row.addEventListener("dragleave", () => {
                row.classList.remove("is-drop-target");
            });
            row.addEventListener("drop", (event) => {
                event.preventDefault();
                row.classList.remove("is-drop-target");
                const dataTransfer = event.dataTransfer;
                if (!dataTransfer) return;
                const fromIndex = Number(dataTransfer.getData("text/plain"));
                const toIndex = Number(row.dataset.index || "0");
                if (Number.isNaN(fromIndex) || Number.isNaN(toIndex) || fromIndex === toIndex) {
                    return;
                }
                onReorder(fromIndex, toIndex);
            });
        }
        const labelWrap = document.createElement("div");
        labelWrap.style.display = "flex";
        labelWrap.style.alignItems = "center";
        labelWrap.style.gap = "8px";
        const dragHandle = document.createElement("span");
        dragHandle.className = "pm-drag-handle material-icons";
        dragHandle.title = "Trascina per riordinare";
        dragHandle.textContent = "drag_indicator";
        if (isEditing) {
            const input = document.createElement("input");
            input.className = "fp-field__input pm-inline-input";
            input.value = item;
            input.addEventListener("keydown", (event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                saveEdit();
            });
            labelWrap.append(dragHandle, input);
        } else {
            const label = document.createElement("span");
            label.textContent = item;
            labelWrap.append(dragHandle, label);
        }
        const actions = document.createElement("div");
        actions.className = "fp-assignees-row__actions";

        const saveEdit = () => {
            const inputEl = labelWrap.querySelector("input");
            const nextName = inputEl?.value?.trim() || "";
            if (!nextName || nextName === item) {
                setEditingValue(null);
                renderCategoriesModal();
                return;
            }
            if (items.some((entry) => toKey(entry) === toKey(nextName))) {
                showWarning("Voce gia' esistente.");
                return;
            }
            onRename(item, nextName);
        };

        if (isEditing) {
            const save = document.createElement("button");
            save.type = "button";
            save.className = "fp-assignees-link";
            save.textContent = "Salva";
            save.addEventListener("click", saveEdit);

            const cancel = document.createElement("button");
            cancel.type = "button";
            cancel.className = "fp-assignees-link fp-assignees-link--danger";
            cancel.textContent = "Annulla";
            cancel.addEventListener("click", () => {
                setEditingValue(null);
                renderCategoriesModal();
            });
            actions.append(save, cancel);
        } else {
            const editBtn = document.createElement("button");
            editBtn.type = "button";
            editBtn.className = "fp-assignees-link";
            editBtn.textContent = "Modifica";
            editBtn.addEventListener("click", () => {
                setEditingValue(item);
                renderCategoriesModal();
            });
            const removeBtn = document.createElement("button");
            removeBtn.type = "button";
            removeBtn.className = "fp-assignees-link fp-assignees-link--danger";
            removeBtn.textContent = "Rimuovi";
            removeBtn.addEventListener("click", () => {
                const ok = window.confirm(`Vuoi eliminare "${item}"?`);
                if (!ok) return;
                onRemove(item);
            });
            actions.append(editBtn, removeBtn);
        }
        row.append(labelWrap, actions);
        list.appendChild(row);
    });
    if (!items.length) {
        list.innerHTML = `<div class="pm-message">${emptyLabel}</div>`;
    }
}

function renderCategoriesModal() {
    const issueTypes = getIssueTypes();
    const areas = getAreas();
    renderEditableList({
        listId: "ts-issue-types-list",
        items: issueTypes,
        editingValue: () => categoriesUiState.issueTypesEditingName,
        setEditingValue: (value) => {
            categoriesUiState.issueTypesEditingName = value;
        },
        onRename: (from, to) => {
            const next = issueTypes.map((item) => (item === from ? to : item));
            if (setTicketCategories({ ...ticketCategories, issueTypes: next })) {
                store.tickets.forEach((ticket) => {
                    if (ticket.issueType === from) ticket.issueType = to;
                });
                saveAll();
                renderAll();
                categoriesUiState.issueTypesEditingName = null;
                renderCategoriesModal();
            }
        },
        onRemove: (value) => {
            const next = issueTypes.filter((item) => item !== value);
            if (setTicketCategories({ ...ticketCategories, issueTypes: next })) {
                renderAll();
                renderCategoriesModal();
            }
        },
        onReorder: (fromIndex, toIndex) => {
            const next = [...issueTypes];
            const [moved] = next.splice(fromIndex, 1);
            next.splice(toIndex, 0, moved);
            if (setTicketCategories({ ...ticketCategories, issueTypes: next })) {
                renderCategoriesModal();
            }
        },
        emptyLabel: "Nessuna tipologia disponibile.",
    });

    renderEditableList({
        listId: "ts-areas-list",
        items: areas,
        editingValue: () => categoriesUiState.areasEditingName,
        setEditingValue: (value) => {
            categoriesUiState.areasEditingName = value;
        },
        onRename: (from, to) => {
            const next = areas.map((item) => (item === from ? to : item));
            if (setTicketCategories({ ...ticketCategories, areas: next })) {
                store.tickets.forEach((ticket) => {
                    if (ticket.area === from) ticket.area = to;
                });
                saveAll();
                renderAll();
                categoriesUiState.areasEditingName = null;
                renderCategoriesModal();
            }
        },
        onRemove: (value) => {
            const next = areas.filter((item) => item !== value);
            if (setTicketCategories({ ...ticketCategories, areas: next })) {
                renderAll();
                renderCategoriesModal();
            }
        },
        onReorder: (fromIndex, toIndex) => {
            const next = [...areas];
            const [moved] = next.splice(fromIndex, 1);
            next.splice(toIndex, 0, moved);
            if (setTicketCategories({ ...ticketCategories, areas: next })) {
                renderCategoriesModal();
            }
        },
        emptyLabel: "Nessun ambito disponibile.",
    });
}

function openCategoriesModal() {
    if (!isAdmin()) {
        showWarning("Accesso admin richiesto.");
        return;
    }
    renderCategoriesModal();
    openModal("ts-categories-modal");
}

function closeCategoriesModal() {
    closeModal("ts-categories-modal");
    categoriesUiState.issueTypesEditingName = null;
    categoriesUiState.areasEditingName = null;
}

function addIssueType() {
    if (!isAdmin()) return;
    const input = document.getElementById("ts-issue-type-name");
    if (!input) return;
    const value = String(input.value || "").trim();
    if (!value) return;
    const items = getIssueTypes();
    if (items.some((item) => toKey(item) === toKey(value))) {
        showWarning("Tipologia gia' presente.");
        return;
    }
    const next = [...items, value];
    if (setTicketCategories({ ...ticketCategories, issueTypes: next })) {
        input.value = "";
        renderCategoriesModal();
    }
}

function addArea() {
    if (!isAdmin()) return;
    const input = document.getElementById("ts-area-name");
    if (!input) return;
    const value = String(input.value || "").trim();
    if (!value) return;
    const items = getAreas();
    if (items.some((item) => toKey(item) === toKey(value))) {
        showWarning("Ambito gia' presente.");
        return;
    }
    const next = [...items, value];
    if (setTicketCategories({ ...ticketCategories, areas: next })) {
        input.value = "";
        renderCategoriesModal();
    }
}

function isValidSelectValue(select, value) {
    if (!select) return false;
    if (!value) return false;
    return Array.from(select.options).some((opt) => opt.value === value);
}

function buildEditNote(before, after) {
    if (!before || !after) return "Modifica salvata.";
    const changes = [];
    const map = [
        { key: "issueType", label: "Tipo" },
        { key: "area", label: "Ambito" },
        { key: "priority", label: "Priorita" },
        { key: "description", label: "Descrizione" },
    ];
    map.forEach(({ key, label }) => {
        const prev = String(before[key] || "").trim();
        const next = String(after[key] || "").trim();
        if (prev !== next) {
            changes.push(`${label}: "${prev || "-"}" -> "${next || "-"}"`);
        }
    });
    if (!changes.length) return "Nessuna modifica ai campi principali.";
    return `Modifiche: ${changes.join("; ")}`;
}

function getPersonKey(name) {
    return `person|${toKey(name)}`;
}

function getCurrentRequester() {
    if (isEmployee()) {
        const personKey = getPersonKey(session.employee || "");
        return {
            role: "employee",
            name: session.employee || "",
            department: session.department || "",
            personKey,
            key: `${toKey(session.department)}|${toKey(session.employee)}`,
        };
    }
    if (isAdmin()) {
        const personKey = getPersonKey(session.adminName || "Admin");
        return {
            role: "admin",
            name: session.adminName || "Admin",
            department: "Admin",
            personKey,
            key: `admin|${toKey(session.adminName)}`,
        };
    }
    return { role: "guest", name: "", department: "", personKey: "", key: "" };
}

function getTicketOwnerPersonKey(ticket) {
    if (!ticket) return "";
    const createdByKey = String(ticket.createdByKey || "").trim().toLowerCase();
    if (createdByKey.startsWith("person|")) return createdByKey;
    const requesterName = String(ticket.requester?.name || "").trim();
    if (requesterName) return getPersonKey(requesterName);
    return "";
}

function isTicketOwnedByRequester(ticket, requester) {
    if (!ticket || !requester) return false;
    const personKey = String(requester.personKey || "").trim().toLowerCase();
    const legacyKey = String(requester.key || "").trim().toLowerCase();
    const ticketKey = String(ticket.createdByKey || "").trim().toLowerCase();
    const ticketPersonKey = getTicketOwnerPersonKey(ticket);
    if (personKey && (ticketKey === personKey || ticketPersonKey === personKey)) return true;
    if (legacyKey && ticketKey === legacyKey) return true;
    return false;
}

function buildTicketId() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    const ss = String(d.getSeconds()).padStart(2, "0");
    const rnd = Math.floor(Math.random() * 900 + 100);
    return `TS-${y}${m}${day}-${hh}${mm}${ss}-${rnd}`;
}

function createHistory(payload) {
    return {
        at: nowIso(),
        event: String(payload?.event || "").trim(),
        actor: String(payload?.actor || "").trim(),
        fromStatus: String(payload?.fromStatus || "").trim(),
        toStatus: String(payload?.toStatus || "").trim(),
        note: String(payload?.note || "").trim(),
    };
}

function saveAll() {
    store = saveStore(store);
}

function getTicketById(ticketId) {
    return store.tickets.find((ticket) => ticket.id === ticketId) || null;
}

function canEmployeeEdit(ticket) {
    if (!isEmployee()) return false;
    const me = getCurrentRequester();
    return !!ticket && isTicketOwnedByRequester(ticket, me) && ticket.status === "Da prendere in carico";
}

function canEmployeeDelete(ticket) {
    return canEmployeeEdit(ticket);
}

function updateStatusDates(ticket, nextStatus, at) {
    ticket.lastStatusChangeAt = at;
    if (nextStatus === "Risolto") {
        ticket.resolvedAt = ticket.resolvedAt || at;
    }
    if (nextStatus === "Chiuso") {
        ticket.closedAt = ticket.closedAt || at;
        ticket.resolvedAt = ticket.resolvedAt || at;
    }
}

function isFinalStatus(status) {
    return FINAL_STATUSES.has(String(status || "").trim());
}

function getFinalStatusTimestamp(ticket) {
    const status = String(ticket?.status || "").trim();
    let raw = "";
    if (status === "Chiuso") {
        raw = ticket?.closedAt || ticket?.resolvedAt || ticket?.lastStatusChangeAt || ticket?.updatedAt || ticket?.createdAt || "";
    } else if (status === "Risolto") {
        raw = ticket?.resolvedAt || ticket?.lastStatusChangeAt || ticket?.updatedAt || ticket?.createdAt || "";
    }
    if (!raw) return 0;
    const ts = new Date(raw).getTime();
    return Number.isFinite(ts) ? ts : 0;
}

function isTicketExpired(ticket, nowMs) {
    if (!isFinalStatus(ticket?.status)) return false;
    const at = getFinalStatusTimestamp(ticket);
    if (!at) return false;
    return nowMs - at >= FINAL_STATUS_KEEP_MS;
}

function filterAdminTickets(tickets) {
    const search = adminFilters.search.toLowerCase();
    const nowMs = Date.now();
    return tickets
        .filter((ticket) => !isTicketExpired(ticket, nowMs))
        .filter((ticket) => {
            if (adminFilters.status && ticket.status !== adminFilters.status) return false;
            if (adminFilters.area && ticket.area !== adminFilters.area) return false;
            if (adminFilters.priority && ticket.priority !== adminFilters.priority) return false;
            if (!search) return true;
            const haystack = [
                ticket.id,
                ticket.requester?.name,
                ticket.requester?.department,
                ticket.issueType,
                ticket.area,
                ticket.priority,
                ticket.status,
                ticket.description,
            ].join(" ").toLowerCase();
            return haystack.includes(search);
        })
        .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
}

function filterOperatorTickets(tickets) {
    const search = operatorFilters.search.toLowerCase();
    const nowMs = Date.now();
    return tickets
        .filter((ticket) => !isTicketExpired(ticket, nowMs))
        .filter((ticket) => {
            if (operatorFilters.status && ticket.status !== operatorFilters.status) return false;
            if (operatorFilters.area && ticket.area !== operatorFilters.area) return false;
            if (operatorFilters.priority && ticket.priority !== operatorFilters.priority) return false;
            if (!search) return true;
            const haystack = [
                ticket.id,
                ticket.issueType,
                ticket.area,
                ticket.priority,
                ticket.status,
                ticket.description,
            ].join(" ").toLowerCase();
            return haystack.includes(search);
        })
        .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
}

async function trySendMail(payload) {
    if (!isMailerAvailable()) {
        const err = getMailerError();
        return { ok: false, error: err ? String(err.message || err) : "Mailer non disponibile" };
    }
    try {
        await sendMail(payload);
        return { ok: true };
    } catch (err) {
        return { ok: false, error: err.message || String(err) };
    }
}

async function notifyAdminOnCreate(ticket) {
    const subject = `[AyPi Ticket Support] Nuova segnalazione ${ticket.id}`;
    const text =
        `Nuovo ticket ricevuto.\n\n` +
        `ID: ${ticket.id}\n` +
        `Dipendente: ${ticket.requester.name}\n` +
        `Reparto: ${ticket.requester.department || "-"}\n` +
        `Tipo: ${ticket.issueType}\n` +
        `Ambito: ${ticket.area}\n` +
        `Priorita: ${ticket.priority}\n` +
        `Stato: ${ticket.status}\n` +
        `Creato: ${formatDateTime(ticket.createdAt)}\n\n` +
        `Descrizione:\n${ticket.description}`;
    return trySendMail({ to: ADMIN_EMAIL, subject, text });
}

async function notifyRequesterOnStatusChange(ticket, fromStatus, toStatus) {
    const recipient = String(ticket.requester?.email || "").trim();
    if (!recipient || !isValidEmail(recipient)) {
        return { ok: false, skipped: true, error: "Email dipendente non disponibile." };
    }
    const subject = `[AyPi Ticket Support] Aggiornamento ticket ${ticket.id}`;
    const text =
        `Ciao ${ticket.requester.name || "utente"},\n\n` +
        `lo stato del ticket ${ticket.id} e' cambiato:\n` +
        `${fromStatus} -> ${toStatus}\n\n` +
        `Descrizione:\n${ticket.description}\n`;
    return trySendMail({ to: recipient, subject, text });
}

function renderOperatorList() {
    const container = document.getElementById("ts-operator-list");
    if (!container) return;
    const title = document.getElementById("ts-list-title");
    if (title) title.textContent = "I miei ticket";

    if (!isLoggedIn()) {
        container.innerHTML = `<div class="ts-ticket-card"><div class="ts-ticket-card__desc">Accedi per vedere le tue richieste.</div></div>`;
        return;
    }

    const me = getCurrentRequester();
    const adminNameKey = isAdmin() ? toKey(session.adminName || "") : "";
    const mine = filterOperatorTickets(store.tickets.filter((ticket) => {
        if (isTicketOwnedByRequester(ticket, me)) return true;
        if (adminNameKey && toKey(ticket.requester?.name || "") === adminNameKey) return true;
        return false;
    }));

    if (!mine.length) {
        container.innerHTML = `<div class="ts-ticket-card"><div class="ts-ticket-card__desc">Nessun ticket creato.</div></div>`;
        return;
    }

    container.innerHTML = mine.map((ticket) => {
        const history = (ticket.history || [])
            .slice()
            .sort((a, b) => String(a.at).localeCompare(String(b.at)))
            .map((item) => {
                const rawEvent = String(item?.event || "");
                const isCreated = rawEvent.trim().toLowerCase() === "ticket creato";
                const statusPart = !isCreated && (item.fromStatus || item.toStatus)
                    ? ` (${item.fromStatus || "-"} -> ${item.toStatus || "-"})`
                    : "";
                const notePart = item.note ? ` | Info: ${item.note}` : "";
                return `[${formatDateTime(item.at)}] ${item.event}${statusPart}${notePart}`;
            })
            .join("\n");
        const statusClass = ticket.status === "Risolto"
            ? " ts-ticket-card--resolved"
            : ticket.status === "Chiuso"
            ? " ts-ticket-card--closed"
            : "";
        return `
            <article class="ts-ticket-card${statusClass}" data-ticket-id="${escapeHtml(ticket.id)}">
                <div class="ts-ticket-card__head">
                    <div class="ts-ticket-card__title">
                        <button type="button" class="fp-link-btn ts-history-open" data-ticket-id="${escapeHtml(ticket.id)}">${escapeHtml(ticket.id)}</button>
                    </div>
                    <div class="ts-ticket-card__status">${escapeHtml(ticket.status)}</div>
                </div>
                <div class="ts-ticket-card__meta">
                    <div><strong>Tipo:</strong> ${escapeHtml(ticket.issueType || "-")}</div>
                    <div><strong>Ambito:</strong> ${escapeHtml(ticket.area || "-")}</div>
                    <div><strong>Priorita:</strong> ${escapeHtml(ticket.priority || "-")}</div>
                    <div><strong>Creato:</strong> ${escapeHtml(formatDateTime(ticket.createdAt))}</div>
                    <div><strong>Ultimo stato:</strong> ${escapeHtml(formatDateTime(ticket.lastStatusChangeAt))}</div>
                    <div><strong>Risolto/Chiuso:</strong> ${escapeHtml(formatDateTime(ticket.resolvedAt))} / ${escapeHtml(formatDateTime(ticket.closedAt))}</div>
                </div>
                <div class="ts-ticket-card__desc">${escapeHtml(ticket.description || "-")}</div>
                <div class="ts-ticket-card__meta">
                    <div><strong>Storico:</strong></div>
                </div>
                <div class="ts-ticket-card__desc">${escapeHtml(history || "-")}</div>
                <div class="ts-ticket-card__actions">
                    <button type="button" class="pm-btn pm-btn--ghost ts-icon-btn ts-op-edit" data-ticket-id="${escapeHtml(ticket.id)}" title="Modifica ticket" aria-label="Modifica ticket">
                        <span class="material-icons">edit</span>
                    </button>
                    <button type="button" class="pm-btn pm-btn--danger ts-icon-btn ts-op-delete" data-ticket-id="${escapeHtml(ticket.id)}" title="Elimina ticket" aria-label="Elimina ticket">
                        <span class="material-icons">delete</span>
                    </button>
                </div>
            </article>
        `;
    }).join("");

    container.querySelectorAll(".ts-op-edit").forEach((btn) => {
        const ticketId = btn.dataset.ticketId || "";
        const ticket = getTicketById(ticketId);
        btn.disabled = !canEmployeeEdit(ticket);
    });
    container.querySelectorAll(".ts-op-delete").forEach((btn) => {
        const ticketId = btn.dataset.ticketId || "";
        const ticket = getTicketById(ticketId);
        btn.disabled = !canEmployeeDelete(ticket);
    });

    if (container.dataset.tsBound !== "1") {
        container.addEventListener("click", (event) => {
            const target = event.target instanceof Element ? event.target : null;
            if (!target) return;
            const historyBtn = target.closest(".ts-history-open");
            if (historyBtn) {
                openHistoryModal(historyBtn.getAttribute("data-ticket-id") || "");
                return;
            }
            const editBtn = target.closest(".ts-op-edit");
            if (editBtn) {
                const ticketId = editBtn.getAttribute("data-ticket-id") || "";
                if (!editBtn.hasAttribute("disabled")) {
                    editTicketByEmployee(ticketId);
                }
                return;
            }
            const delBtn = target.closest(".ts-op-delete");
            if (delBtn) {
                const ticketId = delBtn.getAttribute("data-ticket-id") || "";
                if (!delBtn.hasAttribute("disabled")) {
                    deleteTicketByEmployee(ticketId);
                }
            }
        });
        container.dataset.tsBound = "1";
    }
}

function renderAdminTable() {
    const table = document.getElementById("ts-admin-table");
    if (!table) return;
    if (!isAdmin()) {
        table.innerHTML = `<div class="pm-table__row"><div class="pm-table__cell">Accesso admin richiesto.</div></div>`;
        return;
    }

    const rows = filterAdminTickets(store.tickets);
    if (!rows.length) {
        table.innerHTML = `<div class="pm-table__row"><div class="pm-table__cell">Nessun ticket trovato.</div></div>`;
        return;
    }

    const header = `
        <div class="pm-table__row pm-table__row--header">
            <div class="pm-table__cell">ID</div>
            <div class="pm-table__cell">Dipendente</div>
            <div class="pm-table__cell">Reparto</div>
            <div class="pm-table__cell">Creato</div>
            <div class="pm-table__cell">Stato</div>
            <div class="pm-table__cell">Ambito</div>
            <div class="pm-table__cell">Priorita</div>
            <div class="pm-table__cell">Descrizione</div>
            <div class="pm-table__cell">Azioni</div>
        </div>
    `;
    const body = rows.map((ticket) => {
        const statusClass = ticket.status === "Risolto"
            ? " pm-table__row--confirmed"
            : ticket.status === "Chiuso"
            ? " pm-table__row--deleted"
            : "";
        return `
        <div class="pm-table__row${statusClass}" data-ticket-id="${escapeHtml(ticket.id)}">
            <div class="pm-table__cell">
                <button type="button" class="fp-link-btn ts-history-open" data-ticket-id="${escapeHtml(ticket.id)}">${escapeHtml(ticket.id)}</button>
            </div>
            <div class="pm-table__cell">${escapeHtml(ticket.requester?.name || "-")}</div>
            <div class="pm-table__cell">${escapeHtml(ticket.requester?.department || "-")}</div>
            <div class="pm-table__cell">${escapeHtml(formatDateTime(ticket.createdAt))}</div>
            <div class="pm-table__cell">${escapeHtml(ticket.status)}</div>
            <div class="pm-table__cell">${escapeHtml(ticket.area || "-")}</div>
            <div class="pm-table__cell">${escapeHtml(ticket.priority || "-")}</div>
            <div class="pm-table__cell">${escapeHtml(String(ticket.description || "").slice(0, 90))}</div>
            <div class="pm-table__cell pm-table__actions">
                <div class="ts-table-actions">
                    <button type="button" class="pm-btn pm-btn--ghost ts-icon-btn ts-admin-edit" data-ticket-id="${escapeHtml(ticket.id)}" title="Modifica ticket" aria-label="Modifica ticket">
                        <span class="material-icons">edit</span>
                    </button>
                    <button type="button" class="pm-btn pm-btn--danger ts-icon-btn ts-admin-delete" data-ticket-id="${escapeHtml(ticket.id)}" title="Elimina ticket" aria-label="Elimina ticket">
                        <span class="material-icons">delete</span>
                    </button>
                    <button type="button" class="pm-btn pm-btn--primary ts-icon-btn ts-admin-status" data-ticket-id="${escapeHtml(ticket.id)}" title="Cambia stato ticket" aria-label="Cambia stato ticket">
                        <span class="material-icons">published_with_changes</span>
                    </button>
                </div>
            </div>
        </div>
    `;
    }).join("");

    table.innerHTML = header + body;
    if (table.dataset.tsBound !== "1") {
        table.addEventListener("click", (event) => {
            const target = event.target instanceof Element ? event.target : null;
            if (!target) return;
            const historyBtn = target.closest(".ts-history-open");
            if (historyBtn) {
                openHistoryModal(historyBtn.getAttribute("data-ticket-id") || "");
                return;
            }
            const editBtn = target.closest(".ts-admin-edit");
            if (editBtn) {
                editTicketByAdmin(editBtn.getAttribute("data-ticket-id") || "");
                return;
            }
            const delBtn = target.closest(".ts-admin-delete");
            if (delBtn) {
                deleteTicketByAdmin(delBtn.getAttribute("data-ticket-id") || "");
                return;
            }
            const statusBtn = target.closest(".ts-admin-status");
            if (statusBtn) {
                openStatusModal(statusBtn.getAttribute("data-ticket-id") || "");
            }
        });
        table.dataset.tsBound = "1";
    }
}

function updateRequesterFields() {
    const form = document.getElementById("ts-ticket-form");
    if (!form) return;
    const disabled = !isLoggedIn();
    form.querySelectorAll("input, select, textarea, button").forEach((el) => {
        el.disabled = disabled;
    });
}

function updateLoginButton() {
    const btn = document.getElementById("pm-login-toggle");
    if (!btn) return;
    if (isAdmin()) {
        btn.textContent = `Admin: ${session.adminName || ""}`;
        return;
    }
    if (isEmployee()) {
        btn.textContent = `Dipendente: ${session.employee || ""}`;
        return;
    }
    btn.textContent = "Login";
}

function updateRoleBadge() {
    const label = document.getElementById("ts-role-label");
    if (!label) return;
    if (isAdmin()) {
        label.textContent = `Ruolo attivo: Admin (${session.adminName || ""})`;
        return;
    }
    if (isEmployee()) {
        label.textContent = `Ruolo attivo: Dipendente (${session.employee || ""})`;
        return;
    }
    label.textContent = "Ruolo attivo: Guest";
}

function updateAdminButtonVisibility() {
    const isAdminUser = isAdmin();
    ["ts-open-admin-list", "ts-clean-closed", "ts-settings-assignees-section", "ts-settings-admin-section", "ts-settings-categories-section", "ts-settings-backup-section"].forEach((id) => {
        const node = document.getElementById(id);
        if (!node) return;
        node.classList.toggle("ts-hidden", !isAdminUser);
    });
}

function renderAll() {
    updateLoginButton();
    updateRoleBadge();
    updateRequesterFields();
    updateAdminButtonVisibility();
    renderCategorySelects();
    renderOperatorList();
    renderAdminTable();
}

function openModal(id) {
    const node = document.getElementById(id);
    if (!node) return;
    node.classList.remove("is-hidden");
    node.setAttribute("aria-hidden", "false");
}

function closeModal(id) {
    const node = document.getElementById(id);
    if (!node) return;
    node.classList.add("is-hidden");
    node.setAttribute("aria-hidden", "true");
}

function showModal(node) {
    if (!node) return;
    node.classList.remove("is-hidden");
    node.setAttribute("aria-hidden", "false");
}

function hideModal(node) {
    if (!node) return;
    node.classList.add("is-hidden");
    node.setAttribute("aria-hidden", "true");
}

function formatHistoryEntry(entry) {
    const at = formatDateTime(entry?.at);
    const rawEvent = String(entry?.event || "");
    const event = escapeHtml(rawEvent || "-");
    const actor = escapeHtml(entry?.actor || "-");
    const fromStatus = escapeHtml(entry?.fromStatus || "");
    const toStatus = escapeHtml(entry?.toStatus || "");
    const isCreated = rawEvent.trim().toLowerCase() === "ticket creato";
    const statusPart = !isCreated && (fromStatus || toStatus)
        ? ` (${fromStatus || "-"} -> ${toStatus || "-"})`
        : "";
    const rawNote = String(entry?.note || "").trim();
    let noteBlock = "";
    if (rawNote.startsWith("Modifiche:")) {
        const payload = rawNote.replace(/^Modifiche:\s*/i, "").trim();
        const parts = payload ? payload.split(";").map((item) => item.trim()).filter(Boolean) : [];
        const rows = parts.map((item) => {
            const match = item.match(/^([^:]+):\s*\"(.*)\"\s*->\s*\"(.*)\"$/);
            if (!match) {
                return `<div class="ts-history-change">${escapeHtml(item)}</div>`;
            }
            const label = escapeHtml(match[1].trim());
            const fromVal = escapeHtml(match[2]);
            const toVal = escapeHtml(match[3]);
            return `
                <div class="ts-history-change">
                    <span class="ts-history-badge">${label}</span>
                    <span class="ts-history-from">${fromVal || "-"}</span>
                    <span class="ts-history-arrow">→</span>
                    <span class="ts-history-to">${toVal || "-"}</span>
                </div>
            `;
        });
        if (rows.length) {
            noteBlock = `<div class="ts-history-note ts-history-note--changes">${rows.join("")}</div>`;
        }
    } else if (rawNote) {
        noteBlock = `<div class="ts-history-note">${escapeHtml(rawNote)}</div>`;
    }
    return `
        <div class="ts-history-item">
            <div class="ts-history-head">
                <div class="ts-history-event">${event}${statusPart}</div>
                <div class="ts-history-time">${escapeHtml(at)}</div>
            </div>
            <div class="ts-history-meta">Operatore: ${actor}</div>
            ${noteBlock}
        </div>
    `;
}

function renderHistoryModal(ticket) {
    const list = document.getElementById("ts-history-list");
    if (!list) return;
    if (!ticket) {
        list.innerHTML = `<div class="pm-message">Ticket non trovato.</div>`;
        return;
    }
    const entries = (ticket.history || [])
        .slice()
        .sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
    if (!entries.length) {
        list.innerHTML = `<div class="pm-message">Nessuno storico disponibile.</div>`;
        return;
    }
    list.innerHTML = entries.map(formatHistoryEntry).join("");
}

function openHistoryModal(ticketId) {
    const ticket = getTicketById(ticketId);
    renderHistoryModal(ticket);
    openModal("ts-history-modal");
}

function closeHistoryModal() {
    closeModal("ts-history-modal");
}

function resetAdminLoginSensitiveFields() {
    const password = document.getElementById("pm-login-admin-password");
    const error = document.getElementById("pm-login-admin-error");
    const recover = document.getElementById("pm-login-admin-recover");
    if (password) password.value = "";
    if (error) error.classList.add("is-hidden");
    if (recover) recover.classList.add("is-hidden");
}

function openLoginModal() {
    const modal = document.getElementById("pm-login-modal");
    if (modal && !modal.classList.contains("is-hidden")) {
        return;
    }
    const employeePanel = document.getElementById("pm-login-employee-panel");
    const adminPanel = document.getElementById("pm-login-admin-panel");
    const employeeChoice = document.getElementById("pm-login-choice-employee");
    const adminChoice = document.getElementById("pm-login-choice-admin");
    if (employeePanel) employeePanel.classList.remove("is-hidden");
    if (adminPanel) adminPanel.classList.add("is-hidden");
    if (employeeChoice) employeeChoice.classList.add("is-active");
    if (adminChoice) adminChoice.classList.remove("is-active");
    resetAdminLoginSensitiveFields();
    openModal("pm-login-modal");
}

function closeLoginModal() {
    resetAdminLoginSensitiveFields();
    closeModal("pm-login-modal");
}

function openLogoutModal() {
    openModal("pm-logout-modal");
}

function closeLogoutModal() {
    closeModal("pm-logout-modal");
}

function openAdminListModal() {
    if (!isAdmin()) return;
    if (currentView === "admin") {
        renderAdminTable();
        return;
    }
    ipcRenderer.send("open-ticket-support-admin-window");
}

function closeAdminListModal() {
    if (currentView === "admin") return;
    closeModal("ts-admin-list-modal");
}

function openStatusModal(ticketId) {
    if (!isAdmin()) return;
    const ticket = getTicketById(ticketId);
    if (!ticket) return;
    statusEditingTicketId = ticketId;
    const select = document.getElementById("ts-status-select");
    if (select) select.value = ticket.status || "Da prendere in carico";
    const info = document.getElementById("ts-status-info");
    if (info) info.value = "";
    showInlineMessage("ts-status-message", "");
    openModal("ts-status-modal");
}

function closeStatusModal() {
    statusEditingTicketId = "";
    const info = document.getElementById("ts-status-info");
    if (info) info.value = "";
    closeModal("ts-status-modal");
}

function openEditModal(ticketId, mode) {
    const ticket = getTicketById(ticketId);
    if (!ticket) return;
    const isEmployeeEdit = mode === "employee";
    if (isEmployeeEdit && !canEmployeeEdit(ticket)) return;
    if (!isEmployeeEdit && !isAdmin()) return;

    const type = document.getElementById("ts-edit-type");
    const area = document.getElementById("ts-edit-area");
    const priority = document.getElementById("ts-edit-priority");
    const description = document.getElementById("ts-edit-description");
    if (!type || !area || !priority || !description) return;

    renderCategorySelects();
    ensureOption(type, ticket.issueType);
    ensureOption(area, ticket.area);

    editTicketId = ticket.id;
    editMode = isEmployeeEdit ? "employee" : "admin";
    type.value = ticket.issueType || getIssueTypes()[0] || "Assistenza";
    area.value = ticket.area || getAreas()[0] || "Altro";
    priority.value = ticket.priority || "Media";
    description.value = ticket.description || "";
    showInlineMessage("ts-edit-message", "");
    openModal("ts-edit-modal");
    window.setTimeout(() => description.focus(), 0);
}

function closeEditModal() {
    editTicketId = "";
    editMode = "";
    showInlineMessage("ts-edit-message", "");
    closeModal("ts-edit-modal");
}

function saveTicketEdit() {
    if (!editTicketId || !editMode) return;
    const ticket = getTicketById(editTicketId);
    if (!ticket) {
        closeEditModal();
        return;
    }

    if (editMode === "employee" && !canEmployeeEdit(ticket)) {
        showInlineMessage("ts-edit-message", "Questo ticket non e' piu modificabile.", "error");
        return;
    }
    if (editMode === "admin" && !isAdmin()) {
        showInlineMessage("ts-edit-message", "Accesso admin richiesto.", "error");
        return;
    }

    const issueType = String(document.getElementById("ts-edit-type")?.value || "").trim();
    const area = String(document.getElementById("ts-edit-area")?.value || "").trim();
    const priority = String(document.getElementById("ts-edit-priority")?.value || "").trim();
    const description = String(document.getElementById("ts-edit-description")?.value || "").trim();

    if (!isValidSelectValue(document.getElementById("ts-edit-type"), issueType)) {
        showInlineMessage("ts-edit-message", "Tipo intervento non valido.", "error");
        return;
    }
    if (!isValidSelectValue(document.getElementById("ts-edit-area"), area)) {
        showInlineMessage("ts-edit-message", "Ambito non valido.", "error");
        return;
    }
    if (!isValidSelectValue(document.getElementById("ts-edit-priority"), priority)) {
        showInlineMessage("ts-edit-message", "Priorita non valida.", "error");
        return;
    }
    if (!description) {
        showInlineMessage("ts-edit-message", "Descrizione obbligatoria.", "error");
        return;
    }

    const before = {
        issueType: ticket.issueType,
        area: ticket.area,
        priority: ticket.priority,
        description: ticket.description,
    };
    const after = {
        issueType,
        area,
        priority,
        description,
    };

    ticket.issueType = issueType;
    ticket.area = area;
    ticket.priority = priority;
    ticket.description = description;
    ticket.updatedAt = nowIso();
    ticket.history.push(createHistory({
        event: editMode === "employee" ? "Modifica dipendente" : "Modifica admin",
        actor: editMode === "employee" ? (session.employee || "Dipendente") : (session.adminName || "Admin"),
        note: buildEditNote(before, after),
    }));
    saveAll();
    renderAll();
    closeEditModal();
}

async function saveStatusChange() {
    if (!isAdmin() || !statusEditingTicketId) return;
    const ticket = getTicketById(statusEditingTicketId);
    if (!ticket) return;
    const toStatus = String(document.getElementById("ts-status-select")?.value || "").trim();
    const infoText = String(document.getElementById("ts-status-info")?.value || "").trim();
    if (!STATUS_LIST.includes(toStatus)) {
        showInlineMessage("ts-status-message", "Stato non valido.", "error");
        return;
    }
    const fromStatus = ticket.status;
    if (fromStatus === toStatus) {
        closeStatusModal();
        return;
    }
    const at = nowIso();
    ticket.status = toStatus;
    ticket.updatedAt = at;
    updateStatusDates(ticket, toStatus, at);
    ticket.history.push(createHistory({
        event: "Cambio stato admin",
        actor: session.adminName || "Admin",
        fromStatus,
        toStatus,
        note: infoText,
    }));
    saveAll();
    renderAll();

    const mailResult = await notifyRequesterOnStatusChange(ticket, fromStatus, toStatus);
    if (!mailResult.ok && !mailResult.skipped) {
        showInlineMessage("ts-status-message", `Stato salvato, ma email non inviata: ${mailResult.error}`, "error");
        return;
    }
    closeStatusModal();
}

async function handleCreateTicket(event) {
    event.preventDefault();
    if (!isLoggedIn()) {
        showInlineMessage("ts-create-message", "Accesso richiesto.", "error");
        openLoginModal();
        return;
    }

    const requester = getCurrentRequester();
    const issueType = String(document.getElementById("ts-issue-type")?.value || "").trim();
    const area = String(document.getElementById("ts-area")?.value || "").trim();
    const priority = String(document.getElementById("ts-priority")?.value || "Media").trim();
    const description = String(document.getElementById("ts-description")?.value || "").trim();
    if (!issueType || !area || !description) {
        showInlineMessage("ts-create-message", "Compila tipo intervento, ambito e descrizione.", "error");
        return;
    }
    if (!isValidSelectValue(document.getElementById("ts-issue-type"), issueType)) {
        showInlineMessage("ts-create-message", "Tipo intervento non valido.", "error");
        return;
    }
    if (!isValidSelectValue(document.getElementById("ts-area"), area)) {
        showInlineMessage("ts-create-message", "Ambito non valido.", "error");
        return;
    }
    if (!isValidSelectValue(document.getElementById("ts-priority"), priority)) {
        showInlineMessage("ts-create-message", "Priorita non valida.", "error");
        return;
    }

    const createdAt = nowIso();
    const ticket = {
        id: buildTicketId(),
        requester: {
            name: requester.name,
            department: requester.department,
            email: "",
        },
        issueType,
        area,
        priority,
        description,
        status: "Da prendere in carico",
        createdAt,
        updatedAt: createdAt,
        resolvedAt: "",
        closedAt: "",
        lastStatusChangeAt: createdAt,
        createdByKey: requester.personKey || requester.key,
        createdByRole: requester.role,
        history: [
            createHistory({
                event: "Ticket creato",
                actor: requester.name || requester.role,
                toStatus: "Da prendere in carico",
            }),
        ],
    };

    store.tickets.push(ticket);
    saveAll();
    renderAll();
    document.getElementById("ts-ticket-form")?.reset();
    showInlineMessage("ts-create-message", `Ticket ${ticket.id} creato.`, "success");

    const mailResult = await notifyAdminOnCreate(ticket);
    if (!mailResult.ok) {
        showInlineMessage("ts-create-message", `Ticket creato, ma email admin non inviata: ${mailResult.error}`, "error");
    }
}

function editTicketByEmployee(ticketId) {
    openEditModal(ticketId, "employee");
}

function editTicketByAdmin(ticketId) {
    openEditModal(ticketId, "admin");
}

function deleteTicketByEmployee(ticketId) {
    const ticket = getTicketById(ticketId);
    if (!canEmployeeDelete(ticket)) return;
    const ok = window.confirm(`Eliminare il ticket ${ticket.id}?`);
    if (!ok) return;
    store.tickets = store.tickets.filter((item) => item.id !== ticketId);
    saveAll();
    renderAll();
}

function deleteTicketByAdmin(ticketId) {
    const ticket = getTicketById(ticketId);
    if (!isAdmin() || !ticket) return;
    const ok = window.confirm(`Eliminare il ticket ${ticket.id}?`);
    if (!ok) return;
    store.tickets = store.tickets.filter((item) => item.id !== ticketId);
    saveAll();
    renderAll();
}

function cleanClosedTickets() {
    if (!isAdmin()) {
        showWarning("Accesso admin richiesto.");
        return;
    }
    const ok = window.confirm("Vuoi rimuovere dal JSON tutti i ticket chiusi o risolti?");
    if (!ok) return;
    const before = store.tickets.length;
    const remaining = store.tickets.filter((ticket) => !isFinalStatus(ticket.status));
    const removed = before - remaining.length;
    if (!removed) {
        showInlineMessage(
            currentView === "admin" ? "ts-admin-message" : "ts-create-message",
            "Nessun ticket chiuso o risolto da rimuovere.",
            "success"
        );
        return;
    }
    store.tickets = remaining;
    saveAll();
    renderAll();
    showInlineMessage(
        currentView === "admin" ? "ts-admin-message" : "ts-create-message",
        `Pulizia completata: rimossi ${removed} ticket.`,
        "success"
    );
}

function updateLoginSelectors() {
    renderLoginSelectors({ document, getAssigneeGroups: () => assigneeGroups });
    renderAdminSelect({ document, loadAdminCredentials });
}

function getAdminCache() {
    return Array.isArray(adminCache) ? adminCache : [];
}

function refreshAdminCache() {
    adminCache = loadAdminCredentials();
    return adminCache;
}

const otpUi = createOtpModals({
    document,
    showModal,
    hideModal,
    setMessage,
    showDialog,
    isMailerAvailable: isOtpMailerAvailable,
    getMailerError: getOtpMailerError,
    sendOtpEmail,
    findAdminByName,
    getAdminCache,
    saveAdminCredentials,
    getAuthenticator,
    otpState,
    resetOtpState,
    isHashingAvailable,
    hashPassword,
    OTP_EXPIRY_MS,
    OTP_RESEND_MS,
});

function openOtpModal() {
    refreshAdminCache();
    otpUi.openOtpModal();
}

function bindLoginEvents() {
    const loginToggle = document.getElementById("pm-login-toggle");
    const loginClose = document.getElementById("pm-login-close");
    const choiceEmployee = document.getElementById("pm-login-choice-employee");
    const choiceAdmin = document.getElementById("pm-login-choice-admin");
    const employeePanel = document.getElementById("pm-login-employee-panel");
    const adminPanel = document.getElementById("pm-login-admin-panel");
    const employeeConfirm = document.getElementById("pm-login-employee-confirm");
    const adminConfirm = document.getElementById("pm-login-admin-confirm");
    const adminError = document.getElementById("pm-login-admin-error");
    const adminRecover = document.getElementById("pm-login-admin-recover");
    const employeeDepartment = document.getElementById("pm-login-department");
    const employeeName = document.getElementById("pm-login-employee-name");
    const adminNameInput = document.getElementById("pm-login-admin-name");
    const adminPasswordInput = document.getElementById("pm-login-admin-password");

    if (currentView === "admin") {
        if (loginToggle) {
            loginToggle.classList.add("ts-hidden");
            loginToggle.disabled = true;
        }
        return;
    }

    if (loginToggle) {
        loginToggle.addEventListener("click", () => {
            if (isLoggedIn()) {
                openLogoutModal();
                return;
            }
            openLoginModal();
            adminLoginFailCount = 0;
            if (adminError) adminError.classList.add("is-hidden");
            if (adminRecover) adminRecover.classList.add("is-hidden");
        });
    }
    if (loginClose) {
        loginClose.addEventListener("click", () => {
            closeLoginModal();
            adminLoginFailCount = 0;
            if (adminError) adminError.classList.add("is-hidden");
            if (adminRecover) adminRecover.classList.add("is-hidden");
        });
    }

    if (choiceEmployee) {
        choiceEmployee.addEventListener("click", () => {
            if (employeePanel) employeePanel.classList.remove("is-hidden");
            if (adminPanel) adminPanel.classList.add("is-hidden");
            choiceEmployee.classList.add("is-active");
            if (choiceAdmin) choiceAdmin.classList.remove("is-active");
            adminLoginFailCount = 0;
            resetAdminLoginSensitiveFields();
        });
    }
    if (choiceAdmin) {
        choiceAdmin.addEventListener("click", () => {
            if (adminPanel) adminPanel.classList.remove("is-hidden");
            if (employeePanel) employeePanel.classList.add("is-hidden");
            choiceAdmin.classList.add("is-active");
            if (choiceEmployee) choiceEmployee.classList.remove("is-active");
            adminLoginFailCount = 0;
            if (adminError) adminError.classList.add("is-hidden");
            if (adminRecover) adminRecover.classList.add("is-hidden");
        });
    }

    if (employeeConfirm) {
        employeeConfirm.addEventListener("click", () => {
            const dept = document.getElementById("pm-login-department")?.value || "";
            const emp = document.getElementById("pm-login-employee-name")?.value || "";
            if (!dept || !emp) {
                showWarning("Seleziona reparto e dipendente per accedere.");
                return;
            }
            setSession({ role: "employee", adminName: "", department: dept, employee: emp });
            saveSession();
            closeLoginModal();
            renderAll();
        });
    }
    [employeeDepartment, employeeName].forEach((field) => {
        if (!field || !employeeConfirm) return;
        field.addEventListener("keydown", (event) => {
            if (event.key !== "Enter") return;
            if (employeePanel && employeePanel.classList.contains("is-hidden")) return;
            event.preventDefault();
            employeeConfirm.click();
        });
    });

    if (adminConfirm) {
        adminConfirm.addEventListener("click", async () => {
            const adminName = document.getElementById("pm-login-admin-name")?.value || "";
            const password = document.getElementById("pm-login-admin-password")?.value || "";
            if (adminError) adminError.classList.add("is-hidden");
            if (adminRecover) adminRecover.classList.add("is-hidden");
            if (!adminName || !password) {
                if (adminError) adminError.classList.remove("is-hidden");
                adminLoginFailCount += 1;
                if (adminRecover && adminLoginFailCount >= 3) {
                    adminRecover.classList.remove("is-hidden");
                }
                return;
            }
            const verified = await verifyAdminPassword(password, adminName);
            if (!verified || !verified.admin) {
                if (adminError) adminError.classList.remove("is-hidden");
                adminLoginFailCount += 1;
                if (adminRecover && adminLoginFailCount >= 3) {
                    adminRecover.classList.remove("is-hidden");
                }
                return;
            }
            adminLoginFailCount = 0;
            if (adminRecover) adminRecover.classList.add("is-hidden");
            setSession({ role: "admin", adminName: verified.admin.name, department: "", employee: "" });
            saveSession();
            closeLoginModal();
            renderAll();
        });
    }
    [adminNameInput, adminPasswordInput].forEach((field) => {
        if (!field || !adminConfirm) return;
        field.addEventListener("keydown", (event) => {
            if (event.key !== "Enter") return;
            if (adminPanel && adminPanel.classList.contains("is-hidden")) return;
            event.preventDefault();
            adminConfirm.click();
        });
    });

    if (adminRecover) {
        adminRecover.addEventListener("click", () => {
            openOtpModal();
        });
    }
}

function bindLogoutEvents() {
    document.getElementById("pm-logout-cancel")?.addEventListener("click", closeLogoutModal);
    document.getElementById("pm-logout-confirm")?.addEventListener("click", () => {
        clearSession();
        resetAdminLoginSensitiveFields();
        closeLogoutModal();
        closeAdminListModal();
        renderAll();
    });
}

function bindStatusModalEvents() {
    document.getElementById("ts-status-close")?.addEventListener("click", closeStatusModal);
    document.getElementById("ts-status-cancel")?.addEventListener("click", closeStatusModal);
    document.getElementById("ts-status-save")?.addEventListener("click", () => {
        saveStatusChange();
    });
}

function bindEditModalEvents() {
    document.getElementById("ts-edit-close")?.addEventListener("click", closeEditModal);
    document.getElementById("ts-edit-cancel")?.addEventListener("click", closeEditModal);
    document.getElementById("ts-edit-save")?.addEventListener("click", saveTicketEdit);
}

function bindHistoryEvents() {
    document.getElementById("ts-history-close")?.addEventListener("click", closeHistoryModal);
}

function bindAdminListEvents() {
    document.getElementById("ts-open-admin-list")?.addEventListener("click", () => {
        openAdminListModal();
    });
    document.getElementById("ts-admin-list-close")?.addEventListener("click", () => {
        closeAdminListModal();
    });
    document.getElementById("ts-clean-closed")?.addEventListener("click", () => {
        cleanClosedTickets();
    });
    document.getElementById("ts-admin-filter-search")?.addEventListener("input", (event) => {
        adminFilters.search = String(event.target?.value || "");
        renderAdminTable();
    });
    document.getElementById("ts-admin-filter-status")?.addEventListener("change", (event) => {
        adminFilters.status = String(event.target?.value || "");
        renderAdminTable();
    });
    document.getElementById("ts-admin-filter-area")?.addEventListener("change", (event) => {
        adminFilters.area = String(event.target?.value || "");
        renderAdminTable();
    });
    document.getElementById("ts-admin-filter-priority")?.addEventListener("change", (event) => {
        adminFilters.priority = String(event.target?.value || "");
        renderAdminTable();
    });
}

function bindOperatorListEvents() {
    document.getElementById("ts-op-filter-search")?.addEventListener("input", (event) => {
        operatorFilters.search = String(event.target?.value || "");
        renderOperatorList();
    });
    document.getElementById("ts-op-filter-status")?.addEventListener("change", (event) => {
        operatorFilters.status = String(event.target?.value || "");
        renderOperatorList();
    });
    document.getElementById("ts-op-filter-area")?.addEventListener("change", (event) => {
        operatorFilters.area = String(event.target?.value || "");
        renderOperatorList();
    });
    document.getElementById("ts-op-filter-priority")?.addEventListener("change", (event) => {
        operatorFilters.priority = String(event.target?.value || "");
        renderOperatorList();
    });
}

function bindMainEvents() {
    document.getElementById("ts-ticket-form")?.addEventListener("submit", handleCreateTicket);
    bindOperatorListEvents();
    document.getElementById("ts-refresh")?.addEventListener("click", () => {
        store = loadStore();
        ticketCategories = loadTicketCategories();
        renderAll();
    });
}

function bindSettingsEvents() {
    document.getElementById("ts-settings")?.addEventListener("click", () => {
        openSettingsModal();
    });
    document.getElementById("ts-settings-close")?.addEventListener("click", () => {
        closeSettingsModal();
    });
    document.getElementById("ts-theme-open")?.addEventListener("click", () => {
        openThemeModal();
    });
    document.getElementById("ts-theme-close")?.addEventListener("click", () => {
        closeThemeModal();
    });
    document.getElementById("ts-theme-light")?.addEventListener("click", () => setTheme("light"));
    document.getElementById("ts-theme-dark")?.addEventListener("click", () => setTheme("dark"));
    document.getElementById("ts-theme-aypi")?.addEventListener("click", () => setTheme("aypi"));
    document.getElementById("ts-settings-admin-open")?.addEventListener("click", () => {
        closeSettingsModal();
        if (!isAdmin()) return;
        ipcRenderer.send("open-admin-manager-window");
    });
    document.getElementById("ts-settings-assignees-open")?.addEventListener("click", () => {
        closeSettingsModal();
        if (!isAdmin()) return;
        ipcRenderer.send("open-assignees-manager-window");
    });
    document.getElementById("ts-settings-backup-open")?.addEventListener("click", () => {
        closeSettingsModal();
        openBackupModal();
    });
    document.getElementById("ts-settings-categories-open")?.addEventListener("click", () => {
        closeSettingsModal();
        openCategoriesModal();
    });
    document.getElementById("ts-categories-close")?.addEventListener("click", closeCategoriesModal);
    document.getElementById("ts-backup-close")?.addEventListener("click", closeBackupModal);
    document.getElementById("ts-backup-run")?.addEventListener("click", createTicketBackup);
    document.getElementById("ts-backup-restore")?.addEventListener("click", () => {
        restoreTicketBackup();
    });
}

function bindCategoriesEvents() {
    document.getElementById("ts-issue-type-add")?.addEventListener("click", addIssueType);
    document.getElementById("ts-area-add")?.addEventListener("click", addArea);
    const issueInput = document.getElementById("ts-issue-type-name");
    if (issueInput) {
        issueInput.addEventListener("keydown", (event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            addIssueType();
        });
    }
    const areaInput = document.getElementById("ts-area-name");
    if (areaInput) {
        areaInput.addEventListener("keydown", (event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            addArea();
        });
    }
}

function applySharedSession(payload) {
    applySharedSessionData(payload);
    if (!isLoggedIn()) resetAdminLoginSensitiveFields();
    renderAll();
    if (isLoggedIn()) {
        closeLoginModal();
        closeLogoutModal();
    } else {
        if (currentView === "admin") {
            closeLoginModal();
            showInlineMessage("ts-admin-message", "Sessione terminata. Accedi dalla home Ticket Support.", "error");
        } else {
            openLoginModal();
        }
    }
}

async function refreshSessionFromMain() {
    const loginModal = document.getElementById("pm-login-modal");
    const active = document.activeElement;
    if (
        loginModal &&
        !loginModal.classList.contains("is-hidden") &&
        active &&
        (active.id === "pm-login-admin-password" || active.id === "pm-login-admin-name")
    ) {
        return;
    }
    try {
        const shared = await ipcRenderer.invoke("pm-session-get");
        applySharedSession(shared);
    } catch (err) {
        console.error("Errore sync sessione:", err);
    }
}

async function init() {
    initTheme();
    document.body.classList.toggle("ts-view-form", currentView === "form");
    document.body.classList.toggle("ts-view-admin", currentView === "admin");

    assigneeGroups = (loadAssigneeOptions().groups || {});
    refreshAdminCache();
    updateLoginSelectors();
    bindLoginEvents();
    bindLogoutEvents();
    bindStatusModalEvents();
    bindEditModalEvents();
    bindHistoryEvents();
    bindAdminListEvents();
    bindMainEvents();
    bindSettingsEvents();
    bindCategoriesEvents();
    otpUi.initOtpModals();

    ticketCategories = loadTicketCategories();
    await loadSession();
    renderAll();
    if (!isLoggedIn()) {
        if (currentView === "admin") {
            showInlineMessage("ts-admin-message", "Accedi dalla home Ticket Support per usare questa finestra.", "error");
        } else {
            openLoginModal();
        }
    } else if (currentView === "admin" && !isAdmin()) {
        showInlineMessage("ts-admin-message", "Accesso admin richiesto. Cambia utente dalla home Ticket Support.", "error");
    }

    if (!isMailerAvailable()) {
        const err = getMailerError();
        showInlineMessage(
            "ts-create-message",
            `Mailer non disponibile: ${err ? (err.message || err) : "errore sconosciuto"}`,
            "error"
        );
    }
}

document.addEventListener("DOMContentLoaded", init);

window.addEventListener("focus", () => {
    refreshSessionFromMain();
});

document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
        refreshSessionFromMain();
    }
});

ipcRenderer.on("pm-force-logout", (_event, shouldLogout) => {
    if (!shouldLogout) return;
    clearSession();
    resetAdminLoginSensitiveFields();
    renderAll();
    openLoginModal();
});

ipcRenderer.on("pm-session-updated", (_event, payload) => {
    applySharedSession(payload);
});
