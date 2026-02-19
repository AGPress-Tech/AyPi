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
    const debugClean = document.getElementById("pm-debug-clean");
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
    if (debugClean) {
        debugClean.addEventListener("click", async () => {
            if (!isAdmin()) {
                showWarning("Solo gli admin possono usare la pulizia debug.");
                return;
            }
            const ok = await openConfirmModal(
                "Vuoi rimuovere dal JSON tutti gli elementi eliminati o convalidati?"
            );
            if (!ok) return;
            const mode = getActiveMode();
            const requests = readRequestsFile(mode);
            const cleaned = [];
            requests.forEach((req) => {
                const lines = (req.lines || []).filter((line) => !line.deletedAt && !line.confirmedAt);
                if (lines.length) {
                    req.lines = lines;
                    cleaned.push(req);
                }
            });
            if (saveRequestsFile(cleaned, mode)) {
                renderCartTable();
            }
        });
    }
}

module.exports = { initCartFilters };
