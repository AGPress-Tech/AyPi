require("../../../shared/dev-guards");
import { UI_TEXTS } from "../utils/ui-texts";

type AdminEntry = { name?: string; email?: string; password?: string; passwordHash?: string };
type OtpState = {
    adminName?: string;
    adminEmail?: string;
    secret?: string;
    expiresAt?: number;
    resendAt?: number;
    verified?: boolean;
};

type OtpModalsOptions = {
    document: Document;
    showModal: (el: HTMLElement | null) => void;
    hideModal: (el: HTMLElement | null) => void;
    setMessage: (el: HTMLElement | null, message: string, isError?: boolean) => void;
    showDialog: (type: string, message: string, detail?: string) => Promise<any>;
    isMailerAvailable: () => boolean;
    getMailerError: () => unknown;
    sendOtpEmail: (admin: AdminEntry, code: string) => Promise<void>;
    findAdminByName: (name: string, admins: AdminEntry[]) => AdminEntry | null;
    getAdminCache: () => AdminEntry[];
    saveAdminCredentials: (admins: AdminEntry[]) => void;
    getAuthenticator: () => Promise<{ generateSecret: () => string; generate: (secret: string) => string; check: (code: string, secret: string) => boolean }>;
    otpState: OtpState;
    resetOtpState: () => void;
    isHashingAvailable: () => boolean;
    hashPassword: (password: string) => Promise<string>;
    OTP_EXPIRY_MS: number;
    OTP_RESEND_MS: number;
};

function createOtpModals(options: OtpModalsOptions) {
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
    } = options || ({} as OtpModalsOptions);

    if (!document) {
        throw new Error("document richiesto.");
    }

    function openOtpModal() {
        const modal = document.getElementById("fp-otp-modal") as HTMLElement | null;
        if (!modal) return;
        resetOtpState();
        setMessage(document.getElementById("fp-otp-message"), "");
        const verifySection = document.getElementById("fp-otp-verify-section") as HTMLElement | null;
        const resetSection = document.getElementById("fp-otp-reset-section") as HTMLElement | null;
        if (verifySection) verifySection.classList.add("is-hidden");
        if (resetSection) resetSection.classList.add("is-hidden");
        const nameInput = document.getElementById("fp-otp-admin-name") as HTMLInputElement | null;
        const codeInput = document.getElementById("fp-otp-code") as HTMLInputElement | null;
        const newInput = document.getElementById("fp-otp-new") as HTMLInputElement | null;
        const newConfirmInput = document.getElementById("fp-otp-new-confirm") as HTMLInputElement | null;
        if (nameInput) nameInput.value = "";
        if (codeInput) codeInput.value = "";
        if (newInput) newInput.value = "";
        if (newConfirmInput) newConfirmInput.value = "";
        showModal(modal);
    }

    function closeOtpModal() {
        const modal = document.getElementById("fp-otp-modal") as HTMLElement | null;
        if (!modal) return;
        hideModal(modal);
        resetOtpState();
    }

    function initOtpModals() {
        const otpModal = document.getElementById("fp-otp-modal") as HTMLElement | null;
        const otpClose = document.getElementById("fp-otp-close") as HTMLButtonElement | null;
        const otpSend = document.getElementById("fp-otp-send") as HTMLButtonElement | null;
        const otpResend = document.getElementById("fp-otp-resend") as HTMLButtonElement | null;
        const otpVerify = document.getElementById("fp-otp-verify") as HTMLButtonElement | null;
        const otpReset = document.getElementById("fp-otp-reset") as HTMLButtonElement | null;
        const otpNameInput = document.getElementById("fp-otp-admin-name") as HTMLInputElement | null;
        const otpCodeInput = document.getElementById("fp-otp-code") as HTMLInputElement | null;
        const otpNewInput = document.getElementById("fp-otp-new") as HTMLInputElement | null;
        const otpNewConfirmInput =
            document.getElementById("fp-otp-new-confirm") as HTMLInputElement | null;
        const otpVerifySection = document.getElementById(
            "fp-otp-verify-section",
        ) as HTMLElement | null;
        const otpResetSection = document.getElementById("fp-otp-reset-section") as HTMLElement | null;
        const otpMessage = document.getElementById("fp-otp-message") as HTMLElement | null;

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
                const detailParts = [
                    UI_TEXTS.otpMailerMissingModule,
                    UI_TEXTS.otpMailerInstallerNote,
                ];
                const mailerError = getMailerError();
                if (mailerError) {
                    detailParts.push(
                        `Dettaglio: ${(mailerError as any).message || mailerError}`,
                    );
                }
                await showDialog(
                    "error",
                    UI_TEXTS.otpUnavailableTitle,
                    detailParts.join("\n"),
                );
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
                    UI_TEXTS.otpUnavailableDetail((err as Error).message || err),
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
                if (otpVerifySection)
                    otpVerifySection.classList.remove("is-hidden");
                setMessage(otpMessage, UI_TEXTS.otpSent, false);
            } catch (err) {
                setMessage(
                    otpMessage,
                    UI_TEXTS.otpSendError((err as Error).message || err),
                    true,
                );
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
                    setMessage(
                        otpMessage,
                        UI_TEXTS.otpUnavailableMessage((err as Error).message || err),
                        true,
                    );
                    return;
                }
                const ok = auth.check(code, otpState.secret);
                if (!ok) {
                    setMessage(otpMessage, UI_TEXTS.otpInvalid, true);
                    return;
                }
                otpState.verified = true;
                if (otpResetSection)
                    otpResetSection.classList.remove("is-hidden");
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
                const confirm = otpNewConfirmInput
                    ? otpNewConfirmInput.value
                    : "";
                if (!next || !confirm) {
                    setMessage(otpMessage, UI_TEXTS.otpFillNewPasswords, true);
                    return;
                }
                if (next !== confirm) {
                    setMessage(otpMessage, UI_TEXTS.passwordsMismatch, true);
                    return;
                }
                if (!isHashingAvailable()) {
                    setMessage(
                        otpMessage,
                        UI_TEXTS.hashingUnavailableTitle,
                        true,
                    );
                    return;
                }
                const admin =
                    getAdminCache().find(
                        (item) => item.name === otpState.adminName,
                    ) || findAdminByName(otpState.adminName, getAdminCache());
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

export { createOtpModals };

// Keep CommonJS compatibility for legacy JS callers
if (typeof module !== "undefined" && module.exports && !(globalThis as any).__aypiBundled) {
    if (typeof module !== "undefined" && module.exports && !(globalThis as any).__aypiBundled) module.exports = { createOtpModals };
}


