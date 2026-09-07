let saving: Promise<any> | null = null;

export function withAttachmentSaveUi<T>(action: () => Promise<T>): Promise<T> {
    if (saving) return saving;
    const controls = Array.from(document.querySelectorAll<HTMLInputElement>("button, input, select, textarea"));
    const disabled = controls.map((control) => control.disabled);
    controls.forEach((control) => { control.disabled = true; });
    const overlay = document.createElement("div");
    overlay.setAttribute("role", "status");
    overlay.setAttribute("aria-live", "polite");
    overlay.style.cssText = "position:fixed;inset:0;z-index:2147483647;background:rgba(20,30,45,.75);display:flex;align-items:center;justify-content:center;color:white;font:600 18px sans-serif;text-align:center;padding:32px;cursor:wait";
    overlay.textContent = "Salvataggio e caricamento allegati in corso… Attendi il completamento prima di chiudere la finestra.";
    document.body.appendChild(overlay);
    saving = Promise.resolve().then(action).finally(() => {
        overlay.remove();
        controls.forEach((control, index) => { control.disabled = disabled[index]; });
        saving = null;
    });
    return saving;
}
