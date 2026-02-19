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

function formatMultiLabel(values, placeholder, maxVisible = 2) {
    if (!values.length) return placeholder;
    if (values.length <= maxVisible) return values.join(", ");
    return `${values.slice(0, maxVisible).join(", ")} +${values.length - maxVisible} more`;
}

function buildFilterMultiselect({
    select,
    options,
    selected = [],
    placeholder,
    openMultiselectMenu,
    closeMultiselectMenu,
    onChange,
    showActions = true,
}) {
    if (!select) return;
    const doc = select.ownerDocument || document;
    const parent = select.parentElement;
    if (!parent) return;
    const existing = parent.querySelector(`.pm-multiselect--filter[data-for="${select.id}"]`);
    if (existing) existing.remove();

    select.dataset.pmMultiselect = "1";
    select.classList.add("pm-custom-select__native");

    const wrap = doc.createElement("div");
    wrap.className = "pm-multiselect pm-multiselect--filter";
    wrap.dataset.for = select.id || "";
    if (!wrap.dataset.pmHostId) {
        wrap.dataset.pmHostId = `pm-filter-${select.id || Math.random().toString(36).slice(2)}`;
    }
    const button = doc.createElement("button");
    button.type = "button";
    button.className = "pm-multiselect__button";
    const menu = doc.createElement("div");
    menu.className = "pm-multiselect__menu is-hidden";
    const selectedSet = new Set(selected.filter((value) => options.includes(value)));

    const updateLabel = () => {
        button.textContent = formatMultiLabel(Array.from(selectedSet.values()), placeholder);
    };

    const closeOtherMenus = () => {
        doc.querySelectorAll(".pm-multiselect__menu--floating").forEach((menuEl) => {
            if (menuEl === menu) return;
            const hostId = menuEl.dataset.pmHostId || "";
            const host = hostId ? doc.querySelector(`[data-pm-host-id="${hostId}"]`) : null;
            closeMultiselectMenu(menuEl, host || null);
        });
        doc.querySelectorAll(".pm-custom-select.is-open").forEach((custom) => {
            custom.classList.remove("is-open");
        });
    };

    if (showActions) {
        const actions = doc.createElement("div");
        actions.className = "pm-multiselect__actions";
        const allBtn = doc.createElement("button");
        allBtn.type = "button";
        allBtn.className = "pm-multiselect__action-btn";
        allBtn.textContent = "Tutti";
        const noneBtn = doc.createElement("button");
        noneBtn.type = "button";
        noneBtn.className = "pm-multiselect__action-btn";
        noneBtn.textContent = "Nessuno";
        allBtn.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            selectedSet.clear();
            options.forEach((value) => selectedSet.add(value));
            menu.querySelectorAll('input[type="checkbox"]').forEach((input) => {
                input.checked = true;
            });
            updateLabel();
            if (typeof onChange === "function") {
                onChange(Array.from(selectedSet.values()), selectedSet, button);
            }
        });
        noneBtn.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            selectedSet.clear();
            menu.querySelectorAll('input[type="checkbox"]').forEach((input) => {
                input.checked = false;
            });
            updateLabel();
            if (typeof onChange === "function") {
                onChange([], selectedSet, button);
            }
        });
        actions.append(allBtn, noneBtn);
        menu.appendChild(actions);
    }

    options.forEach((value) => {
        const option = doc.createElement("label");
        option.className = "pm-multiselect__option";
        const checkbox = doc.createElement("input");
        checkbox.type = "checkbox";
        checkbox.value = value;
        if (selectedSet.has(value)) checkbox.checked = true;
        const span = doc.createElement("span");
        span.textContent = value;
        checkbox.addEventListener("change", () => {
            if (checkbox.checked) {
                selectedSet.add(value);
            } else {
                selectedSet.delete(value);
            }
            updateLabel();
            if (typeof onChange === "function") {
                onChange(Array.from(selectedSet.values()), selectedSet, button);
            }
        });
        option.append(checkbox, span);
        menu.appendChild(option);
    });

    button.addEventListener("click", (event) => {
        event.stopPropagation();
        if (menu.classList.contains("is-hidden")) {
            closeOtherMenus();
            openMultiselectMenu(menu, button, wrap);
            return;
        } else {
            closeMultiselectMenu(menu, wrap);
            return;
        }
    });
    doc.addEventListener("click", (event) => {
        if (!wrap.contains(event.target) && !menu.contains(event.target)) {
            closeMultiselectMenu(menu, wrap);
        }
    });

    updateLabel();
    wrap.append(button, menu);
    select.insertAdjacentElement("afterend", wrap);
}

function renderCatalogFilterOptions({
    document,
    isInterventionMode,
    catalogCategories,
    catalogFilterTag,
    openMultiselectMenu,
    closeMultiselectMenu,
    onChange,
}) {
    if (isInterventionMode()) return;
    const select = document.getElementById("pm-catalog-filter");
    if (!select) return;
    const selected = Array.isArray(catalogFilterTag)
        ? catalogFilterTag
        : catalogFilterTag
        ? [catalogFilterTag]
        : [];
    buildFilterMultiselect({
        select,
        options: [...catalogCategories],
        selected,
        placeholder: "Tutte le categorie",
        openMultiselectMenu,
        closeMultiselectMenu,
        onChange,
        showActions: false,
    });
}

function renderInterventionTypeOptions({
    document,
    interventionTypes,
    openMultiselectMenu,
    closeMultiselectMenu,
    selected = [],
    onChange,
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
            if (typeof onChange === "function") {
                onChange(values, selectedSet, button);
            }
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
    openMultiselectMenu,
    closeMultiselectMenu,
    onChange,
}) {
    const select = document.getElementById("pm-cart-filter-tag");
    if (!select) return;
    const options = [];
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
                options.push(type);
            });
    } else {
        catalogCategories.forEach((cat) => options.push(cat));
    }
    const selected = Array.isArray(cartState.tag) ? cartState.tag : cartState.tag ? [cartState.tag] : [];
    buildFilterMultiselect({
        select,
        options,
        selected,
        placeholder: "Tutte",
        openMultiselectMenu,
        closeMultiselectMenu,
        onChange,
        showActions: false,
    });
}

function renderCartUrgencyFilterOptions({
    document,
    cartState,
    openMultiselectMenu,
    closeMultiselectMenu,
    onChange,
}) {
    const select = document.getElementById("pm-cart-filter-urgency");
    if (!select) return;
    const options = ["Alta", "Media", "Bassa"];
    const selected = Array.isArray(cartState.urgency)
        ? cartState.urgency
        : cartState.urgency
        ? [cartState.urgency]
        : [];
    buildFilterMultiselect({
        select,
        options,
        selected,
        placeholder: "Tutte le priorità",
        openMultiselectMenu,
        closeMultiselectMenu,
        onChange,
        showActions: false,
    });
}

module.exports = {
    renderCategoryOptions,
    renderCatalogFilterOptions,
    renderInterventionTypeOptions,
    renderCartTagFilterOptions,
    renderCartUrgencyFilterOptions,
};
