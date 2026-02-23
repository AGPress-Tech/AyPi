// @ts-nocheck
require("../../../shared/dev-guards");
function openLoginModal(ctx) {
    const { document } = ctx;
    const modal = document.getElementById("pm-login-modal");
    const employeePanel = document.getElementById("pm-login-employee-panel");
    const adminPanel = document.getElementById("pm-login-admin-panel");
    const choiceEmployee = document.getElementById("pm-login-choice-employee");
    const choiceAdmin = document.getElementById("pm-login-choice-admin");
    if (!modal) return;
    if (employeePanel) employeePanel.classList.remove("is-hidden");
    if (adminPanel) adminPanel.classList.add("is-hidden");
    if (choiceEmployee) choiceEmployee.classList.add("is-active");
    if (choiceAdmin) choiceAdmin.classList.remove("is-active");
    modal.classList.remove("is-hidden");
    modal.setAttribute("aria-hidden", "false");
}

function closeLoginModal(ctx) {
    const { document } = ctx;
    const modal = document.getElementById("pm-login-modal");
    if (!modal) return;
    modal.classList.add("is-hidden");
    modal.setAttribute("aria-hidden", "true");
}

function openLogoutModal(ctx) {
    const { document } = ctx;
    const modal = document.getElementById("pm-logout-modal");
    if (!modal) return;
    modal.classList.remove("is-hidden");
    modal.setAttribute("aria-hidden", "false");
}

function closeLogoutModal(ctx) {
    const { document } = ctx;
    const modal = document.getElementById("pm-logout-modal");
    if (!modal) return;
    modal.classList.add("is-hidden");
    modal.setAttribute("aria-hidden", "true");
}

if (typeof module !== "undefined" && module.exports && !(globalThis as any).__aypiBundled) module.exports = {
    openLoginModal,
    closeLoginModal,
    openLogoutModal,
    closeLogoutModal,
};

