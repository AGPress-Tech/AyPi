function openCatalogModal(ctx, item = null) {
    const {
        document,
        isAdmin,
        showWarning,
        toTags,
        renderCategoryOptions,
        uiState,
    } = ctx;
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

function closeCatalogModal(document) {
    const modal = document.getElementById("pm-catalog-modal");
    if (!modal) return;
    modal.classList.add("is-hidden");
    modal.setAttribute("aria-hidden", "true");
}

function clearCatalogForm(document) {
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
        saveCatalog,
        renderCatalog,
        uiState,
        getCatalogItems,
        setCatalogItems,
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
    const currentItems = getCatalogItems();
    if (existingId) {
        setCatalogItems(
            currentItems.map((entry) => {
                if (entry.id !== existingId) return entry;
                return {
                    ...entry,
                    ...item,
                    imageUrl: item.imageUrl || entry.imageUrl || "",
                    imageFile: uiState.catalogRemoveImage ? "" : imageFileName || entry.imageFile || "",
                };
            })
        );
    } else {
        setCatalogItems([...currentItems, item]);
    }
    const nextItems = getCatalogItems();
    if (saveCatalog(nextItems)) {
        renderCatalog();
        clearCatalogForm(document);
        closeCatalogModal(document);
    }
}

function initCatalogModal(ctx) {
    const { document, ipcRenderer, showError, uiState, openCatalogModal, closeCatalogModal, saveCatalogItem } = ctx;
    const openBtn = document.getElementById("pm-catalog-add");
    const closeBtn = document.getElementById("pm-catalog-close");
    const cancelBtn = document.getElementById("pm-catalog-cancel");
    const saveBtn = document.getElementById("pm-catalog-save");
    const browseBtn = document.getElementById("pm-catalog-browse");
    const imageInput = document.getElementById("pm-catalog-image");
    const imageUrlInput = document.getElementById("pm-catalog-image-url");
    const removeBtn = document.getElementById("pm-catalog-remove-image");
    if (openBtn) openBtn.addEventListener("click", () => openCatalogModal());
    if (closeBtn) closeBtn.addEventListener("click", () => closeCatalogModal());
    if (cancelBtn) cancelBtn.addEventListener("click", () => closeCatalogModal());
    if (saveBtn) saveBtn.addEventListener("click", () => saveCatalogItem());
    if (browseBtn) {
        browseBtn.addEventListener("click", async () => {
            try {
                const selected = await ipcRenderer.invoke("pm-select-image");
                if (selected && imageInput) {
                    imageInput.value = selected;
                    imageInput.dataset.path = selected;
                    uiState.catalogRemoveImage = false;
                }
            } catch (err) {
                showError(
                    "Selezione immagine non disponibile.",
                    "Riavvia AyPi per attivare il selettore immagini."
                );
            }
        });
    }
    if (removeBtn) {
        removeBtn.addEventListener("click", async () => {
            const confirmed = await ctx.openConfirmModal(
                "Vuoi rimuovere l'immagine da questo prodotto?"
            );
            if (!confirmed) return;
            if (imageInput) {
                imageInput.value = "";
                imageInput.dataset.path = "";
            }
            if (imageUrlInput) {
                imageUrlInput.value = "";
            }
            uiState.catalogRemoveImage = true;
        });
    }
}

module.exports = {
    openCatalogModal,
    closeCatalogModal,
    clearCatalogForm,
    saveCatalogItem,
    initCatalogModal,
};
