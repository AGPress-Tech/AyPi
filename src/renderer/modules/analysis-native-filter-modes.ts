import { FilterModes } from "../../main/modules/analysis-filter-modes";
/** Reuse the native filter's read/apply and preset lifecycle. */
export function nativeFilterModes(groups: Record<string, readonly string[]>) {
    const controls = new Map<string, HTMLSelectElement>();
    function mount() {
    for (const [key, selectors] of Object.entries(groups)) {
        const target = selectors.map(s => document.querySelector<HTMLElement>(s)).find(Boolean);
        if (!target || (controls.get(key)?.isConnected)) continue;
        const label = document.createElement("label");
        label.className = "analysis-filter-mode";
        label.innerHTML = `<select aria-label="Mantieni o escludi ${key}"><option value="include">Mantieni selezionati</option><option value="exclude">Escludi selezionati</option></select>`;
        const anchor = target.closest("label") || target;
        anchor.after(label);
        const select = label.querySelector("select")!;
        select.dataset.filterMode = key;
        select.addEventListener("change", () => { target.dispatchEvent(new Event("input", { bubbles: true })); target.dispatchEvent(new Event("change", { bubbles: true })); });
        controls.set(key, select);
    }
    }
    mount();
    return {
        read(): FilterModes { mount(); return Object.fromEntries([...controls].filter(([, el]) => el.value === "exclude").map(([key]) => [key, "exclude"])); },
        sync(modes: FilterModes = {}) { mount(); for (const [key, el] of controls) el.value = modes[key] || "include"; },
    };
}
