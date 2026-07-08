// @ts-nocheck
require("../shared/dev-guards");
const { createModalHelpers } = require("./ferie-permessi/ui/modals");
const { createAdminModals } = require("./ferie-permessi/ui/admin-modals");
const { createOtpModals } = require("./ferie-permessi/ui/otp-modals");
const { UI_TEXTS } = require("./ferie-permessi/utils/ui-texts");
const {
    isMailerAvailable,
    getMailerError,
    sendOtpEmail,
} = require("./ferie-permessi/services/otp-mail");
const {
    getAuthenticator,
    otpState,
    resetOtpState,
    isHashingAvailable,
    hashPassword,
} = require("./ferie-permessi/config/security");
const sharedDialogs = require("../shared/dialogs");
const { requestBackend } = require("../shared/backend-client");
const { createAsyncGuard } = require("../shared/async-guard");

let adminCache = [];
let adminEditingIndex = -1;
let pendingPasswordAction = null;
let passwordFailCount = 0;

const asyncGuard = createAsyncGuard({
    errorTitle: "Errore Admin Manager.",
    promiseTitle: "Errore promessa non gestita (Admin Manager).",
    report: (message, detail) => {
        sharedDialogs.showError(message, detail);
    },
});

asyncGuard.installGlobalHandlers();

const { showModal, hideModal } = createModalHelpers({ document });

function growWindowForCard(card) {
    if (!card) return;
    const padW = 80;
    const padH = 120;
    const desiredW = Math.ceil(card.scrollWidth + padW);
    const desiredH = Math.ceil(card.scrollHeight + padH);
    const currentW = window.outerWidth || window.innerWidth;
    const currentH = window.outerHeight || window.innerHeight;
    const maxW = window.screen?.availWidth || currentW;
    const maxH = window.screen?.availHeight || currentH;
    const nextW = Math.min(Math.max(currentW, desiredW), maxW);
    const nextH = Math.min(Math.max(currentH, desiredH), maxH);
    if (nextW !== currentW || nextH !== currentH) {
        window.resizeTo(nextW, nextH);
    }
}

function observeModalSizing() {
    const trackedIds = [
        "fp-admin-add-modal",
        "fp-admin-edit-modal",
        "fp-otp-modal",
        "fp-approve-modal",
    ];

    trackedIds.forEach((id) => {
        const modal = document.getElementById(id);
        if (!modal) return;
        const observer = new MutationObserver(() => {
            if (modal.classList.contains("is-hidden")) return;
            const card = modal.querySelector(".fp-modal__card");
            growWindowForCard(card);
        });
        observer.observe(modal, {
            attributes: true,
            attributeFilter: ["class"],
        });
    });
}

function setMessage(el, text, isError = false) {
    if (!el) return;
    if (!text) {
        el.classList.add("is-hidden");
        el.textContent = "";
        el.classList.remove("fp-message--error");
        return;
    }
    el.textContent = text;
    el.classList.remove("is-hidden");
    el.classList.toggle("fp-message--error", !!isError);
}

function setAdminMessage(id, text, isError = false) {
    setMessage(document.getElementById(id), text, isError);
}

function isValidEmail(value) {
    if (!value) return true;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value));
}

function isValidPhone(value) {
    if (!value) return false;
    const trimmed = String(value || "").trim();
    if (!trimmed.startsWith("+39")) return false;
    const digits = trimmed.replace(/\D/g, "");
    return digits.length >= 11 && digits.length <= 13;
}

function normalizeAdminEntry(item) {
    return {
        name: String(item?.name || "").trim(),
        password: item?.password ? String(item.password) : undefined,
        passwordHash: item?.passwordHash
            ? String(item.passwordHash)
            : undefined,
        email: item?.email ? String(item.email) : "",
        phone: item?.phone ? String(item.phone) : "",
        accessCalendar:
            typeof item?.accessCalendar === "boolean"
                ? item.accessCalendar
                : true,
        accessPurchasing:
            typeof item?.accessPurchasing === "boolean"
                ? item.accessPurchasing
                : true,
    };
}

function loadAdminCredentials() {
    return Array.isArray(adminCache) ? adminCache.map(normalizeAdminEntry) : [];
}

async function hydrateAdmins() {
    const payload = await requestBackend("/api/shared/admins");
    adminCache = Array.isArray(payload?.admins)
        ? payload.admins.map(normalizeAdminEntry)
        : [];
    return loadAdminCredentials();
}

async function saveAdminCredentials(admins) {
    const payload = await requestBackend("/api/shared/admins", {
        method: "PUT",
        body: { admins: Array.isArray(admins) ? admins : [] },
    });
    adminCache = Array.isArray(payload?.admins)
        ? payload.admins.map(normalizeAdminEntry)
        : [];
    return loadAdminCredentials();
}

async function verifyAdminPassword(password, targetName) {
    const payload = await requestBackend("/api/shared/admins/verify", {
        method: "POST",
        body: { password, targetName: targetName || null },
    }).catch(() => null);
    if (!payload?.ok || !payload?.admin) return null;
    return {
        admin: normalizeAdminEntry(payload.admin),
        admins: loadAdminCredentials(),
    };
}

function findAdminByName(name) {
    const lower = String(name || "")
        .trim()
        .toLowerCase();
    return (
        loadAdminCredentials().find(
            (item) => item.name.trim().toLowerCase() === lower,
        ) || null
    );
}

function openPasswordModal(action) {
    const modal = document.getElementById("fp-approve-modal");
    const input = document.getElementById("fp-approve-password");
    const error = document.getElementById("fp-approve-error");
    const recover = document.getElementById("fp-approve-recover");
    const title = document.getElementById("fp-approve-title");
    const desc = document.getElementById("fp-approve-desc");
    if (!modal || !input) return;
    pendingPasswordAction = action || null;
    if (title && action?.title) title.textContent = action.title;
    if (desc && action?.description) desc.textContent = action.description;
    if (error) error.classList.add("is-hidden");
    if (recover) recover.classList.add("is-hidden");
    input.value = "";
    showModal(modal);
    setTimeout(() => {
        input.focus();
        input.select?.();
    }, 0);
}

async function confirmPassword() {
    const input = document.getElementById("fp-approve-password");
    const error = document.getElementById("fp-approve-error");
    const recover = document.getElementById("fp-approve-recover");
    const password = input ? input.value : "";
    const action = pendingPasswordAction;
    if (!action) return;

    const targetName = action?.adminName || action?.id || "";
    const checkAny = action.type === "admin-access";
    const result = await verifyAdminPassword(
        password,
        checkAny ? undefined : targetName || undefined,
    );
    if (!result || !result.admin) {
        if (error) error.classList.remove("is-hidden");
        passwordFailCount += 1;
        if (recover && passwordFailCount >= 3)
            recover.classList.remove("is-hidden");
        return;
    }

    passwordFailCount = 0;
    if (error) error.classList.add("is-hidden");
    if (recover) recover.classList.add("is-hidden");
    hideModal(document.getElementById("fp-approve-modal"));

    if (action.type === "admin-access") {
        adminUi.openAdminModal();
        return;
    }

    if (action.type === "admin-delete") {
        const adminName = action.adminName || "";
        adminCache = adminCache.length ? adminCache : loadAdminCredentials();
        if (adminCache.length <= 1) {
            setAdminMessage(
                "fp-admin-message",
                UI_TEXTS.adminMinRequired,
                true,
            );
            return;
        }
        adminCache = adminCache.filter((item) => item.name !== adminName);
        saveAdminCredentials(adminCache);
        adminUi.renderAdminList();
        setAdminMessage("fp-admin-message", UI_TEXTS.adminRemoved, false);
    }
}

function initPasswordModal() {
    const cancel = document.getElementById("fp-approve-cancel");
    const confirm = document.getElementById("fp-approve-confirm");
    const recover = document.getElementById("fp-approve-recover");
    const input = document.getElementById("fp-approve-password");
    if (cancel)
        cancel.addEventListener("click", () =>
            hideModal(document.getElementById("fp-approve-modal")),
        );
    if (confirm)
        confirm.addEventListener("click", asyncGuard.wrap(confirmPassword));
    if (recover) {
        recover.addEventListener("click", () => {
            hideModal(document.getElementById("fp-approve-modal"));
            otpUi.openOtpModal();
        });
    }
    if (input) {
        input.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                event.preventDefault();
                void asyncGuard.wrap(confirmPassword)();
            }
        });
    }
}
const otpUi = createOtpModals({
    document,
    showModal,
    hideModal,
    setMessage,
    showDialog: sharedDialogs.showDialog,
    isMailerAvailable,
    getMailerError,
    sendOtpEmail,
    findAdminByName,
    getAdminCache: () => adminCache,
    loadAdminCredentials,
    saveAdminCredentials,
    getAuthenticator,
    otpState,
    resetOtpState,
    isHashingAvailable,
    hashPassword,
    OTP_EXPIRY_MS: 300000,
    OTP_RESEND_MS: 60000,
});

const adminUi = createAdminModals({
    document,
    showModal,
    hideModal,
    setAdminMessage,
    openConfirmModal: async (message) =>
        window.confirm(String(message || "Confermi?")),
    escapeHtml: (value) => String(value || ""),
    openPasswordModal,
    openOtpModal: () => otpUi.openOtpModal(),
    loadAdminCredentials,
    saveAdminCredentials,
    verifyAdminPassword,
    hashPassword,
    isHashingAvailable,
    isValidEmail,
    isValidPhone,
    showDialog: sharedDialogs.showDialog,
    getAdminCache: () => adminCache,
    setAdminCache: (next) => {
        adminCache = Array.isArray(next) ? [...next] : [];
    },
    getAdminEditingIndex: () => adminEditingIndex,
    setAdminEditingIndex: (next) => {
        adminEditingIndex = next;
    },
    isInitialSetupActive: () => false,
    onInitialSetupComplete: () => {},
});

function init() {
    initPasswordModal();
    otpUi.initOtpModals();
    adminUi.initAdminModals();
    observeModalSizing();

    void hydrateAdmins()
        .then(() => {
            adminUi.openAdminModal();
        })
        .catch((err) => asyncGuard.handle(err));

    document.getElementById("adm-refresh")?.addEventListener(
        "click",
        asyncGuard.wrap(async () => {
            await hydrateAdmins();
            adminUi.renderAdminList();
            setAdminMessage("fp-admin-message", "Dati aggiornati.");
        }),
    );
    document
        .getElementById("adm-close")
        ?.addEventListener("click", () => window.close());
}

document.addEventListener("DOMContentLoaded", asyncGuard.wrap(init));
