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
        getAssigneeGroups,
        setAssigneeGroups,
        setAssigneeOptions,
        setEditingDepartment,
        setEditingEmployee,
    } = options || {};

    if (!document) {
        throw new Error("document richiesto.");
    }

    function closeAssigneesModal() {
        const assigneesModal = document.getElementById("fp-assignees-modal");
        const departmentInput = document.getElementById("fp-department-name");
        const employeeNameInput = document.getElementById("fp-employee-name");
        if (!assigneesModal) return;
        hideModal(assigneesModal);
        if (departmentInput) departmentInput.value = "";
        if (employeeNameInput) employeeNameInput.value = "";
        setEditingDepartment(null);
        setEditingEmployee(null);
        renderDepartmentList();
        renderEmployeesList();
        renderDepartmentSelect();
    }

    function initAssigneesModal() {
        const assigneesManage = document.getElementById("fp-assignees-manage");
        const assigneesModal = document.getElementById("fp-assignees-modal");
        const assigneesClose = document.getElementById("fp-assignees-close");
        const departmentInput = document.getElementById("fp-department-name");
        const departmentAdd = document.getElementById("fp-department-add");
        const employeeNameInput = document.getElementById("fp-employee-name");
        const employeeAdd = document.getElementById("fp-employee-add");

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
                const assigneeGroups = getAssigneeGroups();
                if (!name || assigneeGroups[name]) return;
                assigneeGroups[name] = [];
                setAssigneeGroups(assigneeGroups);
                setAssigneeOptions(Object.values(assigneeGroups).flat());
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
                const assigneeGroups = getAssigneeGroups();
                if (!assigneeGroups[department]) assigneeGroups[department] = [];
                if (!assigneeGroups[department].includes(name)) {
                    assigneeGroups[department].push(name);
                    assigneeGroups[department].sort((a, b) => a.localeCompare(b));
                }
                setAssigneeGroups(assigneeGroups);
                setAssigneeOptions(Object.values(assigneeGroups).flat());
                saveAssigneeOptions(assigneeGroups);
                renderEmployeesList();
                populateEmployees();
                if (employeeNameInput) employeeNameInput.value = "";
            });
        }
    }

    return { initAssigneesModal, closeAssigneesModal };
}

module.exports = { createAssigneesModal };
