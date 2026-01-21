function createModalHelpers(options) {
    const { document, clearPendingAction } = options || {};

    if (!document) {
        throw new Error("document richiesto.");
    }

    function showModal(modal) {
        if (!modal) return;
        modal.classList.remove("is-hidden");
        modal.setAttribute("aria-hidden", "false");
        modal.style.display = "flex";
        modal.style.pointerEvents = "auto";
        modal.style.visibility = "visible";
    }

    function hideModal(modal) {
        if (!modal) return;
        modal.classList.add("is-hidden");
        modal.setAttribute("aria-hidden", "true");
        modal.style.display = "none";
        modal.style.pointerEvents = "none";
        modal.style.visibility = "hidden";
    }

    function forceUnlockUI() {
        document.querySelectorAll(".fp-modal").forEach((item) => hideModal(item));
        if (typeof clearPendingAction === "function") {
            clearPendingAction();
        }
        if (document.activeElement && typeof document.activeElement.blur === "function") {
            document.activeElement.blur();
        }
    }

    return { showModal, hideModal, forceUnlockUI };
}

module.exports = { createModalHelpers };
