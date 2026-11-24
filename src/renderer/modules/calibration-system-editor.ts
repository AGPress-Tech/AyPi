import {
    calibrationRules,
    evaluateCalibrationSystem,
} from "../../../backend/src/modules/measurement-instruments/calibration-system";
const esc = (v: any) =>
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
const number = (v: any) =>
    v == null
        ? "—"
        : new Intl.NumberFormat("it-IT", { maximumFractionDigits: 6 }).format(
              v,
          );
const input = (
    name: string,
    label: string,
    value: any = "",
    type = "text",
    required = false,
) =>
    `<label>${label}<input name="${name}" type="${type}" ${type === "number" ? 'step="any"' : ""} value="${esc(value)}" ${name === "category" ? 'list="systemCategories"' : ""} ${required ? "required" : ""}></label>`;
export function systemPointRow(p: any = {}) {
    const id = p.id || crypto.randomUUID(),
        qualitative = p.kind === "qualitative";
    return `<tr data-system-point="${esc(id)}"><td><input data-p="group" value="${esc(p.group)}" list="systemGroups" aria-label="Gruppo di misure" placeholder="Es. Misure esterne" required></td><td><input data-p="label" value="${esc(p.label)}" aria-label="Punto di misura" placeholder="Es. Diametro 45" required></td><td><select data-p="kind" aria-label="Tipo di controllo"><option value="numeric">Numerico</option><option value="qualitative" ${qualitative ? "selected" : ""}>Qualitativo OK / Non OK</option></select></td>${["nominal", "unit", "tolerance", "repetitions"].map((key, index) => `<td><input data-p="${key}" ${key === "unit" ? "" : 'type="number" step="any"'} value="${esc(key === "repetitions" && p.repetitionsInherited ? "" : p[key])}" aria-label="${["Nominale", "Unità", "Tolleranza specifica ±", "Rilevazioni del punto"][index]}" ${qualitative && key !== "repetitions" ? "disabled" : ""} ${key === "nominal" && !qualitative ? "required" : ""}></td>`).join("")}<td><button type="button" data-remove-system-point aria-label="Rimuovi punto">×</button></td></tr>`;
}
export function calibrationSystemForm(v: any, categories: string[] = []) {
    return (
        input("category", "Categoria strumenti", v.category, "text", true) +
        `<datalist id="systemCategories">${categories.map((category) => `<option value="${esc(category)}"></option>`).join("")}</datalist>` +
        input("name", "Nome sistema", v.name, "text", true) +
        `<label>Stato<select name="active"><option value="true">Attivo</option><option value="false" ${v.active === false ? "selected" : ""}>Disattivato</option></select></label><label>Criterio di idoneità<select name="rule" required><option value="">Scegli il criterio…</option>${Object.entries(
            calibrationRules,
        )
            .map(
                ([key, label]) =>
                    `<option value="${key}" ${key === v.rule ? "selected" : ""}>${label}</option>`,
            )
            .join("")}</select></label>` +
        input(
            "repetitions",
            "Rilevazioni per ogni punto",
            v.repetitions ?? 10,
            "number",
            true,
        ) +
        input("unit", "Unità di misura predefinita (es. mm)", v.unit) +
        input(
            "tolerance",
            "Tolleranza predefinita ± (facoltativa)",
            v.tolerance,
            "number",
        ) +
        input(
            "coverage",
            "Fattore k per media ± k·s",
            v.coverage ?? 2,
            "number",
        ) +
        `<label>Valori esattamente sul limite<select name="strict"><option value="false">Accettati (≤ / ≥)</option><option value="true" ${v.strict ? "selected" : ""}>Non accettati (&lt; / &gt;)</option></select></label>` +
        `<fieldset class="measurement-wide system-historical-fields"><legend>Parametri dei limiti storici</legend><div class="system-parameter-grid">${input("limitConstant", "Costante A", v.limitConstant ?? 50, "number") + input("limitSlope", "Coefficiente B del nominale", v.limitSlope ?? 0.1, "number") + input("limitScale", "Scala dei limiti (es. 0,001)", v.limitScale ?? 0.001, "number") + input("marginScale", "Scala margine dalla tolleranza", v.marginScale ?? 0.001, "number")}</div><p>Limiti ammessi = nominale ± (A + B × nominale) × scala. Il margine si aggiunge all’intervallo media ± k·s. Nei nuovi sistemi s usa tutte le rilevazioni.</p></fieldset>` +
        `<label class="measurement-wide">Procedura, campioni e istruzioni<textarea name="description">${esc(v.description)}</textarea></label><section class="measurement-wide system-points-editor"><div class="measurement-row"><h3>Gruppi e punti da controllare</h3><button id="addSystemPoint" type="button">+ Punto di controllo</button></div><datalist id="systemGroups">${["Misure esterne", "Profondità", "Misure interne", "Diametri", "Altezze", "Planarità"].map((value) => `<option value="${value}"></option>`).join("")}</datalist><div class="measurement-measures system-definition-table"><table><thead><tr>${["Gruppo", "Punto", "Tipo", "Nominale", "Unità", "Tolleranza ±", "Rilevazioni del punto", ""].map((label) => `<th>${label}</th>`).join("")}</tr></thead><tbody id="systemPoints">${(v.points?.length ? v.points : [{}]).map(systemPointRow).join("")}</tbody></table></div></section>`
    );
}
export function readSystemPoints(host: HTMLElement) {
    return [...host.querySelectorAll<HTMLElement>("[data-system-point]")].map(
        (row) => {
            const values: any = { id: row.dataset.systemPoint };
            for (const el of row.querySelectorAll<
                HTMLInputElement | HTMLSelectElement
            >("[data-p]"))
                values[el.dataset.p!] =
                    el instanceof HTMLInputElement && el.type === "number"
                        ? el.value === ""
                            ? null
                            : Number(el.value)
                        : el.value;
            return values;
        },
    );
}
export function updateSystemDefinition(host: HTMLElement) {
    const rule = host.querySelector<HTMLSelectElement>("[name=rule]")?.value;
    host.querySelector<HTMLElement>(".system-historical-fields")!.hidden =
        rule !== "historical";
    for (const row of host.querySelectorAll<HTMLElement>(
        "[data-system-point]",
    )) {
        const qualitative =
            row.querySelector<HTMLSelectElement>("[data-p=kind]")!.value ===
            "qualitative";
        row.querySelector<HTMLInputElement>(
            "[data-p=repetitions]",
        )!.placeholder =
            "Usa " +
            (host.querySelector<HTMLInputElement>("[name=repetitions]")
                ?.value || "10");
        row.querySelector<HTMLInputElement>("[data-p=unit]")!.placeholder =
            qualitative
                ? ""
                : host.querySelector<HTMLInputElement>("[name=unit]")?.value ||
                  "es. mm";
        for (const key of ["nominal", "unit", "tolerance"]) {
            const el = row.querySelector<HTMLInputElement>(`[data-p=${key}]`)!;
            el.disabled = qualitative;
            el.required = key === "nominal" && !qualitative;
        }
    }
}
export function readSystemReadings(host: HTMLElement) {
    return [...host.querySelectorAll<HTMLElement>("[data-reading-point]")].map(
        (row) => ({
            pointId: row.dataset.readingPoint,
            readings: [
                ...row.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
                    "[data-reading]",
                ),
            ].map((el) => {
                const raw = el.value.trim();
                if (!raw) return null;
                if (el instanceof HTMLSelectElement) return raw;
                const value = Number(raw.replace(",", "."));
                return Number.isFinite(value) ? value : raw;
            }),
        }),
    );
}
export function systemReadingsMarkup(system: any, measurements: any[] = []) {
    const max = Math.max(...system.points.map((p) => p.repetitions));
    return `<div class="measurement-row"><h3>${esc(system.name)} · revisione ${system.revision}</h3><span data-system-verdict></span></div><div class="measurement-measures system-readings-table"><table><thead><tr><th>Gruppo / punto</th><th>Nominale</th><th>Unità</th>${Array.from({ length: max }, (_, i) => `<th>${i + 1}ª</th>`).join("")}<th>Media</th><th>Delta</th><th>s (tutte)</th><th>Media - k·s</th><th>Media + k·s</th><th>Ammesso inf.</th><th>Ammesso sup.</th><th>Esito</th></tr></thead><tbody>${system.points
        .map((p) => {
            const values =
                measurements.find((m) => m.pointId === p.id)?.readings || [];
            return `<tr data-reading-point="${esc(p.id)}"><th scope="row">${esc(p.group)} · ${esc(p.label)}</th><td>${p.kind === "numeric" ? number(p.nominal) : "OK"}</td><td>${esc(p.unit)}</td>${Array.from({ length: max }, (_, i) => (i >= p.repetitions ? '<td class="system-not-required"></td>' : `<td>${p.kind === "qualitative" ? `<select data-reading="${i}" aria-label="${esc(p.group + " " + p.label)} rilevazione ${i + 1}"><option value="">—</option><option value="ok" ${values[i] === "ok" ? "selected" : ""}>OK</option><option value="not_ok" ${values[i] === "not_ok" ? "selected" : ""}>Non OK</option></select>` : `<input data-reading="${i}" inputmode="decimal" value="${esc(values[i])}" aria-label="${esc(p.group + " " + p.label)} rilevazione ${i + 1}">`}</td>`)).join("")}${["mean", "deviation", "standardDeviation", "lower", "upper", "acceptanceLower", "acceptanceUpper", "pass"].map((key) => `<td data-result="${key}">—</td>`).join("")}</tr>`;
        })
        .join(
            "",
        )}</tbody></table></div><details class="system-procedure"><summary>Procedura e campioni</summary><p>${esc(system.description || "Nessuna istruzione aggiuntiva.")}</p></details><p class="system-calculation-summary">${esc(calibrationRules[system.rule])}. I risultati incompleti o privi di tolleranza non producono un giudizio di idoneità.</p>`;
}
export function updateSystemResults(
    host: HTMLElement,
    system: any,
    tolerance: number | null,
    unit: string,
) {
    let evaluated: any;
    try {
        evaluated = evaluateCalibrationSystem(
            system,
            readSystemReadings(host),
            tolerance,
            unit,
        );
    } catch {
        evaluated = { outcome: "review", measurements: [] };
    }
    for (const row of host.querySelectorAll<HTMLElement>(
        "[data-reading-point]",
    )) {
        const result = evaluated.measurements.find(
            (m) => m.pointId === row.dataset.readingPoint,
        );
        for (const cell of row.querySelectorAll<HTMLElement>("[data-result]")) {
            const key = cell.dataset.result!,
                value = result?.[key];
            cell.textContent =
                key === "pass"
                    ? value == null
                        ? "Da completare"
                        : value
                          ? "ID"
                          : "NID"
                    : number(value);
            if (key === "pass")
                cell.dataset.verdict =
                    value == null ? "review" : value ? "fit" : "unfit";
        }
    }
    const labels = {
        fit: "Idoneo",
        unfit: "Non idoneo",
        review: "Da completare / valutare",
    };
    const verdict = host.querySelector<HTMLElement>("[data-system-verdict]")!;
    verdict.textContent = labels[evaluated.outcome];
    verdict.dataset.verdict = evaluated.outcome;
    return evaluated;
}
