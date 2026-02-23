// @ts-nocheck
require("../../../shared/dev-guards");
const uiState = {
    pendingConfirmResolve: null,
    pendingAddRow: null,
    interventionEditingRow: null,
    catalogRemoveImage: false,
    categoryEditingName: null,
    categoryColorSnapshot: null,
    categoryPreviewTimer: null,
};

if (typeof module !== "undefined" && module.exports && !(globalThis as any).__aypiBundled) module.exports = { uiState };

