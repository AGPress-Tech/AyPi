function createRefreshController(options) {
    const { loadData, renderAll, autoRefreshMs } = options || {};
    let refreshTimer = null;

    function refreshData() {
        const data = loadData();
        renderAll(data);
    }

    function scheduleAutoRefresh() {
        if (refreshTimer) clearInterval(refreshTimer);
        if (!autoRefreshMs) return;
        refreshTimer = setInterval(refreshData, autoRefreshMs);
    }

    function clearAutoRefresh() {
        if (refreshTimer) clearInterval(refreshTimer);
        refreshTimer = null;
    }

    return { refreshData, scheduleAutoRefresh, clearAutoRefresh };
}

module.exports = { createRefreshController };
