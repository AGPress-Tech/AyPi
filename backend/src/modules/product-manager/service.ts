import { createOperationQueue } from "../../shared/ops/queue";
import {
    createProductManagerBackup,
    loadProductManagerBootstrap,
    listProductManagerBackups,
    restoreProductManagerBackup,
    saveCatalogImage,
    saveProductManagerCatalog,
    saveProductManagerCategories,
    saveProductManagerInterventions,
    saveProductManagerInterventionTypes,
    saveProductManagerRequests,
} from "./repository";

const enqueue = createOperationQueue("product-manager");

export function getProductManagerBootstrap() {
    return loadProductManagerBootstrap();
}

export function getProductManagerBackups() {
    return listProductManagerBackups();
}

export function runProductManagerBackup() {
    return enqueue("createBackup", () => createProductManagerBackup());
}

export function runProductManagerRestore(name: string) {
    return enqueue("restoreBackup", () => restoreProductManagerBackup(name));
}

export function saveRequests(payload: any[]) {
    return enqueue("saveRequests", () => saveProductManagerRequests(payload));
}

export function saveInterventions(payload: any[]) {
    return enqueue("saveInterventions", () => saveProductManagerInterventions(payload));
}

export function saveCatalog(payload: any[]) {
    return enqueue("saveCatalog", () => saveProductManagerCatalog(payload));
}

export function saveCategories(payload: any[]) {
    return enqueue("saveCategories", () => saveProductManagerCategories(payload));
}

export function saveInterventionTypes(payload: any[]) {
    return enqueue("saveInterventionTypes", () =>
        saveProductManagerInterventionTypes(payload),
    );
}

export function saveCatalogImageEntry(payload: {
    catalogId?: string;
    fileName?: string;
    dataBase64?: string;
}) {
    return enqueue("saveCatalogImage", () => saveCatalogImage(payload));
}
