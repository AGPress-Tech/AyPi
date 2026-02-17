function initSettingsModals(ctx) {
    const {
        document,
        requireAdminAccess,
        adminUi,
        initPasswordModal,
        openPasswordModal,
        openCalendarAssignees,
        UI_TEXTS,
    } = ctx;

    const settingsClose = document.getElementById("pm-settings-close");
    if (settingsClose) {
        settingsClose.addEventListener("click", () => {
            const modal = document.getElementById("pm-settings-modal");
            if (modal) {
                modal.classList.add("is-hidden");
                modal.setAttribute("aria-hidden", "true");
            }
        });
    }

    const themeOpen = document.getElementById("pm-theme-open");
    const themeClose = document.getElementById("pm-theme-close");
    const themeModal = document.getElementById("pm-theme-modal");
    if (themeOpen && themeModal) {
        themeOpen.addEventListener("click", () => {
            themeModal.classList.remove("is-hidden");
            themeModal.setAttribute("aria-hidden", "false");
        });
    }
    if (themeClose && themeModal) {
        themeClose.addEventListener("click", () => {
            themeModal.classList.add("is-hidden");
            themeModal.setAttribute("aria-hidden", "true");
        });
    }

    const setTheme = (theme) => {
        document.body.classList.remove("fp-dark", "fp-aypi");
        if (theme === "dark") document.body.classList.add("fp-dark");
        if (theme === "aypi") document.body.classList.add("fp-aypi");
        try {
            window.localStorage.setItem("pm-theme", theme);
        } catch {}
    };
    const themeLight = document.getElementById("pm-theme-light");
    const themeDark = document.getElementById("pm-theme-dark");
    const themeAyPi = document.getElementById("pm-theme-aypi");
    if (themeLight) themeLight.addEventListener("click", () => setTheme("light"));
    if (themeDark) themeDark.addEventListener("click", () => setTheme("dark"));
    if (themeAyPi) themeAyPi.addEventListener("click", () => setTheme("aypi"));
    try {
        const saved = window.localStorage.getItem("pm-theme");
        if (saved) {
            setTheme(saved);
        } else {
            setTheme("light");
        }
    } catch {}

    const assigneesOpen = document.getElementById("pm-assignees-open");
    if (assigneesOpen) {
        assigneesOpen.addEventListener("click", () => {
            const modal = document.getElementById("pm-settings-modal");
            if (modal) modal.classList.add("is-hidden");
            requireAdminAccess(() => {
                if (typeof openCalendarAssignees === "function") {
                    openCalendarAssignees();
                }
            });
        });
    }

    const adminOpen = document.getElementById("pm-admin-open");
    if (adminOpen) {
        adminOpen.addEventListener("click", () => {
            const modal = document.getElementById("pm-settings-modal");
            if (modal) modal.classList.add("is-hidden");
            requireAdminAccess(() => {
                openPasswordModal({
                    type: "admin-access",
                    id: "admin-access",
                    title: "Gestione admin",
                    description: UI_TEXTS.adminAccessDescription,
                });
            });
        });
    }

    adminUi.initAdminModals();
    initPasswordModal();
}

module.exports = { initSettingsModals };
