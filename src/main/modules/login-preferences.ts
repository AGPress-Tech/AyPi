import { app, ipcMain } from "electron";
import fs from "fs";
import path from "path";

export type RememberedLogin = { name: string; department: string };
export type LoginPreferences = { employee?: RememberedLogin; admin?: RememberedLogin };
export function cleanRememberedLogin(input: any): RememberedLogin {
    if (!input || typeof input.name !== "string" || !input.name.trim() || input.name.length > 200 ||
        typeof input.department !== "string" || input.department.length > 200)
        throw Error("Operatore non valido.");
    return { name: input.name.trim(), department: input.department.trim() };
}
export function createLoginPreferencesStore(file: string) {
    function read(): LoginPreferences {
        try {
            const source = JSON.parse(fs.readFileSync(file, "utf8"));
            const result: LoginPreferences = {};
            for (const role of ["employee", "admin"] as const) {
                try { if (source[role]) result[role] = cleanRememberedLogin(source[role]); } catch {}
            }
            return result;
        } catch { return {}; }
    }
    function remember(role: "employee" | "admin", input: unknown) {
        if (!["employee", "admin"].includes(role)) throw Error("Tipo di accesso non valido.");
        const value = { ...read(), [role]: cleanRememberedLogin(input) };
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file + ".tmp", JSON.stringify(value, null, 2), "utf8");
        fs.renameSync(file + ".tmp", file);
        return value;
    }
    return { read, remember };
}
let registered = false;
export function registerLoginPreferencesIpc() {
    if (registered) return;
    registered = true;
    const store = createLoginPreferencesStore(path.join(app.getPath("userData"), "login-preferences.json"));
    ipcMain.handle("login-preferences-read", () => store.read());
    ipcMain.handle("login-preferences-remember", (_event, role, value) => {
        try { return { ok: true, preferences: store.remember(role, value) }; }
        catch { return { ok: false }; }
    });
}
