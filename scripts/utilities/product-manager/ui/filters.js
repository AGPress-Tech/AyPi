function renderCategoryOptions({ document, catalogCategories, selected = [] }) {
    const container = document.getElementById("pm-catalog-category");
    if (!container) return;
    container.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "pm-multiselect";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "pm-multiselect__button";
    button.textContent = "Seleziona tipologie";
    const menu = document.createElement("div");
    menu.className = "pm-multiselect__menu is-hidden";
    const selectedSet = new Set(selected);
    catalogCategories.forEach((cat) => {
        const option = document.createElement("label");
        option.className = "pm-multiselect__option";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.value = cat;
        if (selectedSet.has(cat)) checkbox.checked = true;
        const span = document.createElement("span");
        span.textContent = cat;
        checkbox.addEventListener("change", () => {
            if (checkbox.checked) {
                selectedSet.add(cat);
            } else {
                selectedSet.delete(cat);
            }
            const values = Array.from(selectedSet.values());
            button.textContent = values.length ? values.join(", ") : "Seleziona tipologie";
        });
        option.append(checkbox, span);
        menu.appendChild(option);
    });
    button.addEventListener("click", (event) => {
        event.stopPropagation();
        menu.classList.toggle("is-hidden");
    });
    document.addEventListener("click", (event) => {
        if (!wrap.contains(event.target)) {
            menu.classList.add("is-hidden");
        }
    });
    button.textContent = selectedSet.size ? Array.from(selectedSet.values()).join(", ") : "Seleziona tipologie";
    if (container.dataset && container.dataset.value && selectedSet.size === 0) {
        button.textContent = container.dataset.value;
    }
    wrap.append(button, menu);
    container.appendChild(wrap);
}

function renderCatalogFilterOptions({
    document,
    isInterventionMode,
    catalogCategories,
    catalogFilterTag,
}) {
    if (isInterventionMode()) return;
    const select = document.getElementById("pm-catalog-filter");
    if (!select) return;
    select.innerHTML = "";
    const all = document.createElement("option");
    all.value = "";
    all.textContent = "Tutte le categorie";
    select.appendChild(all);
    catalogCategories.forEach((cat) => {
        const opt = document.createElement("option");
        opt.value = cat;
        opt.textContent = cat;
        select.appendChild(opt);
    });
    select.value = catalogFilterTag || "";
}

function renderInterventionTypeOptions({
    document,
    interventionTypes,
    openMultiselectMenu,
    closeMultiselectMenu,
    selected = [],
}) {
    const wrap = document.createElement("div");
    wrap.className = "pm-multiselect";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "pm-multiselect__button";
    button.textContent = "Seleziona tipologie";
    const menu = document.createElement("div");
    menu.className = "pm-multiselect__menu is-hidden";
    const selectedSet = new Set(selected);
    if (!interventionTypes.length) {
        const empty = document.createElement("div");
        empty.className = "pm-message";
        empty.textContent = "Nessuna tipologia disponibile.";
        menu.appendChild(empty);
    }
    interventionTypes.forEach((type) => {
        const option = document.createElement("label");
        option.className = "pm-multiselect__option";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.value = type;
        if (selectedSet.has(type)) checkbox.checked = true;
        const span = document.createElement("span");
        span.textContent = type;
        checkbox.addEventListener("change", () => {
            if (checkbox.checked) {
                selectedSet.add(type);
            } else {
                selectedSet.delete(type);
            }
            const values = Array.from(selectedSet.values());
            button.textContent = values.length ? values.join(", ") : "Seleziona tipologie";
        });
        option.append(checkbox, span);
        menu.appendChild(option);
    });
    button.addEventListener("click", (event) => {
        event.stopPropagation();
        if (menu.classList.contains("is-hidden")) {
            openMultiselectMenu(menu, button, wrap);
        } else {
            closeMultiselectMenu(menu, wrap);
        }
    });
    document.addEventListener("click", (event) => {
        if (!wrap.contains(event.target) && !menu.contains(event.target)) {
            closeMultiselectMenu(menu, wrap);
        }
    });
    button.textContent = selectedSet.size ? Array.from(selectedSet.values()).join(", ") : "Seleziona tipologie";
    wrap.append(button, menu);
    return { wrap, selectedSet, button };
}

function renderCartTagFilterOptions({
    document,
    isInterventionMode,
    interventionTypes,
    catalogCategories,
    cartState,
    readRequestsFile,
    REQUEST_MODES,
    toTags,
    getInterventionType,
}) {
    const select = document.getElementById("pm-cart-filter-tag");
    if (!select) return;
    select.innerHTML = "";
    const all = document.createElement("option");
    all.value = "";
    all.textContent = "Tutte";
    select.appendChild(all);
    if (isInterventionMode()) {
        const types = new Set(interventionTypes);
        if (!types.size) {
            const requests = readRequestsFile(REQUEST_MODES.INTERVENTION);
            requests.forEach((req) => {
                (req.lines || []).forEach((line) => {
                    toTags(getInterventionType(line)).forEach((type) => {
                        if (type) types.add(type);
                    });
                });
            });
        }
        Array.from(types.values())
            .sort((a, b) => a.localeCompare(b))
            .forEach((type) => {
                const opt = document.createElement("option");
                opt.value = type;
                opt.textContent = type;
                select.appendChild(opt);
            });
    } else {
        catalogCategories.forEach((cat) => {
            const opt = document.createElement("option");
            opt.value = cat;
            opt.textContent = cat;
            select.appendChild(opt);
        });
    }
    select.value = cartState.tag || "";
}

module.exports = {
    renderCategoryOptions,
    renderCatalogFilterOptions,
    renderInterventionTypeOptions,
    renderCartTagFilterOptions,
};
