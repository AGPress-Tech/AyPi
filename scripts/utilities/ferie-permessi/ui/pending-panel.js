const { getTypeLabel } = require("../utils/labels");
const { UI_TEXTS } = require("../utils/ui-texts");

function createPendingPanel(options) {
    const {
        document,
        createRangeLine,
        syncData,
        renderAll,
        getPendingUnlockedBy,
        getPendingPanelOpen,
        setPendingPanelOpen,
        updatePendingBadge,
        applyBalanceForApproval,
        getBalanceImpact,
        loadData,
        confirmNegativeBalance,
        getLoggedAdminName,
        onAccessDenied,
        requireAdminAccess,
        requireAccess,
        isAdminRequiredForPendingAccess,
        isAdminRequiredForPendingApprove,
        isAdminRequiredForPendingReject,
    } = options || {};

    if (!document) {
        throw new Error("document richiesto.");
    }

    function renderPendingList(data) {
        const listEl = document.getElementById("fp-pending-list");
        if (!listEl) return;
        listEl.innerHTML = "";
        const pending = (data.requests || []).filter((req) => req.status === "pending");
        if (pending.length === 0) {
            const empty = document.createElement("p");
            empty.textContent = UI_TEXTS.pendingEmpty;
            empty.className = "fp-message";
            listEl.appendChild(empty);
            return;
        }
        pending.forEach((request) => {
            const card = document.createElement("div");
            card.className = "fp-pending-item";

            const title = document.createElement("h3");
            const deptLabel = request.department ? ` - ${request.department}` : "";
            title.textContent = `${request.employee || "Dipendente"}${deptLabel}`;
            card.appendChild(title);

            const meta = document.createElement("p");
            meta.textContent = getTypeLabel(request.type);
            card.appendChild(meta);

            card.appendChild(createRangeLine(document, request));

            if (request.note) {
                const note = document.createElement("p");
                note.textContent = request.note;
                card.appendChild(note);
            }

            const actions = document.createElement("div");
            actions.className = "fp-pending-actions";

            const approveBtn = document.createElement("button");
            approveBtn.type = "button";
            approveBtn.className = "fp-btn fp-btn--primary";
            approveBtn.textContent = "Approva";
            approveBtn.addEventListener("click", async () => {
                const needsAdmin = typeof isAdminRequiredForPendingApprove === "function"
                    ? !!isAdminRequiredForPendingApprove()
                    : true;
                const run = async () => {
                    if (typeof getBalanceImpact === "function" && typeof confirmNegativeBalance === "function") {
                        const impact = getBalanceImpact(loadData(), request);
                        const ok = await confirmNegativeBalance(impact);
                        if (!ok) {
                            return;
                        }
                    }
                    const updated = syncData((payload) => {
                        const target = (payload.requests || []).find((req) => req.id === request.id);
                        if (target) {
                            target.status = "approved";
                            target.approvedAt = new Date().toISOString();
                            target.approvedBy =
                                getLoggedAdminName?.() ||
                                getPendingUnlockedBy?.() ||
                                target.approvedBy ||
                                "";
                            if (typeof applyBalanceForApproval === "function") {
                                applyBalanceForApproval(payload, target);
                            }
                        }
                        return payload;
                    });
                    renderAll(updated);
                };
                if (needsAdmin && typeof requireAccess === "function") {
                    requireAccess(true, run);
                    return;
                } else if (needsAdmin && typeof requireAdminAccess === "function") {
                    requireAdminAccess(run);
                    return;
                } else if (needsAdmin) {
                    onAccessDenied?.();
                    return;
                }
                run();
            });

            const rejectBtn = document.createElement("button");
            rejectBtn.type = "button";
            rejectBtn.className = "fp-btn";
            rejectBtn.textContent = "Rifiuta";
            rejectBtn.addEventListener("click", () => {
                const needsAdmin = typeof isAdminRequiredForPendingReject === "function"
                    ? !!isAdminRequiredForPendingReject()
                    : true;
                const run = () => {
                    const updated = syncData((payload) => {
                        payload.requests = (payload.requests || []).filter((req) => req.id !== request.id);
                        return payload;
                    });
                    renderAll(updated);
                };
                if (needsAdmin && typeof requireAccess === "function") {
                    requireAccess(true, run);
                    return;
                } else if (needsAdmin && typeof requireAdminAccess === "function") {
                    requireAdminAccess(run);
                    return;
                } else if (needsAdmin) {
                    onAccessDenied?.();
                    return;
                }
                run();
            });

            actions.appendChild(rejectBtn);
            actions.appendChild(approveBtn);
            card.appendChild(actions);
            listEl.appendChild(card);
        });
    }

    function openPendingPanel() {
        const panel = document.getElementById("fp-pending-panel");
        const toggle = document.getElementById("fp-pending-toggle");
        if (!panel || !toggle) return;
        panel.classList.add("is-open");
        panel.setAttribute("aria-hidden", "false");
        toggle.setAttribute("aria-expanded", "true");
        setPendingPanelOpen(true);
    }

    function closePendingPanel() {
        const panel = document.getElementById("fp-pending-panel");
        const toggle = document.getElementById("fp-pending-toggle");
        if (!panel || !toggle) return;
        panel.classList.remove("is-open");
        panel.setAttribute("aria-hidden", "true");
        toggle.setAttribute("aria-expanded", "false");
        setPendingPanelOpen(false);
    }

    function initPendingPanel() {
        const pendingToggle = document.getElementById("fp-pending-toggle");
        const pendingClose = document.getElementById("fp-pending-close");
        if (pendingToggle) {
            pendingToggle.addEventListener("click", () => {
                const needsAdmin = typeof isAdminRequiredForPendingAccess === "function"
                    ? !!isAdminRequiredForPendingAccess()
                    : true;
                const run = () => {
                    if (getPendingPanelOpen()) {
                        closePendingPanel();
                        return;
                    }
                    openPendingPanel();
                };
                if (needsAdmin && typeof requireAccess === "function") {
                    requireAccess(true, run);
                    return;
                } else if (needsAdmin && typeof requireAdminAccess === "function") {
                    requireAdminAccess(run);
                    return;
                } else if (needsAdmin) {
                    onAccessDenied?.();
                    return;
                }
                run();
            });
        }
        if (pendingClose) {
            pendingClose.addEventListener("click", () => {
                closePendingPanel();
            });
        }
    }

    return {
        renderPendingList,
        openPendingPanel,
        closePendingPanel,
        initPendingPanel,
    };
}

module.exports = { createPendingPanel };
