export function applyRequestModeUi(
    document: Document,
    isIntervention: boolean,
) {
    const setActionButtonContent = (
        button: HTMLElement | null,
        iconName: string,
        label: string,
    ) => {
        if (!button) return;
        const icon = document.createElement("span");
        icon.className = "material-icons";
        icon.setAttribute("aria-hidden", "true");
        icon.textContent = iconName;
        button.replaceChildren(icon, document.createTextNode(label));
    };

    document.body.classList.toggle(
        "pm-mode-intervention",
        isIntervention,
    );
    const formTitle = document.getElementById("pm-form-title");
    const toggleButton = document.getElementById("pm-toggle-request");
    const notesLabel = document.getElementById("pm-notes-label");
    const notesInput = document.getElementById(
        "pm-notes",
    ) as HTMLInputElement | null;
    const formIntro = document.getElementById("pm-form-intro");
    const addLineButton = document.getElementById("pm-add-line");
    const saveButton = document.getElementById("pm-request-save");
    const subtitle = document.getElementById("pm-header-subtitle");

    if (formTitle) {
        formTitle.textContent = isIntervention
            ? "Richiesta intervento"
            : "Nuova richiesta";
    }
    if (toggleButton) {
        toggleButton.textContent = isIntervention
            ? "Richiedi acquisto"
            : "Richiedi Intervento";
    }
    if (notesLabel) {
        notesLabel.textContent = isIntervention
            ? "Note generali intervento"
            : "Note generali";
    }
    if (notesInput) {
        notesInput.placeholder = isIntervention
            ? "Note generali per l'intervento"
            : "Note generali per la richiesta";
    }
    if (formIntro) {
        formIntro.textContent = isIntervention
            ? "Descrivi gli interventi necessari oppure torna alla richiesta di acquisto."
            : "Inserisci gli articoli necessari oppure passa alla richiesta di intervento.";
    }
    setActionButtonContent(
        addLineButton,
        "add",
        isIntervention ? "Aggiungi intervento" : "Aggiungi prodotto",
    );
    setActionButtonContent(
        saveButton,
        "send",
        isIntervention ? "Invia intervento" : "Invia richiesta",
    );
    if (subtitle) {
        subtitle.textContent = isIntervention
            ? "Quale intervento vuoi richiedere?"
            : "Cosa vuoi ordinare?";
    }
}
