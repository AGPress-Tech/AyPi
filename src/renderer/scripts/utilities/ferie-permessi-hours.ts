// @ts-nocheck
require("../shared/dev-guards");
import { ipcRenderer } from "electron";
import path from "path";
import fs from "fs";

const bootRequire = (modulePath) => {
    try {
        return require(modulePath);
    } catch (err) {
        ipcRenderer.invoke("show-message-box", {
            type: "error",
            message: "Errore caricamento modulo gestione ore.",
            detail: `${modulePath}\n${err.message || err}`,
        });
        throw err;
    }
};

const scriptsDir = path.join(__dirname, "..", "..", "scripts");
const fpBaseDir = path.join(scriptsDir, "utilities", "ferie-permessi");
const { loadAssigneeOptions } = bootRequire(
    path.join(fpBaseDir, "services", "assignees"),
);
const {
    normalizeBalances,
    applyMissingRequestDeductions,
    listEmployees,
    loadPayload,
    savePayload,
    getMonthKey,
} = bootRequire(path.join(fpBaseDir, "services", "balances"));
const { THEME_STORAGE_KEY } = bootRequire(
    path.join(fpBaseDir, "config", "constants"),
);
let XLSX;
try {
    XLSX = require("xlsx");
} catch (err) {
    console.error("Modulo 'xlsx' non trovato. Esegui: npm install xlsx");
}

function loadThemeSetting() {
    try {
        const value = window.localStorage?.getItem(THEME_STORAGE_KEY);
        if (value === "dark" || value === "aypi") {
            return value;
        }
        return "light";
    } catch (err) {
        return "light";
    }
}

function applyTheme(theme) {
    document.body.classList.toggle("fp-dark", theme === "dark");
    document.body.classList.toggle("fp-aypi", theme === "aypi");
}

function setStatus(text) {
    const el = document.getElementById("fp-hours-status");
    if (el) {
        el.textContent = text || "";
    }
}

function renderTable(payload, assigneeGroups) {
    const tbody = document.getElementById("fp-hours-table-body");
    if (!tbody) return;
    tbody.innerHTML = "";

    const rows = listEmployees(assigneeGroups);
    rows.sort((a, b) => {
        const dept = a.department.localeCompare(b.department);
        if (dept !== 0) return dept;
        return a.employee.localeCompare(b.employee);
    });

    if (!rows.length) {
        const tr = document.createElement("tr");
        const td = document.createElement("td");
        td.colSpan = 6;
        td.textContent = "Nessun dipendente configurato.";
        tr.appendChild(td);
        tbody.appendChild(tr);
        return;
    }

    const balances = payload.balances || {};

    rows.forEach((row) => {
        const record = balances[row.key] || {};

        const tr = document.createElement("tr");

        const tdDept = document.createElement("td");
        tdDept.textContent = row.department || "-";

        const tdEmp = document.createElement("td");
        tdEmp.textContent = row.employee || "-";

        const tdHours = document.createElement("td");
        const input = document.createElement("input");
        input.type = "number";
        input.min = "0";
        input.step = "0.5";
        input.value = Number(record.hoursAvailable || 0).toFixed(2);
        input.className = "fp-hours-input";
        input.dataset.key = row.key;
        if (Number(record.hoursAvailable || 0) < 0) {
            input.classList.add("is-negative");
        }
        tdHours.appendChild(input);

        const tdAccrual = document.createElement("td");
        const accrualInput = document.createElement("input");
        accrualInput.type = "number";
        accrualInput.min = "0";
        accrualInput.step = "0.5";
        accrualInput.value = Number(record.monthlyAccrualHours || 16).toFixed(
            2,
        );
        accrualInput.className = "fp-hours-input fp-hours-input--compact";
        accrualInput.dataset.key = row.key;
        tdAccrual.appendChild(accrualInput);

        const tdMonth = document.createElement("td");
        tdMonth.textContent = record.lastAccrualMonth || getMonthKey();

        const tdClosure = document.createElement("td");
        tdClosure.textContent = Number(record.closureAppliedHours || 0).toFixed(
            2,
        );

        tr.appendChild(tdDept);
        tr.appendChild(tdEmp);
        tr.appendChild(tdHours);
        tr.appendChild(tdAccrual);
        tr.appendChild(tdMonth);
        tr.appendChild(tdClosure);
        tbody.appendChild(tr);
    });
}

function loadAndRender() {
    const assigneesData = loadAssigneeOptions();
    const groups = assigneesData.groups || {};
    const raw = loadPayload();
    const normalized = normalizeBalances(raw, groups);
    const deductions = applyMissingRequestDeductions(normalized.payload);
    if (normalized.changed || deductions.changed) {
        savePayload(deductions.payload);
    }
    renderTable(deductions.payload, groups);
    setStatus("Dati aggiornati.");
}

function saveChanges() {
    const assigneesData = loadAssigneeOptions();
    const groups = assigneesData.groups || {};
    const raw = loadPayload();
    const normalized = normalizeBalances(raw, groups);
    const deductions = applyMissingRequestDeductions(normalized.payload);
    const payload = deductions.payload;

    const tbody = document.getElementById("fp-hours-table-body");
    if (!tbody) return;

    const inputs = tbody.querySelectorAll(".fp-hours-input");
    inputs.forEach((input) => {
        const key = input.dataset.key;
        if (!key) return;
        if (!payload.balances) payload.balances = {};
        if (!payload.balances[key]) {
            payload.balances[key] = {
                hoursAvailable: 0,
                lastAccrualMonth: getMonthKey(),
                monthlyAccrualHours: 16,
            };
        }
        const value = parseFloat(input.value);
        const num = Number.isFinite(value) ? value : 0;
        if (input.classList.contains("fp-hours-input--compact")) {
            payload.balances[key].monthlyAccrualHours = num;
        } else {
            payload.balances[key].hoursAvailable = num;
        }
    });

    if (!savePayload(payload)) {
        ipcRenderer.invoke("show-message-box", {
            type: "error",
            message: "Impossibile salvare le ore.",
            detail: "Controlla la connessione al file condiviso.",
        });
        return;
    }

    renderTable(payload, groups);
    setStatus("Modifiche salvate.");
}

async function exportExcel() {
    if (!XLSX) {
        await ipcRenderer.invoke("show-message-box", {
            type: "error",
            message: "Modulo 'xlsx' non trovato.",
            detail: "Esegui 'npm install xlsx' nella cartella del progetto AyPi.",
        });
        return;
    }
    const assigneesData = loadAssigneeOptions();
    const groups = assigneesData.groups || {};
    const raw = loadPayload();
    const normalized = normalizeBalances(raw, groups);
    const deductions = applyMissingRequestDeductions(normalized.payload);
    if (normalized.changed || deductions.changed) {
        savePayload(deductions.payload);
    }

    const balances = deductions.payload.balances || {};
    const rows = listEmployees(groups)
        .sort((a, b) => {
            const dept = a.department.localeCompare(b.department);
            if (dept !== 0) return dept;
            return a.employee.localeCompare(b.employee);
        })
        .map((row) => {
            const record = balances[row.key] || {};
            return {
                Reparto: row.department || "",
                Dipendente: row.employee || "",
                "Ore disponibili": Number(record.hoursAvailable || 0),
                "Accredito mensile": Number(record.monthlyAccrualHours || 16),
                "Ultimo accredito": record.lastAccrualMonth || getMonthKey(),
                "Chiusure scalate (mese) - provvisorio": Number(
                    record.closureAppliedHours || 0,
                ),
            };
        });

    if (!rows.length) {
        setStatus("Nessun dato da esportare.");
        return;
    }

    const outputPath = await ipcRenderer.invoke("select-output-file", {
        defaultName: "gestione_ore.xlsx",
        filters: [{ name: "File Excel", extensions: ["xlsx"] }],
    });
    if (!outputPath) return;

    const dirOut = path.dirname(outputPath);
    if (!fs.existsSync(dirOut)) {
        fs.mkdirSync(dirOut, { recursive: true });
    }

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, "Gestione Ore");
    XLSX.writeFile(wb, outputPath, { cellDates: true });
    setStatus("Export completato.");
}

window.addEventListener("DOMContentLoaded", () => {
    applyTheme(loadThemeSetting());

    window.addEventListener("storage", (event) => {
        if (!event || event.key !== THEME_STORAGE_KEY) return;
        applyTheme(loadThemeSetting());
    });
    window.addEventListener("focus", () => {
        applyTheme(loadThemeSetting());
    });

    const refreshBtn = document.getElementById("fp-hours-refresh");
    const exportBtn = document.getElementById("fp-hours-export");
    const saveBtn = document.getElementById("fp-hours-save");
    const closeBtn = document.getElementById("fp-hours-close");

    if (refreshBtn) refreshBtn.addEventListener("click", loadAndRender);
    if (exportBtn) exportBtn.addEventListener("click", exportExcel);
    if (saveBtn) saveBtn.addEventListener("click", saveChanges);
    if (closeBtn) closeBtn.addEventListener("click", () => window.close());

    loadAndRender();
});
