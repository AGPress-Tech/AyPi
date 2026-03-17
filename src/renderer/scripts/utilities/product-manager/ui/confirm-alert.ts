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

function openReasonModal(ctx, { title, message, placeholder } = {}) {
    const { document, uiState } = ctx;
    const modal = document.getElementById("pm-reason-modal");
    const titleEl = document.getElementById("pm-reason-title");
    const messageEl = document.getElementById("pm-reason-message");
    const input = document.getElementById("pm-reason-input");
    if (!modal || !input) return Promise.resolve(null);
    if (titleEl) titleEl.textContent = title || "Motivazione richiesta";
    if (messageEl) messageEl.textContent = message || "Inserisci una motivazione per il rifiuto.";
    if (placeholder) input.placeholder = placeholder;
    input.value = "";
    modal.classList.remove("is-hidden");
    modal.setAttribute("aria-hidden", "false");
    setTimeout(() => input.focus(), 0);
    return new Promise((resolve) => {
        uiState.pendingReasonResolve = resolve;
    });
}

function closeReasonModal(ctx, result = null) {
    const { document, uiState } = ctx;
    const modal = document.getElementById("pm-reason-modal");
    if (modal) {
        modal.classList.add("is-hidden");
        modal.setAttribute("aria-hidden", "true");
    }
    if (typeof uiState.pendingReasonResolve === "function") {
        const resolver = uiState.pendingReasonResolve;
        uiState.pendingReasonResolve = null;
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
    openReasonModal,
    closeReasonModal,
    openAlertModal,
    closeAlertModal,
};

