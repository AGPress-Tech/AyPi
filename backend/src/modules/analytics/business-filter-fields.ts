import type { SpecialColumn } from "./special-filter-model";
const numbers = new Set(["line", "minimumQuantity", "price", "discount1", "discount2", "quantity", "deliveredQuantity", "residual", "allocated", "picked", "lineAmount", "estimatedAmount", "plannedQuantity", "reservedSales"]);
const dates = new Set(["orderDate", "deliveryDate", "creationDate", "validFrom", "validTo"]);
export const businessFilterFields = (keys: string[]): SpecialColumn[] => keys.map(key => ({ key, label: key, kind: numbers.has(key) ? "number" : dates.has(key) ? "date" : "text" }));
