const { ipcRenderer } = require("electron");
const fs = require("fs");
const path = require("path");

const DATA_PATH = "\\\\Dl360\\pubbliche\\TECH\\AyPi\\AGPRESS\\ferie-permessi.json";
const ASSIGNEES_PATH = "\\\\Dl360\\pubbliche\\TECH\\AyPi\\AGPRESS\\amministrazione-assignees.json";
const APPROVAL_PASSWORD = "AGPress";
const AUTO_REFRESH_MS = 15000;

let calendar = null;
let pendingAction = null;
let refreshTimer = null;
let selectedEventId = null;
let editingRequestId = null;
let pendingPanelOpen = false;
let pendingUnlocked = false;
let assigneeOptions = [];
let assigneeGroups = {};
let editingDepartment = null;
let editingEmployee = null;

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

function showDialog(type, message, detail = "") {
    return ipcRenderer.invoke("show-message-box", { type, message, detail });
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

function addDaysToDateString(dateStr, days) {
    if (!dateStr) return dateStr;
    const [year, month, day] = dateStr.split("-").map((v) => parseInt(v, 10));
    if (!year || !month || !day) return dateStr;
    const next = new Date(year, month - 1, day);
    next.setDate(next.getDate() + days);
    return next.toISOString().slice(0, 10);
}

function buildEventFromRequest(request) {
    const typeLabel = request.type === "permesso" ? "Permesso" : "Ferie";
    const title = `${request.employee} - ${typeLabel}`;
    if (request.allDay) {
        const endDate = request.end || request.start;
        return {
            id: request.id,
            title,
            start: request.start,
            end: addDaysToDateString(endDate, 1),
            allDay: true,
            backgroundColor: request.type === "permesso" ? "#f08c00" : "#2f9e44",
            borderColor: request.type === "permesso" ? "#f08c00" : "#2f9e44",
        };
    }
    return {
        id: request.id,
        title,
        start: request.start,
        end: request.end,
        allDay: false,
        backgroundColor: request.type === "permesso" ? "#f08c00" : "#2f9e44",
        borderColor: request.type === "permesso" ? "#f08c00" : "#2f9e44",
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
        title.textContent = request.employee || "Dipendente";
        card.appendChild(title);

        const meta = document.createElement("p");
        const dept = request.department ? ` - ${request.department}` : "";
        meta.textContent = `${request.type === "permesso" ? "Permesso" : "Ferie"}${dept}`;
        card.appendChild(meta);

        const range = document.createElement("p");
        range.textContent = formatRange(request);
        card.appendChild(range);

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
    renderSummary(data);
    renderPendingList(data);
    renderCalendar(data);
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

function confirmApproval() {
    const input = document.getElementById("fp-approve-password");
    const error = document.getElementById("fp-approve-error");
    const password = input ? input.value : "";
    if (password !== APPROVAL_PASSWORD) {
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
            openEditModal(target);
        }
    }
    if (actionType === "pending-access") {
        pendingUnlocked = true;
        closeApprovalModal();
        openPendingPanel();
    }
}

function getFieldValue(id) {
    return document.getElementById(id)?.value || "";
}

function isChecked(id) {
    return !!document.getElementById(id)?.checked;
}

function buildRequestFromForm(prefix, requestId) {
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

    if (allDay && endDate < startDate) {
        return { error: "La data fine non puo essere precedente alla data inizio." };
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

function resetForm(prefix) {
    const note = document.getElementById(`${prefix}-note`);
    if (note) note.value = "";
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

    const departments = Object.keys(groups);
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
        const employees = Array.isArray(groups[selected]) ? groups[selected] : [];
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
    fillFormFromRequest("fp-edit", request);
}

function closeEditModal() {
    const modal = document.getElementById("fp-edit-modal");
    const message = document.getElementById("fp-edit-message");
    if (!modal) return;
    hideModal(modal);
    setMessage(message, "");
    editingRequestId = null;
}

function renderDepartmentSelect() {
    const select = document.getElementById("fp-employee-department");
    if (!select) return;
    select.innerHTML = "";
    Object.keys(assigneeGroups).forEach((group) => {
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
    const groups = Object.keys(assigneeGroups);
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
    const groups = Object.keys(assigneeGroups);
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
    employees.forEach((employee) => {
        const row = document.createElement("div");
        row.className = "fp-assignees-row";

        const actions = document.createElement("div");
        actions.className = "fp-assignees-row__actions";

        if (editingEmployee && editingEmployee.name === employee.name && editingEmployee.group === employee.group) {
            const select = document.createElement("select");
            select.className = "fp-field__input";
            Object.keys(assigneeGroups).forEach((group) => {
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
        },
        eventTimeFormat: {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
        },
        eventClick: (info) => {
            selectedEventId = info?.event?.id || null;
        },
        eventDidMount: (info) => {
            if (!info || !info.el) return;
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
    });
    calendar.render();
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
    const assigneesData = loadAssigneeOptions();
    assigneeOptions = assigneesData.options;
    assigneeGroups = assigneesData.groups;
    populateEmployees();
    initCalendar();

    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const startDate = document.getElementById("fp-start-date");
    const endDate = document.getElementById("fp-end-date");
    if (startDate) startDate.value = today;
    if (endDate) endDate.value = today;

    const allDayToggle = document.getElementById("fp-all-day");
    if (allDayToggle) {
        toggleAllDayState(allDayToggle.checked);
        allDayToggle.addEventListener("change", () => {
            toggleAllDayState(allDayToggle.checked);
        });
    }
    const startTimeInput = document.getElementById("fp-start-time");
    const endTimeInput = document.getElementById("fp-end-time");
    const handleTimeFocus = () => {
        if (!allDayToggle || !allDayToggle.checked) return;
        allDayToggle.checked = false;
        toggleAllDayState(false);
    };
    if (startTimeInput) startTimeInput.addEventListener("focus", handleTimeFocus);
    if (endTimeInput) endTimeInput.addEventListener("focus", handleTimeFocus);

    const form = document.getElementById("fp-request-form");
    const message = document.getElementById("fp-form-message");
    if (form) {
        form.addEventListener("submit", (event) => {
            event.preventDefault();
            setMessage(message, "");
            const { request, error } = buildRequestFromForm("fp");
            if (error) {
                setMessage(message, error, true);
                return;
            }
            const updated = syncData((payload) => {
                payload.requests = payload.requests || [];
                payload.requests.push(request);
                return payload;
            });
            setMessage(message, "Richiesta inviata.", false);
            resetForm("fp");
            renderAll(updated);
        });
    }

    const refreshBtn = document.getElementById("fp-refresh");
    if (refreshBtn) {
        refreshBtn.addEventListener("click", () => {
            refreshData();
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
            if (event.target === approveModal) closeApprovalModal();
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

    if (editAllDay) {
        toggleAllDayStateFor("fp-edit", editAllDay.checked);
        editAllDay.addEventListener("change", () => {
            toggleAllDayStateFor("fp-edit", editAllDay.checked);
        });
    }
    const handleEditTimeFocus = () => {
        if (!editAllDay || !editAllDay.checked) return;
        editAllDay.checked = false;
        toggleAllDayStateFor("fp-edit", false);
    };
    if (editStartTime) editStartTime.addEventListener("focus", handleEditTimeFocus);
    if (editEndTime) editEndTime.addEventListener("focus", handleEditTimeFocus);

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
            if (event.target === editModal) closeEditModal();
        });
    }

    if (editForm) {
        editForm.addEventListener("submit", (event) => {
            event.preventDefault();
            if (!editingRequestId) return;
            setMessage(editMessage, "");
            const { request, error } = buildRequestFromForm("fp-edit", editingRequestId);
            if (error) {
                setMessage(editMessage, error, true);
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
                    };
                }
                return payload;
            });
            setMessage(editMessage, "Richiesta aggiornata.", false);
            closeEditModal();
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
