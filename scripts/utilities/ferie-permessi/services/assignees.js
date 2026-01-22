const { ASSIGNEES_PATH } = require("../config/paths");
const { createAssigneesStore } = require("../../shared/assignees-store");
const { showDialog } = require("./dialogs");
const { ensureFolderFor } = require("./storage");
const { UI_TEXTS } = require("../utils/ui-texts");

const store = createAssigneesStore({
    assigneesPath: ASSIGNEES_PATH,
    showDialog,
    readErrorMessage: UI_TEXTS.assigneesReadFailure,
    writeErrorMessage: UI_TEXTS.assigneesWriteFailure,
    createIfMissing: false,
    ensureFolderFor,
});

const { loadAssigneeOptions, saveAssigneeOptions } = store;

module.exports = {
    loadAssigneeOptions,
    saveAssigneeOptions,
};
