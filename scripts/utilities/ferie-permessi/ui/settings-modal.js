function createSettingsModal(options) {
    const {
        document,
        showModal,
        hideModal,
        setMessage,
        loadThemeSetting,
        saveThemeSetting,
        saveColorSettings,
        setSettingsInputsFromColors,
        applyTypeColors,
        applyTheme,
        renderAll,
        loadData,
        normalizeHexColor,
        DEFAULT_TYPE_COLORS,
        getTypeColors,
        setTypeColors,
        openPasswordModal,
    } = options || {};

    if (!document) {
        throw new Error("document richiesto.");
    }

    let themeSnapshot = null;

    function openSettingsModal() {
        const modal = document.getElementById("fp-settings-modal");
        const message = document.getElementById("fp-settings-message");
        if (!modal) return;
        setMessage(message, "");
        if (typeof options?.refreshLegacySyncButton === "function") {
            options.refreshLegacySyncButton();
        }
        showModal(modal);
    }

    function closeSettingsModal() {
        const modal = document.getElementById("fp-settings-modal");
        if (!modal) return;
        hideModal(modal);
    }

    function openThemeModal() {
        const modal = document.getElementById("fp-settings-theme-modal");
        const message = document.getElementById("fp-settings-theme-message");
        if (!modal) return;
        const themeValue = loadThemeSetting();
        themeSnapshot = themeValue;
        const themeInputs = document.querySelectorAll("input[name='fp-theme']");
        themeInputs.forEach((input) => {
            input.checked = input.value === themeValue;
        });
        setMessage(message, "");
        showModal(modal);
    }

    function closeThemeModal() {
        const modal = document.getElementById("fp-settings-theme-modal");
        if (!modal) return;
        if (themeSnapshot) {
            applyTheme(themeSnapshot);
        }
        hideModal(modal);
    }

    function initSettingsModal() {
        const settingsBtn = document.getElementById("fp-settings");
        const settingsClose = document.getElementById("fp-settings-close");
        const settingsModal = document.getElementById("fp-settings-modal");
        const themeOpen = document.getElementById("fp-settings-theme-open");
        const themeClose = document.getElementById("fp-settings-theme-close");
        const themeSave = document.getElementById("fp-settings-theme-save");
        const themeReset = document.getElementById("fp-settings-theme-reset");
        const themeModal = document.getElementById("fp-settings-theme-modal");
        const themeMessage = document.getElementById("fp-settings-theme-message");
        const themeInputs = document.querySelectorAll("input[name='fp-theme']");
        const configOpen = document.getElementById("fp-settings-config-open");

        if (settingsBtn) {
            settingsBtn.addEventListener("click", () => {
                openSettingsModal();
            });
        }
        if (typeof options?.refreshLegacySyncButton === "function") {
            options.refreshLegacySyncButton();
        }
        if (settingsClose) {
            settingsClose.addEventListener("click", () => {
                closeSettingsModal();
            });
        }
        if (settingsModal) {
            settingsModal.addEventListener("click", (event) => {
                if (event.target === settingsModal) {
                    // no-op: keep modal open on backdrop click
                }
            });
        }

        if (themeOpen) {
            themeOpen.addEventListener("click", () => {
                openThemeModal();
            });
        }
        if (themeClose) {
            themeClose.addEventListener("click", () => {
                closeThemeModal();
            });
        }
        if (themeModal) {
            themeModal.addEventListener("click", (event) => {
                if (event.target === themeModal) {
                    // no-op: keep modal open on backdrop click
                }
            });
        }
        if (themeSave) {
            themeSave.addEventListener("click", () => {
                const selectedTheme = Array.from(themeInputs).find((input) => input.checked)?.value || "light";
                saveThemeSetting(selectedTheme);
                applyTheme(selectedTheme);
                renderAll(loadData());
                setMessage(themeMessage, "");
                themeSnapshot = selectedTheme;
                hideModal(themeModal);
            });
        }
        if (themeReset) {
            themeReset.addEventListener("click", () => {
                const nextTheme = "light";
                themeInputs.forEach((input) => {
                    input.checked = input.value === nextTheme;
                });
                applyTheme(nextTheme);
                setMessage(themeMessage, "", false);
            });
        }

        themeInputs.forEach((input) => {
            input.addEventListener("change", () => {
                if (!input.checked) return;
                applyTheme(input.value);
            });
        });

        if (configOpen) {
            configOpen.addEventListener("click", () => {
                if (typeof openPasswordModal === "function") {
                    openPasswordModal({
                        type: "config-access",
                        id: "config-access",
                        title: "Configurazione",
                        description: "Inserisci la password per accedere alla configurazione.",
                    });
                }
            });
        }
    }

    return { openSettingsModal, closeSettingsModal, initSettingsModal };
}

module.exports = { createSettingsModal };
