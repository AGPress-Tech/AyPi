type RequestMode = "purchase" | "intervention";

export function collectRequestPayload(input: {
    notes?: unknown;
    lines: any[];
    mode: RequestMode;
}) {
    const notes = String(input.notes || "").trim();
    if (input.mode === "intervention") {
        const lines = (input.lines || [])
            .map((line) => ({
                interventionType: String(
                    line?.interventionType || line?.type || "",
                ).trim(),
                description: String(
                    line?.description || line?.details || "",
                ).trim(),
                urgency: String(line?.urgency || "").trim(),
            }))
            .filter(
                (line) =>
                    line.interventionType || line.description || line.urgency,
            );
        return { notes, lines };
    }

    const lines = (input.lines || [])
        .map((line) => ({
            product: String(line?.product || "").trim(),
            category: String(line?.category || "").trim(),
            quantity: String(line?.quantity || "").trim(),
            unit: String(line?.unit || "").trim(),
            urgency: String(line?.urgency || "").trim(),
            supplier: String(line?.supplier || "").trim(),
            url: String(line?.url || "").trim(),
            note: String(line?.note || "").trim(),
        }))
        .filter(
            (line) =>
                line.product ||
                line.quantity ||
                line.unit ||
                line.category ||
                line.urgency,
        );
    return { notes, lines };
}

export function validateRequestPayload(
    payload: { lines?: any[] },
    mode: RequestMode,
) {
    const lines = Array.isArray(payload?.lines) ? payload.lines : [];
    if (mode === "intervention") {
        if (!lines.length) return "Aggiungi almeno un intervento.";
        if (
            lines.some(
                (line) =>
                    !line.interventionType ||
                    !line.description ||
                    !line.urgency,
            )
        ) {
            return "Compila tipologia, descrizione e urgenza per ogni riga.";
        }
        return "";
    }

    if (!lines.length) return "Aggiungi almeno un prodotto.";
    if (
        lines.some(
            (line) =>
                !line.product ||
                !line.quantity ||
                !line.unit ||
                !line.urgency,
        )
    ) {
        return "Compila prodotto, quantita, UM e urgenza per ogni riga.";
    }
    return "";
}

export function buildRequestRecord(
    payload: { notes?: string; lines?: any[] },
    session: any,
    now = new Date(),
) {
    const timestamp = now.toISOString();
    const employeeName =
        session?.employee ||
        (session?.role === "admin" ? session?.adminName || "Admin" : "");
    return {
        id: `REQ-${now.getTime()}`,
        createdAt: timestamp,
        status: "pending",
        department: session?.department || "",
        employee: employeeName,
        createdBy: session?.role,
        adminName: session?.adminName || "",
        notes: payload.notes,
        lines: payload.lines,
        history: [
            {
                at: timestamp,
                by: session?.role,
                adminName: session?.adminName || "",
                action: "created",
            },
        ],
    };
}
