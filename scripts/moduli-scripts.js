const { ipcRenderer } = require("electron");
const { initCommonUI } = require("../modules/utils");
const { ADDRESS_BY_ID } = require("../config/addresses");

initCommonUI();

const buttons = [
    "openFornitori", "openDDT", "openManutenzioni", "openTarature",
    "openModuloStampi", "openMorsetti", "openUtensili", "openTicket"
];

buttons.forEach((id) => {
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

const openTicketV2Btn = document.getElementById("openTicketV2");
if (openTicketV2Btn) {
    openTicketV2Btn.addEventListener("click", () => {
        ipcRenderer.send("open-ticket-support-window");
    });
}

window.addEventListener("DOMContentLoaded", () => {
    ipcRenderer.send("resize-normale");
});
