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

function locationList(values) {
    const locations = (values || []).filter(Boolean);
    if (locations.length < 2) return locations[0] || "—";
    return `${locations.slice(0, -1).join(", ")} e ${locations[locations.length - 1]}`;
}

function movementInstructionSteps(movement) {
    if (movement.operationalSteps?.length) return movement.operationalSteps
        .slice()
        .sort((left, right) => (Number(left.order) || 0) - (Number(right.order) || 0));
    const changes = movement.changes || {};
    const itemFor = (id) => [...(movement.afterState || []), ...(movement.beforeState || [])].find((item) => item.id === id) || {};
    const generated = [
        ...(changes.loaded || []).map((entry) => ({ kind: "load", to: entry.to || [], units: [{ ...itemFor(entry.id), to: locationList(entry.to) }] })),
        ...(changes.unloaded || []).map((entry) => ({ kind: "unload", from: entry.from || [], units: [{ ...itemFor(entry.id), from: locationList(entry.from) }] })),
        ...(changes.shifted || []).map((entry) => ({ kind: "reinsert", from: entry.from || [], to: entry.to || [], units: [{ ...itemFor(entry.id), from: locationList(entry.from), to: locationList(entry.to) }] })),
        ...(changes.adjusted || []).map((entry) => ({ kind: "piece-pick", pieceQuantity: Math.max(0, Number(entry.beforePieces) - Number(entry.afterPieces)), remainingPieces: entry.afterPieces, units: [{ ...itemFor(entry.id) }] })),
    ];
    if (generated.length) return generated;
    return (movement.lines || []).map((line) => ({
        kind: line.kind === "loaded" ? "load" : line.kind === "unloaded" ? "unload" : line.kind === "relocated" ? "reinsert" : line.kind === "pieces" ? "piece-pick" : "movement",
        from: line.kind === "unloaded" ? line.locations || [] : [],
        to: line.kind === "loaded" || line.kind === "relocated" ? line.locations || [] : [],
        pieceQuantity: line.pieceCount || 0,
        remainingPieces: 0,
        units: [{
            article: line.article,
            weighingCode: line.weighingCode || "",
            pieceCount: line.pieceCount || 0,
            from: line.kind === "unloaded" ? locationList(line.locations) : "",
            to: line.kind === "loaded" || line.kind === "relocated" ? locationList(line.locations) : "",
        }],
    }));
}

function slotParts(value) {
    const match = /^([A-Za-z]+\d+)([abc])$/i.exec(String(value || "").trim());
    return match ? { stack: match[1].toUpperCase(), level: match[2].toLowerCase() } : null;
}

function instructionUnitSlot(step, unit) {
    if (["load", "reinsert", "optimization-place"].includes(step.kind)) return unit.to || step.to?.[0] || "";
    return unit.from || step.from?.[0] || "";
}

function instructionBlockKey(step) {
    if (!["load", "unload", "corridor", "reinsert"].includes(step.kind) || !step.units?.length) return "";
    if (step.units.some((unit) => unit.type === "pallet")) return "";
    const slots = step.units.map((unit) => slotParts(instructionUnitSlot(step, unit)));
    if (slots.some((slot) => !slot) || slots.some((slot) => slot.stack !== slots[0].stack)) return "";
    const articles = Array.from(new Set(step.units.map((unit) => String(unit.article || "").trim())));
    if (step.kind === "load" && articles.length !== 1) return "";
    return [step.kind, step.sourceArea || "", slots[0].stack, articles.join("|")].join(":");
}

function sortInstructionUnits(step, units) {
    const levelOrder = { a: 0, b: 1, c: 2 };
    return units.slice().sort((left, right) => {
        const leftSlot = slotParts(instructionUnitSlot(step, left));
        const rightSlot = slotParts(instructionUnitSlot(step, right));
        if (!leftSlot || !rightSlot) return 0;
        return leftSlot.stack.localeCompare(rightSlot.stack, "it", { numeric: true })
            || levelOrder[leftSlot.level] - levelOrder[rightSlot.level];
    });
}

function groupMovementInstructionSteps(steps) {
    const grouped = [];
    steps.forEach((sourceStep) => {
        const step = {
            ...sourceStep,
            from: [...(sourceStep.from || [])],
            to: [...(sourceStep.to || [])],
            units: (sourceStep.units || []).map((unit) => ({ ...unit })),
        };
        const key = instructionBlockKey(step);
        const previous = grouped[grouped.length - 1];
        if (key && previous?.displayBlockKey === key) {
            previous.from = Array.from(new Set([...previous.from, ...step.from]));
            previous.to = Array.from(new Set([...previous.to, ...step.to]));
            previous.units.push(...step.units);
            previous.wholeStack = previous.wholeStack || step.wholeStack || previous.units.length === 3;
            previous.displayBlock = true;
            return;
        }
        step.displayBlockKey = key;
        step.displayBlock = Boolean(key && (step.units.length > 1 || step.wholeStack));
        grouped.push(step);
    });
    grouped.forEach((step) => {
        step.units = sortInstructionUnits(step, step.units || []);
        const orderedSlots = step.units.map((unit) => instructionUnitSlot(step, unit)).filter(Boolean);
        if (["load", "reinsert", "optimization-place"].includes(step.kind) && orderedSlots.length) step.to = orderedSlots;
        if (["unload", "corridor"].includes(step.kind) && orderedSlots.length) step.from = orderedSlots;
    });
    return grouped;
}

function italianValues(values) {
    const clean = values.filter((value) => value !== "" && value !== null && value !== undefined);
    if (clean.length < 2) return String(clean[0] ?? "");
    return `${clean.slice(0, -1).join(", ")} e ${clean[clean.length - 1]}`;
}

function articleAndPieces(step) {
    const articles = Array.from(new Set((step.units || []).map((unit) => unit.article).filter(Boolean)));
    const pieces = (step.units || []).map((unit) => Number(unit.pieceCount) || 0).filter((value) => value > 0);
    const article = articles.length === 1 ? ` dell'articolo ${articles[0]}` : "";
    const pieceList = pieces.length === step.units?.length ? ` da ${italianValues(pieces)} pezzi` : "";
    return `${article}${pieceList}`;
}

function instructionTitle(step) {
    const from = locationList(step.from);
    const to = locationList(step.to);
    const quantity = step.units?.length || Math.max(step.from?.length || 0, step.to?.length || 0, 1);
    const crates = quantity === 1 ? "il cassone" : `i ${quantity} cassoni`;
    const pallet = quantity === 1 && step.units?.[0]?.type === "pallet";
    if (["corridor", "optimization-corridor", "optimization-stage"].includes(step.kind)) {
        if (pallet) return `Sposta temporaneamente dal fronte il pallet da ${from} nel corridoio`;
        if (step.wholeStack) return `Sposta temporaneamente dal fronte l'intera pila ${from} nel corridoio`;
        return `Sposta temporaneamente dal fronte ${crates} da ${from} nel corridoio`;
    }
    if (["reinsert", "optimization-place"].includes(step.kind)) {
        if (pallet) return `Ricolloca frontalmente dal corridoio il pallet in ${to}`;
        if (step.wholeStack) return `Ricolloca insieme e frontalmente dal corridoio l'intera pila in ${to}`;
        return `Ricolloca frontalmente dal corridoio ${crates} in ${to}`;
    }
    if (step.kind === "load") {
        const origin = step.sourceArea === "staging" ? "In Attesa/Preparazione/Montaggio" : "Zona carico/uscita";
        const originPhrase = step.sourceArea === "staging"
            ? "dalla zona In Attesa/Preparazione/Montaggio"
            : "dalla Zona carico/uscita";
        if (pallet) return `Preleva il pallet da ${origin} e depositalo frontalmente in ${to}`;
        const originWithArticle = `${crates}${articleAndPieces(step)}`;
        if (quantity > 1) return `Preleva ${originPhrase} ${originWithArticle} e posizionali insieme, frontalmente, in ${to}`;
        return `Preleva ${originPhrase} ${originWithArticle} e depositalo frontalmente in ${to}`;
    }
    if (step.kind === "unload") {
        if (pallet) return `Preleva frontalmente il pallet da ${from} e posizionalo in In Attesa/Preparazione/Montaggio`;
        return `Preleva frontalmente ${crates} da ${from} e ${quantity === 1 ? "posizionalo" : "posizionali"} in In Attesa/Preparazione/Montaggio`;
    }
    if (step.kind === "piece-pick") {
        const source = step.from?.[0];
        const origin = step.units?.[0]?.from || from;
        if (source === "Corridoio") return `Nel corridoio, preleva ${step.pieceQuantity || 0} pezzi dal cassone proveniente da ${origin}; rimangono ${step.remainingPieces || 0} pezzi`;
        if (source === "In Attesa/Preparazione/Montaggio") return `Nella zona In Attesa/Preparazione/Montaggio, preleva ${step.pieceQuantity || 0} pezzi dal cassone proveniente da ${origin}; rimangono ${step.remainingPieces || 0} pezzi da rimettere a magazzino`;
        return `Preleva ${step.pieceQuantity || 0} pezzi dal cassone ${origin}; rimangono ${step.remainingPieces || 0} pezzi`;
    }
    if (step.kind === "staging-exit") return `Porta ${pallet ? "il pallet" : crates} da In Attesa/Preparazione/Montaggio alla Zona carico/uscita`;
    return `Movimenta ${crates}${to !== "—" ? ` verso ${to}` : ""}`;
}

function instructionUnitRoute(step, unit) {
    if (["corridor", "optimization-corridor", "optimization-stage"].includes(step.kind)) return `${unit.from || locationList(step.from)} → CORRIDOIO`;
    if (["reinsert", "optimization-place"].includes(step.kind)) return `CORRIDOIO → ${unit.to || locationList(step.to)}`;
    if (step.kind === "load") return `${step.sourceArea === "staging" ? "IN ATTESA/PREPARAZIONE/MONTAGGIO" : "ZONA CARICO/USCITA"} → ${unit.to || locationList(step.to)}`;
    if (step.kind === "unload") return `${unit.from || locationList(step.from)} → IN ATTESA/PREPARAZIONE/MONTAGGIO`;
    if (step.kind === "staging-exit") return "IN ATTESA/PREPARAZIONE/MONTAGGIO → ZONA CARICO/USCITA";
    if (step.kind === "piece-pick") {
        const source = step.from?.[0] === "Corridoio"
            ? "CORRIDOIO"
            : step.from?.[0] === "In Attesa/Preparazione/Montaggio"
              ? "IN ATTESA/PREPARAZIONE/MONTAGGIO"
              : unit.from || locationList(step.from);
        return `${source} · PRELIEVO ${step.pieceQuantity || 0} PZ · RESIDUO ${step.remainingPieces || 0} PZ`;
    }
    return `${unit.from || locationList(step.from)} → ${unit.to || locationList(step.to)}`;
}

function renderMovementInstructions(movement) {
    const list = document.getElementById("movementInstructionsList");
    list.replaceChildren();
    const steps = groupMovementInstructionSteps(movementInstructionSteps(movement));
    if (!steps.length) {
        const empty = document.createElement("p");
        empty.className = "movement-instructions-empty";
        empty.textContent = "Questo movimento storico non contiene istruzioni operative ricostruibili.";
        list.appendChild(empty);
        return;
    }
    steps.forEach((step, index) => {
        const card = document.createElement("article");
        card.className = "movement-instruction";
        card.classList.toggle("is-block", Boolean(step.displayBlock));
        const number = document.createElement("span");
        number.className = "movement-instruction__number";
        number.textContent = String(index + 1);
        const content = document.createElement("div");
        const title = document.createElement("strong");
        title.textContent = instructionTitle(step);
        content.appendChild(title);
        const unitArticles = new Set((step.units || []).map((unit) => unit.article).filter(Boolean));
        (step.units || []).forEach((unit, unitIndex) => {
            const row = document.createElement("div");
            row.className = "movement-instruction-unit";
            const identity = document.createElement("b");
            const multiple = step.units.length > 1;
            identity.textContent = unit.type === "pallet"
                ? "Pallet"
                : multiple ? `Cassone ${unitIndex + 1}` : "Cassone";
            const route = document.createElement("span");
            const destination = instructionUnitSlot(step, unit);
            route.textContent = step.kind === "load" && destination
                ? `Posizione ${destination}`
                : instructionUnitRoute(step, unit);
            const metadata = document.createElement("small");
            const optionalData = [
                Number(unit.pieceCount) > 0 ? `${Number(unit.pieceCount)} pezzi` : "",
                unitArticles.size > 1 && unit.article ? `articolo ${unit.article}` : "",
                unit.weighingCode ? `codice pesata ${unit.weighingCode}` : "",
                unit.orderReference ? `rif. ordine ${unit.orderReference}` : "",
                unit.customer ? `cliente ${unit.customer}` : "",
            ].filter(Boolean);
            metadata.textContent = optionalData.join(" · ");
            row.append(identity, route);
            if (optionalData.length) row.append(metadata);
            content.appendChild(row);
        });
        card.append(number, content);
        list.appendChild(card);
    });
}

function setMovementView(view) {
    const instructions = view === "instructions";
    document.getElementById("movementComparisonView").hidden = instructions;
    document.getElementById("movementInstructionsView").hidden = !instructions;
    document.getElementById("showMovementComparison").classList.toggle("is-active", !instructions);
    document.getElementById("showMovementInstructions").classList.toggle("is-active", instructions);
    document.getElementById("movementAuditNote").textContent = instructions
        ? "Sequenza storica di sola lettura. Seguire l’ordine indicato per ricostruire l’operazione."
        : "Vista storica di sola lettura. Le giacenze non possono essere modificate da questa finestra.";
}

function renderMovement(movement) {
    if (!movement) return;
    document.title = `AyPi - ${movement.id}`;
    document.getElementById("movementTitle").textContent = movement.id;
    const actor = movement.actor?.displayName || movement.actor?.employee || movement.actor?.adminName || "Operatore non registrato";
    const department = movement.actor?.department ? ` · ${movement.actor.department}` : "";
    const movementType = movement.optimization
        ? "Ottimizzazione globale"
        : movement.type === "load"
          ? "Carico"
          : movement.type === "exit"
            ? "Uscita verso Zona Scarico"
            : "Scarico";
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
    renderMovementInstructions(movement);
}

document.getElementById("showMovementComparison").addEventListener("click", () => setMovementView("comparison"));
document.getElementById("showMovementInstructions").addEventListener("click", () => setMovementView("instructions"));
ipcRenderer.on("warehouse-movement-details-data", (_event, payload) => {
    const movement = payload?.movement || payload;
    renderMovement(movement);
    setMovementView(payload?.movement ? payload.initialView : "comparison");
});
ipcRenderer.send("warehouse-movement-details-ready");
