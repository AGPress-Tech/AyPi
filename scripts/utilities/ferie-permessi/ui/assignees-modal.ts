require("../../../shared/dev-guards");

type AssigneeGroups = Record<string, string[]>;
type AssigneeEmails = Record<string, string>;

type AssigneesModalOptions = {
    document: Document;
    showModal: (el: HTMLElement | null) => void;
    hideModal: (el: HTMLElement | null) => void;
    renderDepartmentList: () => void;
    renderEmployeesList: () => void;
    renderDepartmentSelect: () => void;
    populateEmployees: () => void;
    saveAssigneeOptions: (payload: { groups: AssigneeGroups; emails: AssigneeEmails }) => void;
    syncBalancesAfterAssignees: () => void;
    getAssigneeGroups: () => AssigneeGroups;
    setAssigneeGroups: (groups: AssigneeGroups) => void;
    setAssigneeOptions: (options: string[]) => void;
    getAssigneeEmails: () => AssigneeEmails;
    setAssigneeEmails: (emails: AssigneeEmails) => void;
    setEditingDepartment: (value: string | null) => void;
    setEditingEmployee: (value: string | null) => void;
    onOpenAttempt?: () => void;
};

function createAssigneesModal(options: AssigneesModalOptions) {
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
    } = options || ({} as AssigneesModalOptions);

    if (!document) {
        throw new Error("document richiesto.");
    }

    function closeAssigneesModal() {
        const assigneesModal = document.getElementById("fp-assignees-modal") as HTMLElement | null;
        const departmentInput = document.getElementById("fp-department-name") as HTMLInputElement | null;
        const employeeNameInput = document.getElementById("fp-employee-name") as HTMLInputElement | null;
        const employeeEmailInput = document.getElementById("fp-employee-email") as HTMLInputElement | null;
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
        const assigneesModal = document.getElementById("fp-assignees-modal") as HTMLElement | null;
        const departmentInput = document.getElementById("fp-department-name") as HTMLInputElement | null;
        if (!assigneesModal) return;
        showModal(assigneesModal);
        renderDepartmentList();
        renderEmployeesList();
        renderDepartmentSelect();
        if (departmentInput) departmentInput.focus();
    }

    function initAssigneesModal() {
        const assigneesManage = document.getElementById("fp-assignees-manage") as HTMLButtonElement | null;
        const assigneesModal = document.getElementById("fp-assignees-modal") as HTMLElement | null;
        const assigneesClose = document.getElementById("fp-assignees-close") as HTMLButtonElement | null;
        const departmentInput = document.getElementById("fp-department-name") as HTMLInputElement | null;
        const departmentAdd = document.getElementById("fp-department-add") as HTMLButtonElement | null;
        const employeeNameInput = document.getElementById("fp-employee-name") as HTMLInputElement | null;
        const employeeEmailInput = document.getElementById("fp-employee-email") as HTMLInputElement | null;
        const employeeAdd = document.getElementById("fp-employee-add") as HTMLButtonElement | null;

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
                const select = document.getElementById("fp-employee-department") as HTMLSelectElement | null;
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

export { createAssigneesModal };

// Keep CommonJS compatibility for legacy JS callers
if (typeof module !== "undefined" && module.exports && !(globalThis as any).__aypiBundled) {
    if (typeof module !== "undefined" && module.exports && !(globalThis as any).__aypiBundled) module.exports = { createAssigneesModal };
}


