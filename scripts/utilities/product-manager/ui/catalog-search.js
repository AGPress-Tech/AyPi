function syncCatalogControls({ document, isInterventionMode, catalogSearch, catalogSort }) {
    if (isInterventionMode()) return;
    const search = document.getElementById("pm-catalog-search");
    const sort = document.getElementById("pm-catalog-sort");
    if (search) search.value = catalogSearch || "";
    if (sort) sort.value = catalogSort || "name_asc";
}

function initCatalogFilters({
    document,
    isInterventionMode,
    renderCatalog,
    getCatalogFilterTag,
    setCatalogFilterTag,
    getCatalogSearch,
    setCatalogSearch,
    getCatalogSort,
    setCatalogSort,
}) {
    const filter = document.getElementById("pm-catalog-filter");
    const search = document.getElementById("pm-catalog-search");
    const sort = document.getElementById("pm-catalog-sort");
    if (search) {
        search.addEventListener("input", (event) => {
            setCatalogSearch(event.target.value || "");
            renderCatalog();
        });
    }
    if (sort) {
        sort.addEventListener("change", (event) => {
            setCatalogSort(event.target.value || "name_asc");
            renderCatalog();
        });
    }
    syncCatalogControls({
        document,
        isInterventionMode,
        catalogSearch: getCatalogSearch(),
        catalogSort: getCatalogSort(),
    });
}

module.exports = {
    syncCatalogControls,
    initCatalogFilters,
};
