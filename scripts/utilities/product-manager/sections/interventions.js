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

function loadInterventionTypes(ctx) {
    const {
        fs,
        INTERVENTION_TYPES_PATH,
        normalizeInterventionTypesData,
        validateWithAjv,
        validateInterventionTypesSchema,
        tryAutoCleanJson,
        showWarning,
        showError,
    } = ctx;
    try {
        if (!fs.existsSync(INTERVENTION_TYPES_PATH)) return [];
        const raw = fs.readFileSync(INTERVENTION_TYPES_PATH, "utf8");
        const parsed = JSON.parse(raw);
        const normalized = normalizeInterventionTypesData(parsed);
        validateWithAjv(validateInterventionTypesSchema, normalized, "tipologie interventi", {
            showWarning,
            showError,
        });
        tryAutoCleanJson(
            INTERVENTION_TYPES_PATH,
            parsed,
            normalized,
            validateInterventionTypesSchema,
            "tipologie interventi",
            { showWarning, showError }
        );
        return normalized;
    } catch (err) {
        console.error("Errore lettura tipologie interventi:", err);
        return [];
    }
}

function saveInterventionTypes(ctx, list) {
    const {
        fs,
        INTERVENTION_TYPES_PATH,
        normalizeInterventionTypesData,
        validateWithAjv,
        validateInterventionTypesSchema,
        showWarning,
        showError,
    } = ctx;
    try {
        const normalized = normalizeInterventionTypesData(list);
        if (
            !validateWithAjv(validateInterventionTypesSchema, normalized, "tipologie interventi", {
                showWarning,
                showError,
            }).ok
        )
            return false;
        fs.writeFileSync(INTERVENTION_TYPES_PATH, JSON.stringify(normalized, null, 2), "utf8");
        return true;
    } catch (err) {
        showError("Errore salvataggio tipologie interventi.", err.message || String(err));
        return false;
    }
}

function openInterventionTypesModal(ctx) {
    const { document, isAdmin, showWarning, renderInterventionTypesList } = ctx;
    if (!isAdmin()) {
        showWarning("Solo gli admin possono gestire le tipologie.");
        return;
    }
    const modal = document.getElementById("pm-intervention-types-modal");
    if (!modal) return;
    renderInterventionTypesList();
    modal.classList.remove("is-hidden");
    modal.setAttribute("aria-hidden", "false");
}

function closeInterventionTypesModal(ctx) {
    const { document } = ctx;
    const modal = document.getElementById("pm-intervention-types-modal");
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
        showWarning("Tipologia già esistente.");
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

module.exports = {
    getInterventionType,
    getInterventionDescription,
    loadInterventionTypes,
    saveInterventionTypes,
    openInterventionTypesModal,
    closeInterventionTypesModal,
    addInterventionType,
};
