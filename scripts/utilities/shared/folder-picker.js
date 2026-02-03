
const { ipcRenderer } = require("electron");

let inFlight = false;
let lastCancelAt = 0;

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pickFolder({ cooldownMs = 300 } = {}) {
    if (inFlight) return null;
    inFlight = true;
    try {
        const now = Date.now();
        const sinceCancel = now - lastCancelAt;
        if (sinceCancel >= 0 && sinceCancel < cooldownMs) {
            await delay(cooldownMs - sinceCancel);
        }

        if (!ipcRenderer || typeof ipcRenderer.invoke !== "function") {
            throw new Error("IPC non disponibile per la selezione cartella.");
        }

        ipcRenderer.send("folder-picker-log", {
            phase: "invoke",
            ts: Date.now(),
            cooldownMs,
        });
        const result = await ipcRenderer.invoke("select-root-folder");
        ipcRenderer.send("folder-picker-log", {
            phase: "resolved",
            ts: Date.now(),
            canceled: !result,
        });
        if (!result) {
            lastCancelAt = Date.now();
            return null;
        }
        return result;
    } finally {
        inFlight = false;
    }
}

async function withButtonLock(button, fn) {
    if (!button) return fn();
    if (button.disabled) return null;
    button.disabled = true;
    try {
        return await fn();
    } finally {
        // small delay prevents rapid re-clicks while dialog is closing
        await delay(150);
        button.disabled = false;
    }
}

module.exports = { pickFolder, withButtonLock };
