const { loadStore, saveStore, DATA_PATH } = require("./ticket-support/services/storage");
const { isMailerAvailable, getMailerError, sendMail } = require("./ticket-support/services/mailer");
const { ipcRenderer } = require("electron");
const { loadAssigneeOptions } = require("./ferie-permessi/services/assignees");
const {
    loadAdminCredentials,
    saveAdminCredentials,
    verifyAdminPassword,
    findAdminByName,
    isValidEmail,
} = require("./ferie-permessi/services/admins");
const { createOtpModals } = require("./ferie-permessi/ui/otp-modals");
const { isHashingAvailable, hashPassword, getAuthenticator, otpState, resetOtpState } = require("./ferie-permessi/config/security");
const { isMailerAvailable: isOtpMailerAvailable, getMailerError: getOtpMailerError, sendOtpEmail } = require("./ferie-permessi/services/otp-mail");
const { OTP_EXPIRY_MS, OTP_RESEND_MS } = require("./ferie-permessi/config/constants");
const { showDialog } = require("./ferie-permessi/services/dialogs");
const {
    session,
    setSession,
    saveSession,
    loadSession,
    clearSession,
    isAdmin,
    isEmployee,
    isLoggedIn,
} = require("./product-manager/state/session");
const { renderLoginSelectors, renderAdminSelect } = require("./product-manager/ui/login-selectors");

const ADMIN_EMAIL = "tech@agpress-srl.it";
const STATUS_LIST = ["Da prendere in carico", "Presa in carico", "In Attesa", "Risolto", "Chiuso"];
const params = new URLSearchParams(window.location.search || "");
const currentView = (params.get("tsView") || "form").toLowerCase() === "admin" ? "admin" : "form";

let store = loadStore();
let assigneeGroups = {};
let adminCache = [];
let statusEditingTicketId = "";
let editTicketId = "";
let editMode = "";
let adminLoginFailCount = 0;
const adminFilters = { search: "", status: "", area: "" };

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

function getCurrentRequester() {
    if (isEmployee()) {
        return {
            role: "employee",
            name: session.employee || "",
            department: session.department || "",
            key: `${toKey(session.department)}|${toKey(session.employee)}`,
        };
    }
    if (isAdmin()) {
        return {
            role: "admin",
            name: session.adminName || "Admin",
            department: "Admin",
            key: `admin|${toKey(session.adminName)}`,
        };
    }
    return { role: "guest", name: "", department: "", key: "" };
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
    return !!ticket && ticket.createdByKey === me.key && ticket.status === "Da prendere in carico";
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

function filterAdminTickets(tickets) {
    const search = adminFilters.search.toLowerCase();
    return tickets
        .filter((ticket) => {
            if (adminFilters.status && ticket.status !== adminFilters.status) return false;
            if (adminFilters.area && ticket.area !== adminFilters.area) return false;
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

    if (!isEmployee()) {
        container.innerHTML = `<div class="ts-ticket-card"><div class="ts-ticket-card__desc">Accedi come dipendente per vedere le tue richieste.</div></div>`;
        return;
    }

    const me = getCurrentRequester();
    const mine = store.tickets
        .filter((ticket) => ticket.createdByKey === me.key)
        .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));

    if (!mine.length) {
        container.innerHTML = `<div class="ts-ticket-card"><div class="ts-ticket-card__desc">Nessun ticket creato.</div></div>`;
        return;
    }

    container.innerHTML = mine.map((ticket) => {
        const history = (ticket.history || [])
            .slice()
            .sort((a, b) => String(a.at).localeCompare(String(b.at)))
            .map((item) => `[${formatDateTime(item.at)}] ${item.event}${item.fromStatus || item.toStatus ? ` (${item.fromStatus || "-"} -> ${item.toStatus || "-"})` : ""}`)
            .join("\n");
        return `
            <article class="ts-ticket-card" data-ticket-id="${escapeHtml(ticket.id)}">
                <div class="ts-ticket-card__head">
                    <div class="ts-ticket-card__title">${escapeHtml(ticket.id)}</div>
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
    const body = rows.map((ticket) => `
        <div class="pm-table__row" data-ticket-id="${escapeHtml(ticket.id)}">
            <div class="pm-table__cell">${escapeHtml(ticket.id)}</div>
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
    `).join("");

    table.innerHTML = header + body;
    if (table.dataset.tsBound !== "1") {
        table.addEventListener("click", (event) => {
            const target = event.target instanceof Element ? event.target : null;
            if (!target) return;
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
    const adminOnlyIds = ["ts-open-admin-list"];
    adminOnlyIds.forEach((id) => {
        const btn = document.getElementById(id);
        if (!btn) return;
        btn.classList.toggle("ts-hidden", !isAdmin());
    });
}

function renderAll() {
    updateLoginButton();
    updateRoleBadge();
    updateRequesterFields();
    updateAdminButtonVisibility();
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

function openLoginModal() {
    const modal = document.getElementById("pm-login-modal");
    if (modal && !modal.classList.contains("is-hidden")) {
        return;
    }
    const employeePanel = document.getElementById("pm-login-employee-panel");
    const adminPanel = document.getElementById("pm-login-admin-panel");
    const employeeChoice = document.getElementById("pm-login-choice-employee");
    const adminChoice = document.getElementById("pm-login-choice-admin");
    const error = document.getElementById("pm-login-admin-error");
    const recover = document.getElementById("pm-login-admin-recover");
    if (employeePanel) employeePanel.classList.remove("is-hidden");
    if (adminPanel) adminPanel.classList.add("is-hidden");
    if (employeeChoice) employeeChoice.classList.add("is-active");
    if (adminChoice) adminChoice.classList.remove("is-active");
    if (error) error.classList.add("is-hidden");
    if (recover) recover.classList.add("is-hidden");
    openModal("pm-login-modal");
}

function closeLoginModal() {
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
    showInlineMessage("ts-status-message", "");
    openModal("ts-status-modal");
}

function closeStatusModal() {
    statusEditingTicketId = "";
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

    editTicketId = ticket.id;
    editMode = isEmployeeEdit ? "employee" : "admin";
    type.value = ticket.issueType || "Assistenza";
    area.value = ticket.area || "Altro";
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

    if (!["Assistenza", "Bug", "Richiesta nuova funzione", "Altro"].includes(issueType)) {
        showInlineMessage("ts-edit-message", "Tipo intervento non valido.", "error");
        return;
    }
    if (!["Mail", "MES", "Gestionale", "Hardware", "Rete", "Altro"].includes(area)) {
        showInlineMessage("ts-edit-message", "Ambito non valido.", "error");
        return;
    }
    if (!["Bassa", "Media", "Alta", "Urgente"].includes(priority)) {
        showInlineMessage("ts-edit-message", "Priorita non valida.", "error");
        return;
    }
    if (!description) {
        showInlineMessage("ts-edit-message", "Descrizione obbligatoria.", "error");
        return;
    }

    ticket.issueType = issueType;
    ticket.area = area;
    ticket.priority = priority;
    ticket.description = description;
    ticket.updatedAt = nowIso();
    ticket.history.push(createHistory({
        event: editMode === "employee" ? "Modifica dipendente" : "Modifica admin",
        actor: editMode === "employee" ? (session.employee || "Dipendente") : (session.adminName || "Admin"),
        note: "Tipo/Ambito/Priorita/Descrizione aggiornati",
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
        createdByKey: requester.key,
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
            if (adminError) adminError.classList.add("is-hidden");
            if (adminRecover) adminRecover.classList.add("is-hidden");
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

function bindAdminListEvents() {
    document.getElementById("ts-open-admin-list")?.addEventListener("click", () => {
        openAdminListModal();
    });
    document.getElementById("ts-admin-list-close")?.addEventListener("click", () => {
        closeAdminListModal();
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
}

function bindMainEvents() {
    document.getElementById("ts-ticket-form")?.addEventListener("submit", handleCreateTicket);
    document.getElementById("ts-refresh")?.addEventListener("click", () => {
        store = loadStore();
        renderAll();
        showInlineMessage("ts-create-message", `Dati ricaricati da ${DATA_PATH}.`, "success");
    });
}

function applySharedSession(payload) {
    applySharedSessionData(payload);
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
    document.body.classList.remove("fp-dark");
    document.body.classList.remove("fp-aypi");
    document.body.classList.toggle("ts-view-form", currentView === "form");
    document.body.classList.toggle("ts-view-admin", currentView === "admin");

    assigneeGroups = (loadAssigneeOptions().groups || {});
    refreshAdminCache();
    updateLoginSelectors();
    bindLoginEvents();
    bindLogoutEvents();
    bindStatusModalEvents();
    bindEditModalEvents();
    bindAdminListEvents();
    bindMainEvents();
    otpUi.initOtpModals();

    await loadSession();
    renderAll();
    if (!isLoggedIn()) {
        if (currentView === "admin") {
            showInlineMessage("ts-admin-message", "Accedi dalla home Ticket Support per usare questa finestra.", "error");
        } else {
            openLoginModal();
            showInlineMessage("ts-create-message", "Accedi come admin per aprire la lista ticket.", "error");
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
    renderAll();
    openLoginModal();
});

ipcRenderer.on("pm-session-updated", (_event, payload) => {
    applySharedSession(payload);
});
