type ScrollTable = {
    table: HTMLTableElement;
    total: number;
    initial: number;
    batch?: number;
    append: (from: number, to: number) => void;
    progress?: (loaded: number, total: number) => void;
};
type Controller = ScrollTable & {
    loaded: number;
    container: HTMLElement;
    observer: ResizeObserver;
};
const controllers = new Set<Controller>();
let frame = 0;
function cleanup() {
    for (const c of controllers)
        if (!c.table.isConnected) {
            c.observer.disconnect();
            controllers.delete(c);
        }
}
function nearEnd(c: Controller) {
    const el = c.container;
    if (!el.getClientRects().length || el.clientHeight < 1) return false;
    const style = getComputedStyle(el),
        local =
            /auto|scroll/.test(style.overflowY) &&
            el.scrollHeight > el.clientHeight + 1;
    if (local) return el.scrollHeight - el.clientHeight - el.scrollTop < 180;
    const rect = el.getBoundingClientRect();
    let bottom = innerHeight;
    for (let parent = el.parentElement; parent; parent = parent.parentElement) {
        if (/auto|scroll/.test(getComputedStyle(parent).overflowY))
            bottom = Math.min(bottom, parent.getBoundingClientRect().bottom);
    }
    return rect.bottom <= bottom + 180 && rect.bottom > 0;
}
function schedule() {
    if (frame) return;
    frame = requestAnimationFrame(() => {
        frame = 0;
        cleanup();
        for (const c of controllers) {
            if (c.loaded >= c.total || !nearEnd(c)) continue;
            const end = Math.min(c.total, c.loaded + (c.batch || 250));
            c.append(c.loaded, end);
            c.loaded = end;
            c.progress?.(end, c.total);
            schedule();
        }
    });
}
document.addEventListener(
    "scroll",
    (event) => {
        const target = event.target;
        for (const c of controllers)
            if (
                target === document ||
                (target instanceof Element && target.contains(c.table))
            ) {
                schedule();
                break;
            }
    },
    { capture: true, passive: true },
);
window.addEventListener("resize", schedule, { passive: true });
/** Append rows in place: prior rows, expanded documents and scroll position remain intact. */
export function continueTableOnScroll(options: ScrollTable) {
    cleanup();
    for (const old of controllers)
        if (old.table === options.table) {
            old.observer.disconnect();
            controllers.delete(old);
        }
    const container =
        options.table.closest<HTMLElement>(".table-scroll") ||
        options.table.parentElement!;
    container.scrollTop = 0;
    const observer = new ResizeObserver(schedule),
        controller: Controller = {
            ...options,
            loaded: options.initial,
            container,
            observer,
        };
    controllers.add(controller);
    observer.observe(container);
    options.progress?.(controller.loaded, controller.total);
    schedule();
    (options.table as any)[Symbol.for("aypi.materializeTableRows")] = () => {
        if (controller.loaded < controller.total) {
            controller.append(controller.loaded, controller.total);
            controller.loaded = controller.total;
            controller.progress?.(controller.loaded, controller.total);
        }
    };
}
export function materializeTableRows(table: HTMLTableElement) {
    (table as any)[Symbol.for("aypi.materializeTableRows")]?.();
}
export function appendTableHtml(table: HTMLTableElement, markup: string) {
    const temporary = document.createElement("table");
    temporary.innerHTML = markup;
    const body = temporary.tBodies[0];
    if (body) table.tBodies[0].append(...Array.from(body.children));
}
