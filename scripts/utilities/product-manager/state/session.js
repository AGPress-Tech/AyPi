const { ipcRenderer } = require("electron");

const SESSION_KEY = "pm-session";
const DEFAULT_SESSION = { role: "guest", adminName: "", department: "", employee: "" };

const session = { ...DEFAULT_SESSION };

function setSession(next) {
    const payload = next && typeof next === "object" ? next : {};
    Object.assign(session, DEFAULT_SESSION, payload);
}

function saveSession() {
    try {
        window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    } catch (err) {
        console.error("Errore salvataggio sessione:", err);
    }
    try {
        ipcRenderer.invoke("pm-session-set", session);
    } catch (err) {
        console.error("Errore salvataggio sessione IPC:", err);
    }
}

async function loadSession() {
    try {
        const shared = await ipcRenderer.invoke("pm-session-get");
        if (shared && (shared.role === "admin" || shared.role === "employee")) {
            setSession({
                role: shared.role,
                adminName: shared.adminName || "",
                department: shared.department || "",
                employee: shared.employee || "",
            });
            return;
        }
    } catch (err) {
        console.error("Errore lettura sessione IPC:", err);
    }
    setSession(DEFAULT_SESSION);
}

function clearSession() {
    setSession(DEFAULT_SESSION);
    try {
        window.localStorage.removeItem(SESSION_KEY);
    } catch (err) {
        console.error("Errore clear session:", err);
    }
    try {
        ipcRenderer.invoke("pm-session-clear");
    } catch (err) {
        console.error("Errore clear session IPC:", err);
    }
}

function applySharedSessionData(payload) {
    if (payload && (payload.role === "admin" || payload.role === "employee")) {
        setSession({
            role: payload.role,
            adminName: payload.adminName || "",
            department: payload.department || "",
            employee: payload.employee || "",
        });
        try {
            window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
        } catch (err) {
            console.error("Errore salvataggio sessione:", err);
        }
    } else {
        setSession(DEFAULT_SESSION);
        try {
            window.localStorage.removeItem(SESSION_KEY);
        } catch (err) {
            console.error("Errore clear session:", err);
        }
    }
}

function isAdmin() {
    return session.role === "admin";
}

function isEmployee() {
    return session.role === "employee";
}

function isLoggedIn() {
    return isAdmin() || isEmployee();
}

module.exports = {
    SESSION_KEY,
    session,
    setSession,
    saveSession,
    loadSession,
    clearSession,
    applySharedSessionData,
    isAdmin,
    isEmployee,
    isLoggedIn,
};
