function createSummary(options) {
    const { document } = options || {};

    if (!document) {
        throw new Error("document richiesto.");
    }

    function updatePendingBadge(count) {
        const badge = document.getElementById("fp-pending-badge");
        if (!badge) return;
        badge.textContent = String(count);
        if (count > 0) {
            badge.classList.remove("is-hidden");
        } else {
            badge.classList.add("is-hidden");
        }
    }

    function renderSummary(data) {
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

module.exports = { createSummary };
