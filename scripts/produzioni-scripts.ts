// @ts-nocheck
require("./shared/dev-guards");
const { ipcRenderer } = require("electron");
const { initCommonUI } = require("../modules/utils");
const { ADDRESS_BY_ID } = require("../config/addresses");

initCommonUI();

["openRegStampaggio", "openRegTranceria", "openRegTorneria"].forEach((id) => {
    const btn = document.getElementById(id);
    const entry = ADDRESS_BY_ID[id];
    const key = entry ? entry.key : null;
    if (btn) {
        btn.addEventListener("click", () => {
            if (!key) return;
            ipcRenderer.send("open-address", { key });
        });
        btn.addEventListener("contextmenu", async (event) => {
            event.preventDefault();
            if (!key) return;
            const isAdmin = await ipcRenderer.invoke("admin-is-enabled");
            if (!isAdmin) return;
            ipcRenderer.invoke("addresses-reconfigure", { key });
        });
    }
});

window.addEventListener("DOMContentLoaded", () => {
    ipcRenderer.send("resize-normale");
});



