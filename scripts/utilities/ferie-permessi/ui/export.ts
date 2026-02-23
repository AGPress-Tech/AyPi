require("../../../shared/dev-guards");
import { UI_TEXTS } from "../utils/ui-texts";

type ExportControllerOptions = {
    document: Document;
    showModal?: (el: HTMLElement | null) => void;
    hideModal?: (el: HTMLElement | null) => void;
    setMessage?: (el: HTMLElement | null, message: string, isError?: boolean) => void;
    getAssigneeGroups?: () => Record<string, string[]>;
};

function createExportController(options: ExportControllerOptions) {
    const { document, showModal, hideModal, setMessage, getAssigneeGroups } =
        options || ({} as ExportControllerOptions);

    if (!document) {
        throw new Error("document richiesto.");
    }

    function renderExportDepartments() {
        const container = document.getElementById("fp-export-departments") as HTMLElement | null;
        if (!container) return;
        container.innerHTML = "";
        const groups = Object.keys(
            typeof getAssigneeGroups === "function" ? getAssigneeGroups() : {},
        );
        if (!groups.length) {
            const empty = document.createElement("div");
            empty.textContent = UI_TEXTS.emptyDepartment;
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
        const rangeMode =
            document.querySelector("input[name='fp-export-range']:checked")
                ?.value || "all";
        const startInput = document.getElementById("fp-export-start") as HTMLInputElement | null;
        const endInput = document.getElementById("fp-export-end") as HTMLInputElement | null;
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
        const modal = document.getElementById("fp-export-modal") as HTMLElement | null;
        const rangeAll = document.querySelector(
            "input[name='fp-export-range'][value='all']",
        );
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
        const modal = document.getElementById("fp-export-modal") as HTMLElement | null;
        if (!modal) return;
        if (typeof hideModal === "function") {
            hideModal(modal);
        }
        if (typeof setMessage === "function") {
            setMessage(document.getElementById("fp-export-message"), "");
        }
    }

    function setExportDepartmentsChecked(value: boolean) {
        const container = document.getElementById("fp-export-departments") as HTMLElement | null;
        if (!container) return;
        container
            .querySelectorAll("input[type='checkbox']")
            .forEach((input) => {
                (input as HTMLInputElement).checked = value;
            });
    }

    function getExportSelectedDepartments() {
        const container = document.getElementById("fp-export-departments") as HTMLElement | null;
        if (!container) return [];
        const checked = Array.from(
            container.querySelectorAll("input[type='checkbox']:checked"),
        );
        return checked.map((input) => (input as HTMLInputElement).value);
    }

    function parseDateInput(value: string) {
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

export { createExportController };

// Keep CommonJS compatibility for legacy JS callers
if (typeof module !== "undefined" && module.exports && !(globalThis as any).__aypiBundled) {
    if (typeof module !== "undefined" && module.exports && !(globalThis as any).__aypiBundled) module.exports = { createExportController };
}


