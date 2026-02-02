const { UI_TEXTS } = require("../utils/ui-texts");

function createEditModal(options) {
    const {
        document,
        showModal,
        hideModal,
        setMessage,
        setInlineError,
        fillFormFromRequest,
        toggleAllDayStateFor,
        updateAllDayLock,
        buildRequestFromForm,
        openConfirmModal,
        escapeHtml,
        getTypeLabel,
        formatDate,
        formatDateTime,
        syncData,
        renderAll,
        getEditingRequestId,
        setEditingRequestId,
        getEditingAdminName,
        setEditingAdminName,
        applyBalanceForUpdate,
        applyBalanceForDeletion,
    } = options || {};

    if (!document) {
        throw new Error("document richiesto.");
    }

    function openEditModal(request) {
        const modal = document.getElementById("fp-edit-modal");
        const message = document.getElementById("fp-edit-message");
        if (!modal) return;
        showModal(modal);
        setMessage(message, "");
        setInlineError("fp-edit-end-date-error", "");
        fillFormFromRequest("fp-edit", request);
    }

    function closeEditModal() {
        const modal = document.getElementById("fp-edit-modal");
        const message = document.getElementById("fp-edit-message");
        if (!modal) return;
        hideModal(modal);
        setMessage(message, "");
        setInlineError("fp-edit-end-date-error", "");
        setEditingRequestId(null);
        setEditingAdminName("");
    }

    function initEditModal() {
        const editModal = document.getElementById("fp-edit-modal");
        const editForm = document.getElementById("fp-edit-form");
        const editCancel = document.getElementById("fp-edit-cancel");
        const editDelete = document.getElementById("fp-edit-delete");
        const editMessage = document.getElementById("fp-edit-message");
        const editAllDay = document.getElementById("fp-edit-all-day");
        const editStartTime = document.getElementById("fp-edit-start-time");
        const editEndTime = document.getElementById("fp-edit-end-time");
        const editStartDate = document.getElementById("fp-edit-start-date");
        const editEndDate = document.getElementById("fp-edit-end-date");

        if (editAllDay) {
            toggleAllDayStateFor("fp-edit", editAllDay.checked);
            editAllDay.addEventListener("change", () => {
                toggleAllDayStateFor("fp-edit", editAllDay.checked);
            });
        }
        const handleEditTimeFocus = () => {
            if (!editAllDay || !editAllDay.checked || editAllDay.disabled) return;
            editAllDay.checked = false;
            toggleAllDayStateFor("fp-edit", false);
        };
        if (editStartTime) editStartTime.addEventListener("focus", handleEditTimeFocus);
        if (editEndTime) editEndTime.addEventListener("focus", handleEditTimeFocus);

        if (editStartDate && editEndDate) {
            const normalizeEditDates = () => {
                if (!editStartDate.value || !editEndDate.value) return;
                if (editStartDate.value.length !== 10 || editEndDate.value.length !== 10) return;
                if (editEndDate.value < editStartDate.value) {
                    setInlineError("fp-edit-end-date-error", "La data fine non puo essere precedente alla data inizio.");
                } else {
                    setInlineError("fp-edit-end-date-error", "");
                }
                if (editEndDate.value > editStartDate.value && editAllDay) {
                    editAllDay.checked = true;
                    toggleAllDayStateFor("fp-edit", true);
                }
                updateAllDayLock(editStartDate, editEndDate, editAllDay, "fp-edit");
            };
            editStartDate.addEventListener("change", normalizeEditDates);
            editEndDate.addEventListener("input", normalizeEditDates);
            editEndDate.addEventListener("change", normalizeEditDates);
        }

        if (editCancel) {
            editCancel.addEventListener("click", () => {
                closeEditModal();
            });
        }

        if (editDelete) {
            editDelete.addEventListener("click", async () => {
                const editingRequestId = getEditingRequestId();
                if (!editingRequestId) return;
                if (typeof openConfirmModal === "function") {
                    const ok = await openConfirmModal("Confermi l'eliminazione della richiesta?");
                    if (!ok) return;
                }
                const updated = syncData((payload) => {
                    const target = (payload.requests || []).find((req) => req.id === editingRequestId);
                    if (target && typeof applyBalanceForDeletion === "function") {
                        applyBalanceForDeletion(payload, target);
                    }
                    payload.requests = (payload.requests || []).filter((req) => req.id !== editingRequestId);
                    return payload;
                });
                closeEditModal();
                renderAll(updated);
            });
        }

        if (editModal) {
            editModal.addEventListener("click", (event) => {
                event.stopPropagation();
            });
        }

        if (editForm) {
            editForm.addEventListener("submit", async (event) => {
                event.preventDefault();
                const editingRequestId = getEditingRequestId();
                if (!editingRequestId) return;
                setMessage(editMessage, "");
                const { request, error } = buildRequestFromForm("fp-edit", editingRequestId, true);
                if (error) {
                    setMessage(editMessage, error, true);
                    if (error.includes("data fine")) {
                        setInlineError("fp-edit-end-date-error", error);
                    } else {
                        setInlineError("fp-edit-end-date-error", "");
                    }
                    return;
                }
                if (typeof openConfirmModal === "function") {
                    const typeLabel = escapeHtml && getTypeLabel ? escapeHtml(getTypeLabel(request.type)) : "richiesta";
                    const startLabel = escapeHtml && formatDate && formatDateTime
                        ? escapeHtml(request.allDay ? formatDate(request.start) : formatDateTime(request.start))
                        : "";
                    const endLabel = escapeHtml && formatDate && formatDateTime
                        ? escapeHtml(request.allDay ? formatDate(request.end || request.start) : formatDateTime(request.end))
                        : "";
                    const rangeLabel = startLabel ? ` (${startLabel}${endLabel && endLabel !== startLabel ? ` - ${endLabel}` : ""})` : "";
                    const ok = await openConfirmModal(`Confermi la modifica della <strong>${typeLabel}</strong>${rangeLabel}?`);
                    if (!ok) {
                        return;
                    }
                }
                const editingAdminName = getEditingAdminName();
                const updated = syncData((payload) => {
                    payload.requests = payload.requests || [];
                    const idx = payload.requests.findIndex((req) => req.id === editingRequestId);
                    if (idx >= 0) {
                        const existing = payload.requests[idx];
                        const nextRequest = {
                            ...existing,
                            ...request,
                            status: "approved",
                            approvedAt: existing.approvedAt || new Date().toISOString(),
                            createdAt: existing.createdAt || new Date().toISOString(),
                            modifiedAt: new Date().toISOString(),
                            modifiedBy: editingAdminName || existing.modifiedBy || "",
                        };
                        if (typeof applyBalanceForUpdate === "function") {
                            applyBalanceForUpdate(payload, existing, nextRequest);
                        }
                        payload.requests[idx] = nextRequest;
                    }
                    return payload;
                });
                setMessage(editMessage, UI_TEXTS.requestUpdated, false);
                closeEditModal();
                renderAll(updated);
            });
        }
    }

    return { openEditModal, closeEditModal, initEditModal };
}

module.exports = { createEditModal };
