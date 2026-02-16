function initLogoutModal({ document, clearSession, syncSessionUI, closeLogoutModal }) {
    const logoutCancel = document.getElementById("pm-logout-cancel");
    const logoutConfirm = document.getElementById("pm-logout-confirm");
    if (logoutCancel) logoutCancel.addEventListener("click", () => closeLogoutModal());
    if (logoutConfirm) {
        logoutConfirm.addEventListener("click", () => {
            clearSession();
            syncSessionUI();
            closeLogoutModal();
        });
    }
}

function initGuideModal({ guideUi }) {
    if (guideUi?.initGuideModal) {
        guideUi.initGuideModal();
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

module.exports = { initLogoutModal, initGuideModal };
