// @ts-nocheck
require("../../../shared/dev-guards");
function renderCategoriesList(ctx) {
    const {
        document,
        uiState,
        catalogCategories,
        getCategoryColors,
        getCategoryColor,
        getContrastText,
        openCategoryEditor,
        closeCategoriesModal,
        openConfirmModal,
        showWarning,
        saveCategories,
        saveCatalog,
        saveRequestsFile,
        readRequestsFile,
        toTags,
        renderCategoryOptions,
        renderCatalogFilterOptions,
        renderCartTagFilterOptions,
        renderCatalog,
        renderCartTable,
        setCatalogCategories,
        setCategoryColors,
        saveCategoryColors,
        getCatalogItems,
        setCatalogItems,
    } = ctx;

    const list = document.getElementById("pm-categories-list");
    if (!list) return;
    list.innerHTML = "";
    const items = catalogCategories();
    items.forEach((cat, index) => {
        const row = document.createElement("div");
        row.className = "fp-assignees-row pm-category-row";
        row.dataset.category = cat;
        row.dataset.index = String(index);
        const isEditing = uiState?.categoriesEditingName === cat;
        if (!isEditing) {
            row.setAttribute("draggable", "true");
            row.addEventListener("dragstart", (event) => {
                row.classList.add("is-dragging");
                const dataTransfer = event.dataTransfer;
                if (!dataTransfer) return;
                dataTransfer.effectAllowed = "move";
                dataTransfer.setData("text/plain", row.dataset.index || "");
            });
            row.addEventListener("dragend", () => {
                row.classList.remove("is-dragging");
            });
            row.addEventListener("dragover", (event) => {
                event.preventDefault();
                row.classList.add("is-drop-target");
            });
            row.addEventListener("dragleave", () => {
                row.classList.remove("is-drop-target");
            });
            row.addEventListener("drop", (event) => {
                event.preventDefault();
                row.classList.remove("is-drop-target");
                const dataTransfer = event.dataTransfer;
                if (!dataTransfer) return;
                const fromIndex = Number(dataTransfer.getData("text/plain"));
                const toIndex = Number(row.dataset.index || "0");
                if (Number.isNaN(fromIndex) || Number.isNaN(toIndex) || fromIndex === toIndex) {
                    return;
                }
                const current = catalogCategories();
                const next = [...current];
                const [moved] = next.splice(fromIndex, 1);
                next.splice(toIndex, 0, moved);
                setCatalogCategories(next);
                if (saveCategories(next)) {
                    renderCategoriesList(ctx);
                    renderCategoryOptions();
                    renderCatalogFilterOptions();
                    renderCartTagFilterOptions();
                    renderCatalog();
                    renderCartTable();
                }
            });
        }
        const labelWrap = document.createElement("div");
        labelWrap.style.display = "flex";
        labelWrap.style.alignItems = "center";
        labelWrap.style.gap = "8px";
        const dragHandle = document.createElement("span");
        dragHandle.className = "pm-drag-handle material-icons";
        dragHandle.title = "Trascina per riordinare";
        dragHandle.textContent = "drag_indicator";
        const chipBtn = document.createElement("button");
        chipBtn.type = "button";
        chipBtn.className = "pm-category-chip";
        chipBtn.title = "Modifica colore";
        chipBtn.dataset.category = cat;
        const dot = document.createElement("span");
        dot.className = "pm-category-chip__dot";
        const chipColor = getCategoryColor(cat);
        chipBtn.style.background = chipColor;
        dot.style.background = getContrastText(chipColor);
        chipBtn.appendChild(dot);
        chipBtn.addEventListener("click", (event) => {
            event.stopPropagation();
            openCategoryEditor(cat, chipBtn);
        });
        if (isEditing) {
            const input = document.createElement("input");
            input.className = "fp-field__input pm-inline-input";
            input.value = cat;
            input.addEventListener("keydown", (event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                saveEdit();
            });
            labelWrap.append(dragHandle, chipBtn, input);
        } else {
            const label = document.createElement("span");
            label.textContent = cat;
            labelWrap.append(dragHandle, chipBtn, label);
        }
        const actions = document.createElement("div");
        actions.className = "fp-assignees-row__actions";

        const applyRename = (nextName) => {
            const nextCategories = items.map((entry) => (entry === cat ? nextName : entry));
            setCatalogCategories(nextCategories);
            const colors = getCategoryColors();
            if (colors[cat]) {
                const nextColors = { ...colors, [nextName]: colors[cat] };
                delete nextColors[cat];
                setCategoryColors(nextColors);
                saveCategoryColors(nextColors);
            }
            const catalogItems = getCatalogItems();
            const nextCatalog = catalogItems.map((item) => {
                const tags = toTags(item.category || "").map((t) => (t === cat ? nextName : t));
                return { ...item, category: tags.join(", ") };
            });
            setCatalogItems(nextCatalog);
            const requests = readRequestsFile();
            requests.forEach((req) => {
                (req.lines || []).forEach((line) => {
                    const tags = toTags(line.category || "").map((t) => (t === cat ? nextName : t));
                    line.category = tags.join(", ");
                });
            });
            if (saveCategories(nextCategories) && saveCatalog(nextCatalog) && saveRequestsFile(requests)) {
                if (uiState) uiState.categoriesEditingName = null;
                renderCategoriesList(ctx);
                renderCategoryOptions();
                renderCatalogFilterOptions();
                renderCartTagFilterOptions();
                renderCatalog();
                renderCartTable();
            }
        };

        const saveEdit = () => {
            const inputEl = labelWrap.querySelector("input");
            const nextName = inputEl?.value?.trim() || "";
            if (!nextName || nextName === cat) {
                if (uiState) uiState.categoriesEditingName = null;
                renderCategoriesList(ctx);
                return;
            }
            if (items.includes(nextName)) {
                showWarning("Categoria giÃ  esistente.");
                return;
            }
            applyRename(nextName);
        };

        if (isEditing) {
            const save = document.createElement("button");
            save.type = "button";
            save.className = "fp-assignees-link";
            save.textContent = "Salva";
            save.addEventListener("click", saveEdit);

            const cancel = document.createElement("button");
            cancel.type = "button";
            cancel.className = "fp-assignees-link fp-assignees-link--danger";
            cancel.textContent = "Annulla";
            cancel.addEventListener("click", () => {
                if (uiState) uiState.categoriesEditingName = null;
                renderCategoriesList(ctx);
            });
            actions.append(save, cancel);
        } else {
            const editBtn = document.createElement("button");
            editBtn.type = "button";
            editBtn.className = "fp-assignees-link";
            editBtn.textContent = "Modifica";
            editBtn.addEventListener("click", () => {
                if (uiState) uiState.categoriesEditingName = cat;
                renderCategoriesList(ctx);
            });

            const removeBtn = document.createElement("button");
            removeBtn.type = "button";
            removeBtn.className = "fp-assignees-link fp-assignees-link--danger";
            removeBtn.textContent = "Rimuovi";
            removeBtn.addEventListener("click", async () => {
                closeCategoriesModal();
                const ok = await openConfirmModal(`Vuoi eliminare la categoria \"${cat}\"?`);
                if (!ok) return;
                const nextCategories = items.filter((entry) => entry !== cat);
                setCatalogCategories(nextCategories);
                const colors = getCategoryColors();
                if (colors[cat]) {
                    const nextColors = { ...colors };
                    delete nextColors[cat];
                    setCategoryColors(nextColors);
                    saveCategoryColors(nextColors);
                }
                const catalogItems = getCatalogItems();
                const nextCatalog = catalogItems.map((item) => {
                    const tags = toTags(item.category || "").filter((t) => t !== cat);
                    return { ...item, category: tags.join(", ") };
                });
                setCatalogItems(nextCatalog);
                const requests = readRequestsFile();
                requests.forEach((req) => {
                    (req.lines || []).forEach((line) => {
                        const tags = toTags(line.category || "").filter((t) => t !== cat);
                        line.category = tags.join(", ");
                    });
                });
                if (saveCategories(nextCategories) && saveCatalog(nextCatalog) && saveRequestsFile(requests)) {
                    renderCategoriesList(ctx);
                    renderCategoryOptions();
                    renderCatalogFilterOptions();
                    renderCartTagFilterOptions();
                    renderCatalog();
                    renderCartTable();
                }
            });
            actions.append(editBtn, removeBtn);
        }
        row.append(labelWrap, actions);
        list.appendChild(row);
    });
    if (!items.length) {
        list.innerHTML = "<div class=\"pm-message\">Nessuna categoria disponibile.</div>";
    }
}

function renderInterventionTypesList(ctx) {
    const {
        document,
        uiState,
        interventionTypes,
        showWarning,
        closeInterventionTypesModal,
        openConfirmModal,
        readRequestsFile,
        saveRequestsFile,
        saveInterventionTypes,
        renderCartTagFilterOptions,
        renderLines,
        renderCartTable,
        getInterventionType,
        REQUEST_MODES,
        toTags,
        setInterventionTypes,
    } = ctx;
    const list = document.getElementById("pm-intervention-types-list");
    if (!list) return;
    list.innerHTML = "";
    const types = interventionTypes();
    types.forEach((type, index) => {
        const row = document.createElement("div");
        row.className = "fp-assignees-row pm-type-row";
        row.dataset.type = type;
        row.dataset.index = String(index);
        const isEditing = uiState?.interventionTypesEditingName === type;
        if (!isEditing) {
            row.setAttribute("draggable", "true");
            row.addEventListener("dragstart", (event) => {
                row.classList.add("is-dragging");
                const dataTransfer = event.dataTransfer;
                if (!dataTransfer) return;
                dataTransfer.effectAllowed = "move";
                dataTransfer.setData("text/plain", row.dataset.index || "");
            });
            row.addEventListener("dragend", () => {
                row.classList.remove("is-dragging");
            });
            row.addEventListener("dragover", (event) => {
                event.preventDefault();
                row.classList.add("is-drop-target");
            });
            row.addEventListener("dragleave", () => {
                row.classList.remove("is-drop-target");
            });
            row.addEventListener("drop", (event) => {
                event.preventDefault();
                row.classList.remove("is-drop-target");
                const dataTransfer = event.dataTransfer;
                if (!dataTransfer) return;
                const fromIndex = Number(dataTransfer.getData("text/plain"));
                const toIndex = Number(row.dataset.index || "0");
                if (Number.isNaN(fromIndex) || Number.isNaN(toIndex) || fromIndex === toIndex) {
                    return;
                }
                const current = interventionTypes();
                const next = [...current];
                const [moved] = next.splice(fromIndex, 1);
                next.splice(toIndex, 0, moved);
                setInterventionTypes(next);
                if (saveInterventionTypes(next)) {
                    renderInterventionTypesList(ctx);
                    renderCartTagFilterOptions();
                    renderLines();
                    renderCartTable();
                }
            });
        }
        const labelWrap = document.createElement("div");
        labelWrap.style.display = "flex";
        labelWrap.style.alignItems = "center";
        labelWrap.style.gap = "8px";
        const dragHandle = document.createElement("span");
        dragHandle.className = "pm-drag-handle material-icons";
        dragHandle.title = "Trascina per riordinare";
        dragHandle.textContent = "drag_indicator";
        if (isEditing) {
            const input = document.createElement("input");
            input.className = "fp-field__input pm-inline-input";
            input.value = type;
            input.addEventListener("keydown", (event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                saveEdit();
            });
            labelWrap.append(dragHandle, input);
        } else {
            const label = document.createElement("span");
            label.textContent = type;
            labelWrap.append(dragHandle, label);
        }
        const actions = document.createElement("div");
        actions.className = "fp-assignees-row__actions";

        const applyRename = (nextName) => {
            const nextTypes = types.map((entry) => (entry === type ? nextName : entry));
            setInterventionTypes(nextTypes);
            const requests = readRequestsFile(REQUEST_MODES.INTERVENTION);
            requests.forEach((req) => {
                (req.lines || []).forEach((line) => {
                    const tags = toTags(getInterventionType(line)).map((t) => (t === type ? nextName : t));
                    line.interventionType = tags.join(", ");
                });
            });
            if (saveInterventionTypes(nextTypes) && saveRequestsFile(requests, REQUEST_MODES.INTERVENTION)) {
                if (uiState) uiState.interventionTypesEditingName = null;
                renderInterventionTypesList(ctx);
                renderCartTagFilterOptions();
                renderLines();
                renderCartTable();
            }
        };

        const saveEdit = () => {
            const inputEl = labelWrap.querySelector("input");
            const nextName = inputEl?.value?.trim() || "";
            if (!nextName || nextName === type) {
                if (uiState) uiState.interventionTypesEditingName = null;
                renderInterventionTypesList(ctx);
                return;
            }
            if (types.includes(nextName)) {
                showWarning("Tipologia giÃ  esistente.");
                return;
            }
            applyRename(nextName);
        };

        if (isEditing) {
            const save = document.createElement("button");
            save.type = "button";
            save.className = "fp-assignees-link";
            save.textContent = "Salva";
            save.addEventListener("click", saveEdit);

            const cancel = document.createElement("button");
            cancel.type = "button";
            cancel.className = "fp-assignees-link fp-assignees-link--danger";
            cancel.textContent = "Annulla";
            cancel.addEventListener("click", () => {
                if (uiState) uiState.interventionTypesEditingName = null;
                renderInterventionTypesList(ctx);
            });
            actions.append(save, cancel);
        } else {
            const editBtn = document.createElement("button");
            editBtn.type = "button";
            editBtn.className = "fp-assignees-link";
            editBtn.textContent = "Modifica";
            editBtn.addEventListener("click", () => {
                if (uiState) uiState.interventionTypesEditingName = type;
                renderInterventionTypesList(ctx);
            });
            const removeBtn = document.createElement("button");
            removeBtn.type = "button";
            removeBtn.className = "fp-assignees-link fp-assignees-link--danger";
            removeBtn.textContent = "Rimuovi";
            removeBtn.addEventListener("click", async () => {
                closeInterventionTypesModal();
                const ok = await openConfirmModal(`Vuoi eliminare la tipologia \"${type}\"?`);
                if (!ok) return;
                const nextTypes = types.filter((entry) => entry !== type);
                setInterventionTypes(nextTypes);
                const requests = readRequestsFile(REQUEST_MODES.INTERVENTION);
                requests.forEach((req) => {
                    (req.lines || []).forEach((line) => {
                        const tags = toTags(getInterventionType(line)).filter((t) => t !== type);
                        line.interventionType = tags.join(", ");
                    });
                });
                if (saveInterventionTypes(nextTypes) && saveRequestsFile(requests, REQUEST_MODES.INTERVENTION)) {
                    renderInterventionTypesList(ctx);
                    renderCartTagFilterOptions();
                    renderLines();
                    renderCartTable();
                }
            });
            actions.append(editBtn, removeBtn);
        }
        row.append(labelWrap, actions);
        list.appendChild(row);
    });
    if (!types.length) {
        list.innerHTML = "<div class=\"pm-message\">Nessuna tipologia disponibile.</div>";
    }
}

if (typeof module !== "undefined" && module.exports && !(globalThis as any).__aypiBundled) module.exports = {
    renderCategoriesList,
    renderInterventionTypesList,
};

