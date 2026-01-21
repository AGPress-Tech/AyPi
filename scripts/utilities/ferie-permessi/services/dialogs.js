const { ipcRenderer } = require("electron");

function showDialog(type, message, detail = "", buttons) {
    return ipcRenderer.invoke("show-message-box", {
        type,
        message,
        detail,
        buttons: Array.isArray(buttons) && buttons.length ? buttons : undefined,
    });
}

module.exports = { showDialog };
