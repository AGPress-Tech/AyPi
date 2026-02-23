// @ts-nocheck
require("../../../shared/dev-guards");
function openConfirmModal(ctx, message) {
    const { document, uiState } = ctx;
    const modal = document.getElementById("pm-confirm-modal");
    const desc = document.getElementById("pm-confirm-message");
    if (!modal || !desc) return Promise.resolve(false);
    desc.textContent = message || "";
    modal.classList.remove("is-hidden");
    modal.setAttribute("aria-hidden", "false");
    return new Promise((resolve) => {
        uiState.pendingConfirmResolve = resolve;
    });
}

function closeConfirmModal(ctx, result = false) {
    const { document, uiState } = ctx;
    const modal = document.getElementById("pm-confirm-modal");
    if (modal) {
        modal.classList.add("is-hidden");
        modal.setAttribute("aria-hidden", "true");
    }
    if (typeof uiState.pendingConfirmResolve === "function") {
        const resolver = uiState.pendingConfirmResolve;
        uiState.pendingConfirmResolve = null;
        resolver(result);
    }
}

function openAlertModal(ctx, title, message, detail = "") {
    const { document, pendingAlertResolveSetter } = ctx;
    const modal = document.getElementById("pm-alert-modal");
    const titleEl = document.getElementById("pm-alert-title");
    const messageEl = document.getElementById("pm-alert-message");
    const detailEl = document.getElementById("pm-alert-detail");
    if (!modal || !messageEl) {
        return Promise.resolve(false);
    }
    if (titleEl) titleEl.textContent = title || "Avviso";
    messageEl.textContent = message || "";
    if (detailEl) {
        if (detail) {
            detailEl.textContent = detail;
            detailEl.classList.remove("is-hidden");
        } else {
            detailEl.textContent = "";
            detailEl.classList.add("is-hidden");
        }
    }
    modal.classList.remove("is-hidden");
    modal.setAttribute("aria-hidden", "false");
    return new Promise((resolve) => {
        pendingAlertResolveSetter(resolve);
    });
}

function closeAlertModal(ctx) {
    const { document, pendingAlertResolveGetter, pendingAlertResolveSetter } = ctx;
    const modal = document.getElementById("pm-alert-modal");
    if (modal) {
        modal.classList.add("is-hidden");
        modal.setAttribute("aria-hidden", "true");
    }
    const resolver = pendingAlertResolveGetter();
    if (resolver) {
        pendingAlertResolveSetter(null);
        resolver(true);
    }
}

if (typeof module !== "undefined" && module.exports && !(globalThis as any).__aypiBundled) module.exports = {
    openConfirmModal,
    closeConfirmModal,
    openAlertModal,
    closeAlertModal,
};

