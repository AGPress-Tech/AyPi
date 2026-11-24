import type Chart from "chart.js/auto";
import type { SelectorPoint, SelectorPhases } from "./selector-point";

type Range = { start: number; end: number };
type Callbacks = {
    range(): Range;
    move(start: number, end: number): void;
    commit(kind: "pan" | "zoom"): void;
    select(start: number, end: number, phases: SelectorPhases): void;
    continuous?(): boolean;
    snapPoints?(): SelectorPoint[];
    describeSnap?(point: SelectorPoint): void;
};

/** Camera locale: nessuna richiesta di rete durante il movimento del mouse. */
export function attachChartInteractions(
    chart: Chart<"line">,
    callbacks: Callbacks,
) {
    const canvas = chart.canvas;
    const snapTooltip = document.createElement("div");
    snapTooltip.className = "selector-snap-tooltip";
    snapTooltip.setAttribute("role", "tooltip");
    snapTooltip.hidden = true;
    document.body.append(snapTooltip);
    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
    let hoverTimer: ReturnType<typeof setTimeout> | undefined;
    let wheelTimer: ReturnType<typeof setTimeout> | undefined;
    let frame = 0,
        zoom: (Range & { from: Range; at: number }) | null = null;
    let pending: Range | null = null;
    let drag:
        | (Range & {
              x: number;
              current: number;
              width: number;
              left: number;
              select: boolean;
              pointerStart: number;
              pointerCurrent: number;
              snapStart: SelectorPoint | null;
              snapEnd: SelectorPoint | null;
          })
        | null = null;
    let suppressClick = false;
    let controlPressed = false;
    let pointer: { x: number; y: number } | null = null;
    const hoverRadius = 24;
    let hoverPosition: { clientX: number; clientY: number } | null = null;
    let settled = false,
        latched = false;
    function point(event: Pick<MouseEvent, "clientX" | "clientY">) {
        const rect = canvas.getBoundingClientRect();
        return {
            x: ((event.clientX - rect.left) * chart.width) / rect.width,
            y: ((event.clientY - rect.top) * chart.height) / rect.height,
        };
    }
    function inside(p: { x: number; y: number }) {
        const a = chart.chartArea;
        return (
            p.x >= a.left && p.x <= a.right && p.y >= a.top && p.y <= a.bottom
        );
    }
    function snapTarget(x: number) {
        const axis = chart.scales.x;
        const at = axis.getValueForPixel(x);
        // 14 CSS pixels at any zoom, never more than five minutes.
        const rect = canvas.getBoundingClientRect();
        const tolerance = Math.min(
            300000,
            Math.abs(
                axis.getValueForPixel(x + (14 * chart.width) / rect.width) - at,
            ),
        );
        let nearest: SelectorPoint | null = null;
        let distance = tolerance;
        for (const event of callbacks.snapPoints?.() ?? []) {
            if (event.timestampMs < axis.min || event.timestampMs > axis.max)
                continue;
            const delta = Math.abs(event.timestampMs - at);
            if (delta <= distance) {
                nearest = event;
                distance = delta;
            }
        }
        return nearest;
    }
    function snap(x: number) {
        const target = snapTarget(x);
        return target ? chart.scales.x.getPixelForValue(target.timestampMs) : x;
    }
    function onControl(event: KeyboardEvent) {
        const pressed = event.ctrlKey;
        if (controlPressed === pressed) return;
        controlPressed = pressed;
        if (pressed) hideTooltip();
        if (pointer && inside(pointer) && !drag)
            canvas.style.cursor = pressed ? "crosshair" : "grab";
        chart.draw();
    }
    function onBlur() {
        controlPressed = false;
        pointer = null;
        chart.draw();
    }
    function clearTooltip(draw = true) {
        const hasTooltip = !!chart.tooltip?.getActiveElements().length;
        const hasActive = chart.getActiveElements().length > 0;
        if (hasTooltip) chart.tooltip!.setActiveElements([], { x: 0, y: 0 });
        if (hasActive) chart.setActiveElements([]);
        if (draw && (hasTooltip || hasActive)) chart.draw();
    }
    function hideTooltip() {
        clearTimeout(hoverTimer);
        hoverTimer = undefined;
        hoverPosition = null;
        settled = false;
        latched = false;
        clearTooltip();
    }
    function stopMotion() {
        cancelAnimationFrame(frame);
        frame = 0;
        zoom = null;
        pending = null;
    }
    function paint(now: number) {
        frame = 0;
        if (pending) {
            const p = pending;
            pending = null;
            callbacks.move(p.start, p.end);
        }
        if (zoom) {
            const progress = Math.min(1, (now - zoom.at) / 160),
                ease = 1 - Math.pow(1 - progress, 3);
            callbacks.move(
                zoom.from.start + (zoom.start - zoom.from.start) * ease,
                zoom.from.end + (zoom.end - zoom.from.end) * ease,
            );
            if (progress < 1) frame = requestAnimationFrame(paint);
            else zoom = null;
        }
    }
    function requestPaint() {
        if (!frame) frame = requestAnimationFrame(paint);
    }
    function pan() {
        if (!drag || drag.select) return;
        const shift =
            ((drag.x - drag.current) / drag.width) * (drag.end - drag.start);
        pending = { start: drag.start + shift, end: drag.end + shift };
        requestPaint();
    }
    function showTooltip(p: { x: number; y: number }) {
        if (drag || zoom || pending || !inside(p)) return;
        // Distance to actual finite line segments, including both endpoints.
        // A nearest-index lookup alone also matches far outside the data range.
        let best = hoverRadius * hoverRadius,
            hit: { datasetIndex: number; index: number } | null = null;
        for (
            let datasetIndex = 2;
            datasetIndex < chart.data.datasets.length;
            datasetIndex += 3
        ) {
            if (!chart.isDatasetVisible(datasetIndex)) continue;
            const points = chart.getDatasetMeta(datasetIndex).data as any[];
            for (let i = 0; i < points.length; i++) {
                const b = points[i];
                if (b.skip || !Number.isFinite(b.y)) continue;
                const previous = points[i - 1],
                    a =
                        previous &&
                        !previous.skip &&
                        Number.isFinite(previous.y)
                            ? previous
                            : b;
                const dx = b.x - a.x,
                    dy = b.y - a.y,
                    length = dx * dx + dy * dy;
                // Una volta aperto, segue il tempo sotto il cursore fermo anche
                // quando la temperatura o la scala verticale cambiano nel live.
                const projection = latched
                    ? dx
                        ? (p.x - a.x) / dx
                        : 0
                    : length
                      ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / length
                      : 0;
                const t = Math.max(0, Math.min(1, projection));
                const distance =
                    (p.x - a.x - t * dx) ** 2 +
                    (latched ? 0 : (p.y - a.y - t * dy) ** 2);
                if (distance <= best) {
                    best = distance;
                    hit = {
                        datasetIndex,
                        index: t < 0.5 && a !== b ? i - 1 : i,
                    };
                }
            }
        }
        if (!hit) {
            latched = false;
            clearTooltip();
            return;
        }
        const active = [];
        for (
            let datasetIndex = 2;
            datasetIndex < chart.data.datasets.length;
            datasetIndex += 3
        ) {
            const item = chart.getDatasetMeta(datasetIndex).data[
                hit.index
            ] as any;
            if (chart.isDatasetVisible(datasetIndex) && item && !item.skip)
                active.push({ datasetIndex, index: hit.index });
        }
        latched = true;
        chart.tooltip!.setActiveElements(active, p);
        chart.draw();
    }
    function onMove(event: PointerEvent) {
        pointer = point(event);
        const wasPressed = controlPressed;
        controlPressed = event.ctrlKey;
        if (!drag && (controlPressed || wasPressed)) {
            hideTooltip();
            canvas.style.cursor = inside(pointer)
                ? controlPressed
                    ? "crosshair"
                    : "grab"
                : "default";
            chart.draw();
            if (controlPressed) return;
        }
        if (!drag && callbacks.continuous?.()) {
            hideTooltip();
            canvas.style.cursor = inside(point(event))
                ? event.ctrlKey
                    ? "crosshair"
                    : "grab"
                : "default";
            return;
        }
        if (
            !drag &&
            hoverPosition?.clientX === event.clientX &&
            hoverPosition?.clientY === event.clientY
        )
            return;
        const p = point(event);
        hideTooltip();
        if (drag) {
            drag.pointerCurrent = p.x;
            drag.snapEnd = drag.select
                ? snapTarget(
                      Math.max(
                          drag.left,
                          Math.min(drag.left + drag.width, p.x),
                      ),
                  )
                : null;
            drag.current = drag.select
                ? snap(
                      Math.max(
                          drag.left,
                          Math.min(drag.left + drag.width, p.x),
                      ),
                  )
                : p.x;
            if (drag.select) chart.draw();
            else pan();
            return;
        }
        canvas.style.cursor = inside(p)
            ? event.ctrlKey
                ? "crosshair"
                : "grab"
            : "default";
        if (inside(p)) {
            hoverPosition = { clientX: event.clientX, clientY: event.clientY };
            hoverTimer = setTimeout(() => {
                hoverTimer = undefined;
                settled = true;
                if (hoverPosition) showTooltip(point(hoverPosition));
            }, 500);
        }
    }
    function onDown(event: PointerEvent) {
        const p = point(event);
        pointer = p;
        controlPressed = event.ctrlKey;
        if (event.button !== 0 || !inside(p)) return;
        hideTooltip();
        clearTimeout(wheelTimer);
        wheelTimer = undefined;
        stopMotion();
        const range = { start: chart.scales.x.min, end: chart.scales.x.max };
        drag = {
            ...range,
            x: event.ctrlKey ? snap(p.x) : p.x,
            current: event.ctrlKey ? snap(p.x) : p.x,
            pointerStart: p.x,
            pointerCurrent: p.x,
            snapStart: event.ctrlKey ? snapTarget(p.x) : null,
            snapEnd: event.ctrlKey ? snapTarget(p.x) : null,
            width: chart.chartArea.width,
            left: chart.chartArea.left,
            select: event.ctrlKey,
        };
        canvas.style.cursor = drag.select ? "crosshair" : "grabbing";
        canvas.setPointerCapture(event.pointerId);
        if (drag.select) chart.draw();
    }
    function onUp(event: PointerEvent) {
        if (!drag) return;
        onMove(event);
        const p = drag;
        if (Math.abs(p.current - p.x) >= 4) pan();
        if (pending) {
            const next = pending;
            stopMotion();
            callbacks.move(next.start, next.end);
        }
        drag = null;
        canvas.style.cursor = controlPressed ? "crosshair" : "grab";
        chart.draw();
        if (canvas.hasPointerCapture(event.pointerId))
            canvas.releasePointerCapture(event.pointerId);
        suppressClick = Math.abs(p.pointerCurrent - p.pointerStart) >= 4;
        if (!suppressClick) return;
        if (p.select) {
            const at = (x: number) =>
                p.start + ((x - p.left) / p.width) * (p.end - p.start);
            const lo = Math.round(Math.min(at(p.x), at(p.current))),
                hi = Math.round(Math.max(at(p.x), at(p.current)));
            snapTooltip.hidden = true;
            const forward = p.current >= p.x;
            if (hi > lo)
                callbacks.select(lo, hi, {
                    from: (forward ? p.snapStart : p.snapEnd)?.label,
                    to: (forward ? p.snapEnd : p.snapStart)?.label,
                    fromId: (forward ? p.snapStart : p.snapEnd)?.id,
                    toId: (forward ? p.snapEnd : p.snapStart)?.id,
                });
        } else callbacks.commit("pan");
    }
    function onCancel(event: PointerEvent) {
        if (!drag) return;
        const p = drag;
        drag = null;
        stopMotion();
        hideTooltip();
        canvas.style.cursor = "grab";
        if (!p.select) callbacks.move(p.start, p.end);
        if (canvas.hasPointerCapture(event.pointerId))
            canvas.releasePointerCapture(event.pointerId);
        chart.draw();
    }
    function onWheel(event: WheelEvent) {
        const p = point(event);
        if (!inside(p) || drag) return;
        event.preventDefault();
        hideTooltip();
        const range = zoom || callbacks.range(),
            ratio = (p.x - chart.chartArea.left) / chart.chartArea.width;
        const factor = event.deltaY < 0 ? 0.8 : 1.25,
            span = Math.max(
                1000,
                Math.min(365 * 86400000, (range.end - range.start) * factor),
            );
        const anchor = range.start + ratio * (range.end - range.start),
            start = Math.max(0, anchor - ratio * span);
        if (reducedMotion.matches) callbacks.move(start, start + span);
        else {
            zoom = {
                start,
                end: start + span,
                from: callbacks.range(),
                at: performance.now(),
            };
            requestPaint();
        }
        clearTimeout(wheelTimer);
        wheelTimer = setTimeout(() => {
            wheelTimer = undefined;
            callbacks.commit("zoom");
        }, 180);
    }
    function onClick(event: MouseEvent) {
        // Chart.js usa il click anche per attivare i punti: nel plot serve solo
        // la navigazione, mentre i click sulla legenda restano disponibili.
        if (suppressClick || inside(point(event))) {
            event.stopImmediatePropagation();
            hideTooltip();
        }
        suppressClick = false;
    }
    function onLeave() {
        pointer = null;
        hideTooltip();
        if (!drag) canvas.style.cursor = "default";
        chart.draw();
    }
    window.addEventListener("keydown", onControl);
    window.addEventListener("keyup", onControl);
    window.addEventListener("blur", onBlur);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onCancel);
    canvas.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("click", onClick, true);
    return {
        hideTooltip,
        // Rimuove gli indici prima che cambino i dataset, senza perdere lo stato
        // del cursore. Il tooltip viene ricostruito nello stesso aggiornamento.
        beforeChartUpdate() {
            clearTooltip(false);
        },
        afterChartUpdate() {
            if (!callbacks.continuous?.() && hoverPosition && settled)
                showTooltip(point(hoverPosition));
        },
        get busy() {
            return !!(drag || zoom || wheelTimer);
        },
        drawSelection() {
            const { ctx, chartArea } = chart;
            const showSnap = controlPressed || drag?.select;
            const target =
                showSnap && pointer && inside(pointer)
                    ? snapTarget(pointer.x)
                    : null;
            snapTooltip.hidden =
                !target || !!document.querySelector("dialog[open]");
            if (target && pointer && !snapTooltip.hidden) {
                callbacks.describeSnap?.(target);
                snapTooltip.textContent = target.label;
                const rect = canvas.getBoundingClientRect();
                const x =
                    rect.left +
                    (chart.scales.x.getPixelForValue(target.timestampMs) *
                        rect.width) /
                        chart.width;
                const y = rect.top + (pointer.y * rect.height) / chart.height;
                const box = snapTooltip.getBoundingClientRect();
                snapTooltip.style.left =
                    Math.max(8, Math.min(x + 14, innerWidth - box.width - 8)) +
                    "px";
                snapTooltip.style.top =
                    Math.max(
                        8,
                        Math.min(y + 14, innerHeight - box.height - 8),
                    ) + "px";
            }
            ctx.save();
            for (const event of showSnap
                ? (callbacks.snapPoints?.() ?? [])
                : []) {
                if (
                    event.timestampMs < chart.scales.x.min ||
                    event.timestampMs > chart.scales.x.max
                )
                    continue;
                const active = target?.timestampMs === event.timestampMs;
                ctx.beginPath();
                ctx.arc(
                    chart.scales.x.getPixelForValue(event.timestampMs),
                    chartArea.bottom - 8,
                    active ? 7 : 4,
                    0,
                    Math.PI * 2,
                );
                ctx.fillStyle =
                    event.type === "program_reset" ? "#d85252" : "#2994dc";
                ctx.fill();
                ctx.lineWidth = 1.5;
                ctx.strokeStyle = "#fff";
                ctx.stroke();
            }
            if (target && pointer) {
                const x = chart.scales.x.getPixelForValue(target.timestampMs);
                ctx.strokeStyle =
                    target.type === "program_reset" ? "#d85252" : "#2994dc";
                ctx.lineWidth = 1.5;
                ctx.setLineDash([4, 4]);
                ctx.beginPath();
                ctx.moveTo(x, chartArea.top);
                ctx.lineTo(x, chartArea.bottom);
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.beginPath();
                ctx.arc(x, pointer.y, 6, 0, Math.PI * 2);
                ctx.stroke();
            }
            ctx.restore();
            if (!drag?.select) return;
            ctx.save();
            ctx.fillStyle = "#2994dc22";
            ctx.strokeStyle = "#2994dc";
            ctx.fillRect(
                drag.x,
                chartArea.top,
                drag.current - drag.x,
                chartArea.height,
            );
            ctx.strokeRect(
                drag.x,
                chartArea.top,
                drag.current - drag.x,
                chartArea.height,
            );
            ctx.restore();
        },
        dispose() {
            snapTooltip.remove();
            hideTooltip();
            stopMotion();
            clearTimeout(wheelTimer);
            window.removeEventListener("keydown", onControl);
            window.removeEventListener("keyup", onControl);
            window.removeEventListener("blur", onBlur);
            canvas.removeEventListener("pointermove", onMove);
            canvas.removeEventListener("pointerdown", onDown);
            canvas.removeEventListener("pointerup", onUp);
            canvas.removeEventListener("pointercancel", onCancel);
            canvas.removeEventListener("pointerleave", onLeave);
            canvas.removeEventListener("wheel", onWheel);
            canvas.removeEventListener("click", onClick, true);
        },
    };
}
