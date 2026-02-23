require("./dev-guards");
const { ipcRenderer } = require("electron");

export function showDialog(type: string, message: string, detail = "") {
    return ipcRenderer.invoke("show-message-box", { type, message, detail });
}

export function showInfo(message: string, detail = "") {
    return showDialog("info", message, detail);
}

export function showWarning(message: string, detail = "") {
    return showDialog("warning", message, detail);
}

export function showError(message: string, detail = "") {
    return showDialog("error", message, detail);
}

// Keep CommonJS compatibility for legacy JS files (renderer)
if (typeof module !== "undefined" && module.exports && !(globalThis as any).__aypiBundled) {
    if (typeof module !== "undefined" && module.exports && !(globalThis as any).__aypiBundled) module.exports = {
        showDialog,
        showInfo,
        showWarning,
        showError,
    };
}





