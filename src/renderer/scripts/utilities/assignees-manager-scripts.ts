// @ts-nocheck
require("../shared/dev-guards");
const { loadAssigneeOptions, saveAssigneeOptions } = require("./ferie-permessi/services/assignees");
const { UI_TEXTS } = require("./ferie-permessi/utils/ui-texts");
const {
    renderDepartmentSelect,
    renderDepartmentList,
    renderEmployeesList,
} = require("./product-manager/ui/assignees-admin-ui");

let assigneeGroups = {};
let assigneeEmails = {};
let editingDepartment = null;
let editingEmployee = null;

function setMessage(text, isError = false) {
    const el = document.getElementById("am-message");
    if (!el) return;
    if (!text) {
        el.classList.add("is-hidden");
        el.textContent = "";
        el.classList.remove("fp-message--error");
        return;
    }
    el.classList.remove("is-hidden");
    el.textContent = text;
    el.classList.toggle("fp-message--error", !!isError);
}

function saveAll() {
    saveAssigneeOptions({ groups: assigneeGroups, emails: assigneeEmails });
}

function getCtx() {
    return {
        document,
        getAssigneeGroups: () => ({ ...assigneeGroups }),
        getAssigneeEmails: () => ({ ...(assigneeEmails || {}) }),
        setAssigneeGroups: (next) => {
            assigneeGroups = next && typeof next === "object" ? { ...next } : {};
        },
        setAssigneeEmails: (next) => {
            assigneeEmails = next && typeof next === "object" ? { ...next } : {};
        },
        editingDepartment: () => editingDepartment,
        setEditingDepartment: (next) => {
            editingDepartment = next;
        },
        editingEmployee: () => editingEmployee,
        setEditingEmployee: (next) => {
            editingEmployee = next;
        },
        saveAssignees: () => {
            saveAll();
            setMessage("Dati salvati.");
        },
        renderEmployeesList: () => renderEmployeesList(getCtx()),
        renderDepartmentSelect: () => renderDepartmentSelect(getCtx()),
        renderLoginSelectors: () => {},
        UI_TEXTS,
    };
}

function redraw() {
    const ctx = getCtx();
    renderDepartmentList(ctx);
    renderEmployeesList(ctx);
    renderDepartmentSelect(ctx);
}

function loadAll() {
    const payload = loadAssigneeOptions();
    assigneeGroups = payload.groups || {};
    assigneeEmails = payload.emails || {};
}

function addDepartment() {
    const input = document.getElementById("fp-department-name");
    const name = String(input?.value || "").trim();
    if (!name || assigneeGroups[name]) return;
    assigneeGroups[name] = [];
    saveAll();
    if (input) input.value = "";
    redraw();
    setMessage("Reparto aggiunto.");
}

function addEmployee() {
    const dept = String(document.getElementById("fp-employee-department")?.value || "").trim();
    const name = String(document.getElementById("fp-employee-name")?.value || "").trim();
    const email = String(document.getElementById("fp-employee-email")?.value || "").trim();
    if (!dept || !name) return;
    if (!assigneeGroups[dept]) assigneeGroups[dept] = [];
    if (!assigneeGroups[dept].includes(name)) {
        assigneeGroups[dept].push(name);
        assigneeGroups[dept].sort((a, b) => a.localeCompare(b));
    }
    const key = `${dept}|${name}`;
    if (email) assigneeEmails[key] = email;
    else delete assigneeEmails[key];
    saveAll();
    const nameInput = document.getElementById("fp-employee-name");
    const emailInput = document.getElementById("fp-employee-email");
    if (nameInput) nameInput.value = "";
    if (emailInput) emailInput.value = "";
    redraw();
    setMessage("Dipendente aggiunto.");
}

function init() {
    loadAll();
    redraw();

    document.getElementById("am-refresh")?.addEventListener("click", () => {
        loadAll();
        redraw();
        setMessage("Dati aggiornati.");
    });
    document.getElementById("am-close")?.addEventListener("click", () => window.close());
    document.getElementById("fp-department-add")?.addEventListener("click", addDepartment);
    document.getElementById("fp-employee-add")?.addEventListener("click", addEmployee);
    document.getElementById("fp-department-name")?.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        addDepartment();
    });
    const triggerEmployee = (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        addEmployee();
    };
    document.getElementById("fp-employee-name")?.addEventListener("keydown", triggerEmployee);
    document.getElementById("fp-employee-email")?.addEventListener("keydown", triggerEmployee);
}

document.addEventListener("DOMContentLoaded", init);



