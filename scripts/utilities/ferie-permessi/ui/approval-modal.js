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
    } = options || {};


    if (!document) {
        throw new Error("document richiesto.");
    }

    function openPasswordModal(action) {
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
        setTimeout(() => input.focus(), 0);
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
        if (!pendingAction) {
            closeApprovalModal();
            return;
        }
        const actionType = pendingAction.type;
        const requestId = pendingAction.id;
        if (actionType === "approve") {
            closeApprovalModal();
            const updated = syncData((payload) => {
                const target = (payload.requests || []).find((req) => req.id === requestId);
                if (target) {
                    target.status = "approved";
                    target.approvedAt = new Date().toISOString();
                    target.approvedBy = admin.name;
                }
                return payload;
            });
            renderAll(updated);
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
                setEditingAdminName(admin.name);
                openEditModal(target);
            }
        }
        if (actionType === "pending-access") {
            setPendingUnlocked(true);
            setPendingUnlockedBy(admin.name);
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
            if (!targetName || admin.name !== targetName) {
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
