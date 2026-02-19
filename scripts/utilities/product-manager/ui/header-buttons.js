function setupHeaderButtons(ctx) {
    const {
        document,
        ipcRenderer,
        showError,
        requireLogin,
        syncAssignees,
        renderLoginSelectors,
        loadCatalog,
        loadCategories,
        loadInterventionTypes,
        renderCatalog,
        renderCatalogFilterOptions,
        syncCatalogControls,
        renderCartTagFilterOptions,
        renderCartTable,
        renderLines,
        isInterventionMode,
        collectRequestPayload,
        validateRequestPayload,
        showFormMessage,
        openConfirmModal,
        readRequestsFile,
        buildRequestRecord,
        saveRequestsFile,
        clearForm,
        setCatalogItems,
        setCatalogCategories,
        setInterventionTypes,
    } = ctx;

    const refreshBtn = document.getElementById("pm-refresh");
    const settingsBtn = document.getElementById("pm-settings");
    const cartBtn = document.getElementById("pm-open-cart");
    const interventionsBtn = document.getElementById("pm-open-interventions");
    const addLineBtn = document.getElementById("pm-add-line");
    const saveBtn = document.getElementById("pm-request-save");

    if (refreshBtn) {
        refreshBtn.addEventListener("click", () => {
            syncAssignees();
            renderLoginSelectors();
            setCatalogItems(loadCatalog());
            setCatalogCategories(loadCategories());
            setInterventionTypes(loadInterventionTypes());
            renderCatalog();
            renderCatalogFilterOptions();
            syncCatalogControls();
            renderCartTagFilterOptions();
            renderCartTable();
            renderLines();
        });
    }

    if (settingsBtn) {
        settingsBtn.addEventListener("click", () => {
            if (!requireLogin()) return;
            const modal = document.getElementById("pm-settings-modal");
            if (modal) {
                modal.classList.remove("is-hidden");
                modal.setAttribute("aria-hidden", "false");
            }
        });
    }

    if (cartBtn) {
        cartBtn.addEventListener("click", () => {
            if (!requireLogin()) return;
            ipcRenderer.send("open-product-manager-cart-window");
        });
    }

    if (interventionsBtn) {
        interventionsBtn.addEventListener("click", () => {
            if (!requireLogin()) return;
            ipcRenderer
                .invoke("open-product-manager-interventions-window")
                .catch((err) =>
                    showError(
                        "Impossibile aprire la lista interventi.",
                        err && err.message ? err.message : String(err)
                    )
                );
        });
    }

    if (addLineBtn) {
        addLineBtn.addEventListener("click", (event) => {
            if (!requireLogin()) {
                event.preventDefault();
                event.stopPropagation();
                return;
            }
            if (typeof ctx.addLine === "function") {
                ctx.addLine();
            }
        });
    }

    if (saveBtn) {
        saveBtn.addEventListener("click", async (event) => {
            if (!requireLogin()) {
                event.preventDefault();
                event.stopPropagation();
                return;
            }
            const payload = collectRequestPayload();
            const validationError = validateRequestPayload(payload);
            if (validationError) {
                showFormMessage(validationError, "error");
                return;
            }
            const ok = await openConfirmModal("Vuoi inviare la richiesta?");
            if (!ok) return;
            const requests = readRequestsFile();
            const record = buildRequestRecord(payload);
            requests.push(record);
            if (saveRequestsFile(requests)) {
                const successMessage = isInterventionMode()
                    ? "Intervento inviato correttamente."
                    : "Richiesta inviata correttamente.";
                showFormMessage(successMessage, "success");
                clearForm();
            }
        });
    }
}

module.exports = { setupHeaderButtons };
