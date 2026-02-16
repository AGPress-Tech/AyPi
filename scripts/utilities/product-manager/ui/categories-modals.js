function initCategoriesModal(ctx) {
    const {
        document,
        normalizeHexColor,
        getCategoryColor,
        hashCategoryToColor,
        updateCategoryChipPreview,
        saveCategoryColors,
        closeCategoryEditor,
        renderCatalog,
        renderCartTable,
        uiState,
        openCategoriesModal,
        closeCategoriesModal,
        addCategory,
    } = ctx;

    const openBtn = document.getElementById("pm-categories-open");
    const closeBtn = document.getElementById("pm-categories-close");
    const addBtn = document.getElementById("pm-category-add");
    const colorInput = document.getElementById("pm-category-color-input");
    const colorSave = document.getElementById("pm-category-color-save");
    const colorDefault = document.getElementById("pm-category-color-default");
    const colorCancel = document.getElementById("pm-category-color-cancel");
    const editor = document.getElementById("pm-category-editor");
    if (openBtn) {
        openBtn.addEventListener("click", () => {
            const settings = document.getElementById("pm-settings-modal");
            if (settings) settings.classList.add("is-hidden");
            openCategoriesModal();
        });
    }
    if (closeBtn) closeBtn.addEventListener("click", () => closeCategoriesModal());
    if (addBtn) addBtn.addEventListener("click", () => addCategory());
    if (editor) {
        editor.addEventListener("click", (event) => {
            event.stopPropagation();
        });
    }
    if (colorInput) {
        colorInput.addEventListener("input", () => {
            if (!uiState.categoryEditingName) return;
            const next = normalizeHexColor(
                colorInput.value,
                getCategoryColor(uiState.categoryEditingName)
            );
            const nextColors = { ...ctx.categoryColors(), [uiState.categoryEditingName]: next };
            ctx.setCategoryColors(nextColors);
            updateCategoryChipPreview(uiState.categoryEditingName, next);
            if (uiState.categoryPreviewTimer) clearTimeout(uiState.categoryPreviewTimer);
            uiState.categoryPreviewTimer = setTimeout(() => {
                renderCatalog();
                renderCartTable();
                uiState.categoryPreviewTimer = null;
            }, 80);
        });
    }
    if (colorDefault) {
        colorDefault.addEventListener("click", () => {
            if (!uiState.categoryEditingName) return;
            const next = hashCategoryToColor(uiState.categoryEditingName);
            if (colorInput) colorInput.value = next;
            const nextColors = { ...ctx.categoryColors(), [uiState.categoryEditingName]: next };
            ctx.setCategoryColors(nextColors);
            updateCategoryChipPreview(uiState.categoryEditingName, next);
            renderCatalog();
            renderCartTable();
        });
    }
    if (colorSave) {
        colorSave.addEventListener("click", () => {
            if (!uiState.categoryEditingName) return;
            saveCategoryColors(ctx.categoryColors());
            closeCategoryEditor(false);
        });
    }
    if (colorCancel) {
        colorCancel.addEventListener("click", () => closeCategoryEditor(true));
    }
}

function initInterventionTypesModal(ctx) {
    const { document, openInterventionTypesModal, closeInterventionTypesModal, addInterventionType } = ctx;
    const openBtn = document.getElementById("pm-intervention-types-open");
    const closeBtn = document.getElementById("pm-intervention-types-close");
    const addBtn = document.getElementById("pm-intervention-type-add");
    if (openBtn) {
        openBtn.addEventListener("click", () => {
            const settings = document.getElementById("pm-settings-modal");
            if (settings) settings.classList.add("is-hidden");
            openInterventionTypesModal();
        });
    }
    if (closeBtn) closeBtn.addEventListener("click", () => closeInterventionTypesModal());
    if (addBtn) addBtn.addEventListener("click", () => addInterventionType());
}

module.exports = { initCategoriesModal, initInterventionTypesModal };
