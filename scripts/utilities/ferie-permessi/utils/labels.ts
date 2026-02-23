require("../../../shared/dev-guards");

export type RequestType =
    | "ferie"
    | "permesso"
    | "retribuito"
    | "giustificato"
    | "straordinari"
    | "mutua"
    | "speciale"
    | string;

export function getTypeLabel(value: RequestType) {
    if (value === "permesso") return "Permesso";
    if (value === "retribuito" || value === "giustificato") return "Permesso Retribuito";
    if (value === "straordinari") return "Straordinari";
    if (value === "mutua") return "Mutua";
    if (value === "speciale") return "Permesso Chiusura Aziendale";
    return "Ferie";
}

// Keep CommonJS compatibility for legacy JS callers
if (typeof module !== "undefined" && module.exports && !(globalThis as any).__aypiBundled) {
    if (typeof module !== "undefined" && module.exports && !(globalThis as any).__aypiBundled) module.exports = { getTypeLabel };
}



