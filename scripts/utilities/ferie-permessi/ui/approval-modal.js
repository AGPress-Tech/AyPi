const { UI_TEXTS } = require("../utils/ui-texts");

function createApprovalModal(options) {
    const {
        document,
        showModal,
        hideModal,
        showDialog,
        isHashingAvailable,
        loadAdminCredentials,
        verifyAdminPassword,
        loadData,
        syncData,
        renderAll,
        openEditModal,
        openPendingPanel,
        setPendingUnlocked,
        setPendingUnlockedBy,
        openAdminModal,
        getPendingAction,
        setPendingAction,
        getPasswordFailCount,
        setPasswordFailCount,
        setEditingRequestId,
        setEditingAdminName,
        getAdminCache,
        setAdminCache,
        saveAdminCredentials,
        renderAdminList,
        setAdminMessage,
        forceUnlockUI,
        applyBalanceForApproval,
        applyBalanceForDeletion,
        getBalanceImpact,
        confirmNegativeBalance,
        onHoursAccess,
        onAssigneesAccess,
        onManageAccess,
        onDaysAccess,
        onMutuaCreate,
        onRetribuitoCreate,
        onSpecialeCreate,
        onHolidayCreate,
        onHolidayRemove,
        onHolidayUpdate,
        onClosureCreate,
        onClosureRemove,
        onClosureUpdate,
        onFilterAccess,
        onExport,
        onBackupAccess,
        onConfigAccess,
        isAdminRequiredForAction,
        isAdminLoggedIn,
        getLoggedAdmin,
        onAdminLogin,
        showInfoModal,
        requireAdminAccess,
    } = options || {};


    if (!document) {
        throw new Error("document richiesto.");
    }

    const ALWAYS_REQUIRE_PASSWORD = new Set([
        "admin-access",
        "admin-delete",
        "admin-login",
        "config-access",
        "backup-access",
    ]);

    async function handleAction(admin, pendingAction) {
        if (!pendingAction) {
            closeApprovalModal();
            return;
        }
        const actionType = pendingAction.type;
        const requestId = pendingAction.id;
        if (actionType === "admin-login") {
            closeApprovalModal();
            if (typeof onAdminLogin === "function") {
                onAdminLogin(admin);
            }
            return;
        }
        if (actionType === "mutua-create") {
            closeApprovalModal();
            if (typeof onMutuaCreate === "function") {
                onMutuaCreate(admin, pendingAction.request);
            }
            return;
        }
        if (actionType === "retribuito-create" || actionType === "giustificato-create") {
            closeApprovalModal();
            if (typeof onRetribuitoCreate === "function") {
                onRetribuitoCreate(admin, pendingAction.request);
            }
            return;
        }
        if (actionType === "speciale-create") {
            closeApprovalModal();
            if (typeof onSpecialeCreate === "function") {
                onSpecialeCreate(admin, pendingAction.request);
            }
            return;
        }
        if (actionType === "filter-access") {
            closeApprovalModal();
            if (typeof onFilterAccess === "function") {
                onFilterAccess(admin, pendingAction.filter);
            }
            return;
        }
        if (actionType === "holiday-create") {
            closeApprovalModal();
            if (typeof onHolidayCreate === "function") {
                onHolidayCreate(admin, pendingAction.dates, pendingAction.name);
            }
            return;
        }
        if (actionType === "holiday-remove") {
            closeApprovalModal();
            if (typeof onHolidayRemove === "function") {
                onHolidayRemove(admin, pendingAction.date);
            }
            return;
        }
        if (actionType === "holiday-update") {
            closeApprovalModal();
            if (typeof onHolidayUpdate === "function") {
                onHolidayUpdate(admin, pendingAction.date, pendingAction.nextDate, pendingAction.nextName);
            }
            return;
        }
        if (actionType === "closure-create") {
            closeApprovalModal();
            if (typeof onClosureCreate === "function") {
                onClosureCreate(admin, pendingAction.entry);
            }
            return;
        }
        if (actionType === "closure-remove") {
            closeApprovalModal();
            if (typeof onClosureRemove === "function") {
                onClosureRemove(admin, pendingAction.entry);
            }
            return;
        }
        if (actionType === "closure-update") {
            closeApprovalModal();
            if (typeof onClosureUpdate === "function") {
                onClosureUpdate(admin, pendingAction.entry, pendingAction.next);
            }
            return;
        }
        if (actionType === "export") {
            closeApprovalModal();
            if (typeof onExport === "function") {
                onExport(admin, pendingAction);
            }
            return;
        }
        if (actionType === "backup-access") {
            closeApprovalModal();
            if (typeof onBackupAccess === "function") {
                onBackupAccess(admin);
            }
            return;
        }
        if (actionType === "config-access") {
            closeApprovalModal();
            if (typeof onConfigAccess === "function") {
                onConfigAccess(admin);
            }
            return;
        }
        if (actionType === "approve") {
            if (typeof getBalanceImpact === "function") {
                const current = loadData();
                const target = (current.requests || []).find((req) => req.id === requestId);
                if (target) {
                    const impact = getBalanceImpact(current, target);
                    if (impact && impact.negative && typeof confirmNegativeBalance === "function") {
                        const ok = await confirmNegativeBalance(impact);
                        if (!ok) {
                            return;
                        }
                    }
                }
            }
            closeApprovalModal();
            const updated = syncData((payload) => {
                const target = (payload.requests || []).find((req) => req.id === requestId);
                if (target) {
                    target.status = "approved";
                    target.approvedAt = new Date().toISOString();
                    target.approvedBy = admin?.name || UI_TEXTS.defaultAdminLabel;
                    if (typeof applyBalanceForApproval === "function") {
                        applyBalanceForApproval(payload, target);
                    }
                }
                return payload;
            });
            renderAll(updated);
            return;
        }
        if (actionType === "hours-access") {
            closeApprovalModal();
            if (typeof onHoursAccess === "function") {
                onHoursAccess(admin);
            }
            return;
        }
        if (actionType === "manage-access") {
            closeApprovalModal();
            if (typeof onManageAccess === "function") {
                onManageAccess(admin);
            }
            return;
        }
        if (actionType === "days-access") {
            closeApprovalModal();
            if (typeof onDaysAccess === "function") {
                onDaysAccess(admin);
            }
            return;
        }
        if (actionType === "assignees-access") {
            closeApprovalModal();
            if (typeof onAssigneesAccess === "function") {
                onAssigneesAccess(admin);
            }
            return;
        }
        if (actionType === "reject") {
            closeApprovalModal();
            const updated = syncData((payload) => {
                payload.requests = (payload.requests || []).filter((req) => req.id !== requestId);
                return payload;
            });
            renderAll(updated);
            return;
        }
        if (actionType === "delete") {
            const updated = syncData((payload) => {
                const target = (payload.requests || []).find((req) => req.id === requestId);
                if (target && typeof applyBalanceForDeletion === "function") {
                    applyBalanceForDeletion(payload, target);
                }
                payload.requests = (payload.requests || []).filter((req) => req.id !== requestId);
                return payload;
            });
            if (typeof forceUnlockUI === "function") {
                forceUnlockUI();
            } else {
                closeApprovalModal();
            }
            renderAll(updated);
            return;
        }
        if (actionType === "edit") {
            closeApprovalModal();
            const data = loadData();
            const target = (data.requests || []).find((req) => req.id === requestId);
            if (target) {
                setEditingRequestId(requestId);
                setEditingAdminName(admin?.name || "");
                openEditModal(target);
            }
            return;
        }
        if (actionType === "pending-access") {
            setPendingUnlocked(true);
            setPendingUnlockedBy(admin?.name || "");
            closeApprovalModal();
            openPendingPanel();
            return;
        }
        if (actionType === "admin-access") {
            closeApprovalModal();
            openAdminModal();
            return;
        }
        if (actionType === "admin-delete") {
            const targetName = pendingAction?.adminName || pendingAction?.id || "";
            if (!targetName || admin?.name !== targetName) {
                const error = document.getElementById("fp-approve-error");
                if (error) error.classList.remove("is-hidden");
                return;
            }
            let adminCache = getAdminCache();
            adminCache = adminCache.length ? adminCache : loadAdminCredentials();
            if (adminCache.length <= 1) {
                closeApprovalModal();
                setAdminMessage("fp-admin-message", UI_TEXTS.adminMinRequired, true);
                return;
            }
            adminCache = adminCache.filter((item) => item.name !== targetName);
            setAdminCache(adminCache);
            saveAdminCredentials(adminCache);
            renderAdminList();
            closeApprovalModal();
            setAdminMessage("fp-admin-message", UI_TEXTS.adminRemoved, false);
        }
    }

    function openPasswordModal(action) {
        const loggedIn = typeof isAdminLoggedIn === "function" ? isAdminLoggedIn() : false;
        if (action && !ALWAYS_REQUIRE_PASSWORD.has(action.type)) {
            const needsAdmin = typeof isAdminRequiredForAction === "function"
                ? !!isAdminRequiredForAction(action)
                : true;
            if (needsAdmin && !loggedIn) {
                if (typeof requireAdminAccess === "function") {
                    requireAdminAccess(() => openPasswordModal(action));
                    return;
                }
                if (typeof showInfoModal === "function") {
                    showInfoModal(UI_TEXTS.adminLoginTitle, UI_TEXTS.adminLoginRequired, { showLogin: true });
                } else {
                    showDialog("info", UI_TEXTS.adminLoginTitle, UI_TEXTS.adminLoginRequired);
                }
                return;
            }
            setPendingAction(action);
            if (!needsAdmin && !loggedIn) {
                handleAction(null, action);
                return;
            }
            const admin = typeof getLoggedAdmin === "function" ? getLoggedAdmin() : null;
            handleAction(admin, action);
            return;
        }
        const modal = document.getElementById("fp-approve-modal");
        const input = document.getElementById("fp-approve-password");
        const error = document.getElementById("fp-approve-error");
        const title = document.getElementById("fp-approve-title");
        const desc = document.getElementById("fp-approve-desc");
        if (!modal || !input) return;
        setPendingAction(action);
        if (title && action?.title) title.textContent = action.title;
        if (desc && action?.description) desc.textContent = action.description;
        document.querySelectorAll(".fp-modal").forEach((item) => hideModal(item));
        showModal(modal);
        if (error) {
            error.classList.add("is-hidden");
        }
        input.value = "";
        input.disabled = false;
        input.readOnly = false;
        input.removeAttribute("disabled");
        input.removeAttribute("readonly");
        input.style.pointerEvents = "auto";
        input.style.userSelect = "text";
        input.tabIndex = 0;
        setTimeout(() => {
            input.focus();
            input.select?.();
        }, 0);
    }

    function closeApprovalModal() {
        const modal = document.getElementById("fp-approve-modal");
        const input = document.getElementById("fp-approve-password");
        const error = document.getElementById("fp-approve-error");
        const recoverBtn = document.getElementById("fp-approve-recover");
        if (!modal) return;
        hideModal(modal);
        if (input) input.value = "";
        if (error) error.classList.add("is-hidden");
        if (recoverBtn) recoverBtn.classList.add("is-hidden");
        setPendingAction(null);
        if (document.activeElement && typeof document.activeElement.blur === "function") {
            document.activeElement.blur();
        }
    }

    async function confirmApproval() {
        const input = document.getElementById("fp-approve-password");
        const error = document.getElementById("fp-approve-error");
        const recoverBtn = document.getElementById("fp-approve-recover");
        const password = input ? input.value : "";
        if (!isHashingAvailable()) {
            const hasHashes = loadAdminCredentials().some((item) => item.passwordHash);
            if (hasHashes) {
                await showDialog(
                    "error",
                    UI_TEXTS.hashingUnavailableTitle,
                    UI_TEXTS.hashingUnavailableDetail
                );
                return;
            }
        }
        const result = await verifyAdminPassword(password);
        const admin = result ? result.admin : null;
        if (!admin) {
            if (error) error.classList.remove("is-hidden");
            setPasswordFailCount(getPasswordFailCount() + 1);
            if (recoverBtn && getPasswordFailCount() >= 3) {
                recoverBtn.classList.remove("is-hidden");
            }
            return;
        }
        setPasswordFailCount(0);
        if (recoverBtn) recoverBtn.classList.add("is-hidden");
        const pendingAction = getPendingAction();
        await handleAction(admin, pendingAction);
    }

    function initApprovalModal() {
        const approveCancel = document.getElementById("fp-approve-cancel");
        const approveConfirm = document.getElementById("fp-approve-confirm");
        const approveModal = document.getElementById("fp-approve-modal");
        const approvePassword = document.getElementById("fp-approve-password");
        if (approveCancel) {
            approveCancel.addEventListener("click", closeApprovalModal);
        }
        if (approveConfirm) {
            approveConfirm.addEventListener("click", confirmApproval);
        }
        if (approveModal) {
            approveModal.addEventListener("click", (event) => {
                event.stopPropagation();
            });
        }
        if (approvePassword) {
            approvePassword.addEventListener("keydown", (event) => {
                if (event.key === "Enter") {
                    event.preventDefault();
                    confirmApproval();
                } else if (event.key === "Escape") {
                    event.preventDefault();
                    closeApprovalModal();
                }
            });
        }
    }

    return {
        openPasswordModal,
        closeApprovalModal,
        confirmApproval,
        initApprovalModal,
    };
}

module.exports = { createApprovalModal };

