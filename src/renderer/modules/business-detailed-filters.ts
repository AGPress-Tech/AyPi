import { SpecialColumn, SpecialFilter, SpecialRule, SpecialGroup, specialOperators, SPECIAL_OPERATORS, validateSpecialFilters } from "../../main/modules/analysis-special-filters";
import { specialFilterEditor } from "./analysis-special-filter-editor";
const esc = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
type State = { rules: Record<string, SpecialRule[]>; excluded: string[]; custom: SpecialFilter[] };
export function filterPresets(host: HTMLElement, key: string, read: () => any, sync: (value: any) => void) {
    const box = document.createElement("details"); box.className = "analysis-filter-presets business-filter-presets"; box.dataset.filterPopover = "";
    box.innerHTML = `<summary>Preset di ricerca</summary><div><label>Preset salvato<select data-preset-list></select></label><button type="button" data-preset-load>Carica</button><label>Nome preset<input maxlength="60" data-preset-name></label><button type="button" data-preset-save>Salva</button><button type="button" data-preset-delete>Elimina</button><span role="status" data-preset-status></span></div>`;
    host.append(box);
    let presets: { name: string; value: any }[] = [];
    try { const value = JSON.parse(localStorage.getItem(key) || "[]"); if (Array.isArray(value)) presets = value.filter(item => typeof item?.name === "string" && item.name.length <= 60 && item.value && typeof item.value === "object").slice(0, 20); } catch {}
    const select = box.querySelector<HTMLSelectElement>("select")!, name = box.querySelector<HTMLInputElement>("input")!, status = box.querySelector<HTMLElement>("[role=status]")!;
    const render = () => { select.innerHTML = '<option value="">Scegli preset</option>' + presets.map((item, index) => `<option value="${index}">${esc(item.name)}</option>`).join(""); };
    const perform = (action: () => void) => { try { action(); } catch (error) { status.textContent = (error as Error).message; } };
    box.querySelector<HTMLElement>("[data-preset-save]")!.onclick = () => perform(() => {
        const title = name.value.trim(); if (!title) throw Error("Inserisci un nome per il preset.");
        const value = JSON.parse(JSON.stringify(read())), index = presets.findIndex(item => item.name === title);
        if (index < 0 && presets.length >= 20) throw Error("Massimo 20 preset.");
        if (index < 0) presets.push({ name: title, value }); else presets[index] = { name: title, value };
        localStorage.setItem(key, JSON.stringify(presets)); render(); select.value = String(presets.findIndex(item => item.name === title)); status.textContent = "Preset salvato.";
    });
    box.querySelector<HTMLElement>("[data-preset-load]")!.onclick = () => perform(() => { if (select.value === "") return; const item = presets[Number(select.value)]; sync(JSON.parse(JSON.stringify(item.value))); name.value = item.name; status.textContent = "Preset caricato: premi Cerca per applicarlo."; });
    box.querySelector<HTMLElement>("[data-preset-delete]")!.onclick = () => perform(() => { if (select.value === "") return; presets.splice(Number(select.value), 1); localStorage.setItem(key, JSON.stringify(presets)); render(); status.textContent = "Preset eliminato."; });
    render();
}
export function businessDetailedFilters(host: HTMLElement, fields: readonly SpecialColumn[], options: { key: string; title?: string; changed: () => void; presets?: boolean; extraRead?: () => any; extraSync?: (value: any) => void }) {
    const panel = document.createElement("details"); panel.className = "business-detailed-filters"; panel.dataset.filterPopover = "";
    panel.innerHTML = `<summary>${esc(options.title || "Filtri dettagliati")} <span data-active-count></span></summary><div class="business-filter-content"><div class="business-standard-fields"></div><div data-business-special></div><div class="business-filter-actions"><button type="button" data-filter-clear>Azzera filtri</button><span role="status" data-filter-message></span></div></div>`;
    host.append(panel);
    const position = () => {
        if (!panel.open || !panel.isConnected) return;
        const anchor = panel.querySelector("summary")!.getBoundingClientRect(), popup = panel.querySelector<HTMLElement>(".business-filter-content")!;
        const width = Math.min(580, innerWidth - 48), top = innerHeight - anchor.bottom - 24 >= 260 ? Math.max(82, anchor.bottom + 7) : 105;
        Object.assign(popup.style, { width: `${width}px`, left: `${Math.max(24, Math.min(anchor.left, innerWidth - width - 24))}px`, right: "auto", top: `${top}px`, maxHeight: `${Math.max(150, Math.min(620, innerHeight - top - 24))}px` });
    };
    panel.addEventListener("toggle", position); window.addEventListener("resize", position); document.addEventListener("scroll", position, true);
    const standard = panel.querySelector<HTMLElement>(".business-standard-fields")!;
    const badges = () => {
        let total = 0;
        standard.querySelectorAll<HTMLElement>("[data-filter-field]").forEach(group => {
            const count = [...group.querySelectorAll<HTMLElement>(".business-rule")].filter(row => row.querySelector<HTMLSelectElement>("[data-op]")!.value.match(/^(empty|present)$/) || [...row.querySelectorAll<HTMLInputElement>("input")].some(input => input.value)).length;
            group.querySelector("[data-badge]")!.textContent = count ? String(count) : "Facoltativo"; total += count;
        });
        panel.querySelector("[data-active-count]")!.textContent = total ? `(${total})` : "";
    };
    const changed = () => { badges(); options.changed(); };
    const special = specialFilterEditor(panel.querySelector<HTMLElement>("[data-business-special]")!, fields, changed);
    function addRule(group: HTMLElement, field: SpecialColumn, rule?: SpecialRule) {
        const rules = group.querySelector<HTMLElement>("[data-rules]")!;
        if (rules.children.length >= 20) throw Error("Massimo 20 alternative per campo.");
        const row = document.createElement("div"); row.className = "business-rule";
        const operators = specialOperators(field.kind);
        const initial = field.kind === "number" || field.kind === "date" ? "range" : /Code$|^(article|unit|storage|currency|priceList|orderNo|bom)$/.test(field.key) ? "exact" : "contains";
        row.innerHTML = `<label>Condizione<select data-op aria-label="Condizione ${esc(field.label)}">${operators.map(op => `<option value="${op}">${esc(SPECIAL_OPERATORS[op as keyof typeof SPECIAL_OPERATORS])}</option>`).join("")}</select></label><label data-value-label><span data-value-title>Valore</span><input data-value type="${field.kind === "number" ? "number" : field.kind === "date" ? "date" : "text"}" step="any" maxlength="256" aria-label="${esc(field.label)} da o valore"></label><label data-to-label>A<input data-to type="${field.kind === "number" ? "number" : field.kind === "date" ? "date" : "text"}" step="any" maxlength="256" aria-label="${esc(field.label)} a"></label><button type="button" class="remove-rule" data-remove aria-label="Rimuovi condizione ${esc(field.label)}">×</button>`;
        const op = row.querySelector<HTMLSelectElement>("select")!, value = row.querySelector<HTMLInputElement>("[data-value]")!, to = row.querySelector<HTMLInputElement>("[data-to]")!;
        op.value = rule?.op || initial; value.value = rule?.value || ""; to.value = rule?.to || "";
        const update = () => { row.querySelector<HTMLElement>("[data-value-label]")!.hidden = ["empty", "present"].includes(op.value); row.querySelector<HTMLElement>("[data-to-label]")!.hidden = op.value !== "range"; row.querySelector("[data-value-title]")!.textContent = op.value === "range" ? "Da" : "Valore"; };
        op.onchange = () => { update(); changed(); };
        row.oninput = changed;
        row.querySelector<HTMLElement>("[data-remove]")!.onclick = () => { if (rules.children.length > 1) row.remove(); else { value.value = ""; to.value = ""; op.value = initial; update(); } changed(); };
        rules.append(row); update();
    }
    for (const field of fields) {
        const group = document.createElement("details"); group.className = "filter-group business-filter-field"; group.dataset.filterField = field.key;
        group.innerHTML = `<summary>${esc(field.label)}<span class="badge" data-badge>Facoltativo</span></summary><label class="analysis-filter-mode"><select data-mode aria-label="Mantieni o escludi ${esc(field.label)}"><option value="include">Mantieni selezionati</option><option value="exclude">Escludi selezionati</option></select></label><div data-rules></div><button type="button" class="add-rule" data-add>+ Aggiungi alternativa</button>`;
        standard.append(group); addRule(group, field);
        group.querySelector<HTMLElement>("[data-add]")!.onclick = () => { try { addRule(group, field); changed(); } catch (error) { panel.querySelector("[data-filter-message]")!.textContent = (error as Error).message; } };
        group.querySelector<HTMLSelectElement>("[data-mode]")!.onchange = changed;
    }
    function state(): State {
        const rules: Record<string, SpecialRule[]> = {}, excluded: string[] = [];
        for (const field of fields) {
            const group = [...standard.querySelectorAll<HTMLElement>("[data-filter-field]")].find(element => element.dataset.filterField === field.key)!;
            rules[field.key] = [...group.querySelectorAll<HTMLElement>(".business-rule")].map(row => {
                const op = row.querySelector<HTMLSelectElement>("[data-op]")!.value, value = row.querySelector<HTMLInputElement>("[data-value]")!.value, to = row.querySelector<HTMLInputElement>("[data-to]")!.value;
                return { field: field.key, op, value: ["empty", "present"].includes(op) ? "" : value, ...(op === "range" && to ? { to } : {}) };
            }).filter(rule => rule.value || rule.to || ["empty", "present"].includes(rule.op));
            if (group.querySelector<HTMLSelectElement>("[data-mode]")!.value === "exclude") excluded.push(field.key);
        }
        return { rules, excluded, custom: special.read() };
    }
    function compile(value: State): SpecialFilter[] {
        if (!value || typeof value !== "object" || !value.rules || typeof value.rules !== "object" || !Array.isArray(value.excluded) || value.excluded.some(key => !fields.some(field => field.key === key)) || Object.keys(value.rules).some(key => !fields.some(field => field.key === key))) throw Error("Preset filtri non valido.");
        const include: SpecialGroup[] = [], exclude: SpecialGroup[] = [];
        for (const [key, rules] of Object.entries(value.rules)) {
            if (!Array.isArray(rules) || rules.length > 20 || rules.some(rule => rule.field !== key)) throw Error("Condizioni del preset non valide.");
            if (rules.length) (value.excluded.includes(key) ? exclude : include).push({ join: "any", conditions: rules });
        }
        return validateSpecialFilters([...(include.length ? [{ name: "Campi standard", condition: { join: "all", conditions: include } }] : []), ...(exclude.length ? [{ name: "Esclusioni standard", exclude: true, condition: { join: "any", conditions: exclude } }] : []), ...validateSpecialFilters(value.custom, fields)], fields);
    }
    function sync(value: State = { rules: {}, excluded: [], custom: [] }) {
        compile(value);
        for (const field of fields) {
            const group = [...standard.querySelectorAll<HTMLElement>("[data-filter-field]")].find(element => element.dataset.filterField === field.key)!;
            group.querySelector("[data-rules]")!.replaceChildren();
            const rules = value.rules[field.key] || []; if (rules.length) rules.forEach(rule => addRule(group, field, rule)); else addRule(group, field);
            group.querySelector<HTMLSelectElement>("[data-mode]")!.value = value.excluded.includes(field.key) ? "exclude" : "include";
        }
        special.sync(value.custom); badges();
    }
    const read = () => compile(state());
    panel.querySelector<HTMLElement>("[data-filter-clear]")!.onclick = () => { sync(); options.changed(); };
    if (options.presets !== false) filterPresets(panel.querySelector<HTMLElement>(".business-filter-actions")!, `aypi.business-filters.v1:${options.key}`, () => { read(); return { filters: state(), extra: options.extraRead?.() }; }, value => { compile(value.filters); options.extraSync?.(value.extra); sync(value.filters); options.changed(); });
    badges(); return { read, state, sync, element: panel, dispose() { window.removeEventListener("resize", position); document.removeEventListener("scroll", position, true); } };
}
