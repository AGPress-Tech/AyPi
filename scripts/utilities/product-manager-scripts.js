const { ipcRenderer } = require("electron");
const fs = require("fs");

const { showInfo, showWarning, showError, showDialog } = require("../shared/dialogs");
const { NETWORK_PATHS } = require("../../config/paths");
const { createModalHelpers } = require("./ferie-permessi/ui/modals");
const { createAssigneesModal } = require("./ferie-permessi/ui/assignees-modal");
const { createAdminModals } = require("./ferie-permessi/ui/admin-modals");
const { UI_TEXTS } = require("./ferie-permessi/utils/ui-texts");
const { isHashingAvailable, hashPassword } = require("./ferie-permessi/config/security");
const {
    loadAdminCredentials,
    saveAdminCredentials,
    verifyAdminPassword,
    isValidEmail,
    isValidPhone,
} = require("./ferie-permessi/services/admins");

window.pmLoaded = true;

const ASSIGNEES_FALLBACK = "\\\\Dl360\\pubbliche\\TECH\\AyPi\\AGPRESS\\amministrazione-assignees.json";
const SESSION_KEY = "pm-session";

let session = { role: "guest", adminName: "", department: "", employee: "" };
let assigneeGroups = {};
let assigneeOptions = [];
let editingDepartment = null;
let editingEmployee = null;
let adminCache = [];
let adminEditingIndex = -1;
let pendingPasswordAction = null;
let passwordFailCount = 0;

const { showModal, hideModal } = createModalHelpers({ document });

function normalizeAssigneesPayload(parsed) {
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
}

function loadAssignees() {
    const pathHint = NETWORK_PATHS?.amministrazioneAssignees || ASSIGNEES_FALLBACK;
    try {
        if (!fs.existsSync(pathHint)) return { groups: {}, options: [] };
        const raw = fs.readFileSync(pathHint, "utf8");
        const parsed = JSON.parse(raw);
        return normalizeAssigneesPayload(parsed);
    } catch (err) {
        console.error("Errore lettura assignees:", err);
        return { groups: {}, options: [] };
    }
}

function saveAssignees() {
    const pathHint = NETWORK_PATHS?.amministrazioneAssignees || ASSIGNEES_FALLBACK;
    try {
        fs.writeFileSync(pathHint, JSON.stringify(assigneeGroups, null, 2), "utf8");
    } catch (err) {
        showError("Errore salvataggio dipendenti.", err.message || String(err));
    }
}

function syncAssignees() {
    const payload = loadAssignees();
    assigneeGroups = payload.groups || {};
    assigneeOptions = payload.options || [];
    if (!Object.keys(assigneeGroups).length) {
        showWarning(
            "Elenco dipendenti non disponibile.",
            "Impossibile leggere amministrazione-assignees.json dal server."
        );
    }
}

function saveSession() {
    try {
        window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    } catch (err) {
        console.error("Errore salvataggio sessione:", err);
    }
}

function clearSession() {
    session = { role: "guest", adminName: "", department: "", employee: "" };
    try {
        window.localStorage.removeItem(SESSION_KEY);
    } catch (err) {
        console.error("Errore clear session:", err);
    }
}

function isAdmin() {
    return session.role === "admin";
}

function isEmployee() {
    return session.role === "employee";
}

function isLoggedIn() {
    return isAdmin() || isEmployee();
}

function updateGreeting() {
    const greeting = document.getElementById("pm-greeting");
    if (!greeting) return;
    if (isEmployee()) {
        greeting.textContent = `Buongiorno, ${session.employee}!`;
        return;
    }
    if (isAdmin()) {
        greeting.textContent = `Buongiorno, ${session.adminName}!`;
        return;
    }
    greeting.textContent = "Buongiorno";
}

function updateLoginButton() {
    const btn = document.getElementById("pm-login-toggle");
    if (!btn) return;
    if (isAdmin()) {
        btn.textContent = `Admin: ${session.adminName}`;
        return;
    }
    if (isEmployee()) {
        btn.textContent = `Dipendente: ${session.employee}`;
        return;
    }
    btn.textContent = "Login";
}

function fillSelectOptions(selectEl, options, placeholder) {
    if (!selectEl) return;
    selectEl.innerHTML = "";
    if (placeholder) {
        const opt = document.createElement("option");
        opt.value = "";
        opt.textContent = placeholder;
        opt.disabled = true;
        opt.selected = true;
        selectEl.appendChild(opt);
    }
    options.forEach((value) => {
        const opt = document.createElement("option");
        opt.value = value;
        opt.textContent = value;
        selectEl.appendChild(opt);
    });
}

function renderLoginSelectors() {
    const deptSelect = document.getElementById("pm-login-department");
    const empSelect = document.getElementById("pm-login-employee-name");

    const departments = Object.keys(assigneeGroups || {}).sort();
    fillSelectOptions(deptSelect, departments, "Seleziona reparto");
    fillSelectOptions(empSelect, [], "Seleziona dipendente");

    if (deptSelect) {
        deptSelect.addEventListener("change", () => {
            const list = assigneeGroups[deptSelect.value] || [];
            fillSelectOptions(empSelect, list, "Seleziona dipendente");
        });
    }
}

function renderAdminSelect() {
    const adminSelect = document.getElementById("pm-login-admin-name");
    if (!adminSelect) return;
    const names = loadAdminCredentials().map((admin) => admin.name).filter(Boolean);
    fillSelectOptions(adminSelect, names, "Seleziona admin");
}

function setAdminMessage(id, text, isError = false) {
    const el = document.getElementById(id);
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

function escapeHtml(value) {
    return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function openLoginModal() {
    const modal = document.getElementById("pm-login-modal");
    const employeePanel = document.getElementById("pm-login-employee-panel");
    const adminPanel = document.getElementById("pm-login-admin-panel");
    const choiceEmployee = document.getElementById("pm-login-choice-employee");
    const choiceAdmin = document.getElementById("pm-login-choice-admin");
    if (!modal) return;
    if (employeePanel) employeePanel.classList.remove("is-hidden");
    if (adminPanel) adminPanel.classList.add("is-hidden");
    if (choiceEmployee) choiceEmployee.classList.add("is-active");
    if (choiceAdmin) choiceAdmin.classList.remove("is-active");
    modal.classList.remove("is-hidden");
    modal.setAttribute("aria-hidden", "false");
}

function closeLoginModal() {
    const modal = document.getElementById("pm-login-modal");
    if (!modal) return;
    modal.classList.add("is-hidden");
    modal.setAttribute("aria-hidden", "true");
}

function openLogoutModal() {
    const modal = document.getElementById("pm-logout-modal");
    if (!modal) return;
    modal.classList.remove("is-hidden");
    modal.setAttribute("aria-hidden", "false");
}

function closeLogoutModal() {
    const modal = document.getElementById("pm-logout-modal");
    if (!modal) return;
    modal.classList.add("is-hidden");
    modal.setAttribute("aria-hidden", "true");
}

function requireLogin() {
    if (isLoggedIn()) return true;
    showWarning("Accesso richiesto.", "Per continuare effettua il login.");
    openLoginModal();
    return false;
}

function requireAdminAccess(action) {
    if (isAdmin()) {
        if (typeof action === "function") action();
        return;
    }
    showWarning("Accesso admin richiesto.", "Effettua il login come admin per continuare.");
    openLoginModal();
}

function openPasswordModal(action) {
    pendingPasswordAction = action || null;
    const modal = document.getElementById("fp-approve-modal");
    const input = document.getElementById("fp-approve-password");
    const error = document.getElementById("fp-approve-error");
    const title = document.getElementById("fp-approve-title");
    const desc = document.getElementById("fp-approve-desc");
    if (!modal || !input) return;
    if (title && action?.title) title.textContent = action.title;
    if (desc && action?.description) desc.textContent = action.description;
    showModal(modal);
    if (error) error.classList.add("is-hidden");
    input.value = "";
    setTimeout(() => {
        input.focus();
        input.select?.();
    }, 0);
}

async function confirmPassword() {
    const input = document.getElementById("fp-approve-password");
    const error = document.getElementById("fp-approve-error");
    const password = input ? input.value : "";
    const action = pendingPasswordAction;
    if (!action) {
        if (error) error.classList.add("is-hidden");
        return;
    }
    const targetName = action?.adminName || action?.id || "";
    const shouldCheckAny = action.type === "admin-access";
    const result = await verifyAdminPassword(password, shouldCheckAny ? undefined : (targetName || undefined));
    if (!result || !result.admin) {
        if (error) error.classList.remove("is-hidden");
        passwordFailCount += 1;
        return;
    }
    passwordFailCount = 0;
    if (error) error.classList.add("is-hidden");
    hideModal(document.getElementById("fp-approve-modal"));

    if (action.type === "admin-access") {
        adminUi.openAdminModal();
        return;
    }
    if (action.type === "admin-delete") {
        const adminName = action.adminName || "";
        adminCache = adminCache.length ? adminCache : loadAdminCredentials();
        if (adminCache.length <= 1) {
            setAdminMessage("fp-admin-message", UI_TEXTS.adminMinRequired, true);
            return;
        }
        adminCache = adminCache.filter((item) => item.name !== adminName);
        setAdminCache(adminCache);
        saveAdminCredentials(adminCache);
        adminUi.renderAdminList();
        setAdminMessage("fp-admin-message", UI_TEXTS.adminRemoved, false);
    }
}

function initPasswordModal() {
    const cancel = document.getElementById("fp-approve-cancel");
    const confirm = document.getElementById("fp-approve-confirm");
    if (cancel) cancel.addEventListener("click", () => hideModal(document.getElementById("fp-approve-modal")));
    if (confirm) confirm.addEventListener("click", confirmPassword);
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

            const save = document.createElement("button");
            save.type = "button";
            save.className = "fp-assignees-link";
            save.textContent = "Salva";
            save.addEventListener("click", () => {
                const next = input.value.trim();
                if (!next) return;
                if (assigneeGroups[next] && next !== group) return;
                const copy = { ...assigneeGroups };
                const employees = copy[group] || [];
                delete copy[group];
                copy[next] = employees;
                assigneeGroups = copy;
                editingDepartment = null;
                saveAssignees();
                renderDepartmentList();
                renderEmployeesList();
                renderDepartmentSelect();
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
            const name = document.createElement("div");
            name.textContent = group;

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
                delete assigneeGroups[group];
                saveAssignees();
                renderDepartmentList();
                renderEmployeesList();
                renderDepartmentSelect();
            });

            row.appendChild(name);
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
    const employees = Object.entries(assigneeGroups)
        .flatMap(([dept, names]) => (names || []).map((name) => ({ name, dept })))
        .sort((a, b) => a.name.localeCompare(b.name));

    if (!employees.length) {
        list.textContent = UI_TEXTS.emptyAssignee;
        return;
    }

    employees.forEach((emp) => {
        const row = document.createElement("div");
        row.className = "fp-assignees-row";
        const actions = document.createElement("div");
        actions.className = "fp-assignees-row__actions";

        if (editingEmployee && editingEmployee.name === emp.name && editingEmployee.dept === emp.dept) {
            const input = document.createElement("input");
            input.className = "fp-field__input";
            input.value = emp.name;

            const save = document.createElement("button");
            save.type = "button";
            save.className = "fp-assignees-link";
            save.textContent = "Salva";
            save.addEventListener("click", () => {
                const next = input.value.trim();
                if (!next) return;
                const listForDept = assigneeGroups[emp.dept] || [];
                const idx = listForDept.indexOf(emp.name);
                if (idx >= 0) listForDept[idx] = next;
                assigneeGroups[emp.dept] = Array.from(new Set(listForDept)).sort((a, b) => a.localeCompare(b));
                editingEmployee = null;
                saveAssignees();
                renderEmployeesList();
                renderDepartmentList();
            });

            const cancel = document.createElement("button");
            cancel.type = "button";
            cancel.className = "fp-assignees-link fp-assignees-link--danger";
            cancel.textContent = "Annulla";
            cancel.addEventListener("click", () => {
                editingEmployee = null;
                renderEmployeesList();
            });

            row.appendChild(input);
            actions.appendChild(save);
            actions.appendChild(cancel);
        } else {
            const name = document.createElement("div");
            name.textContent = `${emp.name} (${emp.dept})`;

            const edit = document.createElement("button");
            edit.type = "button";
            edit.className = "fp-assignees-link";
            edit.textContent = "Modifica";
            edit.addEventListener("click", () => {
                editingEmployee = { name: emp.name, dept: emp.dept };
                renderEmployeesList();
            });

            const remove = document.createElement("button");
            remove.type = "button";
            remove.className = "fp-assignees-link fp-assignees-link--danger";
            remove.textContent = "Rimuovi";
            remove.addEventListener("click", () => {
                assigneeGroups[emp.dept] = (assigneeGroups[emp.dept] || []).filter((n) => n !== emp.name);
                saveAssignees();
                renderEmployeesList();
                renderDepartmentList();
            });

            row.appendChild(name);
            actions.appendChild(edit);
            actions.appendChild(remove);
        }

        row.appendChild(actions);
        list.appendChild(row);
    });
}

function getAssigneeGroups() {
    return { ...assigneeGroups };
}

function setAssigneeGroups(next) {
    assigneeGroups = { ...next };
}

function setAssigneeOptions(next) {
    assigneeOptions = Array.isArray(next) ? [...next] : [];
}

function setEditingDepartment(next) {
    editingDepartment = next;
}

function setEditingEmployee(next) {
    editingEmployee = next;
}

function getAdminCache() {
    return adminCache;
}

function setAdminCache(next) {
    adminCache = Array.isArray(next) ? [...next] : [];
}

function getAdminEditingIndex() {
    return adminEditingIndex;
}

function setAdminEditingIndex(next) {
    adminEditingIndex = next;
}

async function openConfirmModal(message) {
    const result = await showDialog("warning", "Conferma", message, ["Annulla", "Conferma"]);
    return result && result.response === 1;
}

function openOtpModal() {
    showInfo("Recupero password", "Funzione OTP non configurata in Product Manager.");
}

const assigneesUi = createAssigneesModal({
    document,
    showModal,
    hideModal,
    renderDepartmentList,
    renderEmployeesList,
    renderDepartmentSelect,
    populateEmployees: renderDepartmentSelect,
    saveAssigneeOptions: saveAssignees,
    syncBalancesAfterAssignees: null,
    getAssigneeGroups,
    setAssigneeGroups,
    setAssigneeOptions,
    setEditingDepartment,
    setEditingEmployee,
    onOpenAttempt: () => requireAdminAccess(() => assigneesUi.openAssigneesModal()),
});

const adminUi = createAdminModals({
    document,
    showModal,
    hideModal,
    setAdminMessage,
    openConfirmModal,
    escapeHtml,
    openPasswordModal,
    openOtpModal,
    loadAdminCredentials,
    saveAdminCredentials,
    verifyAdminPassword,
    hashPassword,
    isHashingAvailable,
    isValidEmail,
    isValidPhone,
    showDialog,
    getAdminCache,
    setAdminCache,
    getAdminEditingIndex,
    setAdminEditingIndex,
    isInitialSetupActive: () => false,
    onInitialSetupComplete: () => {},
});

function setupLogin() {
    const loginBtn = document.getElementById("pm-login-toggle");
    const loginClose = document.getElementById("pm-login-close");
    const choiceEmployee = document.getElementById("pm-login-choice-employee");
    const choiceAdmin = document.getElementById("pm-login-choice-admin");
    const employeePanel = document.getElementById("pm-login-employee-panel");
    const adminPanel = document.getElementById("pm-login-admin-panel");
    const employeeConfirm = document.getElementById("pm-login-employee-confirm");
    const adminConfirm = document.getElementById("pm-login-admin-confirm");
    const adminError = document.getElementById("pm-login-admin-error");

    if (loginBtn) {
        loginBtn.addEventListener("click", () => {
            if (isLoggedIn()) {
                openLogoutModal();
                return;
            }
            openLoginModal();
        });
    }

    if (loginClose) {
        loginClose.addEventListener("click", () => closeLoginModal());
    }

    if (choiceEmployee) {
        choiceEmployee.addEventListener("click", () => {
            if (employeePanel) employeePanel.classList.remove("is-hidden");
            if (adminPanel) adminPanel.classList.add("is-hidden");
            choiceEmployee.classList.add("is-active");
            if (choiceAdmin) choiceAdmin.classList.remove("is-active");
        });
    }

    if (choiceAdmin) {
        choiceAdmin.addEventListener("click", () => {
            if (adminPanel) adminPanel.classList.remove("is-hidden");
            if (employeePanel) employeePanel.classList.add("is-hidden");
            choiceAdmin.classList.add("is-active");
            if (choiceEmployee) choiceEmployee.classList.remove("is-active");
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
            session = { role: "employee", adminName: "", department: dept, employee: emp };
            saveSession();
            updateGreeting();
            updateLoginButton();
            closeLoginModal();
        });
    }

    if (adminConfirm) {
        adminConfirm.addEventListener("click", async () => {
            const adminName = document.getElementById("pm-login-admin-name")?.value || "";
            const password = document.getElementById("pm-login-admin-password")?.value || "";
            if (adminError) adminError.classList.add("is-hidden");
            if (!adminName || !password) {
                if (adminError) adminError.classList.remove("is-hidden");
                return;
            }
            const verified = await verifyAdminPassword(password, adminName);
            if (!verified || !verified.admin) {
                if (adminError) adminError.classList.remove("is-hidden");
                return;
            }
            session = { role: "admin", adminName: verified.admin.name, department: "", employee: "" };
            saveSession();
            updateGreeting();
            updateLoginButton();
            closeLoginModal();
        });
    }
}

function setupHeaderButtons() {
    const refreshBtn = document.getElementById("pm-refresh");
    const settingsBtn = document.getElementById("pm-settings");
    const cartBtn = document.getElementById("pm-open-cart");
    const addLineBtn = document.getElementById("pm-add-line");
    const saveBtn = document.getElementById("pm-request-save");

    if (refreshBtn) {
        refreshBtn.addEventListener("click", () => {
            syncAssignees();
            renderLoginSelectors();
        });
    }

    if (settingsBtn) {
        settingsBtn.addEventListener("click", () => {
            if (!requireLogin()) return;
            const modal = document.getElementById("pm-settings-modal");
            if (modal) {
                modal.classList.remove("is-hidden");
                modal.setAttribute("aria-hidden", "false");
            }
        });
    }

    if (cartBtn) {
        cartBtn.addEventListener("click", () => {
            if (!requireLogin()) return;
            ipcRenderer.send("open-product-manager-cart-window");
        });
    }

    if (addLineBtn) {
        addLineBtn.addEventListener("click", (event) => {
            if (!requireLogin()) {
                event.preventDefault();
                event.stopPropagation();
            }
        });
    }

    if (saveBtn) {
        saveBtn.addEventListener("click", (event) => {
            if (!requireLogin()) {
                event.preventDefault();
                event.stopPropagation();
            }
        });
    }
}

function initSettingsModals() {
    const settingsClose = document.getElementById("pm-settings-close");
    if (settingsClose) settingsClose.addEventListener("click", () => {
        const modal = document.getElementById("pm-settings-modal");
        if (modal) {
            modal.classList.add("is-hidden");
            modal.setAttribute("aria-hidden", "true");
        }
    });

    const themeOpen = document.getElementById("pm-theme-open");
    const themeClose = document.getElementById("pm-theme-close");
    const themeModal = document.getElementById("pm-theme-modal");
    if (themeOpen && themeModal) {
        themeOpen.addEventListener("click", () => {
            themeModal.classList.remove("is-hidden");
            themeModal.setAttribute("aria-hidden", "false");
        });
    }
    if (themeClose && themeModal) {
        themeClose.addEventListener("click", () => {
            themeModal.classList.add("is-hidden");
            themeModal.setAttribute("aria-hidden", "true");
        });
    }

    const setTheme = (theme) => {
        document.body.classList.remove("fp-dark", "fp-aypi");
        if (theme === "dark") document.body.classList.add("fp-dark");
        if (theme === "aypi") document.body.classList.add("fp-aypi");
        try {
            window.localStorage.setItem("pm-theme", theme);
        } catch {}
    };
    const themeLight = document.getElementById("pm-theme-light");
    const themeDark = document.getElementById("pm-theme-dark");
    const themeAyPi = document.getElementById("pm-theme-aypi");
    if (themeLight) themeLight.addEventListener("click", () => setTheme("light"));
    if (themeDark) themeDark.addEventListener("click", () => setTheme("dark"));
    if (themeAyPi) themeAyPi.addEventListener("click", () => setTheme("aypi"));
    try {
        const saved = window.localStorage.getItem("pm-theme");
        if (saved) {
            setTheme(saved);
        } else {
            setTheme("light");
        }
    } catch {}

    const assigneesOpen = document.getElementById("pm-assignees-open");
    if (assigneesOpen) {
        assigneesOpen.addEventListener("click", () => {
            const modal = document.getElementById("pm-settings-modal");
            if (modal) modal.classList.add("is-hidden");
            requireAdminAccess(() => assigneesUi.openAssigneesModal());
        });
    }

    const adminOpen = document.getElementById("pm-admin-open");
    if (adminOpen) {
        adminOpen.addEventListener("click", () => {
            const modal = document.getElementById("pm-settings-modal");
            if (modal) modal.classList.add("is-hidden");
            requireAdminAccess(() => {
                openPasswordModal({
                    type: "admin-access",
                    id: "admin-access",
                    title: "Gestione admin",
                    description: UI_TEXTS.adminAccessDescription,
                });
            });
        });
    }

    adminUi.initAdminModals();
    assigneesUi.initAssigneesModal();
    initPasswordModal();
}

function initLogoutModal() {
    const logoutCancel = document.getElementById("pm-logout-cancel");
    const logoutConfirm = document.getElementById("pm-logout-confirm");
    if (logoutCancel) logoutCancel.addEventListener("click", () => closeLogoutModal());
    if (logoutConfirm) {
        logoutConfirm.addEventListener("click", () => {
            clearSession();
            updateGreeting();
            updateLoginButton();
            closeLogoutModal();
        });
    }
}

function init() {
    const warning = document.getElementById("pm-js-warning");
    if (warning) warning.classList.add("is-hidden");
    clearSession();
    syncAssignees();
    renderLoginSelectors();
    renderAdminSelect();
    setupLogin();
    setupHeaderButtons();
    initSettingsModals();
    initLogoutModal();
    updateGreeting();
    updateLoginButton();
    openLoginModal();
}

window.addEventListener("DOMContentLoaded", () => {
    try {
        init();
    } catch (err) {
        showError("Errore inizializzazione Product Manager.", err.message || String(err));
    }
});

window.addEventListener("error", (event) => {
    const detail = event?.error?.stack || event?.message || "Errore sconosciuto";
    showError("Errore Product Manager.", detail);
});

window.addEventListener("unhandledrejection", (event) => {
    const reason = event?.reason;
    const detail = reason?.stack || reason?.message || String(reason || "Errore sconosciuto");
    showError("Errore Product Manager (Promise).", detail);
});
