import { SpecialColumn, SpecialCondition, SpecialFilter, SpecialGroup, SpecialRule, SPECIAL_OPERATORS, specialOperators, validateSpecialFilters, specialFilterMatcher } from "../../main/modules/analysis-special-filters";
const matchers = new WeakMap<SpecialFilter[], Map<string, ReturnType<typeof specialFilterMatcher>>>();
const dialogs = new Map<HTMLElement, HTMLDialogElement>();
let cleanupObserver: MutationObserver | undefined;
export function matchesSpecialRow(row: Record<string, any>, filters: SpecialFilter[] | undefined, columns: readonly SpecialColumn[]) {
    if (!filters?.length) return true;
    const key = columns.map(c => c.key + ":" + c.kind).join("|"), cache = matchers.get(filters) || new Map();
    if (!cache.has(key)) cache.set(key, specialFilterMatcher(filters, columns));
    matchers.set(filters, cache);
    return cache.get(key)!(row);
}
const esc = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
export function specialFilterEditor(host: HTMLElement, fields: readonly SpecialColumn[] | (() => readonly SpecialColumn[]), changed: () => void) {
    const columns = () => (typeof fields === "function" ? fields() : fields).map(c => ({ ...c, kind: c.kind === "money" ? "number" : c.kind }));
    let filters: SpecialFilter[] = [], draft: SpecialFilter, editing = -1, opener: HTMLElement | null = null;
    const section = document.createElement("section");
    section.className = "analysis-special-filters";
    section.setAttribute("aria-label", "Filtri speciali");
    section.innerHTML = '<button type="button" data-special-create>+ Filtro speciale</button><div class="special-filter-list"></div>';
    const action = host.querySelector(":scope>.filter-actions,:scope>.analysis-filter-presets,:scope>.bom-presets");
    action ? action.before(section) : host.append(section);
    const dialog = document.createElement("dialog");
    dialog.className = "analysis-special-dialog";
    dialog.setAttribute("aria-label", "Definisci filtro speciale");
    dialog.innerHTML = '<form><header><h2>Filtro speciale</h2><button type="button" data-special-cancel aria-label="Chiudi filtro speciale">×</button></header><div class="special-dialog-scroll"><label>Nome del filtro<input data-special-name maxlength="60" required></label><label>Mostra le righe che<select data-special-mode><option value="include">Corrispondono al filtro</option><option value="exclude">Non corrispondono al filtro</option></select></label><p>Combina le condizioni con E / O. Un sottogruppo permette, ad esempio, A E (B O C). Si combina con gli altri filtri attivi.</p><div data-special-tree></div><p data-special-error role="alert"></p></div><footer><button type="button" data-special-cancel>Annulla</button><button type="submit" class="primary">Applica filtro</button></footer></form>';
    document.body.append(dialog);
    dialogs.set(host, dialog);
    if (!cleanupObserver) {
        cleanupObserver = new MutationObserver(changes => {
            if (!changes.some(change => change.removedNodes.length)) return;
            for (const [root, modal] of dialogs) if (!root.isConnected) {
                modal.remove(); dialogs.delete(root);
            }
        });
        cleanupObserver.observe(document.body, { childList: true, subtree: true });
    }
    const el = <T extends HTMLElement = HTMLElement>(selector: string) => dialog.querySelector<T>(selector)!;
    function freshRule(): SpecialRule {
        const first = columns()[0];
        return { field: first.key, op: first.kind === "text" ? "contains" : "exact", value: first.kind === "boolean" ? "1" : "" };
    }
    function groupMarkup(group: SpecialGroup, key: string, depth = 1): string {
        return `<fieldset class="special-condition-group" data-special-path="${key}"><legend>${depth === 1 ? "Combina le condizioni" : "Sottogruppo"}</legend><div class="special-group-head"><select data-special-join aria-label="Come combinare le condizioni"><option value="all" ${group.join === "all" ? "selected" : ""}>Tutte le condizioni (E)</option><option value="any" ${group.join === "any" ? "selected" : ""}>Almeno una condizione (O)</option></select>${depth > 1 ? '<button type="button" data-special-remove aria-label="Rimuovi sottogruppo">×</button>' : ""}</div><div>${group.conditions.map((condition, index) => {
            const path = key + "." + index;
            if ("join" in condition) return groupMarkup(condition, path, depth + 1);
            const column = columns().find(c => c.key === condition.field), kind = column?.kind || "text";
            return `<div class="special-condition" data-special-path="${path}"><label>Campo<select data-special-field>${columns().map(c => `<option value="${esc(c.key)}" ${c.key === condition.field ? "selected" : ""}>${esc(c.label)}</option>`).join("")}</select></label><label>Condizione<select data-special-op>${specialOperators(kind).map(op => `<option value="${op}" ${condition.op === op ? "selected" : ""}>${esc(SPECIAL_OPERATORS[op])}</option>`).join("")}</select></label>${["empty", "present"].includes(condition.op) ? "" : `<label>${condition.op === "range" ? "Da" : "Valore"}${kind === "boolean" ? `<select data-special-value><option value="1" ${condition.value === "1" ? "selected" : ""}>Sì</option><option value="0" ${condition.value === "0" ? "selected" : ""}>No</option></select>` : `<input data-special-value type="${kind === "number" ? "number" : kind === "date" ? "date" : "text"}" ${kind === "number" ? 'step="any"' : ""} maxlength="256" value="${esc(condition.value)}">`}</label>${condition.op === "range" ? `<label>A<input data-special-to type="${kind === "number" ? "number" : kind === "date" ? "date" : "text"}" ${kind === "number" ? 'step="any"' : ""} maxlength="256" value="${esc(condition.to)}"></label>` : ""}`}<button type="button" data-special-remove aria-label="Rimuovi condizione">×</button></div>`;
        }).join("")}</div><div class="special-group-actions"><button type="button" data-special-add>+ Condizione</button>${depth < 3 ? '<button type="button" data-special-add-group>+ Gruppo E / O</button>' : ""}</div></fieldset>`;
    }
    function redraw() { el("[data-special-tree]").innerHTML = groupMarkup(draft.condition, "root"); }
    function at(path: string): SpecialCondition {
        return path.split(".").slice(1).reduce<SpecialCondition>((current, index) => (current as SpecialGroup).conditions[Number(index)], draft.condition);
    }
    function show(index: number, target: HTMLElement) {
        if (!columns().length || (index < 0 && filters.length >= 12)) return;
        editing = index; opener = target;
        draft = index >= 0 ? JSON.parse(JSON.stringify(filters[index])) : { name: "Filtro speciale " + (filters.length + 1), condition: { join: "all", conditions: [freshRule(), freshRule()] } };
        el<HTMLInputElement>("[data-special-name]").value = draft.name;
        el<HTMLSelectElement>("[data-special-mode]").value = draft.exclude ? "exclude" : "include";
        el("[data-special-error]").textContent = "";
        redraw(); dialog.showModal(); el<HTMLInputElement>("[data-special-name]").focus();
    }
    function render() {
        section.querySelector(".special-filter-list")!.innerHTML = filters.map((filter, index) => `<div class="special-filter-chip" data-special-index="${index}"><label title="Attiva o disattiva il filtro"><input type="checkbox" data-special-enabled ${filter.enabled === false ? "" : "checked"}><span>${esc(filter.name)}${filter.exclude ? " · escluso" : ""}</span></label><button type="button" data-special-edit aria-label="Modifica ${esc(filter.name)}">Modifica</button><button type="button" data-special-delete aria-label="Rimuovi ${esc(filter.name)}">×</button></div>`).join("");
    }
    section.addEventListener("click", event => {
        const target = event.target as HTMLElement;
        if (target.closest("[data-special-create]")) show(-1, target);
        const row = target.closest<HTMLElement>("[data-special-index]");
        if (!row) return;
        const index = Number(row.dataset.specialIndex);
        if (target.closest("[data-special-edit]")) show(index, target);
        if (target.closest("[data-special-delete]")) { filters.splice(index, 1); render(); changed(); }
    });
    section.addEventListener("change", event => {
        const target = event.target as HTMLInputElement;
        if (target.matches("[data-special-enabled]")) { filters[Number(target.closest<HTMLElement>("[data-special-index]")!.dataset.specialIndex)].enabled = target.checked; changed(); }
    });
    dialog.addEventListener("input", event => {
        const target = event.target as HTMLInputElement, row = target.closest<HTMLElement>(".special-condition");
        if (!row) return;
        const rule = at(row.dataset.specialPath!) as SpecialRule;
        if (target.matches("[data-special-value]")) rule.value = target.value;
        if (target.matches("[data-special-to]")) rule.to = target.value;
    });
    dialog.addEventListener("change", event => {
        const target = event.target as HTMLSelectElement, row = target.closest<HTMLElement>("[data-special-path]");
        if (!row) return;
        const node = at(row.dataset.specialPath!);
        if (target.matches("[data-special-join]")) (node as SpecialGroup).join = target.value as "all" | "any";
        if (target.matches("[data-special-field]")) {
            const rule = node as SpecialRule; rule.field = target.value;
            const kind = columns().find(c => c.key === rule.field)!.kind;
            rule.op = kind === "text" ? "contains" : "exact"; rule.value = kind === "boolean" ? "1" : ""; delete rule.to;
            redraw();
        }
        if (target.matches("[data-special-op]")) { (node as SpecialRule).op = target.value; redraw(); }
        if (target.matches("[data-special-value]")) (node as SpecialRule).value = target.value;
    });
    dialog.addEventListener("click", event => {
        const target = event.target as HTMLElement;
        if (target.closest("[data-special-cancel]")) { dialog.close(); return; }
        const row = target.closest<HTMLElement>("[data-special-path]");
        if (!row) return;
        const group = at(row.dataset.specialPath!) as SpecialGroup;
        if (target.closest("[data-special-add],[data-special-add-group]")) {
            const count = (node: SpecialCondition): number => "join" in node ? 1 + node.conditions.reduce((sum, child) => sum + count(child), 0) : 1;
            const total = filters.reduce((sum, filter, index) => sum + (index === editing ? 0 : count(filter.condition)), 0) + count(draft.condition);
            if (group.conditions.length >= 30 || total + (target.closest("[data-special-add-group]") ? 3 : 1) > 100) {
                el("[data-special-error]").textContent = "Massimo 30 condizioni per gruppo e 100 complessive. Puoi rimuovere una condizione o un gruppo.";
                return;
            }
        }
        if (target.closest("[data-special-add]")) group.conditions.push(freshRule());
        else if (target.closest("[data-special-add-group]")) group.conditions.push({ join: "any", conditions: [freshRule(), freshRule()] });
        else if (target.closest("[data-special-remove]")) {
            const parts = row.dataset.specialPath!.split("."), index = Number(parts.pop());
            (at(parts.join(".")) as SpecialGroup).conditions.splice(index, 1);
        } else return;
        redraw();
    });
    dialog.querySelector("form")!.addEventListener("submit", event => {
        event.preventDefault();
        try {
            draft.name = el<HTMLInputElement>("[data-special-name]").value.trim();
            draft.exclude = el<HTMLSelectElement>("[data-special-mode]").value === "exclude";
            const next = [...filters]; editing < 0 ? next.push(draft) : next.splice(editing, 1, draft);
            filters = validateSpecialFilters(next, columns()); render(); dialog.close(); changed();
        } catch (error) { el("[data-special-error]").textContent = (error as Error).message; }
    });
    dialog.addEventListener("pointerdown", event => event.stopPropagation());
    dialog.addEventListener("close", () => {
        const target = opener?.isConnected ? opener : section.querySelector<HTMLElement>("[data-special-create]");
        for (let ancestor = target?.parentElement; ancestor; ancestor = ancestor.parentElement)
            if (ancestor instanceof HTMLDetailsElement) ancestor.open = true;
        target?.focus();
    });
    dialog.addEventListener("keydown", event => { if (event.key === "Escape") event.stopPropagation(); });
    host.addEventListener("aypi-filter-preset-capture", (event: CustomEvent) => { event.detail.state = { ...event.detail.state, special: validateSpecialFilters(filters, columns()) }; });
    host.addEventListener("aypi-filter-preset-restore", (event: CustomEvent) => { filters = validateSpecialFilters(event.detail.state?.special, columns()); render(); });
    host.addEventListener("aypi-filter-preset-applied", () => changed());
    return {
        read: () => validateSpecialFilters(filters, columns()),
        sync(value: SpecialFilter[] = []) { filters = JSON.parse(JSON.stringify(value)); render(); },
    };
}
