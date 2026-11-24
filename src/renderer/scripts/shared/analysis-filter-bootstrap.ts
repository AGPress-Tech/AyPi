import { enhanceDetailTable } from "../../modules/analysis-detail-filters";
const page = location.pathname.split(/[\\/]/).pop() || "module";
const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
function presetFields(panel: HTMLElement) {
    return Array.from(panel.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input,select,textarea")).filter(field => !field.closest(".analysis-filter-presets") && !["password", "file", "submit", "button"].includes(field.type));
}
function fieldKey(field: HTMLInputElement | HTMLSelectElement) {
    if (field.id) return field.id;
    if (!field.dataset.presetFieldKey) {
        const scope = field.closest('.aypi-filter-panel')!;
        const identity = ['checkbox', 'radio'].includes(field.type) ? field.value : field.getAttribute('data-year') || '';
        field.dataset.presetFieldKey = `${field.name}:${field.type}:${identity}:${Array.from(scope.querySelectorAll('input,select,textarea')).indexOf(field)}`;
    }
    return field.dataset.presetFieldKey;
}
function addFilterPresets(panel: HTMLElement) {
    if (panel.querySelector(":scope>.analysis-filter-presets")) return;
    const section = document.createElement("details"); section.className = "analysis-filter-presets";
    section.innerHTML = "<summary>Preset filtri</summary>";
    const existing = panel.querySelector<HTMLElement>(".bom-presets,.maintenance-preset-section") || panel.querySelector<HTMLElement>("#filterPreset")?.parentElement;
    if (existing) {
        if (existing.matches("details")) {
            existing.classList.add("analysis-filter-presets"); panel.append(existing); return;
        }
        section.append(existing); panel.append(section); return;
    }
    const storage = "aypi.module-filter-presets.v1:" + page + ":" + (panel.id || panel.className.replace(/aypi-filter-panel/g, "").trim());
    let presets: { name: string; fields: { key: string; value: string; checked: boolean }[] }[] = [];
    try { const saved = JSON.parse(localStorage.getItem(storage) || "[]"); if (Array.isArray(saved)) presets = saved.filter(p => typeof p?.name === "string" && Array.isArray(p.fields)).slice(0, 20); } catch {}
    section.insertAdjacentHTML("beforeend", '<div class="analysis-preset-controls"><select data-module-preset aria-label="Preset filtri"></select><button type="button" data-module-load>Carica</button><input data-module-name maxlength="60" placeholder="Nome preset" aria-label="Nome preset filtri"><button type="button" data-module-save>Salva</button><button type="button" data-module-delete>Elimina</button></div><span data-module-message role="status"></span>');
    const select = section.querySelector<HTMLSelectElement>("[data-module-preset]")!, message = section.querySelector<HTMLElement>("[data-module-message]")!;
    const render = () => { select.innerHTML = '<option value="">Scegli preset</option>' + presets.map((p, i) => `<option value="${i}">${escape(p.name)}</option>`).join(""); };
    const persist = () => { try { localStorage.setItem(storage, JSON.stringify(presets)); render(); message.textContent = "Preset salvati su questo PC."; } catch { message.textContent = "Impossibile salvare i preset."; } };
    section.querySelector<HTMLButtonElement>("[data-module-save]")!.onclick = () => {
        const name = section.querySelector<HTMLInputElement>("[data-module-name]")!.value.trim(); if (!name) { message.textContent = "Indica un nome."; return; }
        const fields = presetFields(panel).map(field => ({ key: fieldKey(field), value: field.value, checked: !!(field as HTMLInputElement).checked }));
        const existing = presets.find(p => p.name === name); if (existing) existing.fields = fields; else if (presets.length < 20) presets.push({ name, fields }); else { message.textContent = "Massimo 20 preset."; return; } persist();
    };
    section.querySelector<HTMLButtonElement>("[data-module-load]")!.onclick = () => {
        if (select.value === "") return; const preset = presets[+select.value]; if (!preset) return;
        const fields = presetFields(panel);
        for (const saved of preset.fields) {
            const field = fields.find(field => fieldKey(field) === saved.key); if (!field || field.disabled) continue;
            if (["checkbox", "radio"].includes(field.type)) (field as HTMLInputElement).checked = saved.checked; else field.value = saved.value;
            field.dispatchEvent(new Event("input", { bubbles: true })); field.dispatchEvent(new Event("change", { bubbles: true }));
        }
        const apply = panel.querySelector<HTMLButtonElement>("#applyRules,#applyFilters,button[type=submit]");
        if (apply) apply.click(); message.textContent = "Preset applicato al contesto corrente.";
    };
    section.querySelector<HTMLButtonElement>("[data-module-delete]")!.onclick = () => { if (select.value !== "") { presets.splice(+select.value, 1); persist(); } };
    render(); panel.append(section);
}
function mountPanel(panel: HTMLElement, standalone = false) {
    if (panel.classList.contains("aypi-filter-panel")) return;
    panel.classList.add("aypi-filter-panel");
    if (!document.body.classList.contains("aypi-operations")) panel.classList.add("aypi-operational-filter");
    for (const field of panel.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input:not([type=checkbox]):not([type=radio]),select')) {
        if (field.closest('label') || document.querySelector(`label[for="${field.id}"]`)) continue;
        const label = document.createElement('label'), text = document.createElement('span');
        text.textContent = field.getAttribute('aria-label') || field.getAttribute('placeholder') || (/sort/i.test(field.id)?'Ordina':'Categoria');
        field.before(label); label.append(text,field);
    }
    if (!panel.querySelector(":scope>.filter-heading")) {
        const heading = document.createElement("div"); heading.className = "filter-heading"; heading.innerHTML = '<span class="eyebrow">CRITERI DI RICERCA</span><h2>Filtri</h2>'; panel.prepend(heading);
    }
    addFilterPresets(panel);
    let body = panel.querySelector<HTMLElement>(":scope>.filter-scroll");
    if (!body) {
        body = document.createElement("div"); body.className = "filter-scroll";
        for (const child of Array.from(panel.children)) if (!child.matches(".filter-heading,.analysis-filter-presets,.filter-actions")) body.append(child);
        panel.querySelector(".filter-heading")!.after(body);
    }
    if (standalone) { panel.classList.add("aypi-standalone-filter"); requestAnimationFrame(()=>window.dispatchEvent(new Event('resize'))); return; }
    const parent = panel.parentElement!;
    if (panel.classList.contains("filter-panel")) { parent.classList.add("aypi-native-filter-layout"); return; }
    const layout = document.createElement("div"); layout.className = "aypi-analysis-layout";
    const results = document.createElement("div"); results.className = "aypi-analysis-results";
    const following: Element[] = []; for (let next = panel.nextElementSibling; next; next = next.nextElementSibling) following.push(next);
    panel.before(layout); layout.append(panel, results); for (const child of following) results.append(child);
    requestAnimationFrame(()=>window.dispatchEvent(new Event('resize')));
}
function scan() {
    const inventory=document.querySelector<HTMLElement>('#inventorySearchForm');
    if(inventory&&!inventory.classList.contains('aypi-filter-panel')){inventory.parentElement!.classList.add('aypi-inventory-filter-layout');mountPanel(inventory,true);}
    const viewerFields=document.querySelector<HTMLElement>('#viewerSearchFilters'),viewerSearch=document.querySelector<HTMLElement>('.viewer-search'),viewer=document.querySelector<HTMLElement>('.viewer-layout');
    if(viewerFields&&viewerSearch&&viewer&&!viewerFields.classList.contains('aypi-filter-panel')){
        viewerFields.hidden=false;viewerFields.prepend(viewerSearch);viewer.prepend(viewerFields);viewer.classList.add('aypi-viewer-filter-layout');mountPanel(viewerFields,true);
        document.querySelector<HTMLElement>('#viewerSearchFilterToggle')?.setAttribute('hidden','');
    }
    const calendar=document.querySelector<HTMLElement>('#fp-calendar-filters'),calendarSidebar=document.querySelector<HTMLElement>('.fp-body>.fp-panel');
    if(calendar&&calendarSidebar&&!calendar.classList.contains('aypi-filter-panel')){calendarSidebar.prepend(calendar);document.body.classList.add('aypi-calendar-filter-layout');mountPanel(calendar,true);}
    const catalog=document.querySelector<HTMLElement>('.pm-catalog-filters'),purchasingSidebar=document.querySelector<HTMLElement>('.pm-body>.pm-panel');
    if(catalog&&purchasingSidebar&&!catalog.classList.contains('aypi-filter-panel')){purchasingSidebar.prepend(catalog);document.body.classList.add('aypi-purchasing-filter-layout');mountPanel(catalog,true);}
    for (const panel of document.querySelectorAll<HTMLElement>("main > .filter-panel,main > .filters,main > .filter-bar,#listView>.cycle-list-filters")) mountPanel(panel);
    for(const panel of document.querySelectorAll<HTMLElement>('.pm-cart-toolbar:has(input[id*="filter"],input[id*="search"]),.mes-machine-filters,.mes-orders-filters')) mountPanel(panel);
    const schedulerFilters=document.querySelector<HTMLElement>('#mes-page-scheduler .controls>.filters');
    if(schedulerFilters){schedulerFilters.parentElement!.after(schedulerFilters);mountPanel(schedulerFilters);}
    // Detail views are independent of the manual filters of the source module.
    const selector = 'dialog:not(#chartsDialog):not(#editDialog):not(#settingsDialog) table,[role=dialog] table,.document-links-row table,.linked-document table,.stock-detail table,.customer-document-lines table,.bom-expanded table,.expanded-detail table,.contract-detail table';
    for (const table of document.querySelectorAll<HTMLTableElement>(selector)) {
        if (!table.tHead || !table.tBodies[0] || table.closest('.fc,.flatpickr-calendar,[role=grid],[role=treegrid]') || table.getAttribute('role')==='presentation' || table.querySelector('input:not([type=hidden]),select,textarea,[contenteditable=true]')) continue;
        const context = table.closest<HTMLElement>("dialog")?.id || table.closest<HTMLElement>("details")?.className || table.closest<HTMLElement>(".stock-detail,.customer-document-lines")?.className || "detail";
        const key = page + ":" + context + ":" + (table.id.replace(/\d+/g, "") || table.className || "table");
        enhanceDetailTable(table, key);
    }
}
let pending = false;
function schedule() { if (pending) return; pending = true; requestAnimationFrame(() => { pending = false; scan(); }); }
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => { scan(); new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true }); });
else { scan(); new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true }); }
