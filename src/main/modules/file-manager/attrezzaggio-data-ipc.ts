import type { IpcMain } from "electron";

type BackendRequest = (
    endpoint: string,
    options?: { method?: string; body?: unknown },
) => Promise<any>;

function safeCodePart(input: unknown) {
    return String(input || "")
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
        .replace(/\s+/g, " ")
        .trim();
}

export function transferCodeFromPayload(payload: any) {
    const articolo = safeCodePart(payload?.codiceArticolo);
    const fase = safeCodePart(payload?.fase);
    const macchina = safeCodePart(payload?.codiceMacchina);
    const metodo = safeCodePart(payload?.metodo);
    return `${articolo} - Fase: ${fase} - ${macchina} - ${metodo}`;
}

export function haasCodeFromPayload(payload: any) {
    return [
        safeCodePart(payload?.codiceArticolo),
        safeCodePart(payload?.macchina),
        safeCodePart(payload?.numeroProgramma),
        safeCodePart(payload?.metodo),
    ]
        .filter(Boolean)
        .join(" - ");
}

function errorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
}

function registerItemHandlers(
    ipcMain: IpcMain,
    request: BackendRequest,
    options: {
        channelPrefix: string;
        endpoint: string;
        buildCode: (payload: any) => string;
        invalidCode: (code: string) => boolean;
        invalidCodeMessage: string;
        useStableRecordId?: boolean;
    },
) {
    ipcMain.handle(`${options.channelPrefix}-list`, async () => {
        try {
            const payload = await request(options.endpoint);
            return {
                ok: true,
                items: Array.isArray(payload?.items) ? payload.items : [],
            };
        } catch (error) {
            return { ok: false, error: errorMessage(error) };
        }
    });

    ipcMain.handle(
        `${options.channelPrefix}-load`,
        async (_event, payload) => {
            try {
                const code = String(payload?.code || "");
                if (!code) {
                    return { ok: false, error: "Codice mancante." };
                }
                const response = await request(
                    `${options.endpoint}/${encodeURIComponent(code)}`,
                );
                return { ok: true, item: response?.item || null };
            } catch (error) {
                return { ok: false, error: errorMessage(error) };
            }
        },
    );

    ipcMain.handle(
        `${options.channelPrefix}-save`,
        async (_event, payload) => {
            try {
                const code = options.buildCode(payload);
                if (options.invalidCode(code)) {
                    return {
                        ok: false,
                        error: options.invalidCodeMessage,
                    };
                }
                const identifier = options.useStableRecordId && payload?.recordId
                    ? String(payload.recordId).trim()
                    : code;
                const response = await request(
                    `${options.endpoint}/${encodeURIComponent(identifier)}`,
                    {
                        method: "PUT",
                        body: { ...payload, code },
                    },
                );
                return {
                    ok: true,
                    code,
                    recordId: response?.item?.recordId || payload?.recordId || "",
                    item: response?.item || null,
                };
            } catch (error) {
                return { ok: false, error: errorMessage(error) };
            }
        },
    );

    ipcMain.handle(
        `${options.channelPrefix}-delete`,
        async (_event, payload) => {
            try {
                const code = String(payload?.code || "");
                if (!code) {
                    return { ok: false, error: "Codice mancante." };
                }
                await request(
                    `${options.endpoint}/${encodeURIComponent(code)}`,
                    { method: "DELETE" },
                );
                return { ok: true };
            } catch (error) {
                return { ok: false, error: errorMessage(error) };
            }
        },
    );

    ipcMain.handle(
        `${options.channelPrefix}-rotate-attachment`,
        async (_event, payload) => {
            try {
                const recordId = String(payload?.recordId || "").trim();
                const attachmentId = String(payload?.attachmentId || "").trim();
                if (!recordId || !attachmentId) {
                    return { ok: false, error: "Scheda o allegato mancante." };
                }
                const loaded = await request(
                    `${options.endpoint}/${encodeURIComponent(recordId)}`,
                );
                const item = loaded?.item;
                if (!item) return { ok: false, error: "Scheda non trovata." };
                let found = false;
                const rotation = ((Math.round(Number(payload?.rotation) || 0) % 360) + 360) % 360;
                const attachments = (Array.isArray(item.attachments) ? item.attachments : []).map(
                    (attachment) => {
                        if (String(attachment?.id || "") !== attachmentId) return attachment;
                        found = true;
                        return { ...attachment, rotation };
                    },
                );
                if (!found) return { ok: false, error: "Allegato non trovato." };
                const response = await request(
                    `${options.endpoint}/${encodeURIComponent(recordId)}`,
                    {
                        method: "PUT",
                        body: {
                            ...item,
                            recordId,
                            previousCode: item.code,
                            attachments,
                            newAttachments: [],
                        },
                    },
                );
                return { ok: true, item: response?.item || null };
            } catch (error) {
                return { ok: false, error: errorMessage(error) };
            }
        },
    );
}

export function registerAttrezzaggioDataIpc(
    ipcMain: IpcMain,
    request: BackendRequest,
) {
    registerItemHandlers(ipcMain, request, {
        channelPrefix: "transfer-attrezzaggio",
        endpoint: "/api/transfer-attrezzaggio/items",
        buildCode: transferCodeFromPayload,
        invalidCode: (code) => !code || code === "///",
        invalidCodeMessage: "Codice scheda non valido.",
        useStableRecordId: true,
    });
    registerItemHandlers(ipcMain, request, {
        channelPrefix: "haas-attrezzaggio",
        endpoint: "/api/haas-attrezzaggio/items",
        buildCode: haasCodeFromPayload,
        invalidCode: (code) => !code,
        invalidCodeMessage: "Codice scheda HAAS non valido.",
        useStableRecordId: true,
    });
}
