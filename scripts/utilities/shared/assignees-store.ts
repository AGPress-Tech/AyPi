require("../../shared/dev-guards");
import fs from "fs";
import path from "path";

type EmployeeEntry = { name: string; email: string };
type AssigneesPayload = {
    groups: Record<string, string[]>;
    options: string[];
    emails: Record<string, string>;
};

type AssigneesStoreOptions = {
    assigneesPath?: string;
    assigneesLegacyPath?: string;
    assigneesReadPaths?: string[];
    assigneesWritePaths?: string[];
    showDialog?: (type: string, message: string, detail?: string) => void;
    readErrorMessage?: string;
    writeErrorMessage?: string;
    createIfMissing?: boolean;
    ensureFolderFor?: (targetPath: string) => void;
};

function ensureFolderForPath(targetPath: string) {
    const dir = path.dirname(targetPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function normalizeEmployeeEntry(entry: unknown): EmployeeEntry | null {
    if (typeof entry === "string") {
        const name = entry.trim();
        return name ? { name, email: "" } : null;
    }
    if (entry && typeof entry === "object") {
        const name =
            typeof (entry as { name?: string }).name === "string"
                ? (entry as { name: string }).name.trim()
                : "";
        if (!name) return null;
        const email =
            typeof (entry as { email?: string }).email === "string"
                ? (entry as { email: string }).email.trim()
                : "";
        return { name, email };
    }
    return null;
}

function buildEmployeeKey(department: string, name: string) {
    return `${String(department || "").trim()}|${String(name || "").trim()}`;
}

function normalizeAssigneesPayload(parsed: unknown): AssigneesPayload {
    if (Array.isArray(parsed)) {
        const names = parsed.map((name) => String(name));
        return { groups: { Altro: names }, options: names, emails: {} };
    }
    if (
        parsed &&
        typeof parsed === "object" &&
        Array.isArray((parsed as { data?: unknown }).data)
    ) {
        const names = (parsed as { data: unknown[] }).data.map((name) =>
            String(name),
        );
        return { groups: { Altro: names }, options: names, emails: {} };
    }
    if (parsed && typeof parsed === "object") {
        const rawGroups =
            (parsed as { groups?: unknown }).groups &&
            typeof (parsed as { groups?: unknown }).groups === "object"
                ? (parsed as { groups: Record<string, unknown> }).groups
                : (parsed as Record<string, unknown>);
        const rawEmails =
            (parsed as { emails?: unknown }).emails &&
            typeof (parsed as { emails?: unknown }).emails === "object"
                ? (parsed as { emails: Record<string, unknown> }).emails
                : {};
        const groups: Record<string, string[]> = {};
        const emails: Record<string, string> = {};
        Object.keys(rawGroups).forEach((key) => {
            const list = Array.isArray(rawGroups[key])
                ? (rawGroups[key] as unknown[])
                : [];
            const normalized: string[] = [];
            list.forEach((entry) => {
                const item = normalizeEmployeeEntry(entry);
                if (!item) return;
                normalized.push(item.name);
                if (item.email) {
                    emails[buildEmployeeKey(key, item.name)] = item.email;
                }
            });
            groups[key] = normalized;
        });
        Object.keys(rawEmails).forEach((key) => {
            const rawValue = (rawEmails as Record<string, unknown>)[key];
            const value = typeof rawValue === "string" ? rawValue.trim() : "";
            if (!value) return;
            if (!emails[key]) emails[key] = value;
        });
        const options = Object.values(groups).flat();
        return { groups, options, emails };
    }
    return { groups: {}, options: [], emails: {} };
}

function createAssigneesStore(options?: AssigneesStoreOptions) {
    const {
        assigneesPath,
        assigneesLegacyPath,
        assigneesReadPaths,
        assigneesWritePaths,
        showDialog,
        readErrorMessage,
        writeErrorMessage,
        createIfMissing = false,
        ensureFolderFor = ensureFolderForPath,
    } = options || {};

    if (!assigneesPath && !assigneesReadPaths && !assigneesWritePaths) {
        throw new Error("assigneesPath richiesto.");
    }

    const readPaths = (
        Array.isArray(assigneesReadPaths)
            ? assigneesReadPaths
            : [assigneesPath, assigneesLegacyPath]
    )
        .filter(
            (item): item is string =>
                typeof item === "string" && item.trim() !== "",
        )
        .map((item) => item.trim());
    const writePaths = (
        Array.isArray(assigneesWritePaths)
            ? assigneesWritePaths
            : [assigneesPath, assigneesLegacyPath]
    )
        .filter(
            (item): item is string =>
                typeof item === "string" && item.trim() !== "",
        )
        .map((item) => item.trim());

    const notify = (type: string, message: string, detail?: string) => {
        if (typeof showDialog === "function") {
            showDialog(type, message, detail);
        }
    };

    function loadAssigneeOptions() {
        try {
            const target = readPaths.find((item) => fs.existsSync(item));
            if (!target) {
                if (createIfMissing) {
                    const firstWrite = writePaths[0] || readPaths[0];
                    if (firstWrite) {
                        ensureFolderFor(firstWrite);
                        fs.writeFileSync(
                            firstWrite,
                            JSON.stringify({}, null, 2),
                            "utf8",
                        );
                    }
                }
                return { groups: {}, options: [], emails: {} };
            }
            const raw = fs.readFileSync(target, "utf8");
            const parsed = JSON.parse(raw);
            return normalizeAssigneesPayload(parsed);
        } catch (err) {
            console.error("Errore caricamento assignees:", err);
            const message = err instanceof Error ? err.message : String(err);
            notify(
                "warning",
                readErrorMessage ||
                    "Impossibile leggere la lista responsabili.",
                message,
            );
            return { groups: {}, options: [], emails: {} };
        }
    }

    function saveAssigneeOptions(
        payloadOrGroups: AssigneesPayload | Record<string, string[]>,
    ) {
        try {
            let groups: Record<string, string[]> = payloadOrGroups as Record<
                string,
                string[]
            >;
            let emails: Record<string, string> = {};
            if ((payloadOrGroups as AssigneesPayload).groups) {
                const payload = payloadOrGroups as AssigneesPayload;
                groups = payload.groups;
                emails =
                    payload.emails && typeof payload.emails === "object"
                        ? payload.emails
                        : {};
            }
            const safeGroups =
                groups && typeof groups === "object" ? groups : {};
            const safeEmails =
                emails && typeof emails === "object" ? emails : {};
            const payload = JSON.stringify(
                { groups: safeGroups, emails: safeEmails },
                null,
                2,
            );
            writePaths.forEach((targetPath) => {
                ensureFolderFor(targetPath);
                fs.writeFileSync(targetPath, payload, "utf8");
            });
        } catch (err) {
            console.error("Errore salvataggio assignees:", err);
            const message = err instanceof Error ? err.message : String(err);
            notify(
                "warning",
                writeErrorMessage ||
                    "Impossibile salvare la lista responsabili.",
                message,
            );
        }
    }

    return { loadAssigneeOptions, saveAssigneeOptions };
}

module.exports = {
    createAssigneesStore,
};

export {};


