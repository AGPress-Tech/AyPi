// @ts-nocheck
export function createPurchasingBackupController(context) {
    const { document } = context;
    const getModal = () => document.getElementById("pm-backup-modal");
    const getMessage = () =>
        document.getElementById("pm-backup-message");

    const setBackupMessage = (text, type = "") => {
        const element = getMessage();
        if (element) {
            context.setMessage(element, text, type === "error");
        }
    };

    function init() {
        const closeButton = document.getElementById("pm-backup-close");
        const runButton = document.getElementById("pm-backup-run");
        const restoreButton =
            document.getElementById("pm-backup-restore");

        closeButton?.addEventListener("click", () => {
            context.hideModal(getModal());
        });
        runButton?.addEventListener("click", () => {
            setBackupMessage();
            context
                .request("/api/product-manager/backups", {
                    method: "POST",
                })
                .then((payload) => {
                    setBackupMessage(
                        `Backup creato: ${payload?.path || payload?.name || ""}`,
                        "success",
                    );
                })
                .catch((error) => {
                    setBackupMessage(
                        `Errore creazione backup: ${
                            error?.message || String(error)
                        }`,
                        "error",
                    );
                });
        });
        restoreButton?.addEventListener(
            "click",
            context.asyncGuard.wrap(async () => {
                try {
                    setBackupMessage();
                    const accepted = await context.openConfirmModal(
                        "Ripristinare un backup Purchasing? Il database corrente verrà sostituito.",
                    );
                    if (!accepted) return;
                    const payload = await context.request(
                        "/api/product-manager/backups",
                    );
                    const items = Array.isArray(payload?.items)
                        ? payload.items
                        : [];
                    if (!items.length) {
                        setBackupMessage(
                            "Nessun backup disponibile.",
                            "error",
                        );
                        return;
                    }
                    const names = items
                        .map((item) => item.name)
                        .filter(Boolean);
                    const selected = context.window.prompt(
                        `Inserisci il nome del backup da ripristinare:\n${names.join("\n")}`,
                        names[0] || "",
                    );
                    if (!selected) return;
                    await context.request(
                        `/api/product-manager/backups/${encodeURIComponent(
                            selected,
                        )}/restore`,
                        { method: "POST" },
                    );
                    await context.hydrate();
                    context.refreshViews();
                    setBackupMessage(
                        "Ripristino completato.",
                        "success",
                    );
                } catch (error) {
                    setBackupMessage(
                        `Errore ripristino backup: ${
                            error?.message || String(error)
                        }`,
                        "error",
                    );
                }
            }),
        );
    }

    function open() {
        context.requireAdminAccess(() => {
            setBackupMessage();
            const modal = getModal();
            if (modal) context.showModal(modal);
        });
    }

    return { init, open };
}
