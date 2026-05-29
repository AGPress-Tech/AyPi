// @ts-nocheck
require("./shared/dev-guards");
const { ipcRenderer } = require("electron");
const fs = require("fs");
const path = require("path");

const REQUIRED_TOOL_FIELDS = ["nrUnita", "iso", "descrizione"];
const TOOL_ICON_COLUMNS = [1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 13, 14];
const TOOL_ICON_TOOLTIPS = {
    1: "Utensile",
    2: "Attacco Base",
    3: "Adattatore",
    4: "Testa Multipla",
    5: "Pulegge",
    6: "Commutatore",
    7: "Arresto Positivo",
    8: "Sosta a Fine Corsa",
    9: "Riduzione Avanzamento 1 (non presente nella tabella)",
    10: "Regolatore Avanzamento 1",
    11: "Riduzione Avanzamento 2 (non presente nella tabella)",
    12: "Regolatore Avanzamento 2",
    13: "Posizione Cartesiana Unita",
    14: "Posizione Angolare Unita",
};
const ICON_DIR = path.join(__dirname, "..", "assets", "transfer-icons");
const PRINT_LOGO_PATH = path.join(__dirname, "..", "assets", "agpress-logo-generico.png");

let currentCode = null;
const iconDataByCol = {};
let printLogoData = "";

const homeView = document.getElementById("homeView");
const listView = document.getElementById("listView");
const formView = document.getElementById("formView");
const cardsList = document.getElementById("cardsList");
const utensiliBody = document.getElementById("utensiliBody");
const methodIdLabel = document.getElementById("methodIdLabel");
const listCount = document.getElementById("listCount");
const filterCodiceArticolo = document.getElementById("filterCodiceArticolo");
const filterCodiceMacchina = document.getElementById("filterCodiceMacchina");
const filterText = document.getElementById("filterText");
const filterUtensile = document.getElementById("filterUtensile");

let allListItems = [];

function showView(name) {
    homeView.classList.toggle("hidden", name !== "home");
    listView.classList.toggle("hidden", name !== "list");
    formView.classList.toggle("hidden", name !== "form");
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
}

function getVal(id) {
    return (document.getElementById(id)?.value || "").trim();
}

function setVal(id, value) {
    const el = document.getElementById(id);
    if (el) el.value = value || "";
}

function updateCodeLabel() {
    const articolo = getVal("codiceArticolo");
    const fase = getVal("fase");
    const macchina = getVal("codiceMacchina");
    const metodo = getVal("metodo");
    const draft = `${articolo} - Fase: ${fase} - ${macchina} - ${metodo}`;
    methodIdLabel.textContent = `Codice: ${currentCode || draft}`;
}

function escapeHtml(v) {
    return String(v || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function buildCodeHtml(item) {
    const art = item?.codiceArticolo || "";
    const fase = item?.fase || "";
    const mac = item?.codiceMacchina || "";
    const met = item?.metodo || "";
    if (art || fase || mac || met) {
        return `<strong>${escapeHtml(art)}</strong> - Fase: ${escapeHtml(fase)} - ${escapeHtml(mac)} - ${escapeHtml(met)}`;
    }
    return escapeHtml(item?.code || "");
}

function addRow(row = {}) {
    const tr = document.createElement("tr");
    ["nrUnita", "iso", "descrizione"].forEach((key) => {
        const td = document.createElement("td");
        if (key === "descrizione") {
            const input = document.createElement("textarea");
            input.dataset.key = key;
            input.rows = 1;
            input.value = row[key] || "";
            input.className = "cell-textarea";
            input.addEventListener("input", () => autoGrowTextarea(input));
            td.appendChild(input);
            autoGrowTextarea(input);
        } else {
            const input = document.createElement("input");
            input.type = "text";
            input.dataset.key = key;
            input.value = row[key] || "";
            td.appendChild(input);
        }
        tr.appendChild(td);
    });
    TOOL_ICON_COLUMNS.forEach((i) => {
        const td = document.createElement("td");
        const input = document.createElement("textarea");
        input.dataset.key = `col${i}`;
        input.rows = 1;
        input.value = row[`col${i}`] || "";
        input.className = "cell-textarea";
        input.addEventListener("input", () => autoGrowTextarea(input));
        autoGrowTextarea(input);
        td.appendChild(input);
        tr.appendChild(td);
    });
    const tdAction = document.createElement("td");
    const del = document.createElement("button");
    del.textContent = "Rimuovi";
    del.type = "button";
    del.addEventListener("click", () => tr.remove());
    tdAction.appendChild(del);
    tr.appendChild(tdAction);
    utensiliBody.appendChild(tr);
}

function autoGrowTextarea(el) {
    el.style.height = "auto";
    el.style.height = `${Math.max(28, el.scrollHeight)}px`;
}

function readRows() {
    return Array.from(utensiliBody.querySelectorAll("tr"))
        .map((tr) => {
            const data = {};
            tr.querySelectorAll("[data-key]").forEach((el) => {
                const input = el as HTMLInputElement | HTMLTextAreaElement;
                data[input.dataset.key] = (input.value || "").trim();
            });
            return data;
        })
        .filter((r) => Object.values(r).some(Boolean));
}

function resetForm() {
    currentCode = null;
    ["codiceArticolo", "fase", "codiceMacchina", "metodo", "lavorazione", "cicloLavorazione", "note"].forEach((id) => setVal(id, ""));
    utensiliBody.innerHTML = "";
    addRow();
    updateCodeLabel();
}

function applyHeaderIcons() {
    TOOL_ICON_COLUMNS.forEach((i) => {
        const img = document.querySelector(`img[data-col-icon=\"${i}\"]`);
        if (!img) return;
        if (iconDataByCol[i]) img.src = iconDataByCol[i];
        const tip = TOOL_ICON_TOOLTIPS[i] || `Colonna ${i}`;
        img.title = tip;
        img.setAttribute("aria-label", tip);
    });
}

function loadHeaderIcons() {
    TOOL_ICON_COLUMNS.forEach((i) => {
        const p = path.join(ICON_DIR, `${i}.png`);
        if (fs.existsSync(p)) {
            const b64 = fs.readFileSync(p).toString("base64");
            iconDataByCol[i] = `data:image/png;base64,${b64}`;
        }
    });
    applyHeaderIcons();
}

function loadPrintLogo() {
    if (!fs.existsSync(PRINT_LOGO_PATH)) return;
    const b64 = fs.readFileSync(PRINT_LOGO_PATH).toString("base64");
    printLogoData = `data:image/png;base64,${b64}`;
}

function printCard(card) {
    const cols = TOOL_ICON_COLUMNS.slice();
    const headerIcons = cols.map((idx) => iconDataByCol[idx] ? `<img src=\"${iconDataByCol[idx]}\" style=\"width:34px;height:34px;object-fit:contain;\">` : `${idx}`);
    const rows = (card.utensili || []).map((r) => {
        const base = [r.nrUnita || "", r.iso || "", r.descrizione || ""];
        const opz = cols.map((c) => r[`col${c}`] || "");
        return `<tr>${[...base, ...opz].map((v) => `<td>${String(v || "")}</td>`).join("")}</tr>`;
    }).join("");

    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(`
        <html><head><title>${card.code}</title>
        <style>
            @page { size: A3 landscape; margin: 10mm; }
            body { font-family: Segoe UI, Tahoma, sans-serif; font-size: 12px; }
            .head { display:flex; align-items:flex-start; gap:12px; margin-bottom:8px; }
            .head img { width: 220px; max-height: 60px; object-fit: contain; object-position: left top; }
            .head h3 { margin: 0; font-size: 24px; line-height: 1.1; }
            .head .code-line { font-size: 18px; line-height: 1.15; }
            .meta { display:grid; grid-template-columns: repeat(4,1fr); gap:6px; margin-bottom:8px; }
            .meta div { border:1px solid #333; padding:6px; min-height:30px; font-size: 16px; line-height: 1.25; }
            .meta div strong { font-size: 18px; }
            table { width:100%; border-collapse:collapse; table-layout:fixed; }
            th,td { border:1px solid #333; padding:4px; text-align:center; vertical-align:middle; font-size: 14px; }
            th { background:#ffffff; }
            td:nth-child(3), th:nth-child(3) { text-align:left; }
            .desc { width:18%; }
        </style></head><body>
        <div class="head">
          ${printLogoData ? `<img src="${printLogoData}" alt="A.G.PRESS">` : ""}
          <div>
            <h3>METODO DI ATTREZZAGGIO TRANSFER</h3>
            <div class="code-line"><strong>Codice:</strong> ${card.code}</div>
          </div>
        </div>
        <div class="meta">
          <div><strong>Codice Articolo</strong><br>${card.codiceArticolo || ""}</div>
          <div><strong>Fase</strong><br>${card.fase || ""}</div>
          <div><strong>Codice Macchina</strong><br>${card.codiceMacchina || ""}</div>
          <div><strong>Metodo</strong><br>${card.metodo || ""}</div>
          <div><strong>Lavorazione</strong><br>${card.lavorazione || ""}</div>
          <div><strong>Ciclo (s)</strong><br>${card.cicloLavorazione || ""}</div>
          <div><strong>Note</strong><br>${card.note || ""}</div>
        </div>
        <table>
            <thead><tr><th>Nr Unita</th><th>ISO</th><th class="desc">Descrizione</th>${headerIcons.map((h) => `<th>${h}</th>`).join("")}</tr></thead>
            <tbody>${rows}</tbody>
        </table>
        <script>window.onload=()=>window.print();</script>
        </body></html>
    `);
    win.document.close();
}

async function loadCardAndOpenForm(code) {
    const loaded = await ipcRenderer.invoke("transfer-attrezzaggio-load", { code });
    if (!loaded?.ok) {
        window.alert(loaded?.error || "Errore caricamento scheda");
        return;
    }
    const card = loaded.item;
    currentCode = card.code;
    setVal("codiceArticolo", card.codiceArticolo);
    setVal("fase", card.fase);
    setVal("codiceMacchina", card.codiceMacchina);
    setVal("metodo", card.metodo);
    setVal("lavorazione", card.lavorazione);
    setVal("cicloLavorazione", card.cicloLavorazione);
    setVal("note", card.note);
    utensiliBody.innerHTML = "";
    (card.utensili || []).forEach(addRow);
    if (!(card.utensili || []).length) addRow();
    updateCodeLabel();
    showView("form");
}

async function loadList() {
    const res = await ipcRenderer.invoke("transfer-attrezzaggio-list");
    if (!res?.ok) {
        window.alert(res?.error || "Errore caricamento lista");
        return;
    }
    allListItems = Array.isArray(res.items) ? res.items : [];
    renderListFiltered();
}

function normalize(v) {
    return String(v || "").toLowerCase().trim();
}

function formatDateTs(ms) {
    const n = Number(ms || 0);
    if (!n) return "-";
    const d = new Date(n);
    if (Number.isNaN(d.getTime())) return "-";
    return d.toLocaleString("it-IT");
}

function matchesFilters(item) {
    const fArt = normalize(filterCodiceArticolo?.value);
    const fMac = normalize(filterCodiceMacchina?.value);
    const fText = normalize(filterText?.value);
    const fUte = normalize(filterUtensile?.value);

    const codiceArticolo = normalize(item?.codiceArticolo);
    const codiceMacchina = normalize(item?.codiceMacchina);
    const lavorazione = normalize(item?.lavorazione);
    const note = normalize(item?.note);
    const utensili = Array.isArray(item?.utensiliDescrizioni)
        ? item.utensiliDescrizioni.map(normalize).join(" | ")
        : "";

    if (fArt && !codiceArticolo.includes(fArt)) return false;
    if (fMac && !codiceMacchina.includes(fMac)) return false;
    if (fText && !(lavorazione.includes(fText) || note.includes(fText))) return false;
    if (fUte && !utensili.includes(fUte)) return false;
    return true;
}

function renderListFiltered() {
    cardsList.innerHTML = "";
    const filtered = allListItems.filter(matchesFilters);
    if (listCount) listCount.textContent = `${filtered.length} schede trovate su ${allListItems.length}`;

    filtered.forEach((item) => {
        const li = document.createElement("li");
        const details = document.createElement("div");
        details.className = "card-details";
        const code = document.createElement("span");
        code.className = "code";
        code.innerHTML = buildCodeHtml(item);
        const meta = document.createElement("span");
        meta.className = "code-meta";
        meta.textContent = `Articolo: ${item.codiceArticolo || "-"} | Fase: ${item.fase || "-"} | Macchina: ${item.codiceMacchina || "-"} | Metodo: ${item.metodo || "-"} | Lavorazione: ${item.lavorazione || "-"} | Ciclo(s): ${item.cicloLavorazione || "-"} | Utensili: ${item.utensiliCount || 0} | Agg.: ${formatDateTs(item.updatedAt)}`;
        details.appendChild(code);
        details.appendChild(meta);
        const edit = document.createElement("button");
        edit.textContent = "Modifica";
        edit.addEventListener("click", () => loadCardAndOpenForm(item.code));
        const print = document.createElement("button");
        print.textContent = "Stampa";
        print.addEventListener("click", async () => {
            const loaded = await ipcRenderer.invoke("transfer-attrezzaggio-load", { code: item.code });
            if (!loaded?.ok) return;
            printCard(loaded.item);
        });
        const del = document.createElement("button");
        del.textContent = "Elimina";
        del.addEventListener("click", async () => {
            const ok = window.confirm(`Eliminare la scheda ${item.code}?`);
            if (!ok) return;
            let resDel;
            try {
                resDel = await ipcRenderer.invoke("transfer-attrezzaggio-delete", { code: item.code });
            } catch (err) {
                window.alert("Funzione elimina non disponibile nella sessione corrente. Riavvia AyPi e riprova.");
                return;
            }
            if (!resDel?.ok) {
                window.alert(resDel?.error || "Errore eliminazione scheda");
                return;
            }
            await loadList();
        });
        li.appendChild(details);
        li.appendChild(edit);
        li.appendChild(print);
        li.appendChild(del);
        cardsList.appendChild(li);
    });
}

async function saveForm() {
    const payload = {
        code: currentCode,
        codiceArticolo: getVal("codiceArticolo"),
        fase: getVal("fase"),
        codiceMacchina: getVal("codiceMacchina"),
        metodo: getVal("metodo"),
        lavorazione: getVal("lavorazione"),
        cicloLavorazione: getVal("cicloLavorazione"),
        note: getVal("note"),
        utensili: readRows(),
    };

    if (!payload.codiceArticolo || !payload.fase || !payload.codiceMacchina || !payload.metodo) {
        window.alert("Compila Codice Articolo, Fase, Codice Macchina e Metodo.");
        return;
    }
    if (!payload.utensili.length) {
        window.alert("Inserisci almeno una riga utensile.");
        return;
    }
    const invalid = payload.utensili.find((r) => REQUIRED_TOOL_FIELDS.some((f) => !r[f]));
    if (invalid) {
        window.alert("Ogni riga utensile deve avere Nr Unita, ISO e Descrizione.");
        return;
    }

    const res = await ipcRenderer.invoke("transfer-attrezzaggio-save", payload);
    if (!res?.ok) {
        window.alert(res?.error || "Errore salvataggio");
        return;
    }
    currentCode = res.code;
    updateCodeLabel();
    window.alert(`Scheda salvata: ${res.code}`);
}

document.getElementById("showListBtn")?.addEventListener("click", async () => { showView("list"); await loadList(); });
document.getElementById("showCreateBtn")?.addEventListener("click", () => { resetForm(); showView("form"); });
document.getElementById("closeWindowBtn")?.addEventListener("click", () => window.close());
document.getElementById("backFromListBtn")?.addEventListener("click", () => showView("home"));
document.getElementById("refreshListBtn")?.addEventListener("click", loadList);
document.getElementById("clearFiltersBtn")?.addEventListener("click", () => {
    [filterCodiceArticolo, filterCodiceMacchina, filterText, filterUtensile].forEach((el) => {
        if (el) el.value = "";
    });
    renderListFiltered();
});
document.getElementById("backFromFormBtn")?.addEventListener("click", () => showView("home"));
document.getElementById("newFormBtn")?.addEventListener("click", resetForm);
document.getElementById("saveFormBtn")?.addEventListener("click", saveForm);
document.getElementById("printFormBtn")?.addEventListener("click", () => {
    const card = {
        code: currentCode || `${getVal("codiceArticolo")} - Fase: ${getVal("fase")} - ${getVal("codiceMacchina")} - ${getVal("metodo")}`,
        codiceArticolo: getVal("codiceArticolo"),
        fase: getVal("fase"),
        codiceMacchina: getVal("codiceMacchina"),
        metodo: getVal("metodo"),
        lavorazione: getVal("lavorazione"),
        cicloLavorazione: getVal("cicloLavorazione"),
        note: getVal("note"),
        utensili: readRows(),
    };
    printCard(card);
});
document.getElementById("addRowBtn")?.addEventListener("click", () => addRow());
["codiceArticolo", "fase", "codiceMacchina", "metodo"].forEach((id) => {
    document.getElementById(id)?.addEventListener("input", updateCodeLabel);
});
[filterCodiceArticolo, filterCodiceMacchina, filterText, filterUtensile].forEach((el) => {
    el?.addEventListener("input", renderListFiltered);
});

loadHeaderIcons();
loadPrintLogo();
resetForm();
showView("home");
