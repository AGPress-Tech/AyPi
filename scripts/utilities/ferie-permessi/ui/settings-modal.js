const { UI_TEXTS } = require("../utils/ui-texts");

function createSettingsModal(options) {
    const {
        document,
        showModal,
        hideModal,
        setMessage,
        loadThemeSetting,
        saveThemeSetting,
        loadColorSettings,
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
    } = options || {};

    if (!document) {
        throw new Error("document richiesto.");
    }

    let settingsSnapshot = null;

    function openSettingsModal() {
        const modal = document.getElementById("fp-settings-modal");
        const message = document.getElementById("fp-settings-message");
        if (!modal) return;
        const themeValue = loadThemeSetting();
        settingsSnapshot = {
            theme: themeValue,
            colors: { ...getTypeColors() },
        };
        setSettingsInputsFromColors();
        const themeInputs = document.querySelectorAll("input[name='fp-theme']");
        themeInputs.forEach((input) => {
            input.checked = input.value === themeValue;
        });
        setMessage(message, "");
        showModal(modal);
    }

    function closeSettingsModal() {
        const modal = document.getElementById("fp-settings-modal");
        if (!modal) return;
        if (settingsSnapshot) {
            setTypeColors({ ...settingsSnapshot.colors });
            applyTypeColors();
            applyTheme(settingsSnapshot.theme);
            renderAll(loadData());
        }
        hideModal(modal);
    }

    function initSettingsModal() {
        const settingsBtn = document.getElementById("fp-settings");
        const settingsClose = document.getElementById("fp-settings-close");
        const settingsSave = document.getElementById("fp-settings-save");
        const settingsReset = document.getElementById("fp-settings-reset");
        const settingsModal = document.getElementById("fp-settings-modal");
        const settingsMessage = document.getElementById("fp-settings-message");
        const ferieInput = document.getElementById("fp-color-ferie");
        const permessoInput = document.getElementById("fp-color-permesso");
        const straordinariInput = document.getElementById("fp-color-straordinari");
        const themeInputs = document.querySelectorAll("input[name='fp-theme']");

        if (settingsBtn) {
            settingsBtn.addEventListener("click", () => {
                openSettingsModal();
            });
        }
        if (settingsClose) {
            settingsClose.addEventListener("click", () => {
                closeSettingsModal();
            });
        }
        if (settingsModal) {
            settingsModal.addEventListener("click", (event) => {
                if (event.target === settingsModal) closeSettingsModal();
            });
        }
        if (settingsSave) {
            settingsSave.addEventListener("click", () => {
                const nextColors = {
                    ferie: normalizeHexColor(ferieInput?.value, DEFAULT_TYPE_COLORS.ferie),
                    permesso: normalizeHexColor(permessoInput?.value, DEFAULT_TYPE_COLORS.permesso),
                    straordinari: normalizeHexColor(straordinariInput?.value, DEFAULT_TYPE_COLORS.straordinari),
                };
                const selectedTheme = Array.from(themeInputs).find((input) => input.checked)?.value || "light";
                setTypeColors({ ...nextColors });
                saveColorSettings(getTypeColors());
                applyTypeColors();
                saveThemeSetting(selectedTheme);
                applyTheme(selectedTheme);
                renderAll(loadData());
                setMessage(settingsMessage, "");
                hideModal(settingsModal);
                settingsSnapshot = {
                    theme: selectedTheme,
                    colors: { ...nextColors },
                };
            });
        }

        themeInputs.forEach((input) => {
            input.addEventListener("change", () => {
                if (!input.checked) return;
                applyTheme(input.value);
            });
        });
        if (settingsReset) {
            settingsReset.addEventListener("click", () => {
                setTypeColors({ ...DEFAULT_TYPE_COLORS });
                saveColorSettings(getTypeColors());
                setSettingsInputsFromColors();
                applyTypeColors();
                renderAll(loadData());
                setMessage(settingsMessage, UI_TEXTS.colorsReset, false);
            });
        }

        const handleColorPreview = () => {
            const nextColors = {
                ferie: normalizeHexColor(ferieInput?.value, DEFAULT_TYPE_COLORS.ferie),
                permesso: normalizeHexColor(permessoInput?.value, DEFAULT_TYPE_COLORS.permesso),
                straordinari: normalizeHexColor(straordinariInput?.value, DEFAULT_TYPE_COLORS.straordinari),
            };
            setTypeColors({ ...nextColors });
            applyTypeColors();
            renderAll(loadData());
        };
        if (ferieInput) ferieInput.addEventListener("input", handleColorPreview);
        if (permessoInput) permessoInput.addEventListener("input", handleColorPreview);
        if (straordinariInput) straordinariInput.addEventListener("input", handleColorPreview);
    }

    return { openSettingsModal, closeSettingsModal, initSettingsModal };
}

module.exports = { createSettingsModal };
