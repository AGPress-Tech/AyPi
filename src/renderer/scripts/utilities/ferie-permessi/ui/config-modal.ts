require("../../../shared/dev-guards");
import { DEFAULT_ACCESS_CONFIG } from "../services/access-config";

type AccessConfig = typeof DEFAULT_ACCESS_CONFIG;

type ConfigModalOptions = {
    document: Document;
    showModal: (el: HTMLElement | null) => void;
    hideModal: (el: HTMLElement | null) => void;
    setMessage?: (el: HTMLElement | null, message: string, isError?: boolean) => void;
    loadAccessConfig?: () => AccessConfig;
    saveAccessConfig?: (config: AccessConfig) => void;
    normalizeAccessConfig?: (config: AccessConfig) => AccessConfig;
    onConfigUpdated?: (config: AccessConfig) => void;
};

function createConfigModal(options: ConfigModalOptions) {
    const {
        document,
        showModal,
        hideModal,
        setMessage,
        loadAccessConfig,
        saveAccessConfig,
        normalizeAccessConfig,
        onConfigUpdated,
    } = options || ({} as ConfigModalOptions);

    if (!document) {
        throw new Error("document richiesto.");
    }

    const FIELD_MAP = {
        "fp-config-create-ferie": ["create", "ferie"],
        "fp-config-create-permesso": ["create", "permesso"],
        "fp-config-create-straordinari": ["create", "straordinari"],
        "fp-config-create-mutua": ["create", "mutua"],
        "fp-config-create-speciale": ["create", "speciale"],
        "fp-config-create-retribuito": ["create", "retribuito"],
        "fp-config-pending-access": ["pending", "access"],
        "fp-config-pending-approve": ["pending", "approve"],
        "fp-config-pending-reject": ["pending", "reject"],
        "fp-config-edit-approved": ["editApproved"],
        "fp-config-delete-approved": ["deleteApproved"],
        "fp-config-filter-ferie": ["filters", "ferie"],
        "fp-config-filter-permesso": ["filters", "permesso"],
        "fp-config-filter-straordinari": ["filters", "straordinari"],
        "fp-config-filter-mutua": ["filters", "mutua"],
        "fp-config-filter-speciale": ["filters", "speciale"],
        "fp-config-filter-retribuito": ["filters", "retribuito"],
        "fp-config-manage-access": ["manageAccess"],
        "fp-config-days-access": ["daysAccess"],
        "fp-config-export": ["export"],
    };

    function getConfigValue(config: AccessConfig, path: string[]) {
        if (!config || !config.operations) return false;
        if (path.length === 1) {
            return !!config.operations[path[0]];
        }
        const parent = config.operations[path[0]] || {};
        return !!parent[path[1]];
    }

    function setConfigValue(config: AccessConfig, path: string[], value: boolean) {
        if (!config || !config.operations) return;
        if (path.length === 1) {
            config.operations[path[0]] = !!value;
            return;
        }
        if (
            !config.operations[path[0]] ||
            typeof config.operations[path[0]] !== "object"
        ) {
            config.operations[path[0]] = {};
        }
        config.operations[path[0]][path[1]] = !!value;
    }

    function readConfigFromUI(config: AccessConfig) {
        Object.entries(FIELD_MAP).forEach(([id, path]) => {
            const el = document.getElementById(id) as HTMLInputElement | null;
            if (!el) return;
            setConfigValue(config, path, !!el.checked);
        });
        return config;
    }

    function applyConfigToUI(config: AccessConfig) {
        Object.entries(FIELD_MAP).forEach(([id, path]) => {
            const el = document.getElementById(id) as HTMLInputElement | null;
            if (!el) return;
            el.checked = getConfigValue(config, path);
        });
    }

    function openConfigModal() {
        const modal = document.getElementById("fp-config-modal") as HTMLElement | null;
        const message = document.getElementById("fp-config-message") as HTMLElement | null;
        if (!modal) return;
        const current =
            typeof loadAccessConfig === "function"
                ? loadAccessConfig()
                : DEFAULT_ACCESS_CONFIG;
        const normalized =
            typeof normalizeAccessConfig === "function"
                ? normalizeAccessConfig(current)
                : current;
        applyConfigToUI(normalized);
        setMessage?.(message, "");
        showModal(modal);
    }

    function closeConfigModal() {
        const modal = document.getElementById("fp-config-modal") as HTMLElement | null;
        if (!modal) return;
        hideModal(modal);
    }

    function initConfigModal() {
        const closeBtn = document.getElementById("fp-config-close") as HTMLButtonElement | null;
        const saveBtn = document.getElementById("fp-config-save") as HTMLButtonElement | null;
        const resetBtn = document.getElementById("fp-config-reset") as HTMLButtonElement | null;
        const modal = document.getElementById("fp-config-modal") as HTMLElement | null;
        const message = document.getElementById("fp-config-message") as HTMLElement | null;

        if (closeBtn) {
            closeBtn.addEventListener("click", () => {
                closeConfigModal();
            });
        }
        if (modal) {
            modal.addEventListener("click", (event) => {
                event.stopPropagation();
            });
        }
        if (saveBtn) {
            saveBtn.addEventListener("click", () => {
                const base =
                    typeof loadAccessConfig === "function"
                        ? loadAccessConfig()
                        : DEFAULT_ACCESS_CONFIG;
                const config = readConfigFromUI(
                    JSON.parse(JSON.stringify(base)),
                );
                const normalized =
                    typeof normalizeAccessConfig === "function"
                        ? normalizeAccessConfig(config)
                        : config;
                if (typeof saveAccessConfig === "function") {
                    saveAccessConfig(normalized);
                }
                if (typeof onConfigUpdated === "function") {
                    onConfigUpdated(normalized);
                }
                setMessage?.(message, "Configurazione salvata.", false);
            });
        }
        if (resetBtn) {
            resetBtn.addEventListener("click", () => {
                const normalized =
                    typeof normalizeAccessConfig === "function"
                        ? normalizeAccessConfig(DEFAULT_ACCESS_CONFIG)
                        : DEFAULT_ACCESS_CONFIG;
                applyConfigToUI(normalized);
                setMessage?.(
                    message,
                    "Ripristinati i valori di default.",
                    false,
                );
            });
        }
    }

    return { openConfigModal, closeConfigModal, initConfigModal };
}

export { createConfigModal };

// Keep CommonJS compatibility for legacy JS callers
if (typeof module !== "undefined" && module.exports && !(globalThis as any).__aypiBundled) {
    if (typeof module !== "undefined" && module.exports && !(globalThis as any).__aypiBundled) module.exports = { createConfigModal };
}


