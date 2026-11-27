import * as THREE from "three";
import { openAssistantAnalysis } from "./assistant-analysis-confirm";

// Contours traced from the AGPress symbol: open triangle above, angular G below.
export const AGPRESS_SYMBOL = {
    top: [[54, 286], [300, 50], [550, 286]],
    opening: [[128, 257], [472, 257], [300, 106]],
    bottom: [[54, 310], [300, 550], [552, 310], [302, 310], [301, 342], [467, 342], [300, 497], [106, 310]],
};
function symbolShape(points: number[][]) {
    const shape = new THREE.Shape();
    points.forEach(([x, y], index) => shape[index ? "lineTo" : "moveTo"]((x - 300) / 250, (300 - y) / 250));
    shape.closePath();
    return shape;
}
function mountSymbol(host: HTMLElement) {
    const scene = new THREE.Scene(), rig = new THREE.Group();
    const camera = new THREE.OrthographicCamera(-1.3, 1.3, 1.3, -1.3, 0.1, 20);
    camera.position.z = 6;
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "low-power" });
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
    renderer.setClearColor(0, 0); renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.className = "agpress-bot-canvas";
    renderer.domElement.setAttribute("aria-hidden", "true");
    host.append(renderer.domElement); host.dataset.assistantRuntime = "agpress-3d";
    scene.add(rig, new THREE.HemisphereLight(0xfff8e8, 0x493029, 2.5));
    const light = new THREE.DirectionalLight(0xffffff, 2.8); light.position.set(-3, 4, 6); scene.add(light);
    const rim = new THREE.DirectionalLight(0xffb24b, 1.4); rim.position.set(3, -1, -2); scene.add(rim);
    const top = symbolShape(AGPRESS_SYMBOL.top);
    top.holes.push(new THREE.Path(symbolShape(AGPRESS_SYMBOL.opening).getPoints()));
    const gold = new THREE.Color(0xffda00), orange = new THREE.Color(0xff7800), red = new THREE.Color(0xff1700);
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.3, roughness: 0.3 });
    const geometries = [top, symbolShape(AGPRESS_SYMBOL.bottom)].map(shape => {
        const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.13, bevelEnabled: true, bevelSegments: 3, steps: 1, bevelSize: 0.013, bevelThickness: 0.013, curveSegments: 1 });
        geometry.translate(0, 0, -0.065);
        const positions = geometry.getAttribute("position"), colors = [];
        for (let i = 0; i < positions.count; i++) {
            const ratio = THREE.MathUtils.clamp((1 - positions.getY(i)) / 2, 0, 1);
            const color = ratio < 0.5 ? gold.clone().lerp(orange, ratio * 2) : orange.clone().lerp(red, (ratio - 0.5) * 2);
            colors.push(color.r, color.g, color.b);
        }
        geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
        rig.add(new THREE.Mesh(geometry, material)); return geometry;
    });
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0, last = 0, disposed = false, x = 0, y = 0;
    const draw = (time: number) => {
        frame = 0;
        if (disposed || document.hidden) return;
        if (time - last >= 33) {
            const t = time / 1000;
            rig.rotation.y = reduced.matches ? -0.16 : -0.16 + Math.sin(t * 0.7) * 0.12 + x * 0.09;
            rig.rotation.x = reduced.matches ? 0.05 : Math.sin(t * 0.5) * 0.05 + y * 0.07;
            rig.position.y = reduced.matches ? 0 : Math.sin(t * 1.1) * 0.035;
            renderer.render(scene, camera); last = time;
        }
        if (!reduced.matches) frame = requestAnimationFrame(draw);
    };
    const resume = () => { if (!frame && !disposed && !document.hidden) frame = requestAnimationFrame(time => { last = time - 34; draw(time); }); };
    const resize = () => {
        const rect = host.getBoundingClientRect();
        renderer.setSize(Math.max(1, rect.width), Math.max(1, rect.height), false);
        renderer.render(scene, camera); resume();
    };
    const observer = new ResizeObserver(resize); observer.observe(host);
    const gaze = (event: PointerEvent) => { const rect = host.getBoundingClientRect(); x = (event.clientX - rect.left) / rect.width - 0.5; y = (event.clientY - rect.top) / rect.height - 0.5; resume(); };
    host.addEventListener("pointermove", gaze);
    document.addEventListener("visibilitychange", resume); reduced.addEventListener("change", resume); resize();
    return () => {
        disposed = true; cancelAnimationFrame(frame); observer.disconnect();
        document.removeEventListener("visibilitychange", resume); reduced.removeEventListener("change", resume); host.removeEventListener("pointermove", gaze);
        geometries.forEach(geometry => geometry.dispose()); material.dispose(); renderer.dispose(); renderer.domElement.remove();
    };
}

export function mountAgpressBot(page: () => { title: string; description: string }) {
    const assistant = document.getElementById("assistant")!;
    const player = document.getElementById("spineAssistantPlayer")!;
    const bubble = document.getElementById("speechBubble")!;
    const label = document.getElementById("assistantLabel")!;
    assistant.classList.add("agpress-bot"); assistant.setAttribute("aria-label", "Assistente AGPress");
    player.setAttribute("aria-label", "Informazioni sui moduli AGPress. Tasto destro per le analisi gestionali.");
    player.setAttribute("aria-haspopup", "dialog"); player.removeAttribute("title");
    bubble.textContent = ""; bubble.setAttribute("role", "status"); bubble.setAttribute("aria-live", "polite");
    for (const id of ["assistantHeadHitbox", "assistantSwitch", "assistantPicker"]) {
        const element = document.getElementById(id)!; element.hidden = true; element.setAttribute("aria-hidden", "true");
    }
    let disposeSymbol: (() => void) | undefined, bubbleTimer: ReturnType<typeof setTimeout> | undefined;
    try { disposeSymbol = mountSymbol(player); }
    catch {
        // Keep the same symbol and all interactions available without WebGL.
        player.dataset.assistantRuntime = "agpress-static";
        player.innerHTML = `<svg viewBox="0 0 600 600" aria-hidden="true"><defs><linearGradient id="agpressBotGradient" x2="0" y2="1"><stop stop-color="#ffda00"/><stop offset=".5" stop-color="#ff7800"/><stop offset="1" stop-color="#ff1700"/></linearGradient></defs><path fill="url(#agpressBotGradient)" fill-rule="evenodd" d="M54 286L300 50 550 286ZM128 257L472 257 300 106ZM54 310L300 550 552 310 302 310 301 342 467 342 300 497 106 310Z"/></svg>`;
    }
    assistant.classList.add("ready"); label.textContent = "AGPRESS // ASSISTENTE";
    const messages = [
        () => `${page().title}: ${page().description}`,
        () => "Analisi AGPress raccoglie ordini, listino clienti, giacenze e impegni clienti. Manager offre il riepilogo aziendale.",
        () => "Nelle tabelle di analisi, il tasto destro su articolo, cliente o documento mostra i collegamenti disponibili.",
        () => "Le analisi gestionali includono consegne, prezzi e materiali. In Qualità e continuità trovi valutazioni DDT, strumenti di misura e manutenzioni. Tasto destro sul logo per accedere.",
    ];
    let next = 0, asking = false;
    const say = (text: string) => {
        clearTimeout(bubbleTimer); bubble.textContent = text; bubble.classList.add("visible");
        bubbleTimer = setTimeout(() => bubble.classList.remove("visible"), 7000);
    };
    let idle: ReturnType<typeof setTimeout> | undefined;
    const activityEvents = ["pointermove", "pointerdown", "wheel", "keydown"];
    const resetIdle = () => {
        clearTimeout(idle);
        if (document.hidden || !document.hasFocus()) return;
        idle = setTimeout(() => {
            const modal = Array.from(document.querySelectorAll<HTMLElement>('[aria-modal="true"]')).some(element => element.getClientRects().length && !element.closest('[aria-hidden="true"]'));
            if (!asking && !modal && !bubble.classList.contains("visible") && !document.activeElement?.matches("input,textarea,select")) inform();
            else resetIdle();
        }, 60000);
    };
    const pauseIdle = () => clearTimeout(idle);
    const inform = () => { say(messages[next++ % messages.length]()); resetIdle(); };
    const ask = async (event: Event) => {
        event.preventDefault(); event.stopPropagation();
        if (asking) return;
        asking = true; bubble.classList.remove("visible");
        try { const result = await openAssistantAnalysis(player); if (!result.ok) say(result.error || "Impossibile aprire le analisi gestionali."); }
        catch { say("Impossibile aprire le analisi gestionali. Riprovare."); }
        finally { asking = false; player.focus(); resetIdle(); }
    };
    const key = (event: KeyboardEvent) => {
        if (event.repeat) return;
        if (event.key === "ContextMenu" || event.key === "F10" && event.shiftKey) void ask(event);
        else if (event.key === "Enter" || event.key === " ") { event.preventDefault(); inform(); }
        else if (event.key === "Escape") bubble.classList.remove("visible");
    };
    player.addEventListener("click", inform); player.addEventListener("contextmenu", ask); player.addEventListener("keydown", key);
    activityEvents.forEach(event => document.addEventListener(event, resetIdle, { passive: true, capture: true }));
    window.addEventListener("focus", resetIdle); window.addEventListener("blur", pauseIdle);
    document.addEventListener("visibilitychange", resetIdle);
    resetIdle();
    return { dispose() {
        clearTimeout(bubbleTimer); clearTimeout(idle); disposeSymbol?.();
        activityEvents.forEach(event => document.removeEventListener(event, resetIdle, true));
        window.removeEventListener("focus", resetIdle); window.removeEventListener("blur", pauseIdle);
        document.removeEventListener("visibilitychange", resetIdle);
        player.removeEventListener("click", inform); player.removeEventListener("contextmenu", ask); player.removeEventListener("keydown", key);
    } };
}
