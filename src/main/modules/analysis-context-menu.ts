import { Menu, BrowserWindow, WebContents } from "electron";

type Request = {
    sender: WebContents;
    menu?: Menu;
    replacing: boolean;
    timer?: ReturnType<typeof setTimeout>;
    window?: BrowserWindow;
    loadingClosed?: Promise<void>;
    finishLoading?: () => void;
};

/** Native feedback while checks run; never reopen a dismissed or superseded menu. */
export class AnalysisContextMenu {
    private current: Request | null = null;

    cancelBeforePopup(sender: WebContents) {
        if (this.current?.sender === sender && !this.current.menu) this.cancel(sender);
    }

    cancel(sender?: WebContents) {
        const request = this.current;
        if (!request || sender && request.sender !== sender) return;
        this.current = null;
        clearTimeout(request.timer);
        if (!request.window?.isDestroyed()) request.menu?.closePopup?.(request.window);
        request.finishLoading?.();
    }

    async show(
        sender: WebContents,
        position: { x: number; y: number },
        load: (isCurrent: () => boolean) => Promise<Electron.MenuItemConstructorOptions[]>,
    ) {
        this.cancel();
        const request: Request = {
            sender,
            window: BrowserWindow.fromWebContents(sender) || undefined,
            replacing: false,
        };
        this.current = request;
        const isCurrent = () => this.current === request && !sender.isDestroyed();
        request.timer = setTimeout(() => {
            if (!isCurrent()) return;
            request.loadingClosed = new Promise(resolve => { request.finishLoading = resolve; });
            request.menu = Menu.buildFromTemplate([{ label: "Verifica collegamenti…", enabled: false }]);
            request.menu.popup({
                window: request.window,
                ...position,
                callback: () => {
                    request.finishLoading?.();
                    if (!request.replacing && this.current === request) this.current = null;
                },
            });
        }, 120);
        try {
            const items = await load(isCurrent);
            clearTimeout(request.timer);
            if (!isCurrent()) {
                if (this.current === request) this.cancel(sender);
                return;
            }
            request.replacing = true;
            request.menu?.closePopup?.(request.window);
            if (!request.menu?.closePopup) request.finishLoading?.();
            // Wait for the native close callback before opening the ready menu;
            // two native popup lifecycles must not overlap on Windows.
            await request.loadingClosed;
            if (!isCurrent()) return;
            if (!items.length) {
                this.current = null;
                return;
            }
            request.menu = Menu.buildFromTemplate(items);
            request.menu.popup({
                window: request.window,
                ...position,
                callback: () => { if (this.current === request) this.current = null; },
            });
        } catch (error) {
            if (this.current === request) this.cancel(sender);
            throw error;
        } finally {
            clearTimeout(request.timer);
        }
    }
}
