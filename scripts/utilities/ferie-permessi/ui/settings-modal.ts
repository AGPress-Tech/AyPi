require("../../../shared/dev-guards");

type SettingsModalOptions = {
    document: Document;
    showModal: (el: HTMLElement | null) => void;
    hideModal: (el: HTMLElement | null) => void;
    setMessage: (el: HTMLElement | null, message: string, isError?: boolean) => void;
    loadThemeSetting: () => string;
    saveThemeSetting: (value: string) => void;
    saveColorSettings: (colors: Record<string, string>) => void;
    setSettingsInputsFromColors: () => void;
    applyTypeColors: () => void;
    applyTheme: (value: string) => void;
    renderAll: (data: any) => void;
    loadData: () => any;
    normalizeHexColor: (value: string) => string;
    DEFAULT_TYPE_COLORS: Record<string, string>;
    getTypeColors: () => Record<string, string>;
    setTypeColors: (colors: Record<string, string>) => void;
    openPasswordModal: (payload: any) => void;
    refreshLegacySyncButton?: () => void;
};

function createSettingsModal(options: SettingsModalOptions) {
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
    } = options || ({} as SettingsModalOptions);

    if (!document) {
        throw new Error("document richiesto.");
    }

    let themeSnapshot: string | null = null;

    function openSettingsModal() {
        const modal = document.getElementById("fp-settings-modal") as HTMLElement | null;
        const message = document.getElementById("fp-settings-message") as HTMLElement | null;
        if (!modal) return;
        setMessage(message, "");
        if (typeof options?.refreshLegacySyncButton === "function") {
            options.refreshLegacySyncButton();
        }
        showModal(modal);
    }

    function closeSettingsModal() {
        const modal = document.getElementById("fp-settings-modal") as HTMLElement | null;
        if (!modal) return;
        hideModal(modal);
    }

    function openThemeModal() {
        const modal = document.getElementById("fp-settings-theme-modal") as HTMLElement | null;
        const message = document.getElementById("fp-settings-theme-message") as HTMLElement | null;
        if (!modal) return;
        const themeValue = loadThemeSetting();
        themeSnapshot = themeValue;
        const themeInputs = document.querySelectorAll<HTMLInputElement>("input[name='fp-theme']");
        themeInputs.forEach((input) => {
            input.checked = input.value === themeValue;
        });
        setMessage(message, "");
        showModal(modal);
    }

    function closeThemeModal() {
        const modal = document.getElementById("fp-settings-theme-modal") as HTMLElement | null;
        if (!modal) return;
        if (themeSnapshot) {
            applyTheme(themeSnapshot);
        }
        hideModal(modal);
    }

    function initSettingsModal() {
        const settingsBtn = document.getElementById("fp-settings") as HTMLButtonElement | null;
        const settingsClose = document.getElementById("fp-settings-close") as HTMLButtonElement | null;
        const settingsModal = document.getElementById("fp-settings-modal") as HTMLElement | null;
        const themeOpen = document.getElementById("fp-settings-theme-open") as HTMLButtonElement | null;
        const themeClose = document.getElementById("fp-settings-theme-close") as HTMLButtonElement | null;
        const themeSave = document.getElementById("fp-settings-theme-save") as HTMLButtonElement | null;
        const themeReset = document.getElementById("fp-settings-theme-reset") as HTMLButtonElement | null;
        const themeModal = document.getElementById("fp-settings-theme-modal") as HTMLElement | null;
        const themeMessage = document.getElementById("fp-settings-theme-message") as HTMLElement | null;
        const themeInputs = document.querySelectorAll<HTMLInputElement>("input[name='fp-theme']");
        const configOpen = document.getElementById("fp-settings-config-open") as HTMLButtonElement | null;

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

export { createSettingsModal };

// Keep CommonJS compatibility for legacy JS callers
if (typeof module !== "undefined" && module.exports && !(globalThis as any).__aypiBundled) {
    if (typeof module !== "undefined" && module.exports && !(globalThis as any).__aypiBundled) module.exports = { createSettingsModal };
}


