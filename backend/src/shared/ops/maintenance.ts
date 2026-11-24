import { HttpError } from "../http/errors";
let busy = false;
let requests = 0;
let recoveryRequired = false;
export function setBackupRecoveryRequired(value: boolean) { recoveryRequired = value; }
export function isBackupRecoveryRequired() { return recoveryRequired; }
export function assertServiceAvailable() { if (busy || recoveryRequired) throw new HttpError(503, "Ripristino backup in corso o recupero richiesto. Riapri il modulo al termine dell’operazione."); }
export function enterBackendRequest(url: string) {
    const pathname = url.split("?")[0];
    if (pathname === "/health" || pathname === "/api/backups" || pathname.startsWith("/api/backups/")) return () => {};
    assertServiceAvailable(); requests++;
    return () => { requests--; };
}
export async function exclusiveMaintenance<T>(run: () => Promise<T>): Promise<T> {
    if (busy) throw new HttpError(409, "Un’operazione di backup è già in corso.");
    busy = true;
    try {
        const start = Date.now();
        while (requests > 0) {
            if (Date.now() - start > 30000) throw new HttpError(409, "Richieste ancora attive. Chiudi i moduli sulle postazioni e riprova.");
            await new Promise(resolve => setTimeout(resolve, 25));
        }
        return await run();
    } finally { await new Promise(resolve => setTimeout(resolve, 50)); busy = false; }
}
