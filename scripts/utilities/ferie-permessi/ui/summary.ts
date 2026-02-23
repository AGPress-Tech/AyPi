require("../../../shared/dev-guards");

type SummaryOptions = {
    document: Document;
};

type RequestLike = {
    status?: string;
};

type SummaryData = {
    requests?: RequestLike[];
};

function createSummary(options: SummaryOptions) {
    const { document } = options || ({} as SummaryOptions);

    if (!document) {
        throw new Error("document richiesto.");
    }

    function updatePendingBadge(count: number) {
        const badge = document.getElementById("fp-pending-badge");
        if (!badge) return;
        badge.textContent = String(count);
        if (count > 0) {
            badge.classList.remove("is-hidden");
        } else {
            badge.classList.add("is-hidden");
        }
    }

    function renderSummary(data: SummaryData) {
        const summaryEl = document.getElementById("fp-summary");
        if (!summaryEl) return;
        const requests = data.requests || [];
        const pending = requests.filter((req) => req.status === "pending").length;
        const approved = requests.filter((req) => req.status === "approved").length;
        summaryEl.textContent = `In attesa: ${pending} | Approvate: ${approved}`;
        updatePendingBadge(pending);
    }

    return { renderSummary, updatePendingBadge };
}

export { createSummary };

// Keep CommonJS compatibility for legacy JS callers
if (typeof module !== "undefined" && module.exports && !(globalThis as any).__aypiBundled) {
    if (typeof module !== "undefined" && module.exports && !(globalThis as any).__aypiBundled) module.exports = { createSummary };
}


