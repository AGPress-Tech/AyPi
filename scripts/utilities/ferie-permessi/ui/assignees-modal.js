function createAssigneesModal(options) {
    const {
        document,
        showModal,
        hideModal,
        renderDepartmentList,
        renderEmployeesList,
        renderDepartmentSelect,
        populateEmployees,
        saveAssigneeOptions,
        syncBalancesAfterAssignees,
        getAssigneeGroups,
        setAssigneeGroups,
        setAssigneeOptions,
        getAssigneeEmails,
        setAssigneeEmails,
        setEditingDepartment,
        setEditingEmployee,
        onOpenAttempt,
    } = options || {};

    if (!document) {
        throw new Error("document richiesto.");
    }

    function closeAssigneesModal() {
        const assigneesModal = document.getElementById("fp-assignees-modal");
        const departmentInput = document.getElementById("fp-department-name");
        const employeeNameInput = document.getElementById("fp-employee-name");
        const employeeEmailInput = document.getElementById("fp-employee-email");
        if (!assigneesModal) return;
        hideModal(assigneesModal);
        if (departmentInput) departmentInput.value = "";
        if (employeeNameInput) employeeNameInput.value = "";
        if (employeeEmailInput) employeeEmailInput.value = "";
        setEditingDepartment(null);
        setEditingEmployee(null);
        renderDepartmentList();
        renderEmployeesList();
        renderDepartmentSelect();
    }

    function openAssigneesModal() {
        const assigneesModal = document.getElementById("fp-assignees-modal");
        const departmentInput = document.getElementById("fp-department-name");
        if (!assigneesModal) return;
        showModal(assigneesModal);
        renderDepartmentList();
        renderEmployeesList();
        renderDepartmentSelect();
        if (departmentInput) departmentInput.focus();
    }

    function initAssigneesModal() {
        const assigneesManage = document.getElementById("fp-assignees-manage");
        const assigneesModal = document.getElementById("fp-assignees-modal");
        const assigneesClose = document.getElementById("fp-assignees-close");
        const departmentInput = document.getElementById("fp-department-name");
        const departmentAdd = document.getElementById("fp-department-add");
        const employeeNameInput = document.getElementById("fp-employee-name");
        const employeeEmailInput = document.getElementById("fp-employee-email");
        const employeeAdd = document.getElementById("fp-employee-add");

        if (assigneesManage && assigneesModal) {
            assigneesManage.addEventListener("click", () => {
                if (typeof onOpenAttempt === "function") {
                    onOpenAttempt();
                    return;
                }
                openAssigneesModal();
            });
        }

        if (assigneesClose) {
            assigneesClose.addEventListener("click", closeAssigneesModal);
        }

        if (assigneesModal) {
            assigneesModal.addEventListener("click", (event) => {
                if (event.target === assigneesModal) {
                    // no-op: keep modal open on backdrop click
                }
            });
        }

        if (departmentAdd) {
            departmentAdd.addEventListener("click", () => {
                const name = departmentInput ? departmentInput.value.trim() : "";
                const assigneeGroups = getAssigneeGroups();
                if (!name || assigneeGroups[name]) return;
                assigneeGroups[name] = [];
                setAssigneeGroups(assigneeGroups);
                setAssigneeOptions(Object.values(assigneeGroups).flat());
                saveAssigneeOptions({
                    groups: assigneeGroups,
                    emails: typeof getAssigneeEmails === "function" ? getAssigneeEmails() : {},
                });
                if (typeof syncBalancesAfterAssignees === "function") {
                    syncBalancesAfterAssignees();
                }
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
                const email = employeeEmailInput ? employeeEmailInput.value.trim() : "";
                if (!department || !name) return;
                const assigneeGroups = getAssigneeGroups();
                if (!assigneeGroups[department]) assigneeGroups[department] = [];
                if (!assigneeGroups[department].includes(name)) {
                    assigneeGroups[department].push(name);
                    assigneeGroups[department].sort((a, b) => a.localeCompare(b));
                }
                const emails = typeof getAssigneeEmails === "function" ? getAssigneeEmails() : {};
                if (typeof setAssigneeEmails === "function") {
                    const key = `${department}|${name}`;
                    if (email) emails[key] = email;
                    else delete emails[key];
                    setAssigneeEmails(emails);
                }
                setAssigneeGroups(assigneeGroups);
                setAssigneeOptions(Object.values(assigneeGroups).flat());
                saveAssigneeOptions({
                    groups: assigneeGroups,
                    emails: typeof getAssigneeEmails === "function" ? getAssigneeEmails() : {},
                });
                if (typeof syncBalancesAfterAssignees === "function") {
                    syncBalancesAfterAssignees();
                }
                renderEmployeesList();
                populateEmployees();
                if (employeeNameInput) employeeNameInput.value = "";
                if (employeeEmailInput) employeeEmailInput.value = "";
            });
        }
    }

    return { initAssigneesModal, closeAssigneesModal, openAssigneesModal };
}

module.exports = { createAssigneesModal };
