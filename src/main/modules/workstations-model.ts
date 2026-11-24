import { createHomePages } from "./home-pages";

export type AccessState = "accessible" | "blocked" | "hidden";
export type StationProfile = { id: string; name: string; rules: Record<string, AccessState> };
export type StationConfig = { version: 1; activeId: string; profiles: StationProfile[] };
export type StationEntry = { id: string; label: string; parent?: string; channel?: string; addressKey?: string; target?: string };
export const stationCatalog: StationEntry[] = [];
for (const [key, page] of Object.entries(createHomePages("standard"))) {
    const parent = `section:${key}`;
    stationCatalog.push({ id: parent, label: page.title });
    for (const action of page.actions || []) stationCatalog.push({
        id: action.addressKey || action.channel!, label: action.label, parent,
        channel: action.channel, addressKey: action.addressKey,
    });
}
stationCatalog.push({ id: "open-forge-window", label: "AyPi FORGE", parent: "section:mes-scada", channel: "open-forge-window" });
stationCatalog.push(
    { id: "open-production-planner-window", label: "MES · Pianificazione produzione", parent: "open-forge-window", channel: "open-production-planner-window" },
    { id: "open-forno-window", label: "SCADA Forno", parent: "open-forge-window", channel: "open-forno-window" },
    { id: "forge-robots", label: "Verifica robot", parent: "open-forge-window" },
    { id: "open-timer-window", label: "Timer e cronometri", parent: "section:utilities", channel: "open-timer-window" },
);
for (const [target, label] of Object.entries({ "article-orders": "Venduto per articolo", "article-offers": "Offerte per articolo", "customer-analysis": "Analisi per cliente", "bom-analysis": "BoM e Articoli", "bar-contracts": "Situazione Contratti Barra in Corso", "stock-analysis": "Giacenze" })) {
    stationCatalog.push({ id: target, label, target, parent: "commercial-analysis-open", channel: `${target}-open` });
}
for (const [target, id] of Object.entries({ "supplier-evaluation": "moduli.openFornitori", "processing-cycles": "infoarticoli.openCicli", tooling: "moduli.openUtensili", "turning-analysis": "turning-analysis-open" })) {
    stationCatalog.find(entry => entry.id === id)!.target = target;
}
const orderedCatalog: StationEntry[] = [];
function appendChildren(parent?: string) {
    for (const entry of stationCatalog.filter(entry => entry.parent === parent)) {
        orderedCatalog.push(entry);
        appendChildren(entry.id);
    }
}
appendChildren();
stationCatalog.splice(0, stationCatalog.length, ...orderedCatalog);

export function defaultStationConfig(): StationConfig {
    return { version: 1, activeId: "", profiles: [{ id: "default", name: "Standard", rules: {} }] };
}
export function validateStationConfig(value: any): StationConfig {
    if (value?.version !== 1 || !Array.isArray(value.profiles) || !value.profiles.length || value.profiles.length > 100) throw Error("Configurazione postazioni non valida.");
    const ids = new Set<string>();
    const names = new Set<string>();
    const profiles = value.profiles.map((profile: any) => {
        if (typeof profile?.id !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(profile.id) || ids.has(profile.id)) throw Error("Identificativo postazione non valido o duplicato.");
        const name = typeof profile.name === "string" ? profile.name.trim() : "";
        if (!name || name.length > 80 || names.has(name.toLocaleLowerCase("it"))) throw Error("Usa nomi di postazione diversi, da 1 a 80 caratteri.");
        ids.add(profile.id); names.add(name.toLocaleLowerCase("it"));
        if (!profile.rules || typeof profile.rules !== "object" || Array.isArray(profile.rules)) throw Error("Regole postazione non valide.");
        const rules: Record<string, AccessState> = {};
        for (const [key, state] of Object.entries(profile.rules)) {
            if (!stationCatalog.some(entry => entry.id === key) || !["accessible", "blocked", "hidden"].includes(state as string)) throw Error("Regola postazione non riconosciuta.");
            rules[key] = state as AccessState;
        }
        return { id: profile.id, name, rules };
    });
    if (value.activeId !== "" && !ids.has(value.activeId)) throw Error("Seleziona una postazione valida per questo PC.");
    return { version: 1, activeId: value.activeId, profiles };
}
export function stationAccess(config: StationConfig, id: string): AccessState {
    const profile = config.profiles.find(p => p.id === config.activeId);
    if (!profile) return "accessible";
    let state: AccessState = profile.rules[id] || "accessible";
    let parent = stationCatalog.find(entry => entry.id === id)?.parent;
    while (parent) {
        const inherited = profile.rules[parent] || "accessible";
        if (inherited === "hidden" || state === "hidden") state = "hidden";
        else if (inherited === "blocked") state = "blocked";
        parent = stationCatalog.find(entry => entry.id === parent)?.parent;
    }
    return state;
}
