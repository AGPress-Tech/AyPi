// @ts-nocheck
require("../../../shared/dev-guards");
function renderCategoriesList(ctx) {
    const {
        document,
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
    items.forEach((cat) => {
        const row = document.createElement("div");
        row.className = "pm-list-item";
        row.dataset.category = cat;
        const labelWrap = document.createElement("div");
        labelWrap.style.display = "flex";
        labelWrap.style.alignItems = "center";
        labelWrap.style.gap = "8px";
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
        chipBtn.addEventListener("click", () => openCategoryEditor(cat));
        const label = document.createElement("span");
        label.textContent = cat;
        labelWrap.append(chipBtn, label);
        const actions = document.createElement("div");
        actions.className = "pm-table__cell pm-table__actions";
        const editBtn = document.createElement("button");
        editBtn.type = "button";
        editBtn.className = "pm-tag-icon-btn";
        editBtn.title = "Modifica";
        const editIcon = document.createElement("span");
        editIcon.className = "material-icons";
        editIcon.textContent = "edit";
        editBtn.appendChild(editIcon);
        editBtn.addEventListener("click", async () => {
            const input = document.getElementById("pm-category-name");
            const nextName = input?.value?.trim() || "";
            if (!nextName || nextName === cat) return;
            if (items.includes(nextName)) {
                showWarning("Categoria giÃ  esistente.");
                return;
            }
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
                if (input) input.value = "";
                renderCategoriesList(ctx);
                renderCategoryOptions();
                renderCatalogFilterOptions();
                renderCartTagFilterOptions();
                renderCatalog();
                renderCartTable();
            }
        });
        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "pm-tag-icon-btn";
        removeBtn.title = "Rimuovi";
        const trashIcon = document.createElement("span");
        trashIcon.className = "material-icons";
        trashIcon.textContent = "delete";
        removeBtn.appendChild(trashIcon);
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
    types.forEach((type) => {
        const row = document.createElement("div");
        row.className = "pm-list-item";
        row.dataset.type = type;
        const label = document.createElement("span");
        label.textContent = type;
        const actions = document.createElement("div");
        actions.className = "pm-table__cell pm-table__actions";
        const editBtn = document.createElement("button");
        editBtn.type = "button";
        editBtn.className = "pm-tag-icon-btn";
        editBtn.title = "Modifica";
        const editIcon = document.createElement("span");
        editIcon.className = "material-icons";
        editIcon.textContent = "edit";
        editBtn.appendChild(editIcon);
        editBtn.addEventListener("click", async () => {
            const input = document.getElementById("pm-intervention-type-name");
            const nextName = input?.value?.trim() || "";
            if (!nextName || nextName === type) return;
            if (types.includes(nextName)) {
                showWarning("Tipologia giÃ  esistente.");
                return;
            }
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
                if (input) input.value = "";
                renderInterventionTypesList(ctx);
                renderCartTagFilterOptions();
                renderLines();
                renderCartTable();
            }
        });
        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "pm-tag-icon-btn";
        removeBtn.title = "Rimuovi";
        const trashIcon = document.createElement("span");
        trashIcon.className = "material-icons";
        trashIcon.textContent = "delete";
        removeBtn.appendChild(trashIcon);
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
        row.append(label, actions);
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

