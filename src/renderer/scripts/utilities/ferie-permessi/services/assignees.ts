require("../../../shared/dev-guards");
import { ASSIGNEES_PATH, LEGACY_ASSIGNEES_PATH } from "../config/paths";
import { createAssigneesStore } from "../../shared/assignees-store";
import { showDialog } from "./dialogs";
import { ensureFolderFor } from "./storage";
import { UI_TEXTS } from "../utils/ui-texts";

const store = createAssigneesStore({
    assigneesPath: ASSIGNEES_PATH,
    assigneesLegacyPath: LEGACY_ASSIGNEES_PATH,
    assigneesReadPaths: [ASSIGNEES_PATH, LEGACY_ASSIGNEES_PATH],
    assigneesWritePaths: [ASSIGNEES_PATH, LEGACY_ASSIGNEES_PATH],
    showDialog,
    readErrorMessage: UI_TEXTS.assigneesReadFailure,
    writeErrorMessage: UI_TEXTS.assigneesWriteFailure,
    createIfMissing: false,
    ensureFolderFor,
});

const { loadAssigneeOptions, saveAssigneeOptions } = store;

export { loadAssigneeOptions, saveAssigneeOptions };

// Keep CommonJS compatibility for legacy JS callers
if (typeof module !== "undefined" && module.exports && !(globalThis as any).__aypiBundled) {
    if (typeof module !== "undefined" && module.exports && !(globalThis as any).__aypiBundled) module.exports = { loadAssigneeOptions, saveAssigneeOptions };
}


