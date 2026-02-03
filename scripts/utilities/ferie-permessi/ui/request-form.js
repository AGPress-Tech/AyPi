const { UI_TEXTS } = require("../utils/ui-texts");

function createRequestForm(options) {
    const {
        document,
        setMessage,
        setInlineError,
        toggleAllDayState,
        updateAllDayLock,
        buildRequestFromForm,
        escapeHtml,
        getTypeLabel,
        formatDate,
        formatDateTime,
        openConfirmModal,
        confirmNegativeBalance,
        getBalanceImpact,
        openPasswordModal,
        requireAdminAccess,
        isAdminRequiredForCreate,
        onDirectMutuaCreate,
        onDirectRetribuitoCreate,
        onDirectSpecialeCreate,
        syncData,
        renderAll,
        refreshData,
        resetForm,
    } = options || {};

    if (!document) {
        throw new Error("document richiesto.");
    }

    function resetNewRequestForm() {
        const now = new Date();
        const today = now.toISOString().slice(0, 10);
        const startDate = document.getElementById("fp-start-date");
        const endDate = document.getElementById("fp-end-date");
        const startTime = document.getElementById("fp-start-time");
        const endTime = document.getElementById("fp-end-time");
        const allDayToggle = document.getElementById("fp-all-day");
        const typeSelect = document.getElementById("fp-type");
        const departmentSelect = document.getElementById("fp-department");
        const employeeSelect = document.getElementById("fp-employee");

        if (startDate) startDate.value = today;
        if (endDate) endDate.value = today;
        if (startTime) startTime.value = "08:00";
        if (endTime) endTime.value = "17:30";
        if (allDayToggle) {
            allDayToggle.checked = false;
            toggleAllDayState(false);
        }
        if (typeSelect) typeSelect.selectedIndex = 0;
        if (typeSelect) typeSelect.dispatchEvent(new Event("change"));
        if (departmentSelect) {
            departmentSelect.selectedIndex = 0;
            departmentSelect.dispatchEvent(new Event("change"));
        }
        if (employeeSelect) {
            employeeSelect.selectedIndex = 0;
        }
        if (typeof resetForm === "function") {
            resetForm("fp");
        }
        updateAllDayLock(startDate, endDate, allDayToggle, "fp");
        setInlineError("fp-end-date-error", "");
    }

    function initRequestForm() {
        const startDate = document.getElementById("fp-start-date");
        const endDate = document.getElementById("fp-end-date");
        const allDayToggle = document.getElementById("fp-all-day");
        const startTimeInput = document.getElementById("fp-start-time");
        const endTimeInput = document.getElementById("fp-end-time");

        if (allDayToggle) {
            toggleAllDayState(allDayToggle.checked);
            allDayToggle.addEventListener("change", () => {
                toggleAllDayState(allDayToggle.checked);
            });
        }
        const handleTimeFocus = () => {
            if (!allDayToggle || !allDayToggle.checked || allDayToggle.disabled) return;
            allDayToggle.checked = false;
            toggleAllDayState(false);
        };
        if (startTimeInput) startTimeInput.addEventListener("focus", handleTimeFocus);
        if (endTimeInput) endTimeInput.addEventListener("focus", handleTimeFocus);

        if (startDate && endDate) {
            const normalizeDates = () => {
                if (!startDate.value || !endDate.value) return;
                if (startDate.value.length !== 10 || endDate.value.length !== 10) return;
                if (endDate.value < startDate.value) {
                    setInlineError("fp-end-date-error", "La data fine non puo essere precedente alla data inizio.");
                } else {
                    setInlineError("fp-end-date-error", "");
                }
                if (endDate.value > startDate.value && allDayToggle) {
                    allDayToggle.checked = true;
                    toggleAllDayState(true);
                }
                updateAllDayLock(startDate, endDate, allDayToggle, "fp");
            };
            startDate.addEventListener("change", normalizeDates);
            endDate.addEventListener("input", normalizeDates);
            endDate.addEventListener("change", normalizeDates);
        }

        const form = document.getElementById("fp-request-form");
        const message = document.getElementById("fp-form-message");
        const saveRequest = async () => {
            setMessage(message, "");
            setInlineError("fp-end-date-error", "");
            const { request, error } = buildRequestFromForm("fp", null, false);
            if (error) {
                setMessage(message, error, true);
                if (error.includes("data fine")) {
                    setInlineError("fp-end-date-error", error);
                }
                return;
            }
            const run = async () => {
                const typeLabel = escapeHtml(getTypeLabel(request.type));
                const startLabel = escapeHtml(request.allDay ? formatDate(request.start) : formatDateTime(request.start));
                const endLabel = escapeHtml(request.allDay ? formatDate(request.end || request.start) : formatDateTime(request.end));
                const confirmMessage = request.type === "mutua"
                    ? UI_TEXTS.mutuaConfirm(startLabel, endLabel)
                    : request.type === "retribuito"
                        ? UI_TEXTS.retribuitoConfirm(startLabel, endLabel)
                        : request.type === "speciale"
                            ? UI_TEXTS.specialeConfirm(startLabel, endLabel)
                            : UI_TEXTS.requestConfirm(typeLabel, startLabel, endLabel);
                const confirmed = await openConfirmModal(confirmMessage);
                if (!confirmed) {
                    return;
                }
                const adminRequired = typeof isAdminRequiredForCreate === "function"
                    ? !!isAdminRequiredForCreate(request.type)
                    : false;
                if (request.type === "mutua") {
                    if (adminRequired && typeof openPasswordModal === "function") {
                        openPasswordModal({
                            type: "mutua-create",
                            id: request.id,
                            title: "Conferma mutua",
                            description: UI_TEXTS.mutuaPasswordDescription,
                            request,
                        });
                        return;
                    }
                    if (typeof onDirectMutuaCreate === "function") {
                        onDirectMutuaCreate(request);
                    }
                    return;
                }
                if (request.type === "retribuito") {
                    if (adminRequired && typeof openPasswordModal === "function") {
                        openPasswordModal({
                            type: "retribuito-create",
                            id: request.id,
                            title: "Conferma permesso retribuito",
                            description: UI_TEXTS.retribuitoPasswordDescription,
                            request,
                        });
                        return;
                    }
                    if (typeof onDirectRetribuitoCreate === "function") {
                        onDirectRetribuitoCreate(request);
                    }
                    return;
                }
                if (request.type === "speciale") {
                    if (adminRequired && typeof openPasswordModal === "function") {
                        openPasswordModal({
                            type: "speciale-create",
                            id: request.id,
                            title: "Conferma permesso chiusura aziendale",
                            description: UI_TEXTS.specialePasswordDescription,
                            request,
                        });
                        return;
                    }
                    if (typeof onDirectSpecialeCreate === "function") {
                        onDirectSpecialeCreate(request);
                    }
                    return;
                }
                if (typeof getBalanceImpact === "function" && typeof confirmNegativeBalance === "function") {
                    const impact = getBalanceImpact(request);
                    const ok = await confirmNegativeBalance(impact);
                    if (!ok) {
                        return;
                    }
                }
                const updated = syncData((payload) => {
                    payload.requests = payload.requests || [];
                    payload.requests.push(request);
                    return payload;
                });
                setMessage(message, UI_TEXTS.requestSent, false);
                resetNewRequestForm();
                renderAll(updated);
            };

            const adminRequired = typeof isAdminRequiredForCreate === "function"
                ? !!isAdminRequiredForCreate(request.type)
                : false;
            if (adminRequired && typeof requireAdminAccess === "function") {
                requireAdminAccess(() => {
                    run();
                });
                return;
            }
            run();
        };
        if (form) {
            form.addEventListener("submit", (event) => {
                event.preventDefault();
            });
        }
        const saveBtn = document.getElementById("fp-request-save");
        if (saveBtn) {
            saveBtn.addEventListener("click", () => {
                saveRequest();
            });
        }

        const refreshBtn = document.getElementById("fp-refresh");
        if (refreshBtn) {
            refreshBtn.addEventListener("click", () => {
                refreshData();
            });
        }
    }

    return { initRequestForm, resetNewRequestForm };
}

module.exports = { createRequestForm };

