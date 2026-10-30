import type Chart from 'chart.js/auto';
import type { attachChartInteractions as desktopInteractions } from '../../src/renderer/scripts/forno/chart-interactions';
type Range = { start: number; end: number };
type Callbacks = Parameters<typeof desktopInteractions>[1];

/** Gesti touch; letture e analisi restano quelle del renderer desktop. */
export function attachChartInteractions(chart: Chart<'line'>, callbacks: Callbacks): ReturnType<typeof desktopInteractions> {
    const canvas = chart.canvas, abort = new AbortController(), signal = abort.signal;
    const touches = new Map<number, { x: number; y: number }>();
    let base: Range = callbacks.range(), origin = 0, current = 0, width = 1, anchor = 0, distance = 0, changed = false, pinching = false;
    let frame = 0, pending: Range | null = null;
    const layout = () => {
        // I canali hanno già controlli touch dedicati: evita la legenda duplicata.
        if (chart.options.plugins?.legend) chart.options.plugins.legend.display = false;
        const axis = chart.options.scales?.x as any;
        if (axis?.title) axis.title.display = !document.documentElement.classList.contains('mobile-chart-focus');
        chart.resize();
        chart.update('none');
    };
    window.addEventListener('resize', layout, { signal });
    layout();
    const mode = () => document.documentElement.dataset.touchMode || 'navigate';
    const point = (event: PointerEvent) => { const r = canvas.getBoundingClientRect(); return { x: (event.clientX - r.left) * chart.width / r.width, y: (event.clientY - r.top) * chart.height / r.height }; };
    const inside = (p: { x: number; y: number }) => p.x >= chart.chartArea.left && p.x <= chart.chartArea.right && p.y >= chart.chartArea.top && p.y <= chart.chartArea.bottom;
    const flush = () => { if (pending) { const p = pending; pending = null; callbacks.move(p.start, p.end); } };
    const move = (start: number, span: number) => { pending = { start: Math.max(0, start), end: Math.max(0, start) + span }; if (!frame) frame = requestAnimationFrame(() => { frame = 0; flush(); }); };
    const reset = () => {
        base = callbacks.range(); width = Math.max(1, chart.chartArea.width);
        const points = [...touches.values()]; origin = current = points[0]?.x || 0;
        if (points.length >= 2) { distance = Math.max(1, Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y)); const middle = (points[0].x + points[1].x) / 2; anchor = base.start + (middle - chart.chartArea.left) / width * (base.end - base.start); pinching = true; }
    };
    canvas.addEventListener('pointerdown', event => {
        const p = point(event); if (!inside(p) || event.button !== 0) return;
        event.preventDefault(); touches.set(event.pointerId, p); canvas.setPointerCapture(event.pointerId);
        if (touches.size === 1) { changed = false; pinching = false; }
        flush(); reset();
    }, { signal });
    canvas.addEventListener('pointermove', event => {
        if (!touches.has(event.pointerId)) return;
        const p = point(event); touches.set(event.pointerId, p); current = p.x;
        if (mode() === 'inspect') return;
        if (touches.size >= 2) {
            const [a, b] = [...touches.values()];
            const span = Math.min(366 * 86400000, Math.max(1000, (base.end - base.start) * distance / Math.max(1, Math.hypot(b.x - a.x, b.y - a.y))));
            const ratio = ((a.x + b.x) / 2 - chart.chartArea.left) / width;
            move(anchor - ratio * span, span); changed = true; return;
        }
        if (Math.abs(current - origin) > 4) changed = true;
        if (mode() === 'analysis') { chart.draw(); return; }
        move(base.start - (current - origin) / width * (base.end - base.start), base.end - base.start);
    }, { signal });
    const end = (event: PointerEvent) => {
        if (!touches.has(event.pointerId)) return;
        flush(); touches.delete(event.pointerId);
        if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
        if (touches.size) { reset(); return; }
        if (changed) {
            if (mode() === 'analysis' && !pinching) { const at = (x: number) => base.start + Math.max(0, Math.min(1, (x - chart.chartArea.left) / width)) * (base.end - base.start); callbacks.select(Math.round(at(Math.min(origin, current))), Math.round(at(Math.max(origin, current)))); }
            else if (mode() !== 'inspect') callbacks.commit(pinching ? 'zoom' : 'pan');
        }
        chart.draw();
    };
    canvas.addEventListener('pointerup', end, { signal });
    canvas.addEventListener('pointercancel', event => { touches.delete(event.pointerId); pending = null; if (!touches.size && changed) callbacks.commit(pinching ? 'zoom' : 'pan'); chart.draw(); }, { signal });
    return {
        get busy() { return touches.size > 0; },
        hideTooltip() { chart.tooltip?.setActiveElements([], { x: 0, y: 0 }); },
        beforeChartUpdate() { chart.tooltip?.setActiveElements([], { x: 0, y: 0 }); chart.setActiveElements([]); },
        drawSelection() { if (!touches.size || mode() !== 'analysis' || pinching) return; const { ctx, chartArea: a } = chart; const left = Math.max(a.left, Math.min(a.right, origin)), right = Math.max(a.left, Math.min(a.right, current)); ctx.save(); ctx.fillStyle = '#2994dc33'; ctx.fillRect(left, a.top, right - left, a.bottom - a.top); ctx.restore(); },
        afterChartUpdate() {},
        dispose() { abort.abort(); cancelAnimationFrame(frame); touches.clear(); },
    };
}
