function renderDepartmentSelect(ctx) {
    const { document, getAssigneeGroups } = ctx;
    const select = document.getElementById("fp-employee-department");
    if (!select) return;
    select.innerHTML = "";
    Object.keys(getAssigneeGroups())
        .sort((a, b) => a.localeCompare(b))
        .forEach((group) => {
            const option = document.createElement("option");
            option.value = group;
            option.textContent = group;
            select.appendChild(option);
        });
}

function renderDepartmentList(ctx) {
    const {
        document,
        getAssigneeGroups,
        editingDepartment,
        setEditingDepartment,
        setAssigneeGroups,
        saveAssignees,
        renderEmployeesList,
        renderDepartmentSelect,
        UI_TEXTS,
    } = ctx;
    const list = document.getElementById("fp-departments-list");
    if (!list) return;
    list.innerHTML = "";
    const groups = Object.keys(getAssigneeGroups()).sort((a, b) => a.localeCompare(b));
    if (!groups.length) {
        list.textContent = UI_TEXTS.emptyDepartment;
        return;
    }
    groups.forEach((group) => {
        const row = document.createElement("div");
        row.className = "fp-assignees-row";
        const actions = document.createElement("div");
        actions.className = "fp-assignees-row__actions";

        if (editingDepartment() === group) {
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
                const current = getAssigneeGroups();
                if (current[next] && next !== group) return;
                const copy = { ...current };
                const employees = copy[group] || [];
                delete copy[group];
                copy[next] = employees;
                setAssigneeGroups(copy);
                setEditingDepartment(null);
                saveAssignees();
                renderDepartmentList(ctx);
                renderEmployeesList(ctx);
                renderDepartmentSelect(ctx);
            });

            const cancel = document.createElement("button");
            cancel.type = "button";
            cancel.className = "fp-assignees-link fp-assignees-link--danger";
            cancel.textContent = "Annulla";
            cancel.addEventListener("click", () => {
                setEditingDepartment(null);
                renderDepartmentList(ctx);
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
                setEditingDepartment(group);
                renderDepartmentList(ctx);
            });

            const remove = document.createElement("button");
            remove.type = "button";
            remove.className = "fp-assignees-link fp-assignees-link--danger";
            remove.textContent = "Rimuovi";
            remove.addEventListener("click", () => {
                const copy = { ...getAssigneeGroups() };
                delete copy[group];
                setAssigneeGroups(copy);
                saveAssignees();
                renderDepartmentList(ctx);
                renderEmployeesList(ctx);
                renderDepartmentSelect(ctx);
            });

            row.appendChild(name);
            actions.appendChild(edit);
            actions.appendChild(remove);
        }

        row.appendChild(actions);
        list.appendChild(row);
    });
}

function renderEmployeesList(ctx) {
    const {
        document,
        getAssigneeGroups,
        editingEmployee,
        setEditingEmployee,
        saveAssignees,
        renderDepartmentSelect,
        renderLoginSelectors,
        UI_TEXTS,
    } = ctx;
    const list = document.getElementById("fp-employees-list");
    if (!list) return;
    list.innerHTML = "";
    const employees = Object.entries(getAssigneeGroups())
        .flatMap(([dept, names]) => (names || []).map((name) => ({ name, dept })))
        .sort((a, b) => a.name.localeCompare(b.name));

    if (!employees.length) {
        list.textContent = UI_TEXTS.emptyAssignee;
        return;
    }

    employees.forEach((employee) => {
        const row = document.createElement("div");
        row.className = "fp-assignees-row";
        const actions = document.createElement("div");
        actions.className = "fp-assignees-row__actions";

        const currentEditing = editingEmployee();
        if (currentEditing && currentEditing.name === employee.name && currentEditing.dept === employee.dept) {
            const input = document.createElement("input");
            input.className = "fp-field__input";
            input.value = employee.name;

            const deptSelect = document.createElement("select");
            deptSelect.className = "fp-field__input";
            Object.keys(getAssigneeGroups()).sort().forEach((group) => {
                const option = document.createElement("option");
                option.value = group;
                option.textContent = group;
                if (group === employee.dept) option.selected = true;
                deptSelect.appendChild(option);
            });

            const save = document.createElement("button");
            save.type = "button";
            save.className = "fp-assignees-link";
            save.textContent = "Salva";
            save.addEventListener("click", () => {
                const nextName = input.value.trim();
                const nextDept = deptSelect.value;
                if (!nextName) return;
                const currentGroups = getAssigneeGroups();
                const currentList = currentGroups[employee.dept] || [];
                const filtered = currentList.filter((name) => name !== employee.name);
                const nextGroups = { ...currentGroups, [employee.dept]: filtered };
                const nextList = nextGroups[nextDept] ? [...nextGroups[nextDept]] : [];
                nextList.push(nextName);
                nextGroups[nextDept] = nextList;
                setAssigneeGroups(nextGroups);
                setEditingEmployee(null);
                saveAssignees();
                renderEmployeesList(ctx);
                renderDepartmentSelect(ctx);
                renderLoginSelectors();
            });

            const cancel = document.createElement("button");
            cancel.type = "button";
            cancel.className = "fp-assignees-link fp-assignees-link--danger";
            cancel.textContent = "Annulla";
            cancel.addEventListener("click", () => {
                setEditingEmployee(null);
                renderEmployeesList(ctx);
            });

            row.appendChild(input);
            row.appendChild(deptSelect);
            actions.appendChild(save);
            actions.appendChild(cancel);
        } else {
            const name = document.createElement("div");
            name.textContent = employee.name;

            const dept = document.createElement("div");
            dept.textContent = employee.dept;

            const edit = document.createElement("button");
            edit.type = "button";
            edit.className = "fp-assignees-link";
            edit.textContent = "Modifica";
            edit.addEventListener("click", () => {
                setEditingEmployee(employee);
                renderEmployeesList(ctx);
            });

            const remove = document.createElement("button");
            remove.type = "button";
            remove.className = "fp-assignees-link fp-assignees-link--danger";
            remove.textContent = "Rimuovi";
            remove.addEventListener("click", () => {
                const currentGroups = getAssigneeGroups();
                const list = currentGroups[employee.dept] || [];
                const nextGroups = { ...currentGroups };
                nextGroups[employee.dept] = list.filter((name) => name !== employee.name);
                setAssigneeGroups(nextGroups);
                saveAssignees();
                renderEmployeesList(ctx);
                renderDepartmentSelect(ctx);
                renderLoginSelectors();
            });

            row.appendChild(name);
            row.appendChild(dept);
            actions.appendChild(edit);
            actions.appendChild(remove);
        }

        row.appendChild(actions);
        list.appendChild(row);
    });
}

module.exports = {
    renderDepartmentSelect,
    renderDepartmentList,
    renderEmployeesList,
};
