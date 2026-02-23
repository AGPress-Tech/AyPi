// @ts-nocheck
require("../../../shared/dev-guards");
import { ensureCustomSelect, syncCustomSelect } from "./custom-select";

function fillSelectOptions(selectEl, options, placeholder) {
    if (!selectEl) return;
    const doc = selectEl.ownerDocument || document;
    selectEl.innerHTML = "";
    if (placeholder) {
        const opt = doc.createElement("option");
        opt.value = "";
        opt.textContent = placeholder;
        opt.disabled = true;
        opt.selected = true;
        selectEl.appendChild(opt);
    }
    options.forEach((value) => {
        const opt = doc.createElement("option");
        opt.value = value;
        opt.textContent = value;
        selectEl.appendChild(opt);
    });
    syncCustomSelect(selectEl);
}

function renderLoginSelectors({ document, getAssigneeGroups }) {
    const deptSelect = document.getElementById("pm-login-department");
    const empSelect = document.getElementById("pm-login-employee-name");

    const groups = getAssigneeGroups();
    const departments = Object.keys(groups || {}).sort();
    fillSelectOptions(deptSelect, departments, "Seleziona reparto");
    fillSelectOptions(empSelect, [], "Seleziona dipendente");
    ensureCustomSelect(deptSelect);
    ensureCustomSelect(empSelect);

    if (deptSelect) {
        deptSelect.addEventListener("change", () => {
            const current = getAssigneeGroups();
            const list = current[deptSelect.value] || [];
            fillSelectOptions(empSelect, list, "Seleziona dipendente");
        });
    }
}

function renderAdminSelect({ document, loadAdminCredentials }) {
    const adminSelect = document.getElementById("pm-login-admin-name");
    if (!adminSelect) return;
    const names = loadAdminCredentials()
        .map((admin) => admin.name)
        .filter(Boolean);
    fillSelectOptions(adminSelect, names, "Seleziona admin");
    ensureCustomSelect(adminSelect);
}

if (typeof module !== "undefined" && module.exports && !(globalThis as any).__aypiBundled) module.exports = {
    renderLoginSelectors,
    renderAdminSelect,
};

