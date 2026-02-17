function normalizeHexColor(ctx, value, fallback) {
    const { DEFAULT_CATEGORY_COLORS } = ctx;
    if (!value || typeof value !== "string") return fallback || DEFAULT_CATEGORY_COLORS[0];
    let next = value.trim().toLowerCase();
    if (!next.startsWith("#")) next = `#${next}`;
    if (/^#([0-9a-f]{3}){1,2}$/i.test(next)) {
        if (next.length === 4) {
            next = `#${next[1]}${next[1]}${next[2]}${next[2]}${next[3]}${next[3]}`;
        }
        return next;
    }
    return fallback || DEFAULT_CATEGORY_COLORS[0];
}

function loadCategoryColors(ctx) {
    const { window, CATEGORY_COLOR_STORAGE_KEY } = ctx;
    try {
        if (!window.localStorage) return {};
        const raw = window.localStorage.getItem(CATEGORY_COLOR_STORAGE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object") return {};
        const cleaned = {};
        Object.keys(parsed).forEach((key) => {
            cleaned[key] = normalizeHexColor(ctx, parsed[key]);
        });
        return cleaned;
    } catch (err) {
        console.error("Errore lettura colori categorie:", err);
        return {};
    }
}

function saveCategoryColors(ctx, next) {
    const { window, CATEGORY_COLOR_STORAGE_KEY } = ctx;
    try {
        if (!window.localStorage) return;
        window.localStorage.setItem(CATEGORY_COLOR_STORAGE_KEY, JSON.stringify(next));
    } catch (err) {
        console.error("Errore salvataggio colori categorie:", err);
    }
}

function hashCategoryToColor(ctx, value) {
    const { DEFAULT_CATEGORY_COLORS } = ctx;
    if (!value) return DEFAULT_CATEGORY_COLORS[0];
    let hash = 0;
    for (let i = 0; i < value.length; i += 1) {
        hash = (hash * 31 + value.charCodeAt(i)) % DEFAULT_CATEGORY_COLORS.length;
    }
    return DEFAULT_CATEGORY_COLORS[Math.abs(hash) % DEFAULT_CATEGORY_COLORS.length];
}

function getCategoryColor(ctx, value) {
    const { getCategoryColors, DEFAULT_CATEGORY_COLORS } = ctx;
    if (!value) return DEFAULT_CATEGORY_COLORS[0];
    const stored = getCategoryColors()[value];
    return stored || hashCategoryToColor(ctx, value);
}

function getContrastText(ctx, hex) {
    const clean = normalizeHexColor(ctx, hex, "#ffffff").replace("#", "");
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    const yiq = (r * 299 + g * 587 + b * 114) / 1000;
    return yiq >= 160 ? "#2b2b2b" : "#ffffff";
}

function applyCategoryColor(ctx, pill, tag) {
    const color = getCategoryColor(ctx, tag);
    pill.style.background = color;
    pill.style.color = getContrastText(ctx, color);
}

function updateCategoryChipPreview(ctx, name, color) {
    const { document } = ctx;
    const list = document.getElementById("pm-categories-list");
    if (!list) return;
    const chips = Array.from(list.querySelectorAll(".pm-category-chip"));
    const chip = chips.find((item) => item.dataset.category === name);
    if (!chip) return;
    chip.style.background = color;
    const dot = chip.querySelector(".pm-category-chip__dot");
    if (dot) dot.style.background = getContrastText(ctx, color);
}

function openCategoryEditor(ctx, category) {
    const { document, uiState, getCategoryColors } = ctx;
    const editor = document.getElementById("pm-category-editor");
    const title = document.getElementById("pm-category-editor-title");
    const colorInput = document.getElementById("pm-category-color-input");
    if (!editor || !colorInput) return;
    uiState.categoryEditingName = category;
    uiState.categoryColorSnapshot = { ...getCategoryColors() };
    colorInput.value = getCategoryColor(ctx, category);
    if (title) title.textContent = `Colore ${category}`;
    editor.classList.remove("is-hidden");
}

function closeCategoryEditor(ctx, revert) {
    const { document, uiState, setCategoryColors, getCategoryColors, saveCategoryColors, renderCatalog, renderCartTable, renderCategoriesList } = ctx;
    const editor = document.getElementById("pm-category-editor");
    if (!editor) return;
    editor.classList.add("is-hidden");
    if (revert && uiState.categoryColorSnapshot) {
        setCategoryColors({ ...uiState.categoryColorSnapshot });
        saveCategoryColors(getCategoryColors());
        renderCatalog();
        renderCartTable();
        renderCategoriesList();
    }
    uiState.categoryEditingName = null;
    uiState.categoryColorSnapshot = null;
}

function loadCatalog(ctx) {
    const {
        fs,
        CATALOG_PATH,
        LEGACY_CATALOG_PATH,
        normalizeCatalogData,
        validateWithAjv,
        validateCatalogSchema,
        tryAutoCleanJson,
        showWarning,
        showError,
    } = ctx;
    try {
        const candidates = [CATALOG_PATH, LEGACY_CATALOG_PATH].filter((item) => item && fs.existsSync(item));
        if (!candidates.length) return [];
        let sourcePath = candidates[0];
        if (candidates.length > 1) {
            const a = Number(fs.statSync(candidates[0]).mtimeMs) || 0;
            const b = Number(fs.statSync(candidates[1]).mtimeMs) || 0;
            sourcePath = b > a ? candidates[1] : candidates[0];
        }
        const raw = fs.readFileSync(sourcePath, "utf8");
        const parsed = JSON.parse(raw);
        const normalized = normalizeCatalogData(parsed);
        validateWithAjv(validateCatalogSchema, normalized, "catalogo", { showWarning, showError });
        tryAutoCleanJson(sourcePath, parsed, normalized, validateCatalogSchema, "catalogo", {
            showWarning,
            showError,
        });
        return normalized;
    } catch (err) {
        console.error("Errore lettura catalogo:", err);
        return [];
    }
}

function saveCatalog(ctx, list) {
    const {
        fs,
        CATALOG_PATH,
        LEGACY_CATALOG_PATH,
        normalizeCatalogData,
        validateWithAjv,
        validateCatalogSchema,
        showWarning,
        showError,
    } = ctx;
    try {
        const normalized = normalizeCatalogData(list);
        if (
            !validateWithAjv(validateCatalogSchema, normalized, "catalogo", {
                showWarning,
                showError,
            }).ok
        )
            return false;
        fs.writeFileSync(CATALOG_PATH, JSON.stringify(normalized, null, 2), "utf8");
        if (LEGACY_CATALOG_PATH && fs.existsSync(LEGACY_CATALOG_PATH)) {
            fs.writeFileSync(LEGACY_CATALOG_PATH, JSON.stringify(normalized, null, 2), "utf8");
        }
        return true;
    } catch (err) {
        showError("Errore salvataggio catalogo.", err.message || String(err));
        return false;
    }
}

function loadCategories(ctx) {
    const {
        fs,
        CATEGORIES_PATH,
        LEGACY_CATEGORIES_PATH,
        normalizeCategoriesData,
        validateWithAjv,
        validateCategoriesSchema,
        tryAutoCleanJson,
        showWarning,
        showError,
    } = ctx;
    try {
        const candidates = [CATEGORIES_PATH, LEGACY_CATEGORIES_PATH].filter((item) => item && fs.existsSync(item));
        if (!candidates.length) return [];
        let sourcePath = candidates[0];
        if (candidates.length > 1) {
            const a = Number(fs.statSync(candidates[0]).mtimeMs) || 0;
            const b = Number(fs.statSync(candidates[1]).mtimeMs) || 0;
            sourcePath = b > a ? candidates[1] : candidates[0];
        }
        const raw = fs.readFileSync(sourcePath, "utf8");
        const parsed = JSON.parse(raw);
        const normalized = normalizeCategoriesData(parsed);
        validateWithAjv(validateCategoriesSchema, normalized, "categorie", { showWarning, showError });
        tryAutoCleanJson(sourcePath, parsed, normalized, validateCategoriesSchema, "categorie", {
            showWarning,
            showError,
        });
        return normalized;
    } catch (err) {
        console.error("Errore lettura categorie:", err);
        return [];
    }
}

function saveCategories(ctx, list) {
    const {
        fs,
        CATEGORIES_PATH,
        LEGACY_CATEGORIES_PATH,
        normalizeCategoriesData,
        validateWithAjv,
        validateCategoriesSchema,
        showWarning,
        showError,
    } = ctx;
    try {
        const normalized = normalizeCategoriesData(list);
        if (
            !validateWithAjv(validateCategoriesSchema, normalized, "categorie", {
                showWarning,
                showError,
            }).ok
        )
            return false;
        fs.writeFileSync(CATEGORIES_PATH, JSON.stringify(normalized, null, 2), "utf8");
        if (LEGACY_CATEGORIES_PATH && fs.existsSync(LEGACY_CATEGORIES_PATH)) {
            fs.writeFileSync(LEGACY_CATEGORIES_PATH, JSON.stringify(normalized, null, 2), "utf8");
        }
        return true;
    } catch (err) {
        showError("Errore salvataggio categorie.", err.message || String(err));
        return false;
    }
}

function renderCatalog(ctx) {
    const {
        renderCatalogUi,
        document,
        shell,
        isAdmin,
        getCatalogItems,
        getCatalogFilterTag,
        getCatalogSearch,
        getCatalogSort,
        toTags,
        getCatalogImageSrc,
        PLACEHOLDER_IMAGE,
        openImageModal,
        applyCategoryColor,
        addLineFromCatalog,
        requireLogin,
        showWarning,
        openConfirmModal,
        saveCatalog,
        setCatalogItems,
        openCatalogModal,
    } = ctx;
    renderCatalogUi({
        document,
        shell,
        isAdmin,
        catalogItems: getCatalogItems(),
        catalogFilterTag: getCatalogFilterTag(),
        catalogSearch: getCatalogSearch(),
        catalogSort: getCatalogSort(),
        toTags,
        getCatalogImageSrc,
        PLACEHOLDER_IMAGE,
        openImageModal,
        applyCategoryColor,
        addLineFromCatalog,
        requireLogin,
        showWarning,
        openConfirmModal,
        saveCatalog,
        setCatalogItems,
        rerenderCatalog: () => renderCatalog(ctx),
        openCatalogModal,
    });
}

function openCatalogModal(ctx, item = null) {
    const { document, isAdmin, showWarning, uiState, toTags, renderCategoryOptions } = ctx;
    if (!isAdmin()) {
        showWarning("Solo gli admin possono aggiungere prodotti.");
        return;
    }
    const modal = document.getElementById("pm-catalog-modal");
    if (!modal) return;
    const title = document.getElementById("pm-catalog-title");
    const saveBtn = document.getElementById("pm-catalog-save");
    const idInput = document.getElementById("pm-catalog-id");
    const name = document.getElementById("pm-catalog-name");
    const desc = document.getElementById("pm-catalog-description");
    const category = document.getElementById("pm-catalog-category");
    const unit = document.getElementById("pm-catalog-unit");
    const url = document.getElementById("pm-catalog-url");
    const imageUrl = document.getElementById("pm-catalog-image-url");
    const image = document.getElementById("pm-catalog-image");
    const removeBtn = document.getElementById("pm-catalog-remove-image");
    const selectedTags = item ? toTags(item.category || "") : [];
    renderCategoryOptions(selectedTags);
    if (item) {
        if (title) title.textContent = "Modifica prodotto catalogo";
        if (saveBtn) saveBtn.textContent = "Salva modifiche";
        if (idInput) idInput.value = item.id || "";
        if (name) name.value = item.name || "";
        if (desc) desc.value = item.description || "";
        if (category) category.dataset.value = item.category || "";
        if (unit) unit.value = item.unit || "";
        if (url) url.value = item.url || "";
        if (imageUrl) imageUrl.value = item.imageUrl || "";
        if (image) {
            image.value = item.imageFile ? "Immagine presente" : "";
            image.dataset.path = "";
        }
        if (removeBtn) removeBtn.style.display = item.imageFile || item.imageUrl ? "inline-flex" : "none";
    } else {
        if (title) title.textContent = "Nuovo prodotto catalogo";
        if (saveBtn) saveBtn.textContent = "Salva prodotto";
        if (idInput) idInput.value = "";
        if (name) name.value = "";
        if (desc) desc.value = "";
        if (category) category.dataset.value = "";
        if (unit) unit.value = "";
        if (url) url.value = "";
        if (imageUrl) imageUrl.value = "";
        if (image) image.value = "";
        if (removeBtn) removeBtn.style.display = "none";
    }
    uiState.catalogRemoveImage = false;
    modal.classList.remove("is-hidden");
    modal.setAttribute("aria-hidden", "false");
}

function closeCatalogModal(ctx) {
    const { document } = ctx;
    const modal = document.getElementById("pm-catalog-modal");
    if (!modal) return;
    modal.classList.add("is-hidden");
    modal.setAttribute("aria-hidden", "true");
}

function clearCatalogForm(ctx) {
    const { document } = ctx;
    const ids = [
        "pm-catalog-id",
        "pm-catalog-name",
        "pm-catalog-description",
        "pm-catalog-category",
        "pm-catalog-unit",
        "pm-catalog-url",
        "pm-catalog-image-url",
        "pm-catalog-image",
    ];
    ids.forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.value = "";
    });
}

function saveCatalogItem(ctx) {
    const {
        document,
        isAdmin,
        showWarning,
        copyCatalogImage,
        uiState,
        getCatalogItems,
        setCatalogItems,
        saveCatalog,
        renderCatalog,
        closeCatalogModal,
    } = ctx;
    if (!isAdmin()) {
        showWarning("Solo gli admin possono aggiungere prodotti.");
        return;
    }
    const idInput = document.getElementById("pm-catalog-id");
    const name = document.getElementById("pm-catalog-name")?.value?.trim() || "";
    if (!name) {
        showWarning("Inserisci il nome prodotto.");
        return;
    }
    const categoryContainer = document.getElementById("pm-catalog-category");
    const category =
        categoryContainer && categoryContainer.querySelector(".pm-multiselect__button")
            ? categoryContainer.querySelector(".pm-multiselect__button").textContent
            : "";
    const imageInput = document.getElementById("pm-catalog-image");
    const imageUrlInput = document.getElementById("pm-catalog-image-url");
    const imageSource = imageInput && imageInput.dataset ? imageInput.dataset.path || "" : "";
    const existingId = idInput?.value?.trim() || "";
    const targetId = existingId || `CAT-${Date.now()}`;
    let imageFileName = "";
    if (imageSource) {
        imageFileName = copyCatalogImage(imageSource, targetId);
    }
    const item = {
        id: targetId,
        name,
        description: document.getElementById("pm-catalog-description")?.value?.trim() || "",
        category,
        unit: document.getElementById("pm-catalog-unit")?.value?.trim() || "",
        url: document.getElementById("pm-catalog-url")?.value?.trim() || "",
        imageUrl: imageUrlInput?.value?.trim() || "",
        imageFile: imageFileName,
        createdAt: new Date().toISOString(),
    };
    const current = getCatalogItems();
    let nextItems = current;
    if (existingId) {
        nextItems = current.map((entry) => {
            if (entry.id !== existingId) return entry;
            return {
                ...entry,
                ...item,
                imageUrl: item.imageUrl || entry.imageUrl || "",
                imageFile: uiState.catalogRemoveImage ? "" : imageFileName || entry.imageFile || "",
            };
        });
    } else {
        nextItems = [...current, item];
    }
    setCatalogItems(nextItems);
    if (saveCatalog(nextItems)) {
        renderCatalog();
        clearCatalogForm(ctx);
        closeCatalogModal(ctx);
    }
}

function openCategoriesModal(ctx) {
    const { document, isAdmin, showWarning, renderCategoriesList } = ctx;
    if (!isAdmin()) {
        showWarning("Solo gli admin possono gestire le categorie.");
        return;
    }
    const modal = document.getElementById("pm-categories-modal");
    if (!modal) return;
    renderCategoriesList();
    modal.classList.remove("is-hidden");
    modal.setAttribute("aria-hidden", "false");
}

function closeCategoriesModal(ctx) {
    const { document, closeCategoryEditor } = ctx;
    const modal = document.getElementById("pm-categories-modal");
    if (!modal) return;
    modal.classList.add("is-hidden");
    modal.setAttribute("aria-hidden", "true");
    closeCategoryEditor(true);
}

function addCategory(ctx) {
    const { document, isAdmin, showWarning, getCatalogCategories, setCatalogCategories, saveCategories, renderCategoriesList, renderCategoryOptions } = ctx;
    if (!isAdmin()) {
        showWarning("Solo gli admin possono gestire le categorie.");
        return;
    }
    const input = document.getElementById("pm-category-name");
    const value = input?.value?.trim() || "";
    if (!value) return;
    const current = getCatalogCategories();
    if (current.includes(value)) {
        showWarning("Categoria già esistente.");
        return;
    }
    const next = [...current, value];
    setCatalogCategories(next);
    if (saveCategories(next)) {
        if (input) input.value = "";
        renderCategoriesList();
        renderCategoryOptions();
    }
}

module.exports = {
    normalizeHexColor,
    loadCategoryColors,
    saveCategoryColors,
    hashCategoryToColor,
    getCategoryColor,
    getContrastText,
    applyCategoryColor,
    updateCategoryChipPreview,
    openCategoryEditor,
    closeCategoryEditor,
    loadCatalog,
    saveCatalog,
    loadCategories,
    saveCategories,
    renderCatalog,
    openCatalogModal,
    closeCatalogModal,
    clearCatalogForm,
    saveCatalogItem,
    openCategoriesModal,
    closeCategoriesModal,
    addCategory,
};
