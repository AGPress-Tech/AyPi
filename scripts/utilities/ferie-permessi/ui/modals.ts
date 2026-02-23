require("../../../shared/dev-guards");

type ModalHelpersOptions = {
    document: Document;
    clearPendingAction?: () => void;
};

function createModalHelpers(options: ModalHelpersOptions) {
    const { document, clearPendingAction } = options || ({} as ModalHelpersOptions);

    if (!document) {
        throw new Error("document richiesto.");
    }

    function showModal(modal: HTMLElement | null) {
        if (!modal) return;
        modal.classList.remove("is-hidden");
        modal.setAttribute("aria-hidden", "false");
        modal.style.display = "flex";
        modal.style.pointerEvents = "auto";
        modal.style.visibility = "visible";
    }

    function hideModal(modal: HTMLElement | null) {
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

export { createModalHelpers };

// Keep CommonJS compatibility for legacy JS callers
if (typeof module !== "undefined" && module.exports && !(globalThis as any).__aypiBundled) {
    if (typeof module !== "undefined" && module.exports && !(globalThis as any).__aypiBundled) module.exports = { createModalHelpers };
}


