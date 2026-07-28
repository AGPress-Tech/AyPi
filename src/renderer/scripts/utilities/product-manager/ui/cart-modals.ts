// @ts-nocheck
export function createCartModals(context) {
    const getFieldValue = (id) => {
        const element = context.document.getElementById(id);
        return element ? element.value : "";
    };

    const missingLine = () =>
        context.showError(
            "Elemento non trovato.",
            "La riga potrebbe essere stata modificata da un altro utente.",
        );

    function openInterventionEdit(row) {
        const requests = context.readRequests(
            context.requestModes.INTERVENTION,
        );
        const request = requests[row.requestIndex];
        const line = request?.lines?.[row.lineIndex];
        if (!request || !line) {
            missingLine();
            return;
        }
        if (!context.canEditLine(request, line) || line.deletedAt) {
            context.showWarning("Non puoi modificare questa richiesta.");
            return;
        }
        context.uiState.interventionEditingRow = row;
        const modal = context.document.getElementById(
            "pm-intervention-edit-modal",
        );
        if (!modal) return;
        const type = context.document.getElementById(
            "pm-intervention-edit-type",
        );
        const description = context.document.getElementById(
            "pm-intervention-edit-description",
        );
        const urgency = context.document.getElementById(
            "pm-intervention-edit-urgency",
        );
        if (type) type.value = row.interventionType || "";
        if (description) description.value = row.description || "";
        if (urgency) urgency.value = row.urgency || "";
        modal.classList.remove("is-hidden");
        modal.setAttribute("aria-hidden", "false");
    }

    function closeInterventionEdit() {
        const modal = context.document.getElementById(
            "pm-intervention-edit-modal",
        );
        if (!modal) return;
        modal.classList.add("is-hidden");
        modal.setAttribute("aria-hidden", "true");
        context.uiState.interventionEditingRow = null;
    }

    function saveInterventionEdit() {
        const row = context.uiState.interventionEditingRow;
        if (!row) return;
        const requests = context.readRequests(
            context.requestModes.INTERVENTION,
        );
        const request = requests[row.requestIndex];
        const line = request?.lines?.[row.lineIndex];
        if (!request || !line) {
            missingLine();
            return;
        }
        if (!context.canEditLine(request, line) || line.deletedAt) {
            context.showWarning("Non puoi modificare questa richiesta.");
            return;
        }
        context.updateRequestLine(
            request,
            line,
            {
                interventionType: getFieldValue(
                    "pm-intervention-edit-type",
                ).trim(),
                description: getFieldValue(
                    "pm-intervention-edit-description",
                ).trim(),
                urgency: getFieldValue(
                    "pm-intervention-edit-urgency",
                ).trim(),
            },
            context.getSession(),
        );
        if (
            context.saveRequests(
                requests,
                context.requestModes.INTERVENTION,
            )
        ) {
            closeInterventionEdit();
            context.renderCart();
        }
    }

    function openPurchaseEdit(row) {
        const requests = context.readRequests();
        const request = requests[row.requestIndex];
        const line = request?.lines?.[row.lineIndex];
        if (!request || !line) {
            missingLine();
            return;
        }
        if (!context.canEditLine(request, line) || line.deletedAt) {
            context.showWarning("Non puoi modificare questa richiesta.");
            return;
        }
        context.cartState.editingRow = row;
        const modal = context.document.getElementById("pm-edit-modal");
        if (!modal) return;
        const product = context.document.getElementById("pm-edit-product");
        const tagsContainer =
            context.document.getElementById("pm-edit-tags");
        const tagsInput =
            context.document.getElementById("pm-edit-tags-input");
        const quantity =
            context.document.getElementById("pm-edit-quantity");
        const unit = context.document.getElementById("pm-edit-unit");
        const urgency = context.document.getElementById("pm-edit-urgency");
        const supplier =
            context.document.getElementById("pm-edit-supplier");
        const url = context.document.getElementById("pm-edit-url");
        const price = context.document.getElementById("pm-edit-price");
        const note = context.document.getElementById("pm-edit-note");
        if (product) product.value = row.product || "";
        const selectedTags = Array.isArray(row.tags)
            ? row.tags
            : context.toTags(row.category || "");
        if (tagsInput) tagsInput.value = selectedTags.join(", ");
        context.buildTagsSelect(
            {
                document: context.document,
                openMenu: context.openMultiselectMenu,
                closeMenu: context.closeMultiselectMenu,
            },
            {
                container: tagsContainer,
                input: tagsInput,
                values: [
                    ...context.getCatalogCategories(),
                    ...selectedTags,
                ],
                selected: selectedTags,
            },
        );
        if (quantity) quantity.value = row.quantity || "";
        if (unit) unit.value = row.unit || "";
        if (urgency) {
            urgency.value = row.urgency || "";
            urgency.dispatchEvent(new Event("change", { bubbles: true }));
        }
        if (supplier) supplier.value = row.supplier || "";
        if (url) url.value = row.url || "";
        if (price) {
            price.value = row.priceCad
                ? String(row.priceCad).replace(/[^\d.,-]/g, "")
                : "";
        }
        if (note) note.value = row.note || "";
        modal.classList.remove("is-hidden");
        modal.setAttribute("aria-hidden", "false");
    }

    function closePurchaseEdit() {
        const modal = context.document.getElementById("pm-edit-modal");
        if (!modal) return;
        modal.classList.add("is-hidden");
        modal.setAttribute("aria-hidden", "true");
        context.cartState.editingRow = null;
    }

    function savePurchaseEdit() {
        const row = context.cartState.editingRow;
        if (!row) return;
        const requests = context.readRequests();
        const request = requests[row.requestIndex];
        const line = request?.lines?.[row.lineIndex];
        if (!request || !line) {
            missingLine();
            return;
        }
        if (!context.canEditLine(request, line) || line.deletedAt) {
            context.showWarning("Non puoi modificare questa richiesta.");
            return;
        }
        context.updateRequestLine(
            request,
            line,
            {
                product: getFieldValue("pm-edit-product").trim(),
                category: getFieldValue("pm-edit-tags-input").trim(),
                quantity: getFieldValue("pm-edit-quantity")
                    .toString()
                    .trim(),
                unit: getFieldValue("pm-edit-unit").trim(),
                urgency: getFieldValue("pm-edit-urgency").trim(),
                supplier: getFieldValue("pm-edit-supplier").trim(),
                url: getFieldValue("pm-edit-url").trim(),
                priceCad: context.normalizePrice(
                    getFieldValue("pm-edit-price"),
                ),
                note: getFieldValue("pm-edit-note").trim(),
            },
            context.getSession(),
        );
        if (context.saveRequests(requests)) {
            closePurchaseEdit();
            context.renderCart();
        }
    }

    function openAdd(row) {
        if (!context.requireLogin()) return;
        context.uiState.pendingAddRow = row;
        const modal = context.document.getElementById("pm-add-modal");
        const quantity =
            context.document.getElementById("pm-add-quantity");
        if (!modal) return;
        if (quantity) quantity.value = "";
        modal.classList.remove("is-hidden");
        modal.setAttribute("aria-hidden", "false");
    }

    function closeAdd() {
        const modal = context.document.getElementById("pm-add-modal");
        if (!modal) return;
        modal.classList.add("is-hidden");
        modal.setAttribute("aria-hidden", "true");
        context.uiState.pendingAddRow = null;
    }

    function saveAdd() {
        if (!context.uiState.pendingAddRow) {
            closeAdd();
            return;
        }
        if (!context.isLoggedIn()) {
            context.showWarning(
                "Accesso richiesto.",
                "Per continuare effettua il login.",
            );
            context.openLoginModal();
            return;
        }
        const raw =
            context.document.getElementById("pm-add-quantity")?.value || "";
        const quantity = raw.toString().trim();
        if (!quantity || Number.parseFloat(quantity) <= 0) {
            context.showWarning("Quantità non valida.");
            return;
        }
        const baseLine = context.uiState.pendingAddRow;
        const line = {
            product: baseLine.product || "",
            category: baseLine.tags
                ? baseLine.tags.join(", ")
                : baseLine.category || "",
            quantity,
            unit: baseLine.unit || "",
            urgency: baseLine.urgency || "",
            supplier: baseLine.supplier || "",
            url: baseLine.url || "",
            note: "",
        };
        const requests = context.readRequests();
        requests.push(
            context.buildRequestRecord({ notes: "", lines: [line] }),
        );
        if (context.saveRequests(requests)) {
            closeAdd();
            context.renderCart();
        }
    }

    return {
        openInterventionEdit,
        closeInterventionEdit,
        saveInterventionEdit,
        openPurchaseEdit,
        closePurchaseEdit,
        savePurchaseEdit,
        openAdd,
        closeAdd,
        saveAdd,
    };
}
