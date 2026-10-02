/**
 * Contratti preparatori per le future funzioni di inventario fisico.
 *
 * Nessuna capability viene abilitata automaticamente: lo schema può essere
 * distribuito e collaudato mesi prima dell'attivazione dell'interfaccia.
 */
export const WAREHOUSE_FUTURE_CAPABILITIES = Object.freeze({
    schemaVersion: 1,
    physicalInventoryAdjustments: false,
    unitTrackingCodes: false,
    scannerConfirmations: false,
    crateLabelPrinting: false,
});

export type WarehouseScanPurpose =
    | "identify"
    | "confirm-pick"
    | "confirm-deposit"
    | "physical-count";

export type WarehouseScanOutcome =
    | "matched"
    | "unexpected-unit"
    | "unexpected-location"
    | "unknown-code"
    | "duplicate-scan";

export type WarehousePhysicalInventoryStatus =
    | "draft"
    | "counting"
    | "review"
    | "reconciled"
    | "cancelled";

export type WarehouseAdjustmentStatus =
    | "draft"
    | "approved"
    | "applied"
    | "cancelled";

export type WarehouseLabelJobStatus =
    | "pending"
    | "printing"
    | "printed"
    | "failed"
    | "cancelled";

/**
 * Il codice resta volutamente indipendente dalla simbologia: lo stesso valore
 * potrà essere stampato come Code 128, Data Matrix o QR senza migrare i dati.
 */
export function normalizeWarehouseTrackingCode(value: unknown) {
    return String(value || "")
        .trim()
        .toUpperCase()
        .replace(/\s+/g, "");
}

export function isValidWarehouseTrackingCode(value: unknown) {
    const normalized = normalizeWarehouseTrackingCode(value);
    return !normalized || /^[A-Z0-9][A-Z0-9._:/-]{5,79}$/.test(normalized);
}

