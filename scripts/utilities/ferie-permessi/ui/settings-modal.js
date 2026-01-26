const { UI_TEXTS } = require("../utils/ui-texts");

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
    } = options || {};

    if (!document) {
        throw new Error("document richiesto.");
    }

    let colorsSnapshot = null;
    let themeSnapshot = null;

    function openSettingsModal() {
        const modal = document.getElementById("fp-settings-modal");
        const message = document.getElementById("fp-settings-message");
        if (!modal) return;
        setMessage(message, "");
        showModal(modal);
    }

    function closeSettingsModal() {
        const modal = document.getElementById("fp-settings-modal");
        if (!modal) return;
        hideModal(modal);
    }

    function openColorsModal() {
        const modal = document.getElementById("fp-settings-colors-modal");
        const message = document.getElementById("fp-settings-colors-message");
        if (!modal) return;
        colorsSnapshot = { ...getTypeColors() };
        setSettingsInputsFromColors();
        setMessage(message, "");
        showModal(modal);
    }

    function closeColorsModal() {
        const modal = document.getElementById("fp-settings-colors-modal");
        if (!modal) return;
        if (colorsSnapshot) {
            setTypeColors({ ...colorsSnapshot });
            applyTypeColors();
            renderAll(loadData());
        }
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
        const colorsOpen = document.getElementById("fp-settings-colors-open");
        const colorsClose = document.getElementById("fp-settings-colors-close");
        const colorsSave = document.getElementById("fp-settings-colors-save");
        const colorsReset = document.getElementById("fp-settings-colors-reset");
        const colorsModal = document.getElementById("fp-settings-colors-modal");
        const colorsMessage = document.getElementById("fp-settings-colors-message");
        const themeOpen = document.getElementById("fp-settings-theme-open");
        const themeClose = document.getElementById("fp-settings-theme-close");
        const themeSave = document.getElementById("fp-settings-theme-save");
        const themeReset = document.getElementById("fp-settings-theme-reset");
        const themeModal = document.getElementById("fp-settings-theme-modal");
        const themeMessage = document.getElementById("fp-settings-theme-message");
        const ferieInput = document.getElementById("fp-color-ferie");
        const permessoInput = document.getElementById("fp-color-permesso");
        const straordinariInput = document.getElementById("fp-color-straordinari");
        const mutuaInput = document.getElementById("fp-color-mutua");
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
                if (event.target === settingsModal) {
                    // no-op: keep modal open on backdrop click
                }
            });
        }

        if (colorsOpen) {
            colorsOpen.addEventListener("click", () => {
                openColorsModal();
            });
        }
        if (colorsClose) {
            colorsClose.addEventListener("click", () => {
                closeColorsModal();
            });
        }
        if (colorsModal) {
            colorsModal.addEventListener("click", (event) => {
                if (event.target === colorsModal) {
                    // no-op: keep modal open on backdrop click
                }
            });
        }
        if (colorsSave) {
            colorsSave.addEventListener("click", () => {
                const nextColors = {
                    ferie: normalizeHexColor(ferieInput?.value, DEFAULT_TYPE_COLORS.ferie),
                    permesso: normalizeHexColor(permessoInput?.value, DEFAULT_TYPE_COLORS.permesso),
                    straordinari: normalizeHexColor(straordinariInput?.value, DEFAULT_TYPE_COLORS.straordinari),
                    mutua: normalizeHexColor(mutuaInput?.value, DEFAULT_TYPE_COLORS.mutua),
                };
                setTypeColors({ ...nextColors });
                saveColorSettings(getTypeColors());
                applyTypeColors();
                renderAll(loadData());
                setMessage(colorsMessage, "");
                colorsSnapshot = { ...nextColors };
                hideModal(colorsModal);
            });
        }
        if (colorsReset) {
            colorsReset.addEventListener("click", () => {
                setTypeColors({ ...DEFAULT_TYPE_COLORS });
                setSettingsInputsFromColors();
                applyTypeColors();
                renderAll(loadData());
                setMessage(colorsMessage, UI_TEXTS.colorsReset, false);
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

        const handleColorPreview = () => {
            const nextColors = {
                ferie: normalizeHexColor(ferieInput?.value, DEFAULT_TYPE_COLORS.ferie),
                permesso: normalizeHexColor(permessoInput?.value, DEFAULT_TYPE_COLORS.permesso),
                straordinari: normalizeHexColor(straordinariInput?.value, DEFAULT_TYPE_COLORS.straordinari),
                mutua: normalizeHexColor(mutuaInput?.value, DEFAULT_TYPE_COLORS.mutua),
            };
            setTypeColors({ ...nextColors });
            applyTypeColors();
            renderAll(loadData());
        };
        if (ferieInput) ferieInput.addEventListener("input", handleColorPreview);
        if (permessoInput) permessoInput.addEventListener("input", handleColorPreview);
        if (straordinariInput) straordinariInput.addEventListener("input", handleColorPreview);
        if (mutuaInput) mutuaInput.addEventListener("input", handleColorPreview);
    }

    return { openSettingsModal, closeSettingsModal, initSettingsModal };
}

module.exports = { createSettingsModal };
