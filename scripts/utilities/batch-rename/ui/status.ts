// @ts-nocheck
require("../../../shared/dev-guards");
import { state } from "../state";

function setStatus(text) {
    const el = document.getElementById("statusLine");
    if (el) {
        el.textContent = text || "";
    }
}

function updateSelectedFolderLabel() {
    const lblFolder = document.getElementById("selectedFolder");
    if (lblFolder) {
        const value = state.rootFolder || "Nessuna";
        lblFolder.textContent = value;
        lblFolder.title = state.rootFolder || "";
    }
}

export {
    setStatus,
    updateSelectedFolderLabel,
};


