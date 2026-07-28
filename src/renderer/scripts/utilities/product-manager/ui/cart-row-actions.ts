// @ts-nocheck
export function createCartRowActions(context) {
    const findLine = (row) => {
        const requests = context.readRequests();
        const request = requests[row.requestIndex];
        const line = request?.lines?.[row.lineIndex];
        return { requests, request, line };
    };

    const showMissingLine = () =>
        context.showError(
            "Elemento non trovato.",
            "La riga potrebbe essere stata modificata da un altro utente.",
        );

    async function confirm(row) {
        if (!context.isAdmin()) {
            context.showWarning("Solo gli admin possono convalidare.");
            return;
        }
        const accepted = await context.openConfirmModal(
            "Vuoi convalidare questo elemento?",
        );
        if (!accepted) return;

        const { requests, request, line } = findLine(row);
        if (!request || !line) {
            showMissingLine();
            return;
        }
        if (line.deletedAt || line.confirmed) return;
        context.confirmRequestLine(
            request,
            line,
            context.getSession(),
        );
        if (context.saveRequests(requests)) context.renderCart();
    }

    async function remove(row) {
        const accepted = await context.openConfirmModal(
            "Vuoi eliminare questo elemento?",
        );
        if (!accepted) return;

        const { requests, request, line } = findLine(row);
        if (!request || !line) {
            showMissingLine();
            return;
        }
        if (!context.canDeleteLine(request, line) || line.deletedAt) {
            context.showWarning("Non puoi eliminare questa richiesta.");
            return;
        }

        let reason = "";
        const employeeRequest =
            context.normalizeString(request.createdBy || "") === "employee";
        if (context.isAdmin() && employeeRequest) {
            while (true) {
                const value = await context.openReasonModal({
                    title: "Motivazione rifiuto",
                    message:
                        "Inserisci una motivazione per il rifiuto della richiesta.",
                    placeholder: "Motivazione",
                });
                if (value === null) return;
                const trimmed = String(value || "").trim();
                if (trimmed) {
                    reason = trimmed;
                    break;
                }
                context.showWarning("Inserisci una motivazione.");
            }
        }

        context.deleteRequestLine(
            request,
            line,
            context.getSession(),
            { admin: context.isAdmin(), reason },
        );
        if (context.saveRequests(requests)) context.renderCart();
    }

    return { confirm, remove };
}
