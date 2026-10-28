/** Identita e animazione di ingresso condivise con gli altri moduli AyPi. */
export function setupFornoSplash() {
    const splash = document.getElementById('forno-splash');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const started = performance.now();
    const timers = new Set<ReturnType<typeof setTimeout>>();
    let finished = false;
    const schedule = (callback: () => void, delay: number) => {
        const timer = setTimeout(() => { timers.delete(timer); callback(); }, delay);
        timers.add(timer);
    };
    const panels = ['.topbar', '.workspace'].map(selector => document.querySelector<HTMLElement>(selector)).filter(Boolean);
    const hide = () => {
        if (finished) return;
        finished = true;
        timers.forEach(clearTimeout); timers.clear();
        splash?.classList.add('is-hidden'); splash?.classList.remove('is-visible', 'is-fading');
        splash?.setAttribute('aria-hidden', 'true');
        if (splash) splash.hidden = true;
        document.body.classList.remove('module-splash-active', 'agpress-scripted-splash');
        panels.forEach(panel => { panel!.inert = false; });
        document.removeEventListener('keydown', keyboard);
    };
    const fade = () => {
        if (finished || splash?.classList.contains('is-fading')) return;
        splash?.classList.add('is-fading');
        schedule(hide, reducedMotion ? 0 : 850);
    };
    const keyboard = (event: KeyboardEvent) => {
        if (!finished && ['Escape', 'Enter', ' '].includes(event.key)) { event.preventDefault(); fade(); }
    };
    if (!splash) { document.body.classList.remove('module-splash-active', 'agpress-scripted-splash'); return { mark: (_stage: string) => {}, ready: hide, dispose: hide }; }
    panels.forEach(panel => { panel!.inert = true; });
    splash.classList.add('is-visible'); splash.setAttribute('aria-hidden', 'false');
    splash.addEventListener('click', fade);
    document.addEventListener('keydown', keyboard);
    schedule(hide, reducedMotion ? 1200 : 7000);
    return {
        mark(stage: string) { splash.querySelector(`[data-boot-stage="${stage}"]`)?.classList.add('is-complete'); },
        ready() { schedule(fade, Math.max(0, (reducedMotion ? 0 : 2200) - (performance.now() - started))); },
        dispose: hide,
    };
}
