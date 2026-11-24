const { ipcRenderer: ipc } = require("electron");
type ModuleItem = { id: string; label: string };
type BackupItem = { name: string; createdAt: string; protected: boolean; legacy: boolean; availableModules?: string[] };
const escape = (value: string) => String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
const date = (value: string) => new Intl.DateTimeFormat("it-IT", { dateStyle: "short", timeStyle: "medium", timeZone: "Europe/Rome" }).format(new Date(value));
export function setupBackups() {
    let admin = false, busy = false, plan: any = null;
    let items: BackupItem[] = [], modules: ModuleItem[] = [];
    const menu = document.getElementById("menuBackups") as HTMLButtonElement;
    const dialog = document.createElement("dialog"); dialog.id = "backupsDialog"; dialog.className = "workstation-dialog backups-dialog";
    dialog.setAttribute("aria-labelledby", "backupsTitle");
    dialog.innerHTML = `<header><div><div class="eyebrow">AYPI · AMMINISTRAZIONE</div><h2 id="backupsTitle">Backups</h2></div><button type="button" data-close aria-label="Chiudi">×</button></header>
      <div class="backup-body"><p>Si conservano gli ultimi <strong>3 backup ordinari</strong>. Prima di ogni ripristino AyPi crea e verifica una copia completa <strong>protetta</strong>, esclusa dal limite e rimovibile solo dalle cartelle del server.</p>
      <p class="backup-recovery" data-recovery hidden></p>
      <fieldset data-controls><div class="backup-toolbar"><label>Backup / data<select id="backupSource" aria-label="Backup da caricare"></select></label><button type="button" id="backupReload">Ricarica</button><button type="button" id="backupCreate">Crea backup ora</button></div>
      <div class="backup-scope"><label><input type="radio" name="backupScope" value="all" checked>Tutto</label><label><input type="radio" name="backupScope" value="modules">Uno o più moduli</label></div>
      <div id="backupModules" class="backup-modules" aria-label="Moduli da ripristinare"></div>
      <p class="station-help">Sono inclusi i dati applicativi AyPi sul server. Lo storico SCADA non modifica i programmi o lo stato del forno; i dati del gestionale ERP esterno restano gestiti dal gestionale.</p>
      <button type="button" id="backupPreview">Verifica e prepara ripristino</button></fieldset>
      <section id="backupPreviewPanel" class="backup-preview" hidden aria-labelledby="backupPreviewTitle"><h3 id="backupPreviewTitle">Conferma ripristino</h3><p id="backupSummary"></p><p>Il ripristino sostituisce i dati selezionati. Chiudi i moduli AyPi su tutte le postazioni e riaprili al termine.</p><label class="backup-check"><input type="checkbox" id="backupConfirmClosed">Ho chiuso i moduli su tutte le postazioni.</label><label>Digita RIPRISTINA per confermare<input id="backupConfirmation" autocomplete="off" spellcheck="false"></label><button type="button" id="backupRestore" disabled>Crea copia protetta e ripristina</button></section>
      </div><footer><span data-status role="status"></span><button type="button" data-close>Chiudi</button></footer><p class="station-help backup-path" data-folder></p>`;
    document.body.append(dialog);
    const el = <T extends HTMLElement = HTMLElement>(selector: string) => dialog.querySelector<T>(selector)!;
    const status = (message: string) => { el("[data-status]").textContent = message; };
    function setBusy(value: boolean) {
        busy = value; dialog.setAttribute("aria-busy", String(value));
        el<HTMLFieldSetElement>("[data-controls]").disabled = value;
        el<HTMLInputElement>("#backupConfirmation").disabled = value;
        el<HTMLInputElement>("#backupConfirmClosed").disabled = value;
        dialog.querySelectorAll<HTMLButtonElement>("[data-close]").forEach(button => button.disabled = value);
        updateConfirmation();
    }
    function updateConfirmation() {
        el<HTMLButtonElement>("#backupRestore").disabled = busy || !admin || !plan || el<HTMLInputElement>("#backupConfirmation").value !== "RIPRISTINA" || !el<HTMLInputElement>("#backupConfirmClosed").checked;
    }
    function clearPreview() {
        plan = null; el("#backupPreviewPanel").hidden = true;
        el<HTMLInputElement>("#backupConfirmation").value = "";
        el<HTMLInputElement>("#backupConfirmClosed").checked = false; updateConfirmation();
    }
    function renderModules() {
        const source = items.find(item => item.name === el<HTMLSelectElement>("#backupSource").value);
        const all = el<HTMLInputElement>("input[name=backupScope]:checked").value === "all";
        const previous = new Set(Array.from(dialog.querySelectorAll<HTMLInputElement>("[data-backup-module]:checked")).map(input => input.value));
        el("#backupModules").innerHTML = modules.map(module => {
            const available = !source?.availableModules || source.availableModules.includes(module.id);
            return `<label class="${available ? "" : "unavailable"}"><input type="checkbox" data-backup-module value="${escape(module.id)}" ${all || !available ? "disabled" : ""} ${available && (all || previous.has(module.id)) ? "checked" : ""}>${escape(module.label)}${available ? "" : " (assente)"}</label>`;
        }).join("");
        el<HTMLButtonElement>("#backupPreview").disabled = !source;
    }
    async function request(channel: string, payload?: any) {
        const result = await ipc.invoke(channel, payload);
        if (!result.ok) {
            const safety = result.details?.safetyPath ? ` Copia protetta: ${result.details.safetyPath}` : "";
            throw Error(result.error + safety);
        }
        return result.data;
    }
    async function loadCatalog() {
        const previous = el<HTMLSelectElement>("#backupSource").value;
        const data = await request("backups-get");
        if (!admin) return;
        items = data.items; modules = data.modules;
        el<HTMLSelectElement>("#backupSource").innerHTML = items.length ? items.map(item => `<option value="${escape(item.name)}">${date(item.createdAt)} · ${item.protected ? "PROTETTO · " : ""}${escape(item.name)}${item.legacy ? " · precedente formato" : ""}</option>`).join("") : '<option value="">Nessun backup disponibile</option>';
        if (items.some(item => item.name === previous)) el<HTMLSelectElement>("#backupSource").value = previous;
        el("[data-folder]").textContent = `Cartella backup sul server: ${data.folder}`;
        el("[data-recovery]").hidden = !data.recovery;
        el("[data-recovery]").textContent = data.recovery ? `Il server richiede un recupero. Copia protetta da usare: ${data.recovery.safety || "controllare le cartelle sul server"}. I moduli restano bloccati fino al recupero.` : "";
        renderModules();
    }
    async function action(run: () => Promise<void>) {
        if (busy || !admin) return;
        setBusy(true);
        try { await run(); }
        catch (error) { status((error as Error).message); }
        finally { setBusy(false); if (!admin) dialog.close(); }
    }
    menu.addEventListener("click", () => {
        if (!admin || busy) return;
        clearPreview(); dialog.showModal(); status("Caricamento dei backup sul server…");
        void action(async () => { await loadCatalog(); status(items.length ? "Scegli una data e i moduli da recuperare." : "Non sono ancora presenti backup. Puoi crearne uno ora."); });
    });
    function close() { if (busy) return; clearPreview(); dialog.close(); menu.focus(); }
    dialog.querySelectorAll("[data-close]").forEach(button => button.addEventListener("click", close));
    dialog.addEventListener("cancel", event => { event.preventDefault(); close(); });
    el("#backupSource").addEventListener("change", () => { clearPreview(); renderModules(); });
    dialog.querySelectorAll("input[name=backupScope]").forEach(input => input.addEventListener("change", () => { clearPreview(); renderModules(); }));
    el("#backupModules").addEventListener("change", clearPreview);
    el("#backupReload").addEventListener("click", () => void action(async () => { clearPreview(); await loadCatalog(); status("Elenco aggiornato."); }));
    el("#backupCreate").addEventListener("click", () => void action(async () => { clearPreview(); status("Creazione e verifica del backup…"); await request("backups-create"); await loadCatalog(); status("Backup creato. Conservati gli ultimi 3 ordinari e tutte le copie protette."); }));
    el("#backupPreview").addEventListener("click", () => void action(async () => {
        clearPreview(); status("Verifica dell’integrità e dei moduli selezionati…");
        const scope = el<HTMLInputElement>("input[name=backupScope]:checked").value;
        const selected = Array.from(dialog.querySelectorAll<HTMLInputElement>("[data-backup-module]:checked")).map(input => input.value);
        plan = await request("backups-preview", { name: el<HTMLSelectElement>("#backupSource").value, scope, modules: selected });
        if (!admin) return;
        el("#backupSummary").textContent = `${date(plan.createdAt)} · ${plan.modules.map(module => module.label).join(", ")}.${plan.legacy ? " Backup precedente: verificati database e file disponibili." : ""}`;
        el("#backupPreviewPanel").hidden = false; status("Verifica completata. Nessun dato è stato modificato.");
        el("#backupPreviewPanel").scrollIntoView({ block: "nearest" }); el<HTMLInputElement>("#backupConfirmation").focus();
    }));
    el("#backupConfirmation").addEventListener("input", updateConfirmation);
    el("#backupConfirmClosed").addEventListener("change", updateConfirmation);
    el("#backupRestore").addEventListener("click", () => void action(async () => {
        if (!plan || el<HTMLInputElement>("#backupConfirmation").value !== "RIPRISTINA" || !el<HTMLInputElement>("#backupConfirmClosed").checked) return;
        status("Creazione e verifica della copia protetta, poi ripristino. Attendi senza chiudere AyPi…");
        const token = plan.token; plan = null;
        const result = await request("backups-restore", { token, confirmation: "RIPRISTINA", clientsClosed: true });
        clearPreview(); await loadCatalog();
        status(`Ripristino completato. Copia protetta per tornare indietro: ${result.safety}. Percorso: ${result.safetyPath}`);
    }));
    const updateAdmin = (enabled: boolean) => {
        admin = enabled; menu.hidden = !enabled;
        if (!enabled && !busy) { clearPreview(); dialog.close(); }
        updateConfirmation();
    };
    ipc.on("admin-state-changed", (_event: unknown, state: any) => updateAdmin(!!state.enabled));
    ipc.invoke("admin-is-enabled").then(updateAdmin);
}
