export function createInterventionRequestLine(
    context: {
        document: Document;
        urgencyOptions: string[];
        toTags: (value: string) => string[];
        renderInterventionTypeOptions: (
            selected: string[],
            onChange: (values: string[]) => void,
        ) => { wrap: HTMLElement };
        updateLineField: (
            index: number,
            field: string,
            value: string,
        ) => void;
        removeLine: (index: number) => void;
    },
    line: any,
    index: number,
) {
    const { document } = context;
    const wrapper = document.createElement("div");
    wrapper.className = "pm-line";
    wrapper.dataset.index = String(index);
    const grid = document.createElement("div");
    grid.className = "pm-line-grid pm-line-grid--intervention";

    const typeField = document.createElement("div");
    typeField.className = "pm-field";
    const typeLabel = document.createElement("label");
    typeLabel.textContent = "Tipologia di intervento";
    const { wrap } = context.renderInterventionTypeOptions(
        context.toTags(line.interventionType || ""),
        (values) => {
            context.updateLineField(
                index,
                "interventionType",
                values.join(", "),
            );
        },
    );
    typeField.append(typeLabel, wrap);

    const descriptionField = document.createElement("div");
    descriptionField.className = "pm-field";
    const descriptionLabel = document.createElement("label");
    descriptionLabel.textContent = "Descrizione";
    const descriptionInput = document.createElement("textarea");
    descriptionInput.rows = 2;
    descriptionInput.value = line.description || "";
    descriptionInput.placeholder = "Descrizione intervento";
    descriptionInput.addEventListener("input", (event) => {
        context.updateLineField(
            index,
            "description",
            (event.target as HTMLTextAreaElement).value,
        );
    });
    descriptionField.append(descriptionLabel, descriptionInput);

    const urgencyField = document.createElement("div");
    urgencyField.className = "pm-field";
    const urgencyLabel = document.createElement("label");
    urgencyLabel.textContent = "Urgenza";
    const urgencySelect = document.createElement("select");
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Seleziona urgenza";
    placeholder.disabled = true;
    placeholder.selected = !line.urgency;
    urgencySelect.appendChild(placeholder);
    context.urgencyOptions.forEach((option) => {
        const item = document.createElement("option");
        item.value = option;
        item.textContent = option;
        item.selected = line.urgency === option;
        urgencySelect.appendChild(item);
    });
    urgencySelect.addEventListener("change", (event) => {
        context.updateLineField(
            index,
            "urgency",
            (event.target as HTMLSelectElement).value,
        );
    });
    urgencyField.append(urgencyLabel, urgencySelect);
    grid.append(typeField, descriptionField, urgencyField);

    const actionsField = document.createElement("div");
    actionsField.className = "pm-field";
    const actionsLabel = document.createElement("label");
    actionsLabel.textContent = "Azioni";
    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "pm-btn pm-btn--ghost";
    removeButton.textContent = "Rimuovi";
    removeButton.addEventListener("click", () => context.removeLine(index));
    actionsField.append(actionsLabel, removeButton);

    wrapper.append(grid, actionsField);
    return wrapper;
}
