// @ts-nocheck
require("../../../shared/dev-guards");
function getInterventionType(ctx, line) {
    const { normalizeString } = ctx;
    if (!line) return "";
    return normalizeString(line.interventionType || line.type);
}

function getInterventionDescription(ctx, line) {
    const { normalizeString } = ctx;
    if (!line) return "";
    return normalizeString(line.description || line.details);
}

function openInterventionTypesModal(ctx) {
    const {
        document,
        isAdmin,
        showWarning,
        renderInterventionTypesList,
        renderCategoriesList,
    } = ctx;
    if (!isAdmin()) {
        showWarning("Solo gli admin possono gestire le tipologie.");
        return;
    }
    const modal = document.getElementById("pm-categories-modal");
    if (!modal) return;
    if (typeof renderCategoriesList === "function") {
        renderCategoriesList();
    }
    renderInterventionTypesList();
    modal.classList.remove("is-hidden");
    modal.setAttribute("aria-hidden", "false");
    const input = document.getElementById("pm-intervention-type-name");
    if (input) {
        setTimeout(() => input.focus(), 0);
    }
    const panel = document.getElementById("pm-intervention-types-panel");
    if (panel) {
        setTimeout(() => {
            panel.scrollIntoView({ block: "nearest" });
        }, 0);
    }
}

function closeInterventionTypesModal(ctx) {
    const { document } = ctx;
    const modal = document.getElementById("pm-categories-modal");
    if (!modal) return;
    modal.classList.add("is-hidden");
    modal.setAttribute("aria-hidden", "true");
}

function addInterventionType(ctx) {
    const {
        document,
        isAdmin,
        showWarning,
        getInterventionTypes,
        setInterventionTypes,
        saveInterventionTypes,
        renderInterventionTypesList,
        renderCartTagFilterOptions,
        renderLines,
    } = ctx;
    if (!isAdmin()) {
        showWarning("Solo gli admin possono gestire le tipologie.");
        return;
    }
    const input = document.getElementById("pm-intervention-type-name");
    const value = input?.value?.trim() || "";
    if (!value) return;
    const current = getInterventionTypes();
    if (current.includes(value)) {
        showWarning("Tipologia giÃ  esistente.");
        return;
    }
    const next = [...current, value];
    setInterventionTypes(next);
    if (saveInterventionTypes(next)) {
        if (input) input.value = "";
        renderInterventionTypesList();
        renderCartTagFilterOptions();
        renderLines();
    }
}

if (
    typeof module !== "undefined" &&
    module.exports &&
    !(globalThis as any).__aypiBundled
)
    module.exports = {
        getInterventionType,
        getInterventionDescription,
        openInterventionTypesModal,
        closeInterventionTypesModal,
        addInterventionType,
    };
