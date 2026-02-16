function updateGreeting(ctx) {
    const { document, isEmployee, isAdmin, session } = ctx;
    const greeting = document.getElementById("pm-greeting");
    if (!greeting) return;
    if (isEmployee()) {
        greeting.textContent = `Buongiorno, ${session.employee}!`;
        return;
    }
    if (isAdmin()) {
        greeting.textContent = `Buongiorno, ${session.adminName}!`;
        return;
    }
    greeting.textContent = "Buongiorno";
}

function updateLoginButton(ctx) {
    const { document, isAdmin, isEmployee, session } = ctx;
    const btn = document.getElementById("pm-login-toggle");
    if (!btn) return;
    if (isAdmin()) {
        btn.textContent = `Admin: ${session.adminName}`;
        return;
    }
    if (isEmployee()) {
        btn.textContent = `Dipendente: ${session.employee}`;
        return;
    }
    btn.textContent = "Login";
}

function updateAdminControls(ctx) {
    const { document, isAdmin } = ctx;
    const section = document.getElementById("pm-categories-section");
    if (section) section.classList.toggle("is-hidden", !isAdmin());
    const typesSection = document.getElementById("pm-intervention-types-section");
    if (typesSection) typesSection.classList.toggle("is-hidden", !isAdmin());
    const catalogAdd = document.getElementById("pm-catalog-add");
    if (catalogAdd) catalogAdd.style.display = isAdmin() ? "inline-flex" : "none";
    const assigneesBtn = document.getElementById("pm-assignees-open");
    if (assigneesBtn) assigneesBtn.style.display = isAdmin() ? "inline-flex" : "none";
    const adminBtn = document.getElementById("pm-admin-open");
    if (adminBtn) adminBtn.style.display = isAdmin() ? "inline-flex" : "none";
}

function syncSessionUI(ctx) {
    const {
        updateGreeting,
        updateLoginButton,
        updateAdminControls,
        renderCatalog,
        renderCategoryOptions,
        renderCatalogFilterOptions,
        renderCartTagFilterOptions,
        renderCartTable,
        renderLines,
    } = ctx;
    updateGreeting();
    updateLoginButton();
    updateAdminControls();
    renderCatalog();
    renderCategoryOptions();
    renderCatalogFilterOptions();
    renderCartTagFilterOptions();
    renderCartTable();
    renderLines();
}

function applySharedSession(ctx, payload) {
    const {
        applySharedSessionData,
        closeLoginModal,
        closeLogoutModal,
        syncSessionUI,
        isLoggedIn,
        openLoginModal,
        document,
    } = ctx;
    applySharedSessionData(payload);
    closeLoginModal();
    closeLogoutModal();
    syncSessionUI();
    if (!isLoggedIn() && document.getElementById("pm-request-form")) {
        openLoginModal();
    }
}

module.exports = {
    updateGreeting,
    updateLoginButton,
    updateAdminControls,
    syncSessionUI,
    applySharedSession,
};
