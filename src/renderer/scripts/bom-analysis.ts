import { continueTableOnScroll } from "../modules/table-scroll-loader";
import {
    BOM_COLUMNS,
    BOM_SUMMARY_COLUMNS,
    ARTICLE_SUMMARY_COLUMNS,
    summaryColumns,
    visibleSummaryColumns,
    summarizeArticleRows,
    BomRow,
    BomSearch,
    BomPreferences,
    DEFAULT_BOM_COLUMNS,
    emptyBomSearch,
    filterBomRows,
    summarizeBomRows,
    validateBomSearch,
    validateBomPreferences,
} from "../../main/modules/bom-analysis/model";
import { bindSortingHeaders, updateSortingBar } from "../modules/table-sorting";
import { installAnalysisLinks } from "../modules/analysis-links";
import { contextFromAnalysisElement } from "../modules/document-links";
const ipc = require("electron").ipcRenderer;
const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
    document.getElementById(id) as T;
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
const num = (v: unknown, d = 6) =>
    new Intl.NumberFormat("it-IT", { maximumFractionDigits: d }).format(
        Number(v),
    );
let rows: BomRow[] = [],
    filtered: BomRow[] = [],
    search = emptyBomSearch(),
    limit = 250,
    loading = false,
    loaded = false;
let preferences: BomPreferences = {
    version: 1,
    columns: [...DEFAULT_BOM_COLUMNS],
    presets: [],
};
const searches: Record<string, BomSearch> = {
    "where-used": emptyBomSearch(),
    composition: { ...emptyBomSearch(), mode: "composition" },
};
const expandedArticles=new Set<string>();
let detailHistory: string[] = [],
    detailSort = emptyBomSearch().sort.filter((s) => s.key === "line"),
    opener: HTMLElement | null = null;
const setStatus = (text = "", error = false) => {
    $("status").textContent = text;
    $("status").classList.toggle("error", error);
};
const equal = (a: unknown, b: unknown) =>
    String(a ?? "")
        .trim()
        .toLocaleLowerCase("it") ===
    String(b ?? "")
        .trim()
        .toLocaleLowerCase("it");
function fieldInput(col: (typeof BOM_COLUMNS)[number], rule: any) {
    if (col.kind === "boolean")
        return `<select data-value aria-label="${esc(col.label)}"><option value="">Tutti</option><option value="1" ${rule.value === "1" ? "selected" : ""}>Sì</option><option value="0" ${rule.value === "0" ? "selected" : ""}>No</option></select>`;
    const numeric = col.kind === "number",
        date = col.kind === "date",
        type = date ? "date" : numeric ? "number" : "text",
        op =
            rule.op ||
            (["date", "number"].includes(col.kind) ? "range" : "contains");
    const options =
        numeric || date
            ? [
                  ["range", "Da / a"],
                  ["exact", "Uguale a"],
              ]
            : [
                  ["contains", "Contiene"],
                  ["prefix", "Inizia con"],
                  ["exact", "Uguale a"],
                  ["range", "Da / a"],
              ];
    return `<select data-op aria-label="Confronto ${esc(col.label)}">${options.map(([v, label]) => `<option value="${v}" ${op === v ? "selected" : ""}>${label}</option>`).join("")}</select><div class="${op === "range" ? "range" : ""}"><input data-value type="${type}" ${numeric ? 'step="any"' : ""} value="${esc(rule.value)}" aria-label="${esc(col.label)}${op === "range" ? " da" : ""}"><input data-to type="${type}" ${numeric ? 'step="any"' : ""} value="${esc(rule.to)}" aria-label="${esc(col.label)} a" ${op !== "range" ? "hidden" : ""}></div>`;
}
function ruleHtml(col: (typeof BOM_COLUMNS)[number], rule: any) {
    return `<div class="rule"><div class="rule-fields">${fieldInput(col, rule)}</div><button type="button" class="remove-rule" aria-label="Rimuovi condizione ${esc(col.label)}">×</button></div>`;
}
function renderFilters() {
    const openStates=new Map([...$("filterGroups").querySelectorAll<HTMLDetailsElement>("details[data-field]")].map(group=>[group.dataset.field,group.open]));
    const lead = search.mode === "where-used" ? "component" : "bom",
        ordered = [
            BOM_COLUMNS.find((c) => c.key === lead)!,
            ...BOM_COLUMNS.filter((c) => c.key !== lead),
        ];
    $("filterGroups").innerHTML = ordered
        .map((col) => {
            const rules = search.rules.filter((r) => r.field === col.key);
            return `<details class="filter-group" data-field="${col.key}" ${(openStates.has(col.key)?openStates.get(col.key):col.key === lead || rules.length) ? "open" : ""}><summary>${esc(col.label)}<span class="badge">${rules.length || "Facoltativo"}</span></summary><div class="rules">${(rules.length ? rules : [{}]).map((r) => ruleHtml(col, r)).join("")}</div><button type="button" class="add-rule">+ Aggiungi alternativa</button></details>`;
        })
        .join("");
    document
        .querySelectorAll<HTMLButtonElement>("[data-mode]")
        .forEach((b) =>
            b.setAttribute(
                "aria-pressed",
                String(b.dataset.mode === search.mode),
            ),
        );
    $("filterTitle").textContent =
        search.mode === "where-used"
            ? "Dove compare l’articolo?"
            : "Cerca una distinta";
    $("resultsTitle").textContent =
        search.mode === "where-used"
            ? "Articoli e distinte in cui compaiono"
            : "Composizione delle distinte";
    renderPreferences();
}
function readSearch(): BomSearch {
    const rules: any[] = [];
    $("filterGroups")
        .querySelectorAll<HTMLElement>("[data-field]")
        .forEach((group) =>
            group.querySelectorAll<HTMLElement>(".rule").forEach((rule) => {
                const value =
                        rule.querySelector<HTMLInputElement>(
                            "[data-value]",
                        )!.value,
                    to =
                        rule.querySelector<HTMLInputElement>(
                            "[data-to]",
                        )?.value,
                    op =
                        rule.querySelector<HTMLSelectElement>("[data-op]")
                            ?.value || "exact";
                if (value || to)
                    rules.push({
                        field: group.dataset.field,
                        op,
                        value,
                        ...(op === "range" && to ? { to } : {}),
                    });
            }),
        );
    return validateBomSearch({ ...search, rules });
}
function apply(next: BomSearch) {
    search = validateBomSearch(next);
    search.sort = search.sort.filter((s) =>
        summaryColumns(search.mode).some((c) => c.key === s.key),
    );
    if(!search.sort.length)search.sort=[{key:search.mode==='where-used'?'component':'bom',direction:'asc'}];
    searches[search.mode] = search;
    limit = 250;
    render();
}
function format(row: BomRow, key: string) {
    const col = [...BOM_COLUMNS,...ARTICLE_SUMMARY_COLUMNS].find((c) => c.key === key)!,
        v = row[key];
    if (v == null || v === "") return "—";
    if (col.kind === "boolean") return Number(v) ? "Sì" : "No";
    if (col.kind === "date")
        return String(v).slice(0, 10).split("-").reverse().join("/");
    if (col.kind === "number")
        return /Weight$/.test(key)
            ? new Intl.NumberFormat("it-IT", {
                  minimumFractionDigits: 3,
                  maximumFractionDigits: 3,
              }).format(Number(v))
            : num(v, /quantity$/i.test(key) ? 3 : 6);
    return String(v);
}
function tableBody(
    table: HTMLTableElement,
    data: BomRow[],
    columns: typeof BOM_COLUMNS,
    sort: any,
    onSort: (s: any) => void,
    articleParents=false,
) {
    table.querySelector("thead")!.innerHTML =
        "<tr>" +
        columns
            .map(
                (c) =>
                    `<th class="${c.kind === "number" ? "numeric" : ""}">${esc(c.label)}</th>`,
            )
            .join("") +
        "</tr>";
    table.querySelector("tbody")!.innerHTML = articleParents?articleRowsMarkup(data,columns):bomRowsMarkup(data, columns);
    bindSortingHeaders(table, columns, sort, onSort);
}
function bomRowsMarkup(data: BomRow[], columns: typeof BOM_COLUMNS) {
    return data
        .map(
            (row) =>
                "<tr>" +
                columns
                    .map((c) => {
                        const value = esc(format(row, c.key)),
                            attribute =
                                c.key === "component" && row.component
                                    ? `data-analysis-article="${esc(row.component)}"`
                                    : c.key === "bom"
                                      ? `data-analysis-bom="${esc(row.bom)}"`
                                      : "";
                        const open =
                            c.key === "bom"
                                ? row.bom
                                : c.key === "component" && Number(row.hasBom)
                                  ? row.component
                                  : null;
                        return `<td ${attribute} class="${c.kind === "number" ? "numeric" : ""}" title="${value}">${open ? `<button class="document-expand" data-expand-bom="${esc(open)}" aria-expanded="false" aria-label="Espandi composizione ${esc(open)}">▸</button><button class="bom-link" data-open-bom="${esc(open)}">${value}</button>` : value}</td>`;
                    })
                    .join("") +
                "</tr>",
        )
        .join("");
}
function articleRowsMarkup(data:BomRow[],columns:typeof BOM_COLUMNS){
    return data.map(row=>{const component=String(row.component),open=expandedArticles.has(component.trim().toLocaleLowerCase('it'));return `<tr data-parent-article="${esc(component)}">${columns.map(c=>`<td ${c.key==='component'?`data-analysis-article="${esc(component)}"`:''} class="${c.kind==='number'?'numeric':''}" title="${esc(format(row,c.key))}">${c.key==='component'?`<button class="document-expand" data-expand-article="${esc(component)}" aria-expanded="${open}" aria-label="${open?'Riduci':'Espandi'} distinte contenenti ${esc(component)}">${open?'▾':'▸'}</button><button class="bom-link" data-open-article="${esc(component)}">${esc(component)}</button>`:esc(format(row,c.key))}</td>`).join('')}</tr>`;}).join('');
}
function toggleArticle(button:HTMLButtonElement){
    const parent=button.closest('tr')!,component=button.dataset.expandArticle!,key=component.trim().toLocaleLowerCase('it'),existing=parent.nextElementSibling;
    if(existing?.classList.contains('bom-where-used-row')){existing.remove();expandedArticles.delete(key);button.textContent='▸';button.setAttribute('aria-expanded','false');button.setAttribute('aria-label',`Espandi distinte contenenti ${component}`);button.removeAttribute('aria-controls');return;}
    const matched=filtered.filter(row=>equal(row.component,component)),summaries=summarizeBomRows(matched,[{key:'bom',direction:'asc'}]);
    if(!summaries.length)return;
    const child=document.createElement('tr');child.className='bom-where-used-row';const cell=document.createElement('td');cell.colSpan=parent.cells.length;cell.className='analysis-linked-documents';child.append(cell);
    const panel=document.createElement('div');panel.className='bom-inline-where-used linked-document';panel.id=`whereUsed${++inlineId}`;
    const heading=document.createElement('strong');heading.textContent=`${component} · ${summaries.length} distinte in cui compare`;
    const scroller=document.createElement('div');scroller.className='table-scroll';scroller.tabIndex=0;scroller.setAttribute('aria-label',`Distinte contenenti ${component}`);
    const nested=document.createElement('table');nested.id=panel.id+'Table';nested.className='linked-documents-table';nested.innerHTML='<thead></thead><tbody></tbody>';scroller.append(nested);panel.append(heading,scroller);cell.append(panel);parent.after(child);
    const outer=parent.closest('table')!;panel.style.width=Math.max(200,outer.parentElement!.clientWidth-56)+'px';let sort= [{key:'bom',direction:'asc' as const}];
    const columns=visibleSummaryColumns('composition',preferences.columns);const draw=()=>{const sorted=summarizeBomRows(matched,sort),initial=Math.min(250,sorted.length);tableBody(nested,sorted.slice(0,initial),columns,sort,next=>{sort=next;draw();});continueTableOnScroll({table:nested,total:sorted.length,initial,append:(from,to)=>nested.tBodies[0].insertAdjacentHTML('beforeend',bomRowsMarkup(sorted.slice(from,to),columns))});};draw();
    expandedArticles.add(key);button.textContent='▾';button.setAttribute('aria-expanded','true');button.setAttribute('aria-label',`Riduci distinte contenenti ${component}`);button.setAttribute('aria-controls',panel.id);
}
function restoreArticleExpansions(table:HTMLTableElement){if(search.mode!=='where-used')return;table.querySelectorAll<HTMLButtonElement>(':scope>tbody>tr>[data-analysis-article]>[data-expand-article]').forEach(button=>{if(expandedArticles.has(button.dataset.expandArticle!.trim().toLocaleLowerCase('it'))&&!button.closest('tr')!.nextElementSibling?.classList.contains('bom-where-used-row'))toggleArticle(button);});}
function render() {
    filtered = filterBomRows(rows, search);
    const articleParents=search.mode==='where-used';
    const summaries = articleParents?summarizeArticleRows(filtered,search.sort):summarizeBomRows(filtered, search.sort),
        columns = visibleSummaryColumns(search.mode,preferences.columns),
        table = $<HTMLTableElement>("results");
    tableBody(table, summaries.slice(0, limit), columns, search.sort, (s) =>
        apply({ ...search, sort: s }),
        articleParents,
    );
    updateSortingBar(table, columns, search.sort, (s) =>
        apply({ ...search, sort: s }),
    );
    restoreArticleExpansions(table);
    table.hidden = !filtered.length;
    $("empty").hidden = !!filtered.length || !loaded;
    $("bomCount").textContent = loaded
        ? num(new Set(filtered.map((r) => r.bom)).size, 0)
        : "—";
    $("componentCount").textContent = loaded
        ? num(
              new Set(
                  filtered.filter((r) => r.component).map((r) => r.component),
              ).size,
              0,
          )
        : "—";
    $("rowCount").textContent = loaded
        ? num(filtered.filter((r) => r.component).length, 0)
        : "—";
    $("loaded").textContent = loaded
        ? `${num(Math.min(limit, summaries.length), 0)} di ${num(summaries.length, 0)} ${articleParents?'articoli':'distinte'}`
        : "";
    continueTableOnScroll({
        table,
        total: summaries.length,
        initial: Math.min(limit, summaries.length),
        append: (from, to) => {
            table.tBodies[0].insertAdjacentHTML(
                "beforeend",
                articleParents?articleRowsMarkup(summaries.slice(from,to),columns):bomRowsMarkup(summaries.slice(from, to), columns),
            );restoreArticleExpansions(table);},
        progress: (count, total) => {
            limit = count;
            $("loaded").textContent =
                `${num(count, 0)} di ${num(total, 0)} ${articleParents?'articoli':'distinte'}`;
        },
    });
    $<HTMLButtonElement>("export").disabled =
        !loaded || loading || !filtered.length;
}
async function savePreferences() {
    const response = await ipc.invoke(
        "bom-analysis-preferences-save",
        preferences,
    );
    if (!response.ok) throw Error(response.error);
}
function renderPreferences() {
    const visible=visibleSummaryColumns(search.mode,preferences.columns);
    $("columnPicker").innerHTML = summaryColumns(search.mode).map(
        (c) =>
            `<label><input type="checkbox" value="${c.key}" ${visible.some(v=>v.key===c.key) ? "checked" : ""} ${c.key === (search.mode==='where-used'?'component':'bom') ? "disabled" : ""}>${esc(c.label)}</label>`,
    ).join("");
    $("columnCount").textContent =
        `(${visible.length})`;
    $<HTMLSelectElement>("presets").innerHTML =
        '<option value="">Scegli preset</option>' +
        preferences.presets
            .map((p, i) => `<option value="${i}">${esc(p.name)}</option>`)
            .join("");
    $<HTMLButtonElement>("deletePreset").disabled = true;
}
async function load() {
    if (loading) return;
    loading = true;
    setStatus("Lettura distinte…");
    $<HTMLButtonElement>("refresh").disabled = true;
    $<HTMLButtonElement>("export").disabled = true;
    try {
        const result = await ipc.invoke("bom-analysis-load");
        if (!result.ok) throw Error(result.error);
        rows = result.rows;
        loaded = true;
        $("sourceInfo").textContent =
            `Gestionale · Distinte base e componenti · ${num(rows.length, 0)} righe lette · ${new Date(result.queriedAt).toLocaleString("it-IT")}`;
        setStatus();
        render();
        if ($<HTMLDialogElement>("bomDetail").open) renderDetail();
    } catch (e) {
        setStatus((e as Error).message, true);
    } finally {
        loading = false;
        $<HTMLButtonElement>("refresh").disabled = false;
        $<HTMLButtonElement>("export").disabled = !loaded || !filtered.length;
    }
}
const detailColumns = BOM_COLUMNS.filter((c) =>
    [
        "line",
        "component",
        "description",
        "quantity",
        "unit",
        "hasBom",
        "variant",
        "scrapQuantity",
        "scrapUnit",
        "validFrom",
        "validTo",
        "notes",
        "drawing",
        "netWeight",
        "grossWeight",
    ].includes(c.key),
);
let inlineId = 0;
function toggleComposition(button: HTMLButtonElement) {
    const parent = button.closest("tr")!,
        table = parent.closest("table")!,
        bom = button.dataset.expandBom!;
    const current = parent.nextElementSibling;
    const currentButton = parent.querySelector<HTMLButtonElement>(
        "[data-expand-bom][aria-expanded=true]",
    );
    if (current?.classList.contains("bom-composition-row")) {
        current.remove();
        if (currentButton) {
            currentButton.setAttribute("aria-expanded", "false");
            currentButton.setAttribute(
                "aria-label",
                `Espandi composizione ${currentButton.dataset.expandBom}`,
            );
            currentButton.removeAttribute("aria-controls");
            currentButton.textContent = "▸";
        }
        if (currentButton === button) return;
    }
    const all = rows.filter((r) => equal(r.bom, bom));
    if (!all.length) return;
    const child = document.createElement("tr");
    child.className = "bom-composition-row";
    const cell = document.createElement("td");
    cell.colSpan = parent.cells.length;
    cell.className = "analysis-linked-documents";
    child.append(cell);
    const panel = document.createElement("div");
    panel.className = "bom-inline-composition linked-document";
    panel.id = `bomComposition${++inlineId}`;
    const heading = document.createElement("div");
    heading.className = "bom-inline-heading";
    const title = document.createElement("strong");
    title.textContent = `Distinta ${bom}`;
    const open = document.createElement("button");
    open.className = "bom-link";
    open.dataset.openBom = bom;
    open.textContent = "Apri dettaglio ↗";
    heading.append(title, open);
    const description = document.createElement("p");
    description.textContent = String(all[0].bomDescription || "");
    const scroller = document.createElement("div");
    scroller.className = "table-scroll";
    scroller.tabIndex = 0;
    scroller.setAttribute("aria-label", `Composizione distinta ${bom}`);
    const nested = document.createElement("table");
    nested.id = panel.id + "Table";
    nested.className = "linked-documents-table";
    nested.innerHTML = "<thead></thead><tbody></tbody>";
    scroller.append(nested);
    panel.append(heading, description, scroller);
    cell.append(panel);
    parent.after(child);
    panel.style.width =
        Math.max(200, table.parentElement!.clientWidth - 56) + "px";
    const components = all.filter((r) => r.line != null);
    let sort = detailSort.filter((s) => s.key === "line");
    if (!sort.length) sort = [{ key: "line", direction: "asc" }];
    const draw = () =>
        tableBody(
            nested,
            filterBomRows(components, { mode: "composition", rules: [], sort }),
            detailColumns,
            sort,
            (next) => {
                sort = next;
                draw();
            },
        );
    draw();
    if (!components.length) {
        const empty = document.createElement("p");
        empty.textContent = "Nessun componente nella distinta.";
        panel.append(empty);
    }
    button.setAttribute("aria-expanded", "true");
    button.setAttribute("aria-label", `Riduci composizione ${bom}`);
    button.setAttribute("aria-controls", panel.id);
    button.textContent = "▾";
}
window.addEventListener("resize", () =>
    document
        .querySelectorAll<HTMLElement>(".bom-inline-composition,.bom-inline-where-used")
        .forEach((panel) => {
            const table = panel.closest("td")?.closest("table");
            if (table?.parentElement)
                panel.style.width =
                    Math.max(200, table.parentElement.clientWidth - 56) + "px";
        }),
);
function renderDetail() {
    const bom = detailHistory[detailHistory.length - 1],
        all = rows.filter((r) => equal(r.bom, bom)),
        term =
            $<HTMLInputElement>("detailSearch").value.toLocaleLowerCase("it");
    $("detailTitle").textContent = `Distinta ${bom}`;
    $("detailSubtitle").textContent =
        `${all[0]?.bomDescription || ""} · ${all.filter((r) => r.line != null).length} righe`;
    const result = filterBomRows(all, {
        mode: "composition",
        rules: [],
        sort: detailSort,
    }).filter(
        (r) =>
            r.line != null &&
            (!term ||
                BOM_COLUMNS.some((c) =>
                    format(r, c.key).toLocaleLowerCase("it").includes(term),
                )),
    );
    tableBody(
        $<HTMLTableElement>("detailTable"),
        result,
        detailColumns,
        detailSort,
        (s) => {
            detailSort = s;
            renderDetail();
        },
    );
    $("detailEmpty").hidden = !!result.length;
    $("detailBack").hidden = detailHistory.length < 2;
}
function openDetail(bom: string, trigger?: HTMLElement) {
    if (!rows.some((r) => equal(r.bom, bom))) return;
    const dialog = $<HTMLDialogElement>("bomDetail");
    if (!dialog.open) {
        opener = trigger || (document.activeElement as HTMLElement);
        detailHistory = [];
        dialog.showModal();
    }
    detailHistory.push(bom);
    $<HTMLInputElement>("detailSearch").value = "";
    detailSort = [{ key: "line", direction: "asc" }];
    renderDetail();
    $("detailClose").focus();
}
function openContext(context: any) {
    if (!context.bom && !context.article) return;
    $<HTMLDialogElement>("bomDetail").close();
    search = {
        ...emptyBomSearch(),
        mode: context.bom ? "composition" : "where-used",
        rules: [
            {
                field: context.bom ? "bom" : "component",
                op: "exact",
                value: context.bom || context.article,
            },
        ],
    };
    renderFilters();
    apply(search);
}
$("searchForm").addEventListener("submit", (event) => {
    event.preventDefault();
    try {
        apply(readSearch());
        setStatus();
    } catch (e) {
        setStatus((e as Error).message, true);
    }
});
$("filterGroups").addEventListener("click", (event) => {
    const target = event.target as HTMLElement,
        group = target.closest<HTMLElement>("[data-field]");
    if (!group) return;
    const col = BOM_COLUMNS.find((c) => c.key === group.dataset.field)!;
    if (target.closest(".add-rule")) {
        const rules = group.querySelector(".rules")!;
        if (rules.children.length >= 10) {
            setStatus("Massimo 10 alternative per campo.", true);
            return;
        }
        rules.insertAdjacentHTML("beforeend", ruleHtml(col, {}));
    }
    if (target.closest(".remove-rule")) {
        target.closest(".rule")!.remove();
        if (!group.querySelector(".rule"))
            group.querySelector(".rules")!.innerHTML = ruleHtml(col, {});
    }
});
$("filterGroups").addEventListener("change", (event) => {
    const target = event.target as HTMLSelectElement;
    if (!target.matches("[data-op]")) return;
    const rule = target.closest(".rule")!,
        to = rule.querySelector<HTMLInputElement>("[data-to]")!;
    to.hidden = target.value !== "range";
    to.parentElement!.classList.toggle("range", !to.hidden);
});
document.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach(
    (button) =>
        (button.onclick = () => {
            try {
                searches[search.mode] = readSearch();
                search = searches[button.dataset.mode!];
                renderFilters();
                apply(search);
                setStatus();
            } catch (e) {
                setStatus((e as Error).message, true);
            }
        }),
);
$("reset").onclick = () => {
    search = { ...emptyBomSearch(), mode: search.mode };
    renderFilters();
    apply(search);
    setStatus();
};
$("refresh").onclick = () => void load();
$("close").onclick = () => ipc.send("bom-analysis-close");
$("columnPicker").addEventListener("change", async () => {
    const otherColumns=preferences.columns.filter(key=>!summaryColumns(search.mode).some(c=>c.key===key));
    preferences.columns = [...otherColumns,...Array.from(
        $("columnPicker").querySelectorAll<HTMLInputElement>("input:checked"),
    ).map((c) => c.value)];
    $("columnCount").textContent = `(${visibleSummaryColumns(search.mode,preferences.columns).length})`;
    render();
    try {
        await savePreferences();
    } catch (e) {
        setStatus((e as Error).message, true);
    }
});
document.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const articleButton=target.closest<HTMLElement>('[data-expand-article],[data-open-article]');if(articleButton){const button=articleButton.closest('tr')!.querySelector<HTMLButtonElement>('[data-expand-article]')!;toggleArticle(button);return;}
    const expand = target.closest<HTMLButtonElement>("[data-expand-bom]");
    if (expand) {
        toggleComposition(expand);
        return;
    }
    const button = target.closest<HTMLElement>("[data-open-bom]");
    if (button) openDetail(button.dataset.openBom!, button);
});
$("detailClose").onclick = () => $<HTMLDialogElement>("bomDetail").close();
$("bomDetail").addEventListener("close", () => {
    if (opener?.isConnected) opener.focus();
    else
        document
            .querySelector<HTMLButtonElement>("[data-mode][aria-pressed=true]")
            ?.focus();
});
$("detailBack").onclick = () => {
    detailHistory.pop();
    $<HTMLInputElement>("detailSearch").value = "";
    renderDetail();
};
$("detailSearch").oninput = () => renderDetail();
$("detailOpenSearch").onclick = () =>
    openContext({ bom: detailHistory[detailHistory.length - 1] });
$("detailWhereUsed").onclick = () =>
    openContext({ article: detailHistory[detailHistory.length - 1] });
$("export").onclick = () => {
    $<HTMLSelectElement>('exportLayout').options[0].textContent=search.mode==='where-used'?'Riepilogo: una riga per articolo':'Riepilogo: una riga per distinta';
    $<HTMLSelectElement>("exportLayout").value = "summary";
    $<HTMLDialogElement>("exportDialog").showModal();
};
$("exportDialog").addEventListener("close", async () => {
    if ($<HTMLDialogElement>("exportDialog").returnValue !== "export") return;
    $<HTMLButtonElement>("export").disabled = true;
    try {
        const result = await ipc.invoke("bom-analysis-export", {
            search,
            columns: preferences.columns,
            layout: $<HTMLSelectElement>("exportLayout").value,
        });
        if (!result.ok) throw Error(result.error);
        if (!result.canceled)
            setStatus(`${num(result.count, 0)} righe esportate in Excel.`);
    } catch (e) {
        setStatus((e as Error).message, true);
    } finally {
        $<HTMLButtonElement>("export").disabled = !filtered.length;
    }
});
$("presets").onchange = () => {
    const value = $<HTMLSelectElement>("presets").value;
    $<HTMLButtonElement>("deletePreset").disabled = value === "";
    if (value === "") return;
    const preset = preferences.presets[Number(value)];
    search = validateBomSearch(preset.search);
    preferences.columns = [...preset.columns];
    renderFilters();
    renderPreferences();
    $<HTMLSelectElement>("presets").value = value;
    $<HTMLButtonElement>("deletePreset").disabled = false;
    apply(search);
    void savePreferences().catch((e) => setStatus(e.message, true));
};
$("savePreset").onclick = () => {
    try {
        readSearch();
        if (preferences.presets.length >= 10) throw Error("Massimo 10 preset.");
        $<HTMLInputElement>("presetName").value = "";
        $<HTMLDialogElement>("presetDialog").showModal();
    } catch (e) {
        setStatus((e as Error).message, true);
    }
};
$("presetDialog").addEventListener("close", async () => {
    if ($<HTMLDialogElement>("presetDialog").returnValue !== "save") return;
    try {
        const next = validateBomPreferences({
            ...preferences,
            presets: [
                ...preferences.presets,
                {
                    name: $<HTMLInputElement>("presetName").value,
                    search: readSearch(),
                    columns: [...preferences.columns],
                },
            ],
        });
        const previous = preferences;
        preferences = next;
        try {
            await savePreferences();
        } catch (e) {
            preferences = previous;
            throw e;
        }
        renderPreferences();
        setStatus();
    } catch (e) {
        setStatus((e as Error).message, true);
    }
});
$("deletePreset").onclick = async () => {
    const value = $<HTMLSelectElement>("presets").value;
    if (value === "") return;
    const previous = preferences;
    preferences = {
        ...preferences,
        presets: preferences.presets.filter((_, i) => i !== Number(value)),
    };
    try {
        await savePreferences();
        renderPreferences();
        setStatus();
    } catch (e) {
        preferences = previous;
        setStatus((e as Error).message, true);
    }
};
installAnalysisLinks(contextFromAnalysisElement, (message) =>
    setStatus(message, true),
);
ipc.on("analysis-open-context", (_event: any, context: any) =>
    openContext(context),
);
ipc.send("analysis-context-ready");
renderFilters();
renderPreferences();
void (async () => {
    let preferencesError = "";
    try {
        const result = await ipc.invoke("bom-analysis-preferences-load");
        if (!result.ok) throw Error(result.error);
        preferences = validateBomPreferences(result.preferences);
        renderPreferences();
    } catch (e) {
        preferencesError = (e as Error).message;
    }
    await load();
    if (preferencesError)
        setStatus("Preferenze personali: " + preferencesError, true);
})();
