// @ts-nocheck
require("../../../shared/dev-guards");
import { ipcRenderer } from "electron";

export function showDialog(type, message, detail = "", buttons) {
    return ipcRenderer.invoke("show-message-box", {
        type,
        message,
        detail,
        buttons: Array.isArray(buttons) && buttons.length ? buttons : undefined,
    });
}

// Keep CommonJS compatibility for legacy JS callers
if (typeof module !== "undefined" && module.exports && !(globalThis as any).__aypiBundled) {
    if (typeof module !== "undefined" && module.exports && !(globalThis as any).__aypiBundled) module.exports = { showDialog };
}


