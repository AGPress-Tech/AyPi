const openPickers = new Set<() => void>();
const reposition = () => { for (const position of openPickers) position(); };
window.addEventListener("resize", reposition);
document.addEventListener("scroll", reposition, true);

/** Keep the existing column disclosure above clipping containers and sticky tables. */
export function bindAnalysisColumnPicker(picker: HTMLDetailsElement) {
    const summary = picker.querySelector<HTMLElement>("summary")!;
    const panel = picker.querySelector<HTMLElement>(".column-picker")!;
    panel.setAttribute("popover", "auto");
    panel.setAttribute("aria-label", "Colonne visibili");
    panel.classList.add("analysis-column-popover");
    const position = () => {
        if (!picker.isConnected || !panel.matches(":popover-open")) { openPickers.delete(position); return; }
        const anchor = summary.getBoundingClientRect();
        const dialog = picker.closest("dialog[open]")?.getBoundingClientRect();
        const top = Math.max(8, (dialog?.top || 0) + 8);
        const bottom = Math.min(innerHeight - 8, (dialog?.bottom ?? innerHeight) - 8);
        const left = Math.max(8, (dialog?.left || 0) + 8);
        const right = Math.min(innerWidth - 8, (dialog?.right ?? innerWidth) - 8);
        panel.style.position = "fixed";
        panel.style.margin = "0";
        panel.style.inset = "auto";
        panel.style.minWidth = "0";
        panel.style.boxSizing = "border-box";
        panel.style.width = Math.min(260, right - left) + "px";
        const below = Math.max(0, bottom - anchor.bottom - 6);
        const above = Math.max(0, anchor.top - top - 6);
        const upwards = below < Math.min(panel.scrollHeight + 2, 280) && above > below;
        panel.style.maxHeight = Math.max(32, Math.min(380, upwards ? above : below)) + "px";
        const height = panel.getBoundingClientRect().height;
        panel.style.left = Math.max(left, Math.min(anchor.right - panel.offsetWidth, right - panel.offsetWidth)) + "px";
        panel.style.top = Math.max(top, Math.min(upwards ? anchor.top - height - 6 : anchor.bottom + 6, bottom - height)) + "px";
    };
    picker.addEventListener("toggle", () => {
        if (picker.open) {
            if (!panel.matches(":popover-open")) panel.showPopover();
            openPickers.add(position);
            position();
        } else {
            if (panel.matches(":popover-open")) panel.hidePopover();
            openPickers.delete(position);
        }
    });
    panel.addEventListener("toggle", event => {
        if ((event as ToggleEvent).newState === "closed") { picker.open = false; openPickers.delete(position); }
    });
    panel.addEventListener("change", position);
}
