export function ruleMode(exclude = false) {
    return `<select data-rule-mode aria-label="Mantieni o escludi la selezione"><option value="include">Mantieni selezionati</option><option value="exclude" ${exclude ? "selected" : ""}>Escludi selezionati</option></select>`;
}
export function readRuleMode(element: Element) {
    return element.querySelector<HTMLSelectElement>("[data-rule-mode]")
        ?.value === "exclude"
        ? { exclude: true as const }
        : {};
}
