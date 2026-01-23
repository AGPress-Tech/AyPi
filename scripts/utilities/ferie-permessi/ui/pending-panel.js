const { getTypeLabel } = require("../utils/labels");
const { UI_TEXTS } = require("../utils/ui-texts");

function createPendingPanel(options) {
    const {
        document,
        createRangeLine,
        syncData,
        renderAll,
        openPasswordModal,
        getPendingUnlocked,
        getPendingUnlockedBy,
        getPendingPanelOpen,
        setPendingPanelOpen,
        updatePendingBadge,
        applyBalanceForApproval,
        showDialog,
        getBalanceImpact,
        loadData,
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
            approveBtn.addEventListener("click", () => {
                if (getPendingUnlocked()) {
                    if (typeof getBalanceImpact === "function" && typeof showDialog === "function") {
                        const impact = getBalanceImpact(loadData(), request);
                        if (impact && impact.negative) {
                            showDialog(
                                "warning",
                                "Ore sotto zero.",
                                `Il dipendente ha ${impact.hoursBefore} ore disponibili. ` +
                                    `La richiesta ne consuma ${impact.hoursDelta} e porterebbe il saldo a ${impact.hoursAfter}. ` +
                                    "Vuoi procedere comunque?",
                                ["Procedi", "Annulla"]
                            ).then((response) => {
                                if (!response || response.response !== 0) {
                                    return;
                                }
                                const updated = syncData((payload) => {
                                    const target = (payload.requests || []).find((req) => req.id === request.id);
                                    if (target) {
                                        target.status = "approved";
                                        target.approvedAt = new Date().toISOString();
                                        target.approvedBy =
                                            getPendingUnlockedBy() || target.approvedBy || UI_TEXTS.defaultAdminLabel;
                                        if (typeof applyBalanceForApproval === "function") {
                                            applyBalanceForApproval(payload, target);
                                        }
                                    }
                                    return payload;
                                });
                                renderAll(updated);
                            });
                            return;
                        }
                    }
                    const updated = syncData((payload) => {
                        const target = (payload.requests || []).find((req) => req.id === request.id);
                        if (target) {
                            target.status = "approved";
                            target.approvedAt = new Date().toISOString();
                            target.approvedBy =
                                getPendingUnlockedBy() || target.approvedBy || UI_TEXTS.defaultAdminLabel;
                            if (typeof applyBalanceForApproval === "function") {
                                applyBalanceForApproval(payload, target);
                            }
                        }
                        return payload;
                    });
                    renderAll(updated);
                    return;
                }
                openPasswordModal({
                    type: "approve",
                    id: request.id,
                    title: "Approva richiesta",
                    description: UI_TEXTS.pendingApprovePasswordDescription,
                });
            });

            const rejectBtn = document.createElement("button");
            rejectBtn.type = "button";
            rejectBtn.className = "fp-btn";
            rejectBtn.textContent = "Rifiuta";
            rejectBtn.addEventListener("click", () => {
                if (getPendingUnlocked()) {
                    const updated = syncData((payload) => {
                        payload.requests = (payload.requests || []).filter((req) => req.id !== request.id);
                        return payload;
                    });
                    renderAll(updated);
                    return;
                }
                openPasswordModal({
                    type: "reject",
                    id: request.id,
                    title: "Rifiuta richiesta",
                    description: UI_TEXTS.pendingRejectPasswordDescription,
                });
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
                if (getPendingPanelOpen()) {
                    closePendingPanel();
                    return;
                }
                if (getPendingUnlocked()) {
                    openPendingPanel();
                    return;
                }
                openPasswordModal({
                    type: "pending-access",
                    id: "pending-access",
                    title: "Richieste in attesa",
                    description: UI_TEXTS.pendingAccessPasswordDescription,
                });
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
