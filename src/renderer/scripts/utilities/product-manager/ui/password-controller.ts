// @ts-nocheck
export function createPasswordController(context) {
    const { document } = context;
    let pendingAction = null;
    let failCount = 0;

    const getElements = () => ({
        modal: document.getElementById("fp-approve-modal"),
        input: document.getElementById("fp-approve-password"),
        error: document.getElementById("fp-approve-error"),
        recover: document.getElementById("fp-approve-recover"),
    });

    function open(action) {
        pendingAction = action || null;
        const { modal, input, error, recover } = getElements();
        const title = document.getElementById("fp-approve-title");
        const description = document.getElementById("fp-approve-desc");
        if (!modal || !input) return;
        if (title && action?.title) title.textContent = action.title;
        if (description && action?.description) {
            description.textContent = action.description;
        }
        context.showModal(modal);
        error?.classList.add("is-hidden");
        recover?.classList.add("is-hidden");
        input.value = "";
        setTimeout(() => {
            input.focus();
            input.select?.();
        }, 0);
    }

    function close() {
        context.hideModal(
            document.getElementById("fp-approve-modal"),
        );
    }

    async function confirm() {
        const { input, error, recover } = getElements();
        const action = pendingAction;
        if (!action) {
            error?.classList.add("is-hidden");
            recover?.classList.add("is-hidden");
            return;
        }

        const targetName = action.adminName || action.id || "";
        const result = await context
            .verifyAdminPassword(
                input?.value || "",
                action.type === "admin-access"
                    ? undefined
                    : targetName || undefined,
            )
            .catch(() => null);
        if (!result?.admin) {
            error?.classList.remove("is-hidden");
            failCount += 1;
            if (recover && failCount >= 3) {
                recover.classList.remove("is-hidden");
            }
            return;
        }

        failCount = 0;
        error?.classList.add("is-hidden");
        recover?.classList.add("is-hidden");
        close();
        if (action.type === "admin-access") {
            context.openAdminModal();
            return;
        }
        if (action.type !== "admin-delete") return;

        const adminName = action.adminName || "";
        let adminCache = context.getAdminCache();
        if (!adminCache.length) {
            adminCache = context.loadAdminCredentials();
        }
        if (adminCache.length <= 1) {
            context.setAdminMessage(
                "fp-admin-message",
                context.adminMinRequiredText,
                true,
            );
            return;
        }
        const next = adminCache.filter(
            (item) => item.name !== adminName,
        );
        context.setAdminCache(next);
        context.saveAdminCredentials(next);
        context.renderAdminList();
        context.setAdminMessage(
            "fp-admin-message",
            context.adminRemovedText,
            false,
        );
    }

    function init() {
        const cancel = document.getElementById("fp-approve-cancel");
        const confirmButton =
            document.getElementById("fp-approve-confirm");
        const recover = document.getElementById("fp-approve-recover");
        const input = document.getElementById("fp-approve-password");
        cancel?.addEventListener("click", close);
        confirmButton?.addEventListener("click", confirm);
        input?.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                event.preventDefault();
                confirm();
            } else if (event.key === "Escape") {
                event.preventDefault();
                close();
            }
        });
        recover?.addEventListener("click", () => {
            close();
            context.openOtpModal();
        });
    }

    return { open, confirm, init };
}
