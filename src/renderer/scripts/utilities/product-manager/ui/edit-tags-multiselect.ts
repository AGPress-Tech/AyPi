interface EditTagsMultiselectDependencies {
    document: Document;
    openMenu: (
        menu: HTMLElement,
        button: HTMLElement,
        host: HTMLElement,
    ) => void;
    closeMenu: (
        menu: Element,
        host: Element | null,
    ) => void;
}

interface EditTagsMultiselectOptions {
    container: HTMLElement | null;
    input: HTMLInputElement | null;
    values: string[];
    selected: string[];
}

export function buildEditTagsMultiSelect(
    dependencies: EditTagsMultiselectDependencies,
    options: EditTagsMultiselectOptions,
) {
    const { document } = dependencies;
    const { container, input, values, selected } = options;
    if (!container || !input) return null;

    container.innerHTML = "";
    const wrapper = document.createElement("div");
    wrapper.className = "pm-multiselect";
    wrapper.dataset.pmHostId =
        wrapper.dataset.pmHostId ||
        `pm-edit-tags-${Math.random().toString(36).slice(2)}`;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "pm-multiselect__button";
    const menu = document.createElement("div");
    menu.className = "pm-multiselect__menu is-hidden";
    const selectedValues = new Set((selected || []).filter(Boolean));
    const availableValues = Array.from(
        new Set((values || []).filter(Boolean)),
    ).sort((left, right) => left.localeCompare(right));

    const updateLabel = () => {
        const current = Array.from(selectedValues);
        button.textContent = current.length
            ? current.join(", ")
            : "Seleziona tipologie";
        input.value = current.join(", ");
    };

    if (!availableValues.length) {
        const empty = document.createElement("div");
        empty.className = "pm-message";
        empty.textContent = "Nessuna tipologia disponibile.";
        menu.appendChild(empty);
    }

    availableValues.forEach((value) => {
        const option = document.createElement("label");
        option.className = "pm-multiselect__option";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.value = value;
        checkbox.checked = selectedValues.has(value);
        const text = document.createElement("span");
        text.textContent = value;
        checkbox.addEventListener("change", () => {
            if (checkbox.checked) selectedValues.add(value);
            else selectedValues.delete(value);
            updateLabel();
        });
        option.append(checkbox, text);
        menu.appendChild(option);
    });

    const closeOtherMenus = () => {
        document
            .querySelectorAll(".pm-multiselect__menu--floating")
            .forEach((otherMenu) => {
                if (otherMenu === menu) return;
                const hostId =
                    (otherMenu as HTMLElement).dataset.pmHostId || "";
                const host = hostId
                    ? document.querySelector(
                          `[data-pm-host-id="${hostId}"]`,
                      )
                    : null;
                dependencies.closeMenu(otherMenu, host);
            });
        document
            .querySelectorAll(".pm-custom-select.is-open")
            .forEach((customSelect) => {
                customSelect.classList.remove("is-open");
            });
    };

    button.addEventListener("click", (event) => {
        event.stopPropagation();
        if (menu.classList.contains("is-hidden")) {
            closeOtherMenus();
            dependencies.openMenu(menu, button, wrapper);
        } else {
            dependencies.closeMenu(menu, wrapper);
        }
    });
    document.addEventListener("click", (event) => {
        const target = event.target as Node | null;
        if (
            target &&
            !wrapper.contains(target) &&
            !menu.contains(target)
        ) {
            dependencies.closeMenu(menu, wrapper);
        }
    });

    updateLabel();
    wrapper.append(button, menu);
    container.appendChild(wrapper);
    return { getSelected: () => Array.from(selectedValues) };
}
