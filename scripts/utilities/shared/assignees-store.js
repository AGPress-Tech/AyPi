const fs = require("fs");
const path = require("path");

function ensureFolderForPath(targetPath) {
    const dir = path.dirname(targetPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function normalizeEmployeeEntry(entry) {
    if (typeof entry === "string") {
        const name = entry.trim();
        return name ? { name, email: "" } : null;
    }
    if (entry && typeof entry === "object") {
        const name = typeof entry.name === "string" ? entry.name.trim() : "";
        if (!name) return null;
        const email = typeof entry.email === "string" ? entry.email.trim() : "";
        return { name, email };
    }
    return null;
}

function buildEmployeeKey(department, name) {
    return `${String(department || "").trim()}|${String(name || "").trim()}`;
}

function normalizeAssigneesPayload(parsed) {
    if (Array.isArray(parsed)) {
        const names = parsed.map((name) => String(name));
        return { groups: { Altro: names }, options: names, emails: {} };
    }
    if (Array.isArray(parsed?.data)) {
        const names = parsed.data.map((name) => String(name));
        return { groups: { Altro: names }, options: names, emails: {} };
    }
    if (parsed && typeof parsed === "object") {
        const rawGroups = parsed.groups && typeof parsed.groups === "object" ? parsed.groups : parsed;
        const rawEmails = parsed.emails && typeof parsed.emails === "object" ? parsed.emails : {};
        const groups = {};
        const emails = {};
        Object.keys(rawGroups).forEach((key) => {
            const list = Array.isArray(rawGroups[key]) ? rawGroups[key] : [];
            const normalized = [];
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
            const value = typeof rawEmails[key] === "string" ? rawEmails[key].trim() : "";
            if (!value) return;
            if (!emails[key]) emails[key] = value;
        });
        const options = Object.values(groups).flat();
        return { groups, options, emails };
    }
    return { groups: {}, options: [], emails: {} };
}

function createAssigneesStore(options) {
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

    const readPaths = (Array.isArray(assigneesReadPaths) ? assigneesReadPaths : [assigneesPath, assigneesLegacyPath])
        .filter((item) => typeof item === "string" && item.trim())
        .map((item) => item.trim());
    const writePaths = (Array.isArray(assigneesWritePaths) ? assigneesWritePaths : [assigneesPath, assigneesLegacyPath])
        .filter((item) => typeof item === "string" && item.trim())
        .map((item) => item.trim());

    const notify = (type, message, detail) => {
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
                        fs.writeFileSync(firstWrite, JSON.stringify({}, null, 2), "utf8");
                    }
                }
                return { groups: {}, options: [], emails: {} };
            }
            const raw = fs.readFileSync(target, "utf8");
            const parsed = JSON.parse(raw);
            return normalizeAssigneesPayload(parsed);
        } catch (err) {
            console.error("Errore caricamento assignees:", err);
            notify(
                "warning",
                readErrorMessage || "Impossibile leggere la lista responsabili.",
                err.message || String(err)
            );
            return { groups: {}, options: [], emails: {} };
        }
    }

    function saveAssigneeOptions(payloadOrGroups) {
        try {
            let groups = payloadOrGroups;
            let emails = {};
            if (payloadOrGroups && typeof payloadOrGroups === "object" && payloadOrGroups.groups) {
                groups = payloadOrGroups.groups;
                emails = payloadOrGroups.emails && typeof payloadOrGroups.emails === "object"
                    ? payloadOrGroups.emails
                    : {};
            }
            const safeGroups = groups && typeof groups === "object" ? groups : {};
            const safeEmails = emails && typeof emails === "object" ? emails : {};
            const payload = JSON.stringify({ groups: safeGroups, emails: safeEmails }, null, 2);
            writePaths.forEach((targetPath) => {
                ensureFolderFor(targetPath);
                fs.writeFileSync(targetPath, payload, "utf8");
            });
        } catch (err) {
            console.error("Errore salvataggio assignees:", err);
            notify(
                "warning",
                writeErrorMessage || "Impossibile salvare la lista responsabili.",
                err.message || String(err)
            );
        }
    }

    return { loadAssigneeOptions, saveAssigneeOptions };
}

module.exports = {
    createAssigneesStore,
};
