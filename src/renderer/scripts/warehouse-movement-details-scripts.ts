// @ts-nocheck
require("./shared/dev-guards");
const { ipcRenderer } = require("electron");

function compareLocation(left, right) {
    return String(left.location || "").localeCompare(String(right.location || ""), "it", { numeric: true });
}

function logicalUnitCount(rows) {
    return new Set((rows || []).map((row) => row.id).filter(Boolean)).size;
}

function changeIds(movement, key) {
    return new Set((movement?.changes?.[key] || []).map((entry) => entry.id));
}

function appendStateTable(targetId, rows, movement, phase) {
    const body = document.getElementById(targetId);
    body.replaceChildren();
    const loaded = changeIds(movement, "loaded");
    const unloaded = changeIds(movement, "unloaded");
    const shifted = changeIds(movement, "shifted");
    const adjusted = changeIds(movement, "adjusted");
    (rows || []).slice().sort(compareLocation).forEach((item) => {
        const row = document.createElement("tr");
        if (phase === "after" && loaded.has(item.id)) row.classList.add("is-loaded");
        if (shifted.has(item.id)) row.classList.add("is-shifted");
        if (phase === "before" && unloaded.has(item.id)) row.classList.add("is-unloaded");
        if (adjusted.has(item.id)) row.classList.add("is-adjusted");
        const states = [item.inMovement ? "In movimento" : "", ...(item.tags || [])].filter(Boolean).join(", ") || "—";
        [
            item.location,
            item.id,
            item.type === "pallet" ? "Pallet" : "Cassone",
            item.article,
            item.customer || "—",
            item.orderReference || "—",
            item.weighingCode || "—",
            `${Math.max(1, Number(item.pieceCount) || 1)} / ${Math.max(1, Number(item.maxPieceCapacity) || Number(item.pieceCount) || 1)}`,
            states,
        ].forEach((value) => {
            const cell = document.createElement("td");
            cell.textContent = value;
            row.appendChild(cell);
        });
        body.appendChild(row);
    });
}

function summaryCard(label, value, detail) {
    const card = document.createElement("article");
    const caption = document.createElement("span");
    caption.textContent = label;
    const amount = document.createElement("strong");
    amount.textContent = String(value);
    const note = document.createElement("small");
    note.textContent = detail;
    card.append(caption, amount, note);
    return card;
}

function renderMovement(movement) {
    if (!movement) return;
    document.title = `AyPi - ${movement.id}`;
    document.getElementById("movementTitle").textContent = movement.id;
    const actor = movement.actor?.displayName || movement.actor?.employee || movement.actor?.adminName || "Operatore non registrato";
    const department = movement.actor?.department ? ` · ${movement.actor.department}` : "";
    const movementType = movement.optimization ? "Ottimizzazione globale" : movement.type === "load" ? "Carico" : "Scarico";
    document.getElementById("movementMeta").textContent = `${movementType} · ${new Date(movement.timestamp).toLocaleString("it-IT")} · ${actor}${department}${movement.reconstructed ? " · snapshot legacy ricostruito" : ""}`;
    const before = movement.beforeState || [];
    const after = movement.afterState || [];
    document.getElementById("beforeCount").textContent = `${logicalUnitCount(before)} unità logistiche`;
    document.getElementById("afterCount").textContent = `${logicalUnitCount(after)} unità logistiche`;
    const summary = document.getElementById("movementSummary");
    const adjustedPieces = (movement.changes?.adjusted || []).reduce((sum, item) => sum + Math.max(0, Number(item.beforePieces) - Number(item.afterPieces)), 0);
    const finalCard = adjustedPieces
        ? summaryCard("Pezzi prelevati", adjustedPieces, "da cassoni rimasti in magazzino")
        : movement.optimization
        ? summaryCard("Spostamenti piano", movement.operationalSteps?.length || 0, "istruzioni registrate")
        : summaryCard("Righe articolo", movement.lines?.length || 0, "nel movimento");
    summary.replaceChildren(
        summaryCard("Caricate", movement.changes?.loaded?.length || 0, "nuove unità"),
        summaryCard("Prelevate", movement.changes?.unloaded?.length || 0, "unità uscite"),
        summaryCard("Ricollocate", movement.changes?.shifted?.length || 0, "cambi di ubicazione"),
        finalCard,
    );
    appendStateTable("beforeTable", before, movement, "before");
    appendStateTable("afterTable", after, movement, "after");
}

ipcRenderer.on("warehouse-movement-details-data", (_event, movement) => renderMovement(movement));
ipcRenderer.send("warehouse-movement-details-ready");
