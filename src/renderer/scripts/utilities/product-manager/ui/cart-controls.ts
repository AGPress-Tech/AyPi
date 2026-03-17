// @ts-nocheck
require("../../../shared/dev-guards");
function initCartFilters({
    document,
    cartState,
    renderCartTable,
    isAdmin,
    showWarning,
    openConfirmModal,
    getActiveMode,
    readRequestsFile,
    saveRequestsFile,
}) {
    const searchInput = document.getElementById("pm-cart-search");
    const sortSelect = document.getElementById("pm-cart-sort");
    if (searchInput) {
        searchInput.addEventListener("input", (event) => {
            cartState.search = event.target.value || "";
            renderCartTable();
        });
    }
    if (sortSelect) {
        sortSelect.addEventListener("change", (event) => {
            cartState.sort = event.target.value || "created_desc";
            renderCartTable();
        });
    }
}

if (typeof module !== "undefined" && module.exports && !(globalThis as any).__aypiBundled) module.exports = { initCartFilters };

