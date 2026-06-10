import { createOperationQueue } from "../../shared/ops/queue";
import {
    deleteTransferItem,
    listTransferItems,
    loadTransferItem,
    saveTransferItem,
} from "./repository";

const enqueue = createOperationQueue("transfer-attrezzaggio");

export function getTransferItems() {
    return listTransferItems();
}

export function getTransferItem(code: string) {
    return loadTransferItem(code);
}

export function saveTransfer(code: string, payload: any) {
    return enqueue("saveItem", () =>
        saveTransferItem({
            ...payload,
            code,
        }),
    );
}

export function removeTransfer(code: string) {
    return enqueue("deleteItem", () => deleteTransferItem(code));
}
