function initAddModal({ document, closeAddModal, saveAddModal }) {
    const closeBtn = document.getElementById("pm-add-close");
    const cancelBtn = document.getElementById("pm-add-cancel");
    const saveBtn = document.getElementById("pm-add-save");
    if (closeBtn) closeBtn.addEventListener("click", () => closeAddModal());
    if (cancelBtn) cancelBtn.addEventListener("click", () => closeAddModal());
    if (saveBtn) saveBtn.addEventListener("click", () => saveAddModal());
}

function initConfirmModal({ document, closeConfirmModal }) {
    const cancelBtn = document.getElementById("pm-confirm-cancel");
    const okBtn = document.getElementById("pm-confirm-ok");
    const modal = document.getElementById("pm-confirm-modal");
    if (cancelBtn) cancelBtn.addEventListener("click", () => closeConfirmModal(false));
    if (okBtn) okBtn.addEventListener("click", () => closeConfirmModal(true));
    if (modal) {
        modal.addEventListener("click", (event) => {
            if (event.target === modal) closeConfirmModal(false);
        });
    }
}

function initAlertModal({ document, closeAlertModal }) {
    const okBtn = document.getElementById("pm-alert-ok");
    const modal = document.getElementById("pm-alert-modal");
    if (okBtn) okBtn.addEventListener("click", () => closeAlertModal());
    if (modal) {
        modal.addEventListener("click", (event) => {
            if (event.target === modal) closeAlertModal();
        });
    }
}

function initImageModal({ document, closeImageModal }) {
    const closeBtn = document.getElementById("pm-image-close");
    const modal = document.getElementById("pm-image-modal");
    if (closeBtn) closeBtn.addEventListener("click", () => closeImageModal());
    if (modal) {
        modal.addEventListener("click", (event) => {
            if (event.target === modal) closeImageModal();
        });
    }
}

module.exports = {
    initAddModal,
    initConfirmModal,
    initAlertModal,
    initImageModal,
};
