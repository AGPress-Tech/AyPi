// @ts-nocheck
require("../../../shared/dev-guards");
function showInfo(ctx, message, detail = "") {
    const { document, sharedDialogs, openAlertModal } = ctx;
    const modal = document.getElementById("pm-alert-modal");
    if (!modal) {
        return sharedDialogs.showInfo(message, detail);
    }
    return openAlertModal("Info", message, detail);
}

function showWarning(ctx, message, detail = "") {
    const { document, sharedDialogs, openAlertModal } = ctx;
    const modal = document.getElementById("pm-alert-modal");
    if (!modal) {
        return sharedDialogs.showWarning(message, detail);
    }
    return openAlertModal("Attenzione", message, detail);
}

function showError(ctx, message, detail = "") {
    const { document, sharedDialogs, openAlertModal } = ctx;
    const modal = document.getElementById("pm-alert-modal");
    if (!modal) {
        return sharedDialogs.showError(message, detail);
    }
    return openAlertModal("Errore", message, detail);
}

function requireLogin(ctx) {
    const { isLoggedIn, showWarning, openLoginModal } = ctx;
    if (isLoggedIn()) return true;
    showWarning("Accesso richiesto.", "Per continuare effettua il login.");
    openLoginModal();
    return false;
}

function requireAdminAccess(ctx, action) {
    const { isAdmin, showWarning, openLoginModal } = ctx;
    if (isAdmin()) {
        if (typeof action === "function") action();
        return;
    }
    showWarning("Accesso admin richiesto.", "Effettua il login come admin per continuare.");
    openLoginModal();
}

if (typeof module !== "undefined" && module.exports && !(globalThis as any).__aypiBundled) module.exports = {
    showInfo,
    showWarning,
    showError,
    requireLogin,
    requireAdminAccess,
};

