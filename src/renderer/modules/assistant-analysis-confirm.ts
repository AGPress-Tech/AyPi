import { overviewAssistantPrompt } from "../../main/modules/analysis-overview-model";
let pendingAnalysisConfirmation: Promise<any> | null = null;

/** One themed confirmation for both the company bot and Blue Archive assistants. */
export function openAssistantAnalysis(opener: HTMLElement, input?: { assistant: string; name: string }): Promise<any> {
    if (pendingAnalysisConfirmation) return pendingAnalysisConfirmation;
    opener.setAttribute("aria-busy", "true");
    pendingAnalysisConfirmation = (async () => {
        const prompt = overviewAssistantPrompt(input);
        const dialog = document.createElement("dialog");
        dialog.className = "assistant-analysis-confirm";
        dialog.setAttribute("aria-labelledby", "assistantAnalysisQuestion");
        dialog.setAttribute("aria-describedby", "assistantAnalysisDetail");
        dialog.setAttribute("aria-modal", "true");
        dialog.innerHTML = `<header><span class="eyebrow" data-assistant-name></span><button type="button" data-answer="no" class="assistant-confirm-close" aria-label="Chiudi">×</button></header><div class="assistant-confirm-body"><h2 id="assistantAnalysisQuestion"></h2><p id="assistantAnalysisDetail"></p></div><footer><button type="button" class="time-secondary" data-answer="no" autofocus>No</button><button type="button" class="time-primary" data-answer="yes">Sì</button></footer>`;
        dialog.querySelector("[data-assistant-name]")!.textContent = prompt.title;
        dialog.querySelector("h2")!.textContent = prompt.message;
        dialog.querySelector("p")!.textContent = prompt.detail;
        document.body.append(dialog);
        const accepted = await new Promise<boolean>(resolve => {
            dialog.querySelectorAll<HTMLButtonElement>("[data-answer]").forEach(button => button.onclick = () => dialog.close(button.dataset.answer));
            dialog.addEventListener("close", () => resolve(dialog.returnValue === "yes"), { once: true });
            dialog.showModal();
        }).finally(() => { dialog.remove(); if (opener.isConnected) opener.focus(); });
        if (!accepted) return { ok: true, canceled: true };
        return require("electron").ipcRenderer.invoke("analysis-overview-open", input);
    })().finally(() => { pendingAnalysisConfirmation = null; opener.removeAttribute("aria-busy"); });
    return pendingAnalysisConfirmation;
}
