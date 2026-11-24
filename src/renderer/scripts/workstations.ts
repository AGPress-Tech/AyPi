import { stationAccess, StationConfig, StationEntry, AccessState } from "../../main/modules/workstations-model";
const { ipcRenderer: ipc } = require("electron");
const labels: Record<AccessState, string> = { accessible: "Accessibile", blocked: "Non accessibile", hidden: "Nascosto" };
const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

export function setupWorkstations(onChange: () => void) {
    let saved: StationConfig, draft: StationConfig, catalog: StationEntry[] = [], admin = false, selected = "", dirty = false;
    let readError = "";
    let savedRevision = 0, draftRevision = 0;
    const dialog = document.createElement("dialog");
    dialog.id = "workstationDialog";
    dialog.className = "workstation-dialog";
    dialog.innerHTML = `<header><div><div class="eyebrow">AYPI · CONFIGURAZIONE</div><h2 id="stationTitle">Postazione</h2></div><button type="button" data-close aria-label="Chiudi">×</button></header>
      <p data-intro></p><div class="station-toolbar" data-admin><label>Profilo da modificare<select data-profile></select></label><button type="button" data-new>Nuova</button><button type="button" data-copy>Duplica</button><button type="button" data-delete>Elimina</button><button type="button" data-import>Importa</button><button type="button" data-export>Esporta</button></div>
      <div class="station-fields"><label data-admin>Nome postazione<input data-name maxlength="80" autocomplete="off"></label><label data-operator>La mia postazione<select data-active></select></label><label>Cerca sezione o modulo<input type="search" data-search placeholder="Cerca…"></label></div>
      <p class="station-help">Le regole di una sezione valgono anche per i suoi moduli. Accessibile permette l’uso; Non accessibile mostra il pulsante disabilitato; Nascosto lo rimuove dall’interfaccia.</p>
      <div class="station-rules"><table><thead><tr><th>Sezione / Modulo</th><th>Impostazione</th><th>Stato effettivo</th></tr></thead><tbody></tbody></table></div>
      <footer><span role="status" data-status></span><button type="button" data-refresh>Ricarica</button><button type="button" data-close>Chiudi</button><button type="button" data-save data-admin>Salva profili</button><button type="button" data-select data-operator>Usa su questo PC</button></footer>`;
    dialog.setAttribute("aria-labelledby", "stationTitle");
    document.body.append(dialog);
    const el = <T extends HTMLElement = HTMLElement>(selector: string) => dialog.querySelector<T>(selector)!;
    const activeProfile = () => draft.profiles.find(profile => profile.id === selected)!;
    const status = (text: string) => { el("[data-status]").textContent = text; };
    const access = (id: string): AccessState => saved ? stationAccess(saved, id) : "hidden";
    const optionList = () => draft.profiles.map(profile => `<option value="${profile.id}">${escape(profile.name)}</option>`).join("");
    function renderRows() {
        if (!draft) return;
        const query = el<HTMLInputElement>("[data-search]").value.trim().toLocaleLowerCase("it");
        const current = activeProfile();
        const preview = { ...draft, activeId: selected };
        const matches = (entry: StationEntry): boolean => entry.label.toLocaleLowerCase("it").includes(query) || !!entry.parent && matches(catalog.find(parent => parent.id === entry.parent)!);
        el("tbody").innerHTML = catalog.filter(entry => !query || matches(entry) || catalog.some(child => child.parent === entry.id && matches(child))).map(entry => {
            const configured = current?.rules[entry.id] || "accessible";
            const effective = stationAccess(preview, entry.id);
            return `<tr class="${entry.parent ? "station-module" : "station-section"}"><td>${escape(entry.label)}</td><td><select data-rule="${entry.id}" aria-label="Accesso ${escape(entry.label)}" ${!admin ? "disabled" : ""}>${Object.entries(labels).map(([value, label]) => `<option value="${value}" ${configured === value ? "selected" : ""}>${label}</option>`).join("")}</select></td><td><span class="station-state ${effective}">${labels[effective]}</span>${effective !== configured ? " <small>(dalla sezione)</small>" : ""}</td></tr>`;
        }).join("");
    }
    function render() {
        dialog.querySelectorAll<HTMLElement>("[data-admin]").forEach(element => element.hidden = !admin);
        dialog.querySelectorAll<HTMLElement>("[data-operator]").forEach(element => element.hidden = admin);
        el("#stationTitle").textContent = admin ? "Gestione postazioni" : "Postazione";
        el("[data-intro]").textContent = admin ? "Prepara le viste condivise con gli altri PC. Ogni operatore sceglie autonomamente la propria postazione dal menu Postazione." : "Scegli la tua postazione per usare la vista preparata dall’amministratore. La scelta vale solo su questo PC. Chiudi i moduli aperti prima di cambiarla.";
        el<HTMLSelectElement>("[data-profile]").innerHTML = optionList();
        el<HTMLSelectElement>("[data-profile]").value = selected;
        el<HTMLSelectElement>("[data-active]").innerHTML = '<option value="">Nessuna postazione · Tutti i moduli ON</option>' + optionList();
        el<HTMLSelectElement>("[data-active]").value = admin ? saved.activeId : selected;
        el<HTMLInputElement>("[data-name]").value = activeProfile()?.name || "";
        el<HTMLInputElement>("[data-name]").readOnly = !admin;
        el<HTMLButtonElement>("[data-delete]").disabled = draft.profiles.length === 1;
        renderRows();
    }
    function accept(snapshot: any) {
        saved = snapshot.config; catalog = snapshot.catalog; readError = snapshot.error || "";
        savedRevision = snapshot.revision || 0;
        onChange();
    }
    function resetDraft() {
        draft = structuredClone(saved); selected = admin ? saved.activeId || draft.profiles[0].id : saved.activeId; dirty = false;
        draftRevision = savedRevision;
    }
    async function reload() {
        if (dirty && !window.confirm("Ricaricare e scartare le modifiche non salvate?")) return;
        dirty = false;
        status("Aggiornamento profili…");
        try {
            accept(await ipc.invoke("workstations-get"));
            if (!dialog.open) return;
            if (dirty) { status("Catalogo aggiornato. Conservate le modifiche in corso; ricarica per usare le nuove definizioni."); return; }
            resetDraft(); render(); status(readError);
        } catch (error) { status((error as Error).message); }
    }
    function open() {
        if (!saved) return;
        resetDraft();
        el<HTMLInputElement>("[data-search]").value = "";
        render(); status(readError);
        dialog.showModal();
        void reload();
    }
    function close() {
        if (dirty && !window.confirm("Chiudere senza salvare le modifiche alle postazioni?")) return;
        dialog.close(); document.getElementById("menuWorkstation")?.focus();
    }
    dialog.querySelectorAll("[data-close]").forEach(button => button.addEventListener("click", close));
    dialog.addEventListener("cancel", event => { event.preventDefault(); close(); });
    el("[data-search]").addEventListener("input", renderRows);
    el("[data-profile]").addEventListener("change", () => { selected = el<HTMLSelectElement>("[data-profile]").value; render(); });
    el("[data-active]").addEventListener("change", () => {
        if (admin) return;
        selected = el<HTMLSelectElement>("[data-active]").value;
        dirty = selected !== saved.activeId; renderRows();
        status(selected ? "Anteprima della vista. Premi Usa su questo PC per confermare." : "Senza postazione tutti i moduli sono ON. Premi Usa su questo PC per confermare.");
    });
    el("[data-refresh]").addEventListener("click", () => void reload());
    el("[data-name]").addEventListener("input", () => { activeProfile().name = el<HTMLInputElement>("[data-name]").value; dirty = true; });
    el("[data-name]").addEventListener("change", render);
    el("tbody").addEventListener("change", event => {
        const select = event.target as HTMLSelectElement;
        if (!select.dataset.rule || !admin) return;
        activeProfile().rules[select.dataset.rule] = select.value as AccessState; dirty = true;
        const focusedRule = select.dataset.rule;
        renderRows();
        Array.from(dialog.querySelectorAll<HTMLSelectElement>("[data-rule]")).find(node => node.dataset.rule === focusedRule)?.focus();
        status("Modifiche da salvare.");
    });
    function create(copy: boolean) {
        let name = copy ? `${activeProfile().name} (copia)` : "Nuova postazione", suffix = 2;
        const base = name;
        while (draft.profiles.some(profile => profile.name === name)) name = `${base} ${suffix++}`;
        const profile = { id: crypto.randomUUID(), name, rules: copy ? { ...activeProfile().rules } : {} };
        draft.profiles.push(profile); selected = profile.id; dirty = true; render();
        el<HTMLInputElement>("[data-name]").focus(); el<HTMLInputElement>("[data-name]").select();
    }
    el("[data-new]").addEventListener("click", () => create(false));
    el("[data-copy]").addEventListener("click", () => create(true));
    el("[data-delete]").addEventListener("click", () => {
        if (draft.profiles.length === 1 || !window.confirm(`Eliminare la postazione “${activeProfile().name}”?`)) return;
        draft.profiles = draft.profiles.filter(profile => profile.id !== selected);
        if (draft.activeId === selected) draft.activeId = "";
        selected = draft.profiles[0].id; dirty = true; render(); status("Eliminazione da salvare.");
    });
    async function request(channel: string) {
        try {
            const result = await ipc.invoke(channel, { ...draft, revision: draftRevision });
            if (!result.ok) throw Error(result.error);
            return result;
        } catch (error) { status((error as Error).message); return null; }
    }
    el("[data-save]").addEventListener("click", async () => {
        const button = el<HTMLButtonElement>("[data-save]"); button.disabled = true;
        try {
            const result = await request("workstations-save");
            if (!result) return;
            accept(result); draftRevision = savedRevision; dirty = false; status("Profili salvati e disponibili per gli operatori. La scelta della postazione resta locale a ogni PC.");
        } finally { button.disabled = false; }
    });
    el("[data-select]").addEventListener("click", async () => {
        const button = el<HTMLButtonElement>("[data-select]"); button.disabled = true;
        try {
            const result = await ipc.invoke("workstations-select", { id: selected });
            if (!result.ok) throw Error(result.error);
            accept(result); resetDraft(); render();
            status(selected ? "Postazione scelta e applicata solo su questo PC." : "Nessuna postazione scelta: tutti i moduli sono ON.");
        } catch (error) { status((error as Error).message); }
        finally { button.disabled = false; }
    });
    el("[data-export]").addEventListener("click", async () => { const result = await request("workstations-export"); if (result && !result.canceled) status("Postazioni esportate."); });
    el("[data-import]").addEventListener("click", async () => {
        if (dirty && !window.confirm("Sostituire le modifiche non salvate con i profili importati?")) return;
        const result = await request("workstations-import");
        if (!result || result.canceled) return;
        draft = result.config; selected = draft.profiles[0].id; dirty = true; render(); status("Profili importati in anteprima. Salva profili per renderli disponibili agli operatori; le scelte dei PC restano locali.");
    });
    function updateAdmin(enabled: boolean) {
        admin = enabled;
        document.getElementById("stationMenuLabel")!.textContent = admin ? "Gestione" : "Postazione";
        if (dialog.open && saved) { resetDraft(); render(); status(readError); }
    }
    document.getElementById("menuWorkstation")!.addEventListener("click", open);
    ipc.on("workstations-changed", (_event: unknown, snapshot: any) => accept(snapshot));
    ipc.on("admin-state-changed", (_event: unknown, state: any) => updateAdmin(!!state.enabled));
    ipc.on("workstation-access-denied", (_event: unknown, message: string) => window.alert(message));
    ipc.invoke("admin-is-enabled").then(updateAdmin);
    ipc.invoke("workstations-get").then(accept).catch((error: Error) => { readError = error.message; window.alert(readError); });
    return { access };
}
