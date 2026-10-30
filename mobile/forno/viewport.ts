/** Dimensioni reali della WebView, anche dopo rotazione e apertura della tastiera. */
export function installMobileViewport() {
    const root = document.documentElement;
    let previousScroll = { x: 0, y: 0 };
    const update = () => {
        const height = Math.min(window.innerHeight, window.visualViewport?.height || window.innerHeight);
        root.style.setProperty('--forno-viewport-height', `${Math.max(1, Math.floor(height))}px`);
        root.style.setProperty('--forno-viewport-width', `${Math.max(1, Math.floor(window.innerWidth))}px`);
    };
    const top = () => {
        window.scrollTo(0, 0);
        document.documentElement.scrollTop = 0;
        document.body.scrollTop = 0;
    };
    const toggle = () => {
        const entering = !root.classList.contains('mobile-chart-focus');
        if (entering) previousScroll = { x: window.scrollX, y: window.scrollY };
        root.classList.toggle('mobile-chart-focus', entering);
        update();
        if (entering) top();
        requestAnimationFrame(() => {
            if (entering) top(); else window.scrollTo(previousScroll.x, previousScroll.y);
            window.dispatchEvent(new Event('resize'));
        });
        return entering;
    };
    (window as any).__aypiToggleFullscreen = toggle;
    (window as any).__aypiUpdateViewport = update;
    window.addEventListener('resize', update);
    window.visualViewport?.addEventListener('resize', update);
    update();
}
