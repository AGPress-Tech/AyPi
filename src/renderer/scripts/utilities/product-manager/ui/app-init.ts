// @ts-nocheck
require("../../../shared/dev-guards");
function initLogoutModal({ document, clearSession, syncSessionUI, closeLogoutModal }) {
    const logoutCancel = document.getElementById("pm-logout-cancel");
    const logoutConfirm = document.getElementById("pm-logout-confirm");
    const logoutModal = document.getElementById("pm-logout-modal");
    if (logoutCancel) logoutCancel.addEventListener("click", () => closeLogoutModal());
    if (logoutConfirm) {
        logoutConfirm.addEventListener("click", () => {
            clearSession();
            syncSessionUI();
            closeLogoutModal();
        });
    }
    if (logoutModal) {
        logoutModal.addEventListener("keydown", (event) => {
            if (event.key !== "Enter") return;
            if (logoutModal.classList.contains("is-hidden")) return;
            event.preventDefault();
            if (logoutConfirm) {
                logoutConfirm.click();
            }
        });
    }
}

function initGuideModal({ document, guideUi }) {
    if (guideUi?.initGuideModal) {
        guideUi.initGuideModal();
    }
    const guideNews = document.getElementById("pm-guide-news");
    if (guideNews) {
        guideNews.addEventListener("click", () => {
            if (guideUi?.openGuideModalAtPath) {
                guideUi.openGuideModalAtPath("novita.html");
            } else if (guideUi?.openGuideModalWithQuery) {
                guideUi.openGuideModalWithQuery("Novita");
            } else if (guideUi?.openGuideModal) {
                guideUi.openGuideModal();
            }
        });
    }
    window.addEventListener("keydown", (event) => {
        if (event.key === "F1") {
            event.preventDefault();
            if (guideUi?.openGuideModalAtPath) {
                guideUi.openGuideModalAtPath("introduzione.html");
            } else if (guideUi?.openGuideModal) {
                guideUi.openGuideModal();
            }
        }
    });
}

if (typeof module !== "undefined" && module.exports && !(globalThis as any).__aypiBundled) module.exports = { initLogoutModal, initGuideModal };

