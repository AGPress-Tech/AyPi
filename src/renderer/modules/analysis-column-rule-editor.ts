import {
    ColumnRule,
    FilterColumn,
    validateColumnRules,
} from "../../main/modules/analysis-column-rules";
const esc = (v: unknown) =>
    String(v ?? "").replace(
        /[&<>"']/g,
        (c) =>
            ({
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                '"': "&quot;",
                "'": "&#39;",
            })[c]!,
    );
export function columnRuleEditor(
    host: HTMLElement,
    columns: readonly FilterColumn[],
) {
    function markup(c: FilterColumn, r: Partial<ColumnRule> = {}) {
        const numeric = c.kind === "number",
            date = c.kind === "date",
            op = r.op || (numeric || date ? "range" : "contains");
        const options =
            numeric || date
                ? [
                      ["range", "Da / a"],
                      ["exact", "Uguale a"],
                  ]
                : [
                      ["exact", "Corrisponde a"],
                      ["contains", "Contiene"],
                      ["prefix", "Inizia con"],
                      ["range", "Intervallo"],
                  ];
        const type = numeric ? 'number" step="any' : date ? "date" : "text";
        return `<div class="rule"><div class="rule-fields"><select data-op aria-label="Confronto ${esc(c.label)}">${options.map(([v, l]) => `<option value="${v}" ${v === op ? "selected" : ""}>${l}</option>`).join("")}</select><div class="range"><input data-value type="${type}" value="${esc(r.value)}" aria-label="${esc(c.label)} da"><input data-to type="${type}" value="${esc(r.to)}" aria-label="${esc(c.label)} a" ${op === "range" ? "" : "hidden"}></div></div><button class="remove-rule" type="button" aria-label="Rimuovi condizione ${esc(c.label)}">×</button></div>`;
    }
    function render(rules: readonly ColumnRule[]) {
        const open = new Map(
            [
                ...host.querySelectorAll<HTMLDetailsElement>(
                    "details[data-field]",
                ),
            ].map((d) => [d.dataset.field, d.open]),
        );
        host.innerHTML = columns
            .map((c, i) => {
                const selected = rules.filter((r) => r.field === c.key);
                return `<details class="filter-group" data-field="${c.key}" ${(open.get(c.key) ?? (i === 0 || !!selected.length)) ? "open" : ""}><summary>${esc(c.label)}<span class="badge">${selected.length || "Facoltativo"}</span></summary><div class="rules">${(selected.length ? selected : [{}]).map((r) => markup(c, r)).join("")}</div><button type="button" class="add-rule">+ Aggiungi alternativa</button></details>`;
            })
            .join("");
    }
    host.addEventListener("click", (event) => {
        const target = event.target as HTMLElement,
            group = target.closest<HTMLElement>("[data-field]");
        if (!group) return;
        if (target.closest(".add-rule")) {
            if (host.querySelectorAll(".rule").length >= 100) return;
            group
                .querySelector(".rules")!
                .insertAdjacentHTML(
                    "beforeend",
                    markup(columns.find((c) => c.key === group.dataset.field)!),
                );
        }
        if (target.closest(".remove-rule")) {
            const row = target.closest<HTMLElement>(".rule")!;
            if (row.parentElement!.children.length > 1) row.remove();
            else {
                row.querySelectorAll("input").forEach((i) => (i.value = ""));
            }
        }
    });
    host.addEventListener("change", (event) => {
        const op = event.target as HTMLSelectElement;
        if (op.matches("[data-op]"))
            op
                .closest(".rule")!
                .querySelector<HTMLElement>("[data-to]")!.hidden =
                op.value !== "range";
    });
    function read() {
        const rules: ColumnRule[] = [];
        host.querySelectorAll<HTMLElement>("[data-field]").forEach((group) =>
            group.querySelectorAll<HTMLElement>(".rule").forEach((row) => {
                const op = row.querySelector<HTMLSelectElement>("[data-op]")!
                        .value as ColumnRule["op"],
                    value =
                        row.querySelector<HTMLInputElement>(
                            "[data-value]",
                        )!.value,
                    to =
                        op === "range"
                            ? row.querySelector<HTMLInputElement>("[data-to]")!
                                  .value
                            : "";
                if (value || to)
                    rules.push({
                        field: group.dataset.field!,
                        op,
                        value,
                        ...(to ? { to } : {}),
                    });
            }),
        );
        return validateColumnRules(rules, columns);
    }
    return { render, read };
}
