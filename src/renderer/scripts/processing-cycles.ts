import { installAnalysisLinks } from "../modules/analysis-links";
import type { AnalysisContext } from "../../main/modules/analysis-navigation-model";
import {
    cycleHeaderFields,
    cyclePhaseFields,
    emptyProcessingCycle,
    emptyCyclePhase,
    escapeCycle as esc,
    processingCyclePrintHtml,
    ProcessingCycle,
} from "../modules/processing-cycle-document";
const ipc = require("electron").ipcRenderer;
const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
    document.getElementById(id) as T;
let view = "home",
    items: ProcessingCycle[] = [],
    draft: ProcessingCycle = emptyProcessingCycle(),
    readOnly = false,
    savedSnapshot = "",
    busy = false,
    allowClose = false,
    visible = 250,
    dragged = "";
let contextArticle = "",
    pendingCycleContext: AnalysisContext | null = null;
const filteredValues: Record<string, string> = {};
function status(message = "", error = false) {
    $("status").textContent = message;
    $("status").classList.toggle("error", error);
}
async function api(action: string, extra: any = {}) {
    const result = await ipc.invoke("processing-cycles-request", {
        action,
        ...extra,
    });
    if (!result.ok) throw Error(result.error || "Operazione non riuscita.");
    return result;
}
function show(name: string) {
    view = name;
    for (const key of ["home", "list", "form"])
        $(key + "View").hidden = key !== name;
    window.scrollTo(0, 0);
}
function collect(): ProcessingCycle {
    if (view !== "form") return draft;
    const header = Object.fromEntries(
        cycleHeaderFields.map((field) => [
            field.key,
            (
                $("technicalFields").querySelector(
                    `[data-header="${field.key}"]`,
                ) as HTMLInputElement
            ).value,
        ]),
    );
    const fasi = [
        ...$("phases").querySelectorAll<HTMLElement>("[data-phase-id]"),
    ].map((node, index) => ({
        id: node.dataset.phaseId!,
        fase: (index + 1) * 5,
        ...Object.fromEntries(
            cyclePhaseFields.map((field) => [
                field.key,
                (
                    node.querySelector(
                        `[data-phase-field="${field.key}"]`,
                    ) as HTMLInputElement
                ).value,
            ]),
        ),
    }));
    return { ...draft, ...header, fasi };
}
const dirty = () =>
    view === "form" && !readOnly && JSON.stringify(collect()) !== savedSnapshot;
async function confirm(title: string, message: string) {
    const dialog = $<HTMLDialogElement>("confirmDialog");
    if (dialog.open) return false;
    $("confirmTitle").textContent = title;
    $("confirmMessage").textContent = message;
    const previous = document.activeElement as HTMLElement;
    dialog.returnValue = "cancel";
    dialog.showModal();
    return new Promise<boolean>((resolve) =>
        dialog.addEventListener(
            "close",
            () => {
                previous?.focus();
                resolve(dialog.returnValue === "confirm");
            },
            { once: true },
        ),
    );
}
async function canLeave() {
    return (
        !dirty() ||
        (await confirm(
            "Modifiche non salvate",
            "Uscire dalla scheda e scartare le modifiche?",
        ))
    );
}
async function action(run: () => Promise<void>) {
    if (busy) return;
    busy = true;
    syncButtons();
    try {
        await run();
    } catch (error) {
        status((error as Error).message, true);
    } finally {
        busy = false;
        syncButtons();
        if (pendingCycleContext) void applyCycleContext();
    }
}
function syncButtons() {
    for (const id of [
        "saveCycle",
        "newFromForm",
        "editCycle",
        "copyCycle",
        "deleteCycle",
        "printCycle",
        "addPhase",
        "refreshList",
        "newCycle",
        "formBack",
        "listBack",
    ])
        $<HTMLButtonElement>(id).disabled = busy;
    $("cycleForm")
        .querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
            "input,textarea",
        )
        .forEach((input) => (input.disabled = busy || readOnly));
    const phases = [
        ...$("phases").querySelectorAll<HTMLElement>("[data-phase-id]"),
    ];
    phases.forEach((row, index) =>
        row
            .querySelectorAll<HTMLButtonElement>("button")
            .forEach((button) => (button.disabled = busy || readOnly)),
    );
}
function fieldHtml(
    field: { key: string; label: string; type?: string },
    source: any,
    phase = false,
) {
    const attr = phase ? "data-phase-field" : "data-header",
        disabled = readOnly ? "disabled" : "",
        required = !phase && field.key === "codiceProdotto" ? "required" : "";
    return `<label class="cycle-field">${esc(field.label)}${required ? " *" : ""}${field.key === "descrizione" ? `<textarea ${attr}="${field.key}" rows="2" maxlength="10000" ${disabled}>${esc(source[field.key])}</textarea>` : `<input ${attr}="${field.key}" type="${field.type || "text"}" value="${esc(source[field.key])}" maxlength="${field.key === "codiceProdotto" ? 200 : 1000}" ${required} ${disabled}>`}</label>`;
}
function headerRow(keys: string[], cls = "") {
    return `<div class="cycle-technical-row ${cls}">${keys.map((key) => fieldHtml(cycleHeaderFields.find((field) => field.key === key)!, draft)).join("")}</div>`;
}
function renderPhases() {
    $("phases").innerHTML =
        draft.fasi
            .map(
                (phase, index) =>
                    `<article class="cycle-phase" data-phase-id="${esc(phase.id)}"><div class="cycle-phase-heading">${readOnly ? "" : `<button type="button" class="phase-drag" draggable="true" aria-label="Trascina fase ${(index + 1) * 5}" title="Trascina per spostare la fase">⠿</button>`}<strong>Fase ${(index + 1) * 5}</strong><div class="phase-actions" ${readOnly ? "hidden" : ""}><button type="button" data-remove-phase aria-label="Elimina fase ${(index + 1) * 5}" title="Elimina fase">×</button></div></div><div class="cycle-phase-grid">${cyclePhaseFields
                        .slice(0, 3)
                        .map((field) => fieldHtml(field, phase, true))
                        .join(
                            "",
                        )}<fieldset class="cycle-phase-times"><legend>Tempi</legend>${cyclePhaseFields
                        .slice(3, 7)
                        .map((field) => fieldHtml(field, phase, true))
                        .join(
                            "",
                        )}</fieldset><div class="cycle-operator">${cyclePhaseFields
                        .slice(7, 9)
                        .map((field) => fieldHtml(field, phase, true))
                        .join(
                            "",
                        )}</div></div><div class="cycle-phase-description">${fieldHtml(cyclePhaseFields[9], phase, true)}</div></article>`,
            )
            .join("") ||
        '<p class="cycle-empty">Nessuna fase. Aggiungi un blocco di produzione.</p>';
    $("addPhase").hidden = readOnly;
}
function renderForm() {
    $("technicalFields").innerHTML =
        headerRow(["metodo", "codiceProdotto"], "primary-fields") +
        '<div class="cycle-section-title">UFFICIO TECNICO</div>' +
        headerRow([
            "numeroDisegno",
            "edizione",
            "denominazione",
            "data",
            "revisione",
        ]) +
        headerRow([
            "materiale",
            "dimensioni",
            "pesoGrezzo",
            "pesoFinito",
            "cliente",
        ]);
    renderPhases();
    $("saveCycle").hidden = readOnly;
    $("editCycle").hidden = !readOnly || !draft.id;
    $("deleteCycle").hidden = !draft.id;
    $("copyCycle").hidden = !draft.id;
    $("formMode").textContent = readOnly
        ? "Visualizzazione"
        : draft.id
          ? "Modifica ciclo"
          : "Nuovo ciclo";
    savedSnapshot = JSON.stringify(collect());
}
async function fresh() {
    items = (await api("list")).items;
    renderList();
}
async function startNew() {
    if (!(await canLeave())) return;
    draft = emptyProcessingCycle();
    readOnly = false;
    show("form");
    renderForm();
    $("technicalFields")
        .querySelector<HTMLInputElement>("[data-header=codiceProdotto]")!
        .focus();
    status();
}
async function openCycle(id: string, mode: "view" | "edit" | "copy") {
    if (!(await canLeave())) return;
    await action(async () => {
        draft = (await api("load", { id })).item;
        if (mode === "copy") {
            draft = {
                ...draft,
                id: undefined,
                revision: undefined,
                codiceProdotto: "",
                fasi: draft.fasi.map((p) => ({
                    ...p,
                    id: crypto.randomUUID(),
                })),
            };
            delete draft.createdAt;
            delete draft.updatedAt;
            delete draft.createdBy;
            delete draft.updatedBy;
        }
        readOnly = mode === "view";
        show("form");
        renderForm();
        status(
            mode === "copy"
                ? "Copia pronta: inserisci il nuovo codice prodotto."
                : "",
        );
        if (mode === "copy")
            $("technicalFields")
                .querySelector<HTMLInputElement>(
                    "[data-header=codiceProdotto]",
                )!
                .focus();
    });
}
function matchesText(value: any, search: string) {
    return String(value ?? "")
        .toLocaleLowerCase("it")
        .includes(search.toLocaleLowerCase("it"));
}
function renderList() {
    const product = $<HTMLInputElement>("filterProduct").value,
        customer = $<HTMLInputElement>("filterCustomer").value,
        machine = $<HTMLInputElement>("filterMachine").value,
        method = $<HTMLInputElement>("filterMethod").value,
        search = $<HTMLInputElement>("filterSearch").value;
    const source = items.filter(
        (item) =>
            (contextArticle
                ? String(item.codiceProdotto).trim().toLocaleLowerCase("it") ===
                  contextArticle.toLocaleLowerCase("it")
                : matchesText(item.codiceProdotto, product)) &&
            matchesText(item.cliente, customer) &&
            matchesText(item.metodo, method) &&
            cycleHeaderFields.every(
                (f) =>
                    !filteredValues["header:" + f.key] ||
                    matchesText(item[f.key], filteredValues["header:" + f.key]),
            ) &&
            item.fasi.some(
                (phase) =>
                    matchesText(phase.macchina, machine) &&
                    cyclePhaseFields.every(
                        (f) =>
                            !filteredValues["phase:" + f.key] ||
                            matchesText(
                                phase[f.key],
                                filteredValues["phase:" + f.key],
                            ),
                    ),
            ) &&
            (!search ||
                cycleHeaderFields.some((f) =>
                    matchesText(item[f.key], search),
                ) ||
                item.fasi.some((p) =>
                    cyclePhaseFields.some((f) => matchesText(p[f.key], search)),
                )),
    );
    const sort = $<HTMLSelectElement>("listSort").value,
        [key, dir] = sort.split("-"),
        field =
            key === "product"
                ? "codiceProdotto"
                : key === "method"
                  ? "metodo"
                  : "updatedAt";
    source.sort(
        (a, b) =>
            String(a[field] || "").localeCompare(String(b[field] || ""), "it", {
                numeric: true,
            }) * (dir === "desc" ? -1 : 1),
    );
    $("cycleList").innerHTML =
        source
            .slice(0, visible)
            .map(
                (item) =>
                    `<li class="cycle-list-item" data-cycle-id="${esc(item.id)}"><button class="cycle-card-open" data-cycle-action="view"><strong data-cycle-article="${esc(item.codiceProdotto)}">${esc(item.codiceProdotto)}${item.metodo ? " · " + esc(item.metodo) : ""}</strong><span>${esc(item.denominazione || "")} ${item.cliente ? " · " + esc(item.cliente) : ""}</span><span>${item.fasi.length} ${item.fasi.length === 1 ? "fase" : "fasi"} · ${esc([...new Set(item.fasi.map((p) => p.macchina).filter(Boolean))].join(" / "))}</span></button><div class="cycle-row-actions"><button data-cycle-action="edit">Modifica</button><button data-cycle-action="copy">Copia</button><button data-cycle-action="print">Stampa</button><button data-cycle-action="delete">Elimina</button></div></li>`,
            )
            .join("") || '<li class="cycle-empty">Nessun ciclo trovato.</li>';
    $("listCount").textContent =
        `${source.length} ${source.length === 1 ? "ciclo" : "cicli"}`;
    $("moreCycles").hidden = source.length <= visible;
}
async function remove(item: ProcessingCycle) {
    await action(async () => {
        if (
            !(await confirm(
                "Elimina ciclo",
                `Eliminare il ciclo ${item.codiceProdotto}${item.metodo ? " · " + item.metodo : ""}?`,
            ))
        )
            return;
        await api("delete", { id: item.id, revision: item.revision });
        savedSnapshot = "";
        show("list");
        await fresh();
        status("Ciclo eliminato.");
    });
}
async function print(item: ProcessingCycle) {
    await action(async () => {
        const fs = require("fs"),
            path = require("path"),
            logoPath = path.join(
                __dirname,
                "..",
                "assets",
                "agpress-logo-generico.png",
            ),
            logo = fs.existsSync(logoPath)
                ? "data:image/png;base64," +
                  fs.readFileSync(logoPath).toString("base64")
                : "";
        const result = await ipc.invoke("attrezzaggio-preview-pdf", {
            title: "Ciclo di lavorazione " + item.codiceProdotto,
            html: processingCyclePrintHtml(item, logo),
            pageSize: "A4",
            landscape: false,
        });
        if (!result.ok) throw Error(result.error || "Stampa non riuscita.");
    });
}
$("showList").onclick = () =>
    void action(async () => {
        show("list");
        await fresh();
        status();
    });
$("listBack").onclick = () => {
    show("home");
    status();
};
$("showCreate").onclick =
    $("newCycle").onclick =
    $("newFromForm").onclick =
        () => void startNew();
$("refreshList").onclick = () =>
    void action(async () => {
        await fresh();
        status();
    });
$("formBack").onclick = async () => {
    if (await canLeave()) {
        show("list");
        await action(fresh);
        status();
    }
};
$("editCycle").onclick = () => void openCycle(draft.id!, "edit");
$("copyCycle").onclick = () => void openCycle(draft.id!, "copy");
$("deleteCycle").onclick = () => void remove(draft);
$("saveCycle").onclick = () => $<HTMLFormElement>("cycleForm").requestSubmit();
$("cycleForm").onsubmit = (event) => {
    event.preventDefault();
    if (readOnly || busy) return;
    const item = collect();
    if (!item.fasi.length) {
        status("Aggiungi almeno una fase di produzione.", true);
        return;
    }
    void action(async () => {
        draft = (await api("save", { item })).item;
        renderForm();
        status("Ciclo salvato.");
    });
};
$("printCycle").onclick = () => void print(collect());
$("addPhase").onclick = () => {
    if (readOnly) return;
    draft = collect();
    if (draft.fasi.length >= 200) {
        status("Massimo 200 fasi per ciclo.", true);
        return;
    }
    const left = window.scrollX,
        top = window.scrollY;
    draft.fasi.push(emptyCyclePhase());
    renderPhases();
    window.scrollTo(left, top);
};
$("phases").addEventListener("click", (event) => {
    const target = event.target as HTMLElement,
        row = target.closest<HTMLElement>("[data-phase-id]");
    if (!row || readOnly) return;
    const remove = target.closest("[data-remove-phase]");
    if (!remove) return;
    draft = collect();
    const index = draft.fasi.findIndex((p) => p.id === row.dataset.phaseId);
    draft.fasi.splice(index, 1);
    renderPhases();
});
$("phases").addEventListener("dragstart", (event) => {
    const handle = (event.target as HTMLElement).closest(".phase-drag");
    if (!handle || readOnly) {
        event.preventDefault();
        return;
    }
    dragged = handle.closest<HTMLElement>("[data-phase-id]")!.dataset.phaseId!;
    event.dataTransfer!.setData("text/plain", dragged);
    event.dataTransfer!.effectAllowed = "move";
});
$("phases").addEventListener("dragover", (event) => {
    const row = (event.target as HTMLElement).closest<HTMLElement>(
        "[data-phase-id]",
    );
    if (!row || !dragged || readOnly) return;
    event.preventDefault();
    event.dataTransfer!.dropEffect = "move";
    row.classList.add("drag-over");
});
$("phases").addEventListener("dragleave", (event) => {
    (event.target as HTMLElement)
        .closest(".cycle-phase")
        ?.classList.remove("drag-over");
});
$("phases").addEventListener("drop", (event) => {
    event.preventDefault();
    const target = (event.target as HTMLElement).closest<HTMLElement>(
        "[data-phase-id]",
    );
    if (!target || !dragged || readOnly) return;
    draft = collect();
    const from = draft.fasi.findIndex((p) => p.id === dragged),
        to = draft.fasi.findIndex((p) => p.id === target.dataset.phaseId);
    if (from >= 0 && to >= 0 && from !== to) {
        const rect = target.getBoundingClientRect(),
            after = event.clientY >= rect.top + rect.height / 2,
            moved = draft.fasi.splice(from, 1)[0],
            remaining = draft.fasi.findIndex(
                (p) => p.id === target.dataset.phaseId,
            );
        draft.fasi.splice(remaining + (after ? 1 : 0), 0, moved);
    }
    dragged = "";
    renderPhases();
});
$("phases").addEventListener("dragend", () => {
    dragged = "";
    $("phases")
        .querySelectorAll(".drag-over")
        .forEach((node) => node.classList.remove("drag-over"));
});
$("cycleList").onclick = async (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>(
            "[data-cycle-action]",
        ),
        id = button?.closest<HTMLElement>("[data-cycle-id]")?.dataset.cycleId;
    if (!button || !id || busy) return;
    const mode = button.dataset.cycleAction;
    if (mode === "view" || mode === "edit" || mode === "copy")
        return void openCycle(id, mode);
    try {
        const item = (await api("load", { id })).item;
        if (mode === "delete") await remove(item);
        if (mode === "print") await print(item);
    } catch (error) {
        status((error as Error).message, true);
    }
};
for (const id of [
    "filterProduct",
    "filterCustomer",
    "filterMachine",
    "filterMethod",
    "filterSearch",
    "listSort",
])
    $(id).addEventListener(id === "listSort" ? "change" : "input", () => {
        visible = 250;
        renderList();
    });
$("advancedListFilters").innerHTML = [
    ...cycleHeaderFields
        .filter((f) => !["codiceProdotto", "cliente", "metodo"].includes(f.key))
        .map((f) => ({ ...f, scope: "header" })),
    ...cyclePhaseFields
        .filter((f) => f.key !== "macchina")
        .map((f) => ({ ...f, scope: "phase" })),
]
    .map(
        (f) =>
            `<label>${f.scope === "phase" ? "Fase · " : ""}${esc(f.label)}<input data-list-filter="${f.scope}:${f.key}" type="${f.type || "search"}"></label>`,
    )
    .join("");
$("advancedListFilters").addEventListener("input", (event) => {
    const input = event.target as HTMLInputElement;
    if (!input.dataset.listFilter) return;
    filteredValues[input.dataset.listFilter] = input.value;
    visible = 250;
    renderList();
});
$("resetListFilters").onclick = () => {
    contextArticle = "";
    for (const id of [
        "filterProduct",
        "filterCustomer",
        "filterMachine",
        "filterMethod",
        "filterSearch",
    ])
        $<HTMLInputElement>(id).value = "";
    $("advancedListFilters")
        .querySelectorAll<HTMLInputElement>("input")
        .forEach((input) => (input.value = ""));
    for (const key of Object.keys(filteredValues)) delete filteredValues[key];
    $<HTMLSelectElement>("listSort").value = "product-asc";
    visible = 250;
    renderList();
};
$("moreCycles").onclick = () => {
    visible += 250;
    renderList();
};
$("legacy").onclick = async () => {
    const result = await ipc.invoke("processing-cycles-legacy");
    if (!result.ok) status(result.error, true);
};
$("close").onclick = async () => {
    if (await canLeave()) {
        allowClose = true;
        ipc.send("processing-cycles-close");
    }
};
window.addEventListener("beforeunload", (event) => {
    if (!allowClose && dirty()) {
        event.preventDefault();
        event.returnValue = false as any;
    }
});
document.addEventListener("keydown", (event) => {
    if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "s" &&
        view === "form" &&
        !readOnly
    ) {
        event.preventDefault();
        $<HTMLFormElement>("cycleForm").requestSubmit();
    }
    if (event.key === "Escape" && !$<HTMLDialogElement>("confirmDialog").open) {
        if (view === "form") $("formBack").click();
        else if (view === "list") $("listBack").click();
    }
});
show("home");

installAnalysisLinks(
    (target) => {
        const code = target.closest<HTMLElement>("[data-cycle-article]")
            ?.dataset.cycleArticle;
        const input = target.closest<HTMLInputElement>(
            "[data-header=codiceProdotto]",
        );
        const article = (code || input?.value || "").trim();
        return article ? { article } : null;
    },
    (message) => status(message, true),
);
$("filterProduct").addEventListener(
    "input",
    () => {
        contextArticle = "";
    },
    true,
);
async function applyCycleContext() {
    if (busy || !pendingCycleContext?.article) return;
    const context = pendingCycleContext;
    pendingCycleContext = null;
    await action(async () => {
        if (!(await canLeave())) return;
        for (const id of [
            "filterProduct",
            "filterCustomer",
            "filterMachine",
            "filterMethod",
            "filterSearch",
        ])
            $<HTMLInputElement>(id).value = "";
        $("advancedListFilters")
            .querySelectorAll<HTMLInputElement>("input")
            .forEach((input) => (input.value = ""));
        for (const key of Object.keys(filteredValues))
            delete filteredValues[key];
        contextArticle = context.article!;
        $<HTMLInputElement>("filterProduct").value = context.article!;
        visible = 250;
        show("list");
        await fresh();
        status();
    });
}
ipc.on("analysis-open-context", (_event: any, context: AnalysisContext) => {
    if (context.article) {
        pendingCycleContext = context;
        void applyCycleContext();
    }
});
ipc.send("analysis-context-ready");
