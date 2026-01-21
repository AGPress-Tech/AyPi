function createExportController(options) {
    const { document, showModal, hideModal, setMessage, getAssigneeGroups } = options || {};

    if (!document) {
        throw new Error("document richiesto.");
    }

    function renderExportDepartments() {
        const container = document.getElementById("fp-export-departments");
        if (!container) return;
        container.innerHTML = "";
        const groups = Object.keys(typeof getAssigneeGroups === "function" ? getAssigneeGroups() : {});
        if (!groups.length) {
            const empty = document.createElement("div");
            empty.textContent = "Nessun reparto.";
            container.appendChild(empty);
            return;
        }
        groups.forEach((group) => {
            const label = document.createElement("label");
            label.className = "fp-export-choice";
            const input = document.createElement("input");
            input.type = "checkbox";
            input.value = group;
            input.checked = true;
            label.appendChild(input);
            label.append(` ${group}`);
            container.appendChild(label);
        });
    }

    function updateExportDateState() {
        const rangeMode = document.querySelector("input[name='fp-export-range']:checked")?.value || "all";
        const startInput = document.getElementById("fp-export-start");
        const endInput = document.getElementById("fp-export-end");
        const isAll = rangeMode === "all";
        if (startInput) {
            startInput.disabled = isAll;
            startInput.readOnly = false;
        }
        if (endInput) {
            endInput.disabled = isAll;
            endInput.readOnly = false;
        }
    }

    function openExportModal() {
        const modal = document.getElementById("fp-export-modal");
        const rangeAll = document.querySelector("input[name='fp-export-range'][value='all']");
        if (!modal) return;
        if (typeof showModal === "function") {
            showModal(modal);
        }
        renderExportDepartments();
        if (typeof setMessage === "function") {
            setMessage(document.getElementById("fp-export-message"), "");
        }
        if (rangeAll) {
            rangeAll.checked = true;
        }
        updateExportDateState();
    }

    function closeExportModal() {
        const modal = document.getElementById("fp-export-modal");
        if (!modal) return;
        if (typeof hideModal === "function") {
            hideModal(modal);
        }
        if (typeof setMessage === "function") {
            setMessage(document.getElementById("fp-export-message"), "");
        }
    }

    function setExportDepartmentsChecked(value) {
        const container = document.getElementById("fp-export-departments");
        if (!container) return;
        container.querySelectorAll("input[type='checkbox']").forEach((input) => {
            input.checked = value;
        });
    }

    function getExportSelectedDepartments() {
        const container = document.getElementById("fp-export-departments");
        if (!container) return [];
        const checked = Array.from(container.querySelectorAll("input[type='checkbox']:checked"));
        return checked.map((input) => input.value);
    }

    function parseDateInput(value) {
        if (!value) return null;
        const [year, month, day] = value.split("-").map((v) => parseInt(v, 10));
        if (!year || !month || !day) return null;
        return new Date(year, month - 1, day);
    }

    return {
        openExportModal,
        closeExportModal,
        renderExportDepartments,
        setExportDepartmentsChecked,
        updateExportDateState,
        getExportSelectedDepartments,
        parseDateInput,
    };
}

module.exports = { createExportController };
