const { ipcRenderer } = require("electron");

function showDialog(type, message, detail = "") {
    return ipcRenderer.invoke("show-message-box", { type, message, detail });
}

function showInfo(message, detail = "") {
    return showDialog("info", message, detail);
}

function showWarning(message, detail = "") {
    return showDialog("warning", message, detail);
}

function showError(message, detail = "") {
    return showDialog("error", message, detail);
}

module.exports = {
    showDialog,
    showInfo,
    showWarning,
    showError,
};
