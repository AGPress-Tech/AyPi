import http from "http";
import https from "https";

type CalendarApiDependencies = {
    baseUrl: string;
    getUser: () => string;
    getCachedData: () => any;
    setCachedData: (data: any) => void;
    render: (data: any) => void;
    debug: (action: string, payload?: any) => void;
    showDialog: (type: string, title: string, detail: string) => void;
};

type RequestOptions = {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
};

export function resolveCalendarBackendBaseUrl(ipcRenderer: any) {
    if (process.env.AYPI_FP_BACKEND_URL) {
        return process.env.AYPI_FP_BACKEND_URL;
    }
    if (ipcRenderer && typeof ipcRenderer.sendSync === "function") {
        try {
            const value = ipcRenderer.sendSync("fp-get-backend-base-url");
            if (typeof value === "string" && value.trim()) {
                return value.trim();
            }
        } catch {
            // Use the network default below.
        }
    }
    return "http://192.168.1.240:3000/api/ferie-permessi";
}

export function createCalendarApi(dependencies: CalendarApiDependencies) {
    let saveSequence = 0;
    let unavailableNotified = false;

    function request(endpoint = "", options: RequestOptions = {}) {
        const url = `${dependencies.baseUrl}${endpoint}`;
        const headers = {
            "x-aypi-user": dependencies.getUser() || "guest",
            "x-aypi-client": "AyPi-Electron",
            ...(options.headers || {}),
        };
        dependencies.debug("backend.request", {
            url,
            method: options.method || "GET",
            user: headers["x-aypi-user"],
        });

        return new Promise<any>((resolve, reject) => {
            try {
                const target = new URL(url);
                const client =
                    target.protocol === "https:" ? https : http;
                const backendRequest = client.request(
                    {
                        protocol: target.protocol,
                        hostname: target.hostname,
                        port: target.port,
                        path: `${target.pathname}${target.search}`,
                        method: options.method || "GET",
                        headers,
                    },
                    (response) => {
                        let raw = "";
                        response.setEncoding("utf8");
                        response.on("data", (chunk) => {
                            raw += chunk;
                        });
                        response.on("end", () => {
                            const statusCode = response.statusCode || 500;
                            if (statusCode < 200 || statusCode >= 300) {
                                reject(
                                    new Error(`HTTP ${statusCode}: ${raw}`),
                                );
                                return;
                            }
                            try {
                                resolve(raw ? JSON.parse(raw) : null);
                            } catch (err) {
                                reject(err);
                            }
                        });
                    },
                );
                backendRequest.on("error", reject);
                if (options.body) backendRequest.write(options.body);
                backendRequest.end();
            } catch (err) {
                reject(err);
            }
        });
    }

    function unavailableMessage(err: unknown) {
        const detail = err instanceof Error ? err.message : String(err || "");
        return `Backend ferie-permessi non raggiungibile su ${dependencies.baseUrl}.\nAvvia prima 'npm run start:backend'.\n\nDettaglio: ${detail}`;
    }

    async function loadData() {
        try {
            const payload = await request("/payload");
            const data = payload || { requests: [] };
            dependencies.setCachedData(data);
            unavailableNotified = false;
            dependencies.debug("backend.response.load", {
                requests: Array.isArray(data?.requests)
                    ? data.requests.length
                    : 0,
            });
            return data;
        } catch (err) {
            dependencies.debug("backend.error.load", {
                detail: err instanceof Error ? err.message : String(err),
            });
            if (!unavailableNotified) {
                unavailableNotified = true;
                dependencies.showDialog(
                    "warning",
                    "Backend ferie/permessi non disponibile.",
                    unavailableMessage(err),
                );
            }
            return dependencies.getCachedData();
        }
    }

    async function saveData(payload: any) {
        const sequence = ++saveSequence;
        const saved = await request("/payload", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload || {}),
        });
        if (sequence === saveSequence && saved) {
            dependencies.setCachedData(saved);
        }
        dependencies.debug("backend.response.save", {
            sequence,
            requests: Array.isArray(saved?.requests)
                ? saved.requests.length
                : 0,
        });
        return saved;
    }

    async function refresh() {
        const data = await loadData();
        dependencies.render(data);
        return data;
    }

    async function createRequest(calendarRequest: any) {
        const created = await request("/requests", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(calendarRequest || {}),
        });
        dependencies.debug("backend.response.create", {
            id: created?.id || "",
            status: created?.status || "",
        });
        return refresh();
    }

    async function updateRequest(requestId: string, calendarRequest: any) {
        dependencies.debug("backend.request.update", {
            requestId: requestId || "",
            keys:
                calendarRequest && typeof calendarRequest === "object"
                    ? Object.keys(calendarRequest)
                    : [],
            request: calendarRequest,
        });
        const updated = await request(`/requests/${requestId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(calendarRequest || {}),
        });
        dependencies.debug("backend.response.update", {
            id: updated?.id || requestId || "",
            status: updated?.status || "",
        });
        return refresh();
    }

    async function approveRequest(requestId: string, actor?: string) {
        const updated = await request(`/requests/${requestId}/approve`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                actor: actor || dependencies.getUser() || "guest",
            }),
        });
        dependencies.debug("backend.response.approve", {
            id: updated?.request?.id || requestId || "",
            status: updated?.request?.status || "",
        });
        return refresh();
    }

    async function rejectRequest(requestId: string, actor?: string) {
        const updated = await request(`/requests/${requestId}/reject`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                actor: actor || dependencies.getUser() || "guest",
            }),
        });
        dependencies.debug("backend.response.reject", {
            id: updated?.id || requestId || "",
            status: updated?.status || "",
        });
        return refresh();
    }

    async function deleteRequest(requestId: string, actor?: string) {
        try {
            const updated = await request(`/requests/${requestId}`, {
                method: "DELETE",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    actor: actor || dependencies.getUser() || "guest",
                }),
            });
            dependencies.debug("backend.response.delete", {
                id: updated?.id || requestId || "",
                status: updated?.status || "",
            });
            return refresh();
        } catch (err) {
            dependencies.debug("backend.error.delete", {
                requestId: requestId || "",
                detail: err instanceof Error ? err.message : String(err),
            });
            const data = await refresh();
            const target = (data?.requests || []).find(
                (entry: any) => entry?.id === requestId,
            );
            if (!target || target.status === "deleted") {
                dependencies.debug("backend.delete.reconciled", {
                    requestId: requestId || "",
                    status: target?.status || "missing",
                });
                return data;
            }
            throw err;
        }
    }

    async function createHolidays(dates: string[], name: string) {
        const result = await request("/holidays", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ dates: dates || [], name: name || "" }),
        });
        dependencies.debug("backend.response.holidays.create", {
            added: result?.added || 0,
            dates: Array.isArray(dates) ? dates.length : 0,
        });
        return refresh();
    }

    async function deleteHoliday(date: string) {
        const result = await request(`/holidays/${date}`, {
            method: "DELETE",
        });
        dependencies.debug("backend.response.holidays.delete", {
            date,
            removed: !!result?.removed,
        });
        return refresh();
    }

    async function updateHoliday(
        date: string,
        nextDate: string,
        nextName: string,
    ) {
        const result = await request(`/holidays/${date}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ nextDate, nextName }),
        });
        dependencies.debug("backend.response.holidays.update", {
            date,
            nextDate,
            hasConflict: !!result?.hasConflict,
            updated: !!result?.updated,
        });
        const data = await refresh();
        data.holidaysUpdated = !result?.hasConflict && !!result?.updated;
        return data;
    }

    async function createClosure(entry: any) {
        const result = await request("/closures", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(entry || {}),
        });
        dependencies.debug("backend.response.closure.create", {
            added: !!result?.added,
            start: entry?.start || "",
            end: entry?.end || "",
        });
        const data = await refresh();
        data.closureAdded = !!result?.added;
        return data;
    }

    async function deleteClosure(entry: any) {
        const result = await request("/closures", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(entry || {}),
        });
        dependencies.debug("backend.response.closure.delete", {
            removed: !!result?.removed,
            start: entry?.start || "",
            end: entry?.end || "",
        });
        return refresh();
    }

    async function updateClosure(entry: any, next: any) {
        const result = await request("/closures", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ entry, next }),
        });
        dependencies.debug("backend.response.closure.update", {
            current: `${entry?.start || ""}|${entry?.end || ""}`,
            next: `${next?.start || ""}|${next?.end || ""}`,
            hasConflict: !!result?.hasConflict,
            updated: !!result?.updated,
        });
        const data = await refresh();
        data.closureUpdated = !result?.hasConflict && !!result?.updated;
        return data;
    }

    return {
        approveRequest,
        createClosure,
        createHolidays,
        createRequest,
        deleteClosure,
        deleteHoliday,
        deleteRequest,
        loadData,
        rejectRequest,
        request,
        saveData,
        unavailableMessage,
        updateClosure,
        updateHoliday,
        updateRequest,
    };
}
