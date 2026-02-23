require("../../../shared/dev-guards");

type RefreshOptions<T> = {
    loadData: () => T;
    renderAll: (data: T) => void;
    autoRefreshMs?: number;
};

function createRefreshController<T>(options: RefreshOptions<T>) {
    const { loadData, renderAll, autoRefreshMs } = options || ({} as RefreshOptions<T>);
    let refreshTimer: NodeJS.Timeout | null = null;

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

export { createRefreshController };

// Keep CommonJS compatibility for legacy JS callers
if (typeof module !== "undefined" && module.exports && !(globalThis as any).__aypiBundled) {
    if (typeof module !== "undefined" && module.exports && !(globalThis as any).__aypiBundled) module.exports = { createRefreshController };
}


