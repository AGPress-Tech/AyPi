export interface RequestAccessSession {
    loggedIn: boolean;
    admin: boolean;
    employee: boolean;
    employeeName?: unknown;
    department?: unknown;
}

type RequestLineAction = "edit" | "delete";

function normalizeString(value: unknown) {
    if (value === null || value === undefined) return "";
    return String(value).trim();
}

export function isRequestOwner(
    request: any,
    session: RequestAccessSession,
) {
    if (!request || !session.employee) return false;
    const employee = normalizeString(session.employeeName);
    if (!employee) return false;
    if (normalizeString(request.employee) !== employee) return false;

    const requestDepartment = normalizeString(request.department);
    const sessionDepartment = normalizeString(session.department);
    if (
        requestDepartment &&
        sessionDepartment &&
        requestDepartment !== sessionDepartment
    ) {
        return false;
    }

    const createdBy = normalizeString(request.createdBy);
    return !createdBy || createdBy === "employee";
}

export function hasAdminTouchedRequest(request: any) {
    if (!request) return false;
    const history = Array.isArray(request.history) ? request.history : [];
    return history.some((entry) => entry && entry.by === "admin");
}

export function isRequestLineFinalized(line: any) {
    return Boolean(
        line && (line.confirmed || line.confirmedAt || line.deletedAt),
    );
}

export function canAccessRequestLine(
    request: any,
    line: any,
    session: RequestAccessSession,
) {
    // Gli admin mantengono il comportamento storico: l'eventuale riga eliminata
    // viene filtrata dai chiamanti prima di aprire o confermare i modali.
    if (session.admin) return true;
    if (!line || line.deletedAt) return false;
    if (!session.employee) return false;
    if (!isRequestOwner(request, session)) return false;
    if (hasAdminTouchedRequest(request)) return false;
    if (isRequestLineFinalized(line)) return false;
    return true;
}

export function getRequestLineDenyReason(
    action: RequestLineAction,
    request: any,
    line: any,
    session: RequestAccessSession,
) {
    if (!session.loggedIn) return "Effettua il login.";
    if (!request || !line) return "Elemento non disponibile.";
    if (line.deletedAt) return "Riga eliminata.";
    if ((line.confirmed || line.confirmedAt) && !session.admin) {
        return "Richiesta già convalidata.";
    }
    if (session.admin) return "";
    if (!session.employee) return "Accesso admin richiesto.";
    if (!isRequestOwner(request, session)) {
        return "Richiesta di un altro dipendente.";
    }
    if (hasAdminTouchedRequest(request)) {
        return "Richiesta già gestita da un admin.";
    }
    if (isRequestLineFinalized(line)) {
        return "Richiesta già convalidata o eliminata.";
    }
    return action === "edit"
        ? "Non puoi modificare questa richiesta."
        : "Non puoi eliminare questa richiesta.";
}
