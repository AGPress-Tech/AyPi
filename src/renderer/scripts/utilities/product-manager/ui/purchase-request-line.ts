export interface PurchaseRequestLine {
    product?: string;
    category?: string;
    quantity?: string;
    unit?: string;
    urgency?: string;
    supplier?: string;
    url?: string;
    note?: string;
}

interface PurchaseRequestLineContext {
    document: Document;
    catalogCategories: string[];
    urgencyOptions: string[];
    toTags: (value: string) => string[];
    openMultiselectMenu: (
        menu: HTMLElement,
        trigger: HTMLElement,
        host: HTMLElement,
    ) => void;
    closeMultiselectMenu: (menu: HTMLElement, host: HTMLElement) => void;
    updateLineField: (
        index: number,
        field: keyof PurchaseRequestLine,
        value: string,
    ) => void;
    removeLine: (index: number) => void;
}

function createTextField(
    document: Document,
    options: {
        label: string;
        value?: string;
        placeholder: string;
        onInput: (value: string) => void;
    },
) {
    const field = document.createElement("div");
    field.className = "pm-field";
    const label = document.createElement("label");
    label.textContent = options.label;
    const input = document.createElement("input");
    input.type = "text";
    input.value = options.value || "";
    input.placeholder = options.placeholder;
    input.addEventListener("input", () => options.onInput(input.value));
    field.append(label, input);
    return field;
}

function createCategoryField(
    context: PurchaseRequestLineContext,
    line: PurchaseRequestLine,
    index: number,
) {
    const { document } = context;
    const field = document.createElement("div");
    field.className = "pm-field";
    const label = document.createElement("label");
    label.textContent = "Tipologia";

    const wrapper = document.createElement("div");
    wrapper.className = "pm-multiselect";
    const display = document.createElement("button");
    display.type = "button";
    display.className = "pm-multiselect__button";
    const updateDisplay = (values: string[]) => {
        if (!values.length) {
            display.textContent = "Seleziona tipologie";
        } else if (values.length > 2) {
            display.textContent = `${values.slice(0, 2).join(", ")} +${values.length - 2} more`;
        } else {
            display.textContent = values.join(", ");
        }
    };

    const menu = document.createElement("div");
    menu.className = "pm-multiselect__menu is-hidden";
    const selected = new Set(context.toTags(line.category || ""));
    context.catalogCategories.forEach((category) => {
        const option = document.createElement("label");
        option.className = "pm-multiselect__option";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.value = category;
        checkbox.checked = selected.has(category);
        const text = document.createElement("span");
        text.textContent = category;
        checkbox.addEventListener("change", () => {
            if (checkbox.checked) selected.add(category);
            else selected.delete(category);
            const values = Array.from(selected);
            context.updateLineField(index, "category", values.join(", "));
            updateDisplay(values);
        });
        option.append(checkbox, text);
        menu.appendChild(option);
    });

    display.addEventListener("click", (event) => {
        event.stopPropagation();
        if (menu.classList.contains("is-hidden")) {
            context.openMultiselectMenu(menu, display, wrapper);
        } else {
            context.closeMultiselectMenu(menu, wrapper);
        }
    });
    document.addEventListener("click", (event) => {
        const target = event.target as Node | null;
        if (
            target &&
            !wrapper.contains(target) &&
            !menu.contains(target)
        ) {
            context.closeMultiselectMenu(menu, wrapper);
        }
    });

    updateDisplay(Array.from(selected));
    wrapper.append(display, menu);
    field.append(label, wrapper);
    return field;
}

function createQuantityField(
    context: PurchaseRequestLineContext,
    line: PurchaseRequestLine,
    index: number,
) {
    const { document } = context;
    const field = document.createElement("div");
    field.className = "pm-field";
    const label = document.createElement("label");
    label.textContent = "Quantità";
    const input = document.createElement("input");
    input.className = "pm-qty-input";
    input.type = "number";
    input.min = "0";
    input.step = "1";
    input.value = line.quantity || "";
    input.placeholder = "0";
    input.addEventListener("input", () =>
        context.updateLineField(index, "quantity", input.value),
    );
    field.append(label, input);
    return field;
}

function createUrgencyField(
    context: PurchaseRequestLineContext,
    line: PurchaseRequestLine,
    index: number,
) {
    const { document } = context;
    const field = document.createElement("div");
    field.className = "pm-field";
    const label = document.createElement("label");
    label.textContent = "Urgenza";
    const select = document.createElement("select");
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Seleziona urgenza";
    placeholder.disabled = true;
    placeholder.selected = !line.urgency;
    select.appendChild(placeholder);
    context.urgencyOptions.forEach((urgency) => {
        const option = document.createElement("option");
        option.value = urgency;
        option.textContent = urgency;
        option.selected = line.urgency === urgency;
        select.appendChild(option);
    });
    select.addEventListener("change", () =>
        context.updateLineField(index, "urgency", select.value),
    );
    field.append(label, select);
    return field;
}

export function createPurchaseRequestLine(
    context: PurchaseRequestLineContext,
    line: PurchaseRequestLine,
    index: number,
) {
    const { document } = context;
    const wrapper = document.createElement("div");
    wrapper.className = "pm-line";
    wrapper.dataset.index = String(index);

    const grid = document.createElement("div");
    grid.className = "pm-line-grid";
    grid.append(
        createTextField(document, {
            label: "Prodotto",
            value: line.product,
            placeholder: "Nome prodotto",
            onInput: (value) =>
                context.updateLineField(index, "product", value),
        }),
        createCategoryField(context, line, index),
        createQuantityField(context, line, index),
        createTextField(document, {
            label: "UM",
            value: line.unit,
            placeholder: "Pezzi / Scatole",
            onInput: (value) =>
                context.updateLineField(index, "unit", value),
        }),
        createUrgencyField(context, line, index),
    );

    const secondary = document.createElement("div");
    secondary.className = "pm-line-grid pm-line-grid--secondary";
    secondary.append(
        createTextField(document, {
            label: "Fornitore",
            value: line.supplier,
            placeholder: "Nome fornitore (opzionale)",
            onInput: (value) =>
                context.updateLineField(index, "supplier", value),
        }),
        createTextField(document, {
            label: "URL",
            value: line.url,
            placeholder: "Link prodotto (opzionale)",
            onInput: (value) =>
                context.updateLineField(index, "url", value),
        }),
        createTextField(document, {
            label: "Note riga",
            value: line.note,
            placeholder: "Note specifiche",
            onInput: (value) =>
                context.updateLineField(index, "note", value),
        }),
    );

    const actions = document.createElement("div");
    actions.className = "pm-field";
    const actionsLabel = document.createElement("label");
    actionsLabel.textContent = "Azioni";
    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "pm-btn pm-btn--ghost";
    removeButton.textContent = "Rimuovi";
    removeButton.addEventListener("click", () => context.removeLine(index));
    actions.append(actionsLabel, removeButton);
    secondary.appendChild(actions);

    wrapper.append(grid, secondary);
    return wrapper;
}
