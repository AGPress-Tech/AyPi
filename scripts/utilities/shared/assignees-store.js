const fs = require("fs");
const path = require("path");

function ensureFolderForPath(targetPath) {
    const dir = path.dirname(targetPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function normalizeAssigneesPayload(parsed) {
    if (Array.isArray(parsed)) {
        return { groups: { Altro: parsed.map((name) => String(name)) }, options: parsed.map((name) => String(name)) };
    }
    if (Array.isArray(parsed?.data)) {
        return { groups: { Altro: parsed.data.map((name) => String(name)) }, options: parsed.data.map((name) => String(name)) };
    }
    if (parsed && typeof parsed === "object") {
        const rawGroups = parsed.groups && typeof parsed.groups === "object" ? parsed.groups : parsed;
        const groups = {};
        Object.keys(rawGroups).forEach((key) => {
            const list = Array.isArray(rawGroups[key]) ? rawGroups[key] : [];
            groups[key] = list.map((name) => String(name));
        });
        const options = Object.values(groups).flat();
        return { groups, options };
    }
    return { groups: {}, options: [] };
}

function createAssigneesStore(options) {
    const {
        assigneesPath,
        showDialog,
        readErrorMessage,
        writeErrorMessage,
        createIfMissing = false,
        ensureFolderFor = ensureFolderForPath,
    } = options || {};

    if (!assigneesPath) {
        throw new Error("assigneesPath richiesto.");
    }

    const notify = (type, message, detail) => {
        if (typeof showDialog === "function") {
            showDialog(type, message, detail);
        }
    };

    function loadAssigneeOptions() {
        try {
            if (!fs.existsSync(assigneesPath)) {
                if (createIfMissing) {
                    ensureFolderFor(assigneesPath);
                    fs.writeFileSync(assigneesPath, JSON.stringify({}, null, 2), "utf8");
                }
                return { groups: {}, options: [] };
            }
            const raw = fs.readFileSync(assigneesPath, "utf8");
            const parsed = JSON.parse(raw);
            return normalizeAssigneesPayload(parsed);
        } catch (err) {
            console.error("Errore caricamento assignees:", err);
            notify(
                "warning",
                readErrorMessage || "Impossibile leggere la lista responsabili.",
                err.message || String(err)
            );
            return { groups: {}, options: [] };
        }
    }

    function saveAssigneeOptions(groups) {
        try {
            ensureFolderFor(assigneesPath);
            fs.writeFileSync(assigneesPath, JSON.stringify(groups, null, 2), "utf8");
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
