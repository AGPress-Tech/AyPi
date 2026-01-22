const { UI_TEXTS } = require("../utils/ui-texts");

function createOtpModals(options) {
    const {
        document,
        showModal,
        hideModal,
        setMessage,
        showDialog,
        isMailerAvailable,
        getMailerError,
        sendOtpEmail,
        findAdminByName,
        getAdminCache,
        saveAdminCredentials,
        getAuthenticator,
        otpState,
        resetOtpState,
        isHashingAvailable,
        hashPassword,
        OTP_EXPIRY_MS,
        OTP_RESEND_MS,
    } = options || {};

    if (!document) {
        throw new Error("document richiesto.");
    }

    function openOtpModal() {
        const modal = document.getElementById("fp-otp-modal");
        if (!modal) return;
        resetOtpState();
        setMessage(document.getElementById("fp-otp-message"), "");
        const verifySection = document.getElementById("fp-otp-verify-section");
        const resetSection = document.getElementById("fp-otp-reset-section");
        if (verifySection) verifySection.classList.add("is-hidden");
        if (resetSection) resetSection.classList.add("is-hidden");
        const nameInput = document.getElementById("fp-otp-admin-name");
        const codeInput = document.getElementById("fp-otp-code");
        const newInput = document.getElementById("fp-otp-new");
        const newConfirmInput = document.getElementById("fp-otp-new-confirm");
        if (nameInput) nameInput.value = "";
        if (codeInput) codeInput.value = "";
        if (newInput) newInput.value = "";
        if (newConfirmInput) newConfirmInput.value = "";
        showModal(modal);
    }

    function closeOtpModal() {
        const modal = document.getElementById("fp-otp-modal");
        if (!modal) return;
        hideModal(modal);
        resetOtpState();
    }

    function initOtpModals() {
        const otpModal = document.getElementById("fp-otp-modal");
        const otpClose = document.getElementById("fp-otp-close");
        const otpSend = document.getElementById("fp-otp-send");
        const otpResend = document.getElementById("fp-otp-resend");
        const otpVerify = document.getElementById("fp-otp-verify");
        const otpReset = document.getElementById("fp-otp-reset");
        const otpNameInput = document.getElementById("fp-otp-admin-name");
        const otpCodeInput = document.getElementById("fp-otp-code");
        const otpNewInput = document.getElementById("fp-otp-new");
        const otpNewConfirmInput = document.getElementById("fp-otp-new-confirm");
        const otpVerifySection = document.getElementById("fp-otp-verify-section");
        const otpResetSection = document.getElementById("fp-otp-reset-section");
        const otpMessage = document.getElementById("fp-otp-message");

        if (otpClose) {
            otpClose.addEventListener("click", closeOtpModal);
        }
        if (otpModal) {
            otpModal.addEventListener("click", (event) => {
                event.stopPropagation();
            });
        }

        const handleSendOtp = async () => {
            if (!isMailerAvailable()) {
                const detailParts = [UI_TEXTS.otpMailerMissingModule, UI_TEXTS.otpMailerInstallerNote];
                const mailerError = getMailerError();
                if (mailerError) {
                    detailParts.push(`Dettaglio: ${mailerError.message || mailerError}`);
                }
                await showDialog("error", UI_TEXTS.otpUnavailableTitle, detailParts.join("\n"));
                return;
            }
            const name = otpNameInput ? otpNameInput.value.trim() : "";
            if (!name) {
                setMessage(otpMessage, UI_TEXTS.otpMissingAdminName, true);
                return;
            }
            const admin = findAdminByName(name, getAdminCache());
            if (!admin) {
                setMessage(otpMessage, UI_TEXTS.adminNotFound, true);
                return;
            }
            if (!admin.email) {
                setMessage(otpMessage, UI_TEXTS.otpMissingAdminEmail, true);
                return;
            }
            const now = Date.now();
            if (otpState.resendAt && now < otpState.resendAt) {
                const seconds = Math.ceil((otpState.resendAt - now) / 1000);
                setMessage(otpMessage, UI_TEXTS.otpResendWait(seconds), true);
                return;
            }
            let auth;
            try {
                auth = await getAuthenticator();
            } catch (err) {
                await showDialog(
                    "error",
                    UI_TEXTS.otpUnavailableTitle,
                    UI_TEXTS.otpUnavailableDetail(err.message || err)
                );
                return;
            }
            const secret = auth.generateSecret();
            const code = auth.generate(secret);
            Object.assign(otpState, {
                adminName: admin.name,
                adminEmail: admin.email,
                secret,
                expiresAt: now + OTP_EXPIRY_MS,
                resendAt: now + OTP_RESEND_MS,
                verified: false,
            });
            try {
                await sendOtpEmail(admin, code);
                if (otpVerifySection) otpVerifySection.classList.remove("is-hidden");
                setMessage(otpMessage, UI_TEXTS.otpSent, false);
            } catch (err) {
                setMessage(otpMessage, UI_TEXTS.otpSendError(err.message || err), true);
            }
        };

        if (otpSend) otpSend.addEventListener("click", handleSendOtp);
        if (otpResend) otpResend.addEventListener("click", handleSendOtp);
        if (otpVerify) {
            otpVerify.addEventListener("click", async () => {
                const code = otpCodeInput ? otpCodeInput.value.trim() : "";
                if (!code) {
                    setMessage(otpMessage, UI_TEXTS.otpMissingCode, true);
                    return;
                }
                if (!otpState.secret || Date.now() > otpState.expiresAt) {
                    setMessage(otpMessage, UI_TEXTS.otpExpired, true);
                    return;
                }
                let auth;
                try {
                    auth = await getAuthenticator();
                } catch (err) {
                    setMessage(otpMessage, UI_TEXTS.otpUnavailableMessage(err.message || err), true);
                    return;
                }
                const ok = auth.check(code, otpState.secret);
                if (!ok) {
                    setMessage(otpMessage, UI_TEXTS.otpInvalid, true);
                    return;
                }
                otpState.verified = true;
                if (otpResetSection) otpResetSection.classList.remove("is-hidden");
                setMessage(otpMessage, UI_TEXTS.otpVerified, false);
            });
        }
        if (otpReset) {
            otpReset.addEventListener("click", async () => {
                if (!otpState.verified) {
                    setMessage(otpMessage, UI_TEXTS.otpVerifyFirst, true);
                    return;
                }
                const next = otpNewInput ? otpNewInput.value : "";
                const confirm = otpNewConfirmInput ? otpNewConfirmInput.value : "";
                if (!next || !confirm) {
                    setMessage(otpMessage, UI_TEXTS.otpFillNewPasswords, true);
                    return;
                }
                if (next !== confirm) {
                    setMessage(otpMessage, UI_TEXTS.passwordsMismatch, true);
                    return;
                }
                if (!isHashingAvailable()) {
                setMessage(otpMessage, UI_TEXTS.hashingUnavailableTitle, true);
                    return;
                }
                const admin =
                    getAdminCache().find((item) => item.name === otpState.adminName) ||
                    findAdminByName(otpState.adminName, getAdminCache());
                if (!admin) {
                    setMessage(otpMessage, UI_TEXTS.adminNotFound, true);
                    return;
                }
                admin.passwordHash = await hashPassword(next);
                delete admin.password;
                const adminCache = getAdminCache();
                saveAdminCredentials(adminCache.length ? adminCache : [admin]);
                setMessage(otpMessage, UI_TEXTS.passwordUpdated, false);
                closeOtpModal();
            });
        }
    }

    return { openOtpModal, closeOtpModal, initOtpModals };
}

module.exports = { createOtpModals };
