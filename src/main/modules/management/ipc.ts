import { BrowserWindow, ipcMain, dialog, app } from "electron";
import path from "path";
import fs from "fs";
import { Worker } from "worker_threads";
import { SOURCE_PATH, ManagementData, MovementIndex } from "./model";
import { queryMovements } from "./movement-query";
import { readTargets, saveTarget } from "./targets";
import { createAnalyticsClient } from "./analytics-client";

export function registerManagementIpc(mainWindow: BrowserWindow, allowed: () => boolean, icon: () => string, options?:{getCredential:()=>string|null;getBackendUrl:()=>string}) {
    const analytics=createAnalyticsClient(options?.getBackendUrl || (()=>{throw new Error("Backend non configurato.");}),options?.getCredential || (()=>null));
    let window: BrowserWindow | null = null;
    let cache: ManagementData | null = null;
    let movementIndex: MovementIndex = Object.create(null);
    let pending: Promise<any> | null = null;
    let worker: Worker | null = null;
    const revoke = () => {
        cache = null;
        movementIndex = Object.create(null);
        worker?.terminate();
        void analytics.logout();
        if (window && !window.isDestroyed()) window.destroy();
        window = null;
    };
    ipcMain.handle("management-open", async (event) => {
        if (!allowed() || event.sender !== mainWindow.webContents) return { ok: false, error: "Accesso riservato. Premi F2 e inserisci la password amministratore." };
        if (window && !window.isDestroyed()) { window.maximize(); window.show(); window.focus(); return { ok: true }; }
        const win = new BrowserWindow({ width: 1480, height: 940, minWidth: 1000, minHeight: 680,
            title: "AyPi · Controllo di Gestione", icon: icon(), backgroundColor: "#f7f4ed", show: false,
            webPreferences: { nodeIntegration: true, contextIsolation: false } });
        window = win;
        win.setMenu(null);
        win.maximize();
        win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
        win.webContents.on("will-navigate", e => e.preventDefault());
        win.once("ready-to-show", () => { if (!win.isDestroyed() && allowed()) win.show(); });
        win.on("closed", () => { if (window === win) { window = null; cache=null; movementIndex=Object.create(null); } });
        const theme = /[?&]theme=bluearchive(?:&|$)/.test(mainWindow.webContents.getURL?.() || "") ? "bluearchive" : "standard";
        await win.loadFile(path.join(__dirname, "..", "..", "pages", "management.html"), { query: { theme } });
        return { ok: true };
    });
    ipcMain.handle("management-load", async (event, payload) => {
        if (!allowed() || !window || event.sender !== window.webContents) return { ok: false, error: "Sessione non autorizzata." };
        const mode=payload?.mode==="excel" ? "excel" : "sql",refresh=payload===true||!!payload?.refresh;
        if (cache && !refresh && cache.sourceKind===mode) return { ok: true, data: cache };
        if (!pending) {
            const owner=window;
            pending = (async()=>{
              const dataset=mode==="sql" ? await analytics.query("bilancino") : null;
              if(!allowed()||window!==owner||owner.isDestroyed())return {ok:false,error:"Sessione terminata."};
              return new Promise(resolve => {
                const task = new Worker(path.join(__dirname, "worker.js"), { workerData: { source: SOURCE_PATH, dataset } });
                worker = task;
                let done = false;
                const finish = (result: any) => {
                    if (done) return;
                    done = true; clearTimeout(timeout);
                    const active=allowed()&&window===owner&&!owner.isDestroyed();
                    if (active && result.ok) { cache = result.data; movementIndex = result.movements || Object.create(null); }
                    resolve(!active ? { ok: false, error: "Sessione terminata." } : result.ok ? { ok: true, data: result.data } : { ok: false, error: result.error });
                    if (worker === task) worker = null;
                };
                const timeout = setTimeout(() => { finish({ ok: false, error: "Tempo di lettura scaduto. Verificare il collegamento a DL360 e riprovare." }); task.terminate(); }, 120000);
                task.once("message", finish);
                task.once("error", e => finish({ ok: false, error: e.message }));
                task.once("exit", () => finish({ ok: false, error: "Lettura del file interrotta." }));
              });
            })().catch(error=>({ok:false,error:error instanceof Error ? error.message : String(error)})).finally(() => { pending = null; });
        }
        return pending;
    });
    ipcMain.handle("management-movements", (event, request) => {
        if (!allowed() || !window || event.sender !== window.webContents || !cache) return {ok:false,error:"Sessione non autorizzata."};
        try { return {ok:true,...queryMovements(cache,movementIndex,request)}; }
        catch(error) { return {ok:false,error:error instanceof Error ? error.message : String(error)}; }
    });
    let targetWrites = Promise.resolve();
    ipcMain.handle("management-targets-load", async event => {
        if (!allowed() || !window || event.sender !== window.webContents) return {ok:false,error:"Sessione non autorizzata."};
        try {
            await targetWrites;
            const targets = await readTargets(path.join(app.getPath("userData"),"management-targets.json"));
            return allowed() && !event.sender.isDestroyed() ? {ok:true,targets} : {ok:false,error:"Sessione terminata."};
        } catch(error) { return {ok:false,error:error instanceof Error ? error.message : String(error)}; }
    });
    ipcMain.handle("management-targets-save", async (event, request) => {
        if (!allowed() || !window || event.sender !== window.webContents) return {ok:false,error:"Sessione non autorizzata."};
        let result: any;
        const operation = targetWrites.then(async () => {
            if (!allowed() || event.sender.isDestroyed()) { result={ok:false,error:"Sessione terminata."}; return; }
            const targets = await saveTarget(path.join(app.getPath("userData"),"management-targets.json"),request);
            result={ok:true,targets};
        });
        targetWrites = operation.catch(() => {});
        try { await operation; return result; }
        catch(error) { return {ok:false,error:error instanceof Error ? error.message : String(error)}; }
    });
    ipcMain.handle("management-save", async (event, bytes) => {
        if (!allowed() || !window || event.sender !== window.webContents) return { ok: false, error: "Sessione non autorizzata." };
        if (!(bytes instanceof Uint8Array) || bytes.byteLength > 32 * 1024 * 1024) return { ok: false, error: "Esportazione non valida." };
        const owner = window;
        const choice = await dialog.showSaveDialog(owner, { title: "Esporta controllo di gestione", defaultPath: "ControlloGestione.xlsx", filters: [{ name: "Cartella di lavoro Excel", extensions: ["xlsx"] }] });
        if (choice.canceled || !choice.filePath) return { ok: true, canceled: true };
        if (!allowed() || owner.isDestroyed()) return { ok: false, error: "Sessione terminata." };
        try {
            if (path.resolve(choice.filePath).toLowerCase() === path.resolve(SOURCE_PATH).toLowerCase()) return { ok: false, error: "Scegliere un file diverso dall’Excel sorgente." };
            await fs.promises.writeFile(choice.filePath, bytes);
            return { ok: true };
        } catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
    });
    return { revoke };
}
