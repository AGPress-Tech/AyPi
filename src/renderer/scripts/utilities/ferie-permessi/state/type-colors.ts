export type TypeColorMap = Record<string, string>;

export function normalizeHexColor(value: unknown, fallback: string) {
    if (typeof value !== "string") return fallback;
    const cleaned = value.trim();
    return /^#[0-9a-fA-F]{6}$/.test(cleaned)
        ? cleaned.toLowerCase()
        : fallback;
}

export function createTypeColorStore(options: {
    storage: Storage | null | undefined;
    storageKey: string;
    defaults: TypeColorMap;
}) {
    const defaults = { ...options.defaults };
    let colors = { ...defaults };

    function normalize(input: any): TypeColorMap {
        const source = input && typeof input === "object" ? input : {};
        const legacyRetribuito = source.retribuito ?? source.giustificato;
        return {
            ferie: normalizeHexColor(source.ferie, defaults.ferie),
            permesso: normalizeHexColor(source.permesso, defaults.permesso),
            straordinari: normalizeHexColor(
                source.straordinari,
                defaults.straordinari,
            ),
            mutua: normalizeHexColor(source.mutua, defaults.mutua),
            speciale: normalizeHexColor(source.speciale, defaults.speciale),
            retribuito: normalizeHexColor(
                legacyRetribuito,
                defaults.retribuito,
            ),
        };
    }

    function load() {
        try {
            const raw = options.storage?.getItem(options.storageKey);
            colors = raw ? normalize(JSON.parse(raw)) : { ...defaults };
        } catch {
            colors = { ...defaults };
        }
        return getAll();
    }

    function save(next: TypeColorMap = colors) {
        set(next);
        try {
            options.storage?.setItem(options.storageKey, JSON.stringify(colors));
        } catch (err) {
            console.error("Errore salvataggio impostazioni colori:", err);
        }
    }

    function get(type: string) {
        const key = type === "infortunio" ? "mutua" : type;
        return colors[key] || defaults[key] || "#1a73e8";
    }

    function getAll() {
        return { ...colors };
    }

    function set(next: TypeColorMap) {
        colors = { ...next };
    }

    return { get, getAll, load, save, set };
}
