const { UI_TEXTS } = require("../utils/ui-texts");

function createAdminModals(options) {
    const {
        document,
        showModal,
        hideModal,
        setAdminMessage,
        openConfirmModal,
        escapeHtml,
        openPasswordModal,
        openOtpModal,
        loadAdminCredentials,
        saveAdminCredentials,
        verifyAdminPassword,
        hashPassword,
        isHashingAvailable,
        isValidEmail,
        isValidPhone,
        showDialog,
        getAdminCache,
        setAdminCache,
        getAdminEditingIndex,
        setAdminEditingIndex,
        isInitialSetupActive,
        onInitialSetupComplete,
    } = options || {};

    if (!document) {
        throw new Error("document richiesto.");
    }

    function renderAdminList() {
        const list = document.getElementById("fp-admin-list");
        if (!list) return;
        list.innerHTML = "";
        const adminCache = getAdminCache();
        if (!adminCache.length) {
            const empty = document.createElement("div");
            empty.className = "fp-message";
            empty.textContent = UI_TEXTS.adminNone;
            list.appendChild(empty);
            return;
        }
        adminCache.forEach((admin, index) => {
            const row = document.createElement("div");
            row.className = "fp-admin-row";

            const name = document.createElement("div");
            name.textContent = admin.name;
            row.appendChild(name);

            const actions = document.createElement("div");
            actions.className = "fp-assignees-row__actions";

            const edit = document.createElement("button");
            edit.type = "button";
            edit.className = "fp-btn";
            edit.textContent = "Modifica";
            edit.addEventListener("click", () => {
                setAdminEditingIndex(index);
                const nameInput = document.getElementById("fp-admin-edit-name");
                if (nameInput) nameInput.value = admin.name;
                const emailInput = document.getElementById("fp-admin-edit-email");
                if (emailInput) emailInput.value = admin.email || "";
                const phoneInput = document.getElementById("fp-admin-edit-phone");
                if (phoneInput) phoneInput.value = admin.phone || "";
                const editModal = document.getElementById("fp-admin-edit-modal");
                const passwordPanel = document.getElementById("fp-admin-password-panel");
                if (passwordPanel) passwordPanel.classList.add("is-hidden");
                setAdminMessage("fp-admin-edit-message", "");
                if (editModal) showModal(editModal);
            });

            const remove = document.createElement("button");
            remove.type = "button";
            remove.className = "fp-btn fp-btn--danger";
            remove.textContent = "Rimuovi";
            remove.addEventListener("click", async () => {
                if (adminCache.length <= 1) {
                    setAdminMessage("fp-admin-message", UI_TEXTS.adminMinRequired, true);
                    return;
                }
                const confirmed = await openConfirmModal(UI_TEXTS.adminDeleteConfirm(escapeHtml(admin.name)));
                if (!confirmed) return;
                openPasswordModal({
                    type: "admin-delete",
                    id: admin.name,
                    adminName: admin.name,
                    title: "Elimina admin",
                    description: UI_TEXTS.adminDeletePasswordDescription(admin.name),
                });
            });

            actions.appendChild(edit);
            actions.appendChild(remove);
            row.appendChild(actions);
            list.appendChild(row);
        });
    }

    function openAdminModal() {
        const modal = document.getElementById("fp-admin-modal");
        if (!modal) return;
        const nextCache = loadAdminCredentials().sort((a, b) => a.name.localeCompare(b.name));
        setAdminCache(nextCache);
        renderAdminList();
        setAdminMessage("fp-admin-message", "");
        setAdminEditingIndex(-1);
        showModal(modal);
    }

    function closeAdminModal() {
        const modal = document.getElementById("fp-admin-modal");
        if (!modal) return;
        hideModal(modal);
        setAdminEditingIndex(-1);
    }

    function initAdminModals() {
        const adminOpen = document.getElementById("fp-admin-open");
        const adminModal = document.getElementById("fp-admin-modal");
        const adminClose = document.getElementById("fp-admin-close");
        const adminAddOpen = document.getElementById("fp-admin-add-open");
        const adminAddModal = document.getElementById("fp-admin-add-modal");
        const adminAddClose = document.getElementById("fp-admin-add-close");
        const adminAddCancel = document.getElementById("fp-admin-add-cancel");
        const adminAdd = document.getElementById("fp-admin-add");
        const adminEditModal = document.getElementById("fp-admin-edit-modal");
        const adminEditSave = document.getElementById("fp-admin-edit-save");
        const adminEditClose = document.getElementById("fp-admin-edit-close");
        const adminEditCancel = document.getElementById("fp-admin-edit-cancel");
        const adminPasswordPanel = document.getElementById("fp-admin-password-panel");
        const adminPasswordOpen = document.getElementById("fp-admin-password-open");
        const adminCurrentInput = document.getElementById("fp-admin-current");
        const adminNewInput = document.getElementById("fp-admin-new");
        const adminNewConfirmInput = document.getElementById("fp-admin-new-confirm");
        const adminChange = document.getElementById("fp-admin-change");
        const adminForgot = document.getElementById("fp-admin-forgot");
        const adminEditName = document.getElementById("fp-admin-edit-name");
        const adminEditEmail = document.getElementById("fp-admin-edit-email");
        const adminEditPhone = document.getElementById("fp-admin-edit-phone");
        const adminNameInput = document.getElementById("fp-admin-name");
        const adminEmailInput = document.getElementById("fp-admin-email");
        const adminPhoneInput = document.getElementById("fp-admin-phone");
        const adminPasswordInput = document.getElementById("fp-admin-password");
        const adminPasswordConfirmInput = document.getElementById("fp-admin-password-confirm");

        if (adminOpen) {
            adminOpen.addEventListener("click", () => {
                openPasswordModal({
                    type: "admin-access",
                    id: "admin-access",
                    title: "Gestione admin",
                    description: UI_TEXTS.adminAccessDescription,
                });
            });
        }
        if (adminClose) {
            adminClose.addEventListener("click", closeAdminModal);
        }
        if (adminModal) {
            adminModal.addEventListener("click", (event) => {
                event.stopPropagation();
            });
        }
        if (adminAddModal) {
            adminAddModal.addEventListener("click", (event) => {
                event.stopPropagation();
            });
        }
        if (adminEditModal) {
            adminEditModal.addEventListener("click", (event) => {
                event.stopPropagation();
            });
        }
        if (adminEditSave) {
            adminEditSave.addEventListener("click", () => {
                const name = adminEditName ? adminEditName.value.trim() : "";
                if (!name) {
                    setAdminMessage("fp-admin-edit-message", UI_TEXTS.adminNameRequired, true);
                    return;
                }
                const adminEditingIndex = getAdminEditingIndex();
                const adminCache = getAdminCache();
                if (adminEditingIndex < 0 || adminEditingIndex >= adminCache.length) {
                    setAdminMessage("fp-admin-edit-message", UI_TEXTS.adminSelectionRequired, true);
                    return;
                }
                const emailValue = adminEditEmail ? adminEditEmail.value.trim() : "";
                const phoneValue = adminEditPhone ? adminEditPhone.value.trim() : "";
                if (emailValue && !isValidEmail(emailValue)) {
                    setAdminMessage("fp-admin-edit-message", UI_TEXTS.invalidEmail, true);
                    return;
                }
                if (phoneValue && !isValidPhone(phoneValue)) {
                    setAdminMessage("fp-admin-edit-message", UI_TEXTS.invalidPhone, true);
                    return;
                }
                const exists = adminCache.some(
                    (admin, idx) => idx !== adminEditingIndex && admin.name.toLowerCase() === name.toLowerCase()
                );
                if (exists) {
                    setAdminMessage("fp-admin-edit-message", UI_TEXTS.adminAlreadyExists, true);
                    return;
                }
                adminCache[adminEditingIndex].name = name;
                adminCache[adminEditingIndex].email = emailValue;
                adminCache[adminEditingIndex].phone = phoneValue;
                adminCache.sort((a, b) => a.name.localeCompare(b.name));
                setAdminEditingIndex(-1);
                saveAdminCredentials(adminCache);
                renderAdminList();
                if (adminEditModal) hideModal(adminEditModal);
                setAdminMessage("fp-admin-edit-message", "");
                setAdminMessage("fp-admin-message", UI_TEXTS.adminUpdated, false);
            });
        }
        if (adminEditClose) {
            adminEditClose.addEventListener("click", () => {
                if (adminEditModal) hideModal(adminEditModal);
                if (adminPasswordPanel) adminPasswordPanel.classList.add("is-hidden");
                setAdminEditingIndex(-1);
                setAdminMessage("fp-admin-edit-message", "");
            });
        }
        if (adminAddOpen) {
            adminAddOpen.addEventListener("click", () => {
                if (adminAddModal) showModal(adminAddModal);
                setAdminMessage("fp-admin-add-message", "");
            });
        }
        if (adminAddClose) {
            adminAddClose.addEventListener("click", () => {
                if (typeof isInitialSetupActive === "function" && isInitialSetupActive()) {
                    return;
                }
                if (adminAddModal) hideModal(adminAddModal);
                if (adminNameInput) adminNameInput.value = "";
                if (adminEmailInput) adminEmailInput.value = "";
                if (adminPhoneInput) adminPhoneInput.value = "";
                if (adminPasswordInput) adminPasswordInput.value = "";
                if (adminPasswordConfirmInput) adminPasswordConfirmInput.value = "";
                setAdminMessage("fp-admin-add-message", "");
            });
        }
        if (adminAddCancel) {
            adminAddCancel.addEventListener("click", () => {
                if (typeof isInitialSetupActive === "function" && isInitialSetupActive()) {
                    return;
                }
                if (adminAddModal) hideModal(adminAddModal);
                if (adminNameInput) adminNameInput.value = "";
                if (adminEmailInput) adminEmailInput.value = "";
                if (adminPhoneInput) adminPhoneInput.value = "";
                if (adminPasswordInput) adminPasswordInput.value = "";
                if (adminPasswordConfirmInput) adminPasswordConfirmInput.value = "";
                setAdminMessage("fp-admin-add-message", "");
            });
        }
        if (adminAdd) {
            adminAdd.addEventListener("click", async () => {
                const name = adminNameInput ? adminNameInput.value.trim() : "";
                const pass = adminPasswordInput ? adminPasswordInput.value : "";
                const confirm = adminPasswordConfirmInput ? adminPasswordConfirmInput.value : "";
                const email = adminEmailInput ? adminEmailInput.value.trim() : "";
                const phone = adminPhoneInput ? adminPhoneInput.value.trim() : "";
                if (!name || !pass || !confirm) {
                    setAdminMessage("fp-admin-add-message", UI_TEXTS.fieldsRequired, true);
                    return;
                }
                if (email && !isValidEmail(email)) {
                    setAdminMessage("fp-admin-add-message", UI_TEXTS.invalidEmail, true);
                    return;
                }
                if (phone && !isValidPhone(phone)) {
                    setAdminMessage("fp-admin-add-message", UI_TEXTS.invalidPhone, true);
                    return;
                }
                if (pass !== confirm) {
                    setAdminMessage("fp-admin-add-message", UI_TEXTS.passwordsMismatch, true);
                    return;
                }
                if (!isHashingAvailable()) {
                    await showDialog(
                        "error",
                        UI_TEXTS.hashingUnavailableTitle,
                        UI_TEXTS.hashingUnavailableDetail
                    );
                    return;
                }
                const adminCache = getAdminCache();
                const exists = adminCache.some((admin) => admin.name.toLowerCase() === name.toLowerCase());
                if (exists) {
                    setAdminMessage("fp-admin-add-message", UI_TEXTS.adminAlreadyExists, true);
                    return;
                }
                const hash = await hashPassword(pass);
                adminCache.push({ name, passwordHash: hash, email, phone });
                adminCache.sort((a, b) => a.name.localeCompare(b.name));
                saveAdminCredentials(adminCache);
                renderAdminList();
                if (adminNameInput) adminNameInput.value = "";
                if (adminEmailInput) adminEmailInput.value = "";
                if (adminPhoneInput) adminPhoneInput.value = "";
                if (adminPasswordInput) adminPasswordInput.value = "";
                if (adminPasswordConfirmInput) adminPasswordConfirmInput.value = "";
                setAdminMessage("fp-admin-add-message", UI_TEXTS.adminAdded, false);
                if (adminAddModal) hideModal(adminAddModal);
                if (typeof onInitialSetupComplete === "function") {
                    onInitialSetupComplete();
                }
            });
        }
        if (adminEditCancel) {
            adminEditCancel.addEventListener("click", () => {
                if (adminEditModal) hideModal(adminEditModal);
                if (adminPasswordPanel) adminPasswordPanel.classList.add("is-hidden");
                setAdminEditingIndex(-1);
                setAdminMessage("fp-admin-edit-message", "");
            });
        }
        if (adminPasswordOpen) {
            adminPasswordOpen.addEventListener("click", () => {
                if (adminPasswordPanel) adminPasswordPanel.classList.toggle("is-hidden");
            });
        }
        if (adminChange) {
            adminChange.addEventListener("click", async () => {
                const current = adminCurrentInput ? adminCurrentInput.value : "";
                const next = adminNewInput ? adminNewInput.value : "";
                const confirm = adminNewConfirmInput ? adminNewConfirmInput.value : "";
                const adminEditingIndex = getAdminEditingIndex();
                const adminCache = getAdminCache();
                if (adminEditingIndex < 0 || adminEditingIndex >= adminCache.length) {
                    setAdminMessage("fp-admin-edit-message", UI_TEXTS.adminSelectionRequired, true);
                    return;
                }
                if (!current || !next || !confirm) {
                    setAdminMessage("fp-admin-edit-message", UI_TEXTS.fieldsRequired, true);
                    return;
                }
                if (next !== confirm) {
                    setAdminMessage("fp-admin-edit-message", UI_TEXTS.passwordsMismatch, true);
                    return;
                }
                if (!isHashingAvailable()) {
                    await showDialog(
                        "error",
                        UI_TEXTS.hashingUnavailableTitle,
                        UI_TEXTS.hashingUnavailableDetail
                    );
                    return;
                }
                const admin = adminCache[adminEditingIndex];
                const verify = await verifyAdminPassword(current, admin?.name);
                if (!admin || !verify) {
                    setAdminMessage("fp-admin-edit-message", UI_TEXTS.passwordInvalid, true);
                    return;
                }
                admin.passwordHash = await hashPassword(next);
                delete admin.password;
                saveAdminCredentials(adminCache);
                if (adminCurrentInput) adminCurrentInput.value = "";
                if (adminNewInput) adminNewInput.value = "";
                if (adminNewConfirmInput) adminNewConfirmInput.value = "";
                setAdminMessage("fp-admin-edit-message", UI_TEXTS.passwordUpdated, false);
            });
        }
        if (adminForgot) {
            adminForgot.addEventListener("click", () => {
                if (adminEditModal) hideModal(adminEditModal);
                if (typeof openOtpModal === "function") {
                    openOtpModal();
                }
            });
        }
    }

    function openAdminAddModal() {
        const adminAddModal = document.getElementById("fp-admin-add-modal");
        const adminNameInput = document.getElementById("fp-admin-name");
        const adminEmailInput = document.getElementById("fp-admin-email");
        const adminPhoneInput = document.getElementById("fp-admin-phone");
        const adminPasswordInput = document.getElementById("fp-admin-password");
        const adminPasswordConfirmInput = document.getElementById("fp-admin-password-confirm");
        if (adminNameInput) adminNameInput.value = "";
        if (adminEmailInput) adminEmailInput.value = "";
        if (adminPhoneInput) adminPhoneInput.value = "";
        if (adminPasswordInput) adminPasswordInput.value = "";
        if (adminPasswordConfirmInput) adminPasswordConfirmInput.value = "";
        setAdminMessage("fp-admin-add-message", "");
        if (adminAddModal) showModal(adminAddModal);
    }

    return {
        renderAdminList,
        openAdminModal,
        openAdminAddModal,
        closeAdminModal,
        initAdminModals,
    };
}

module.exports = { createAdminModals };
