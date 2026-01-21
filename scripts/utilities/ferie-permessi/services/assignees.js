const { ASSIGNEES_PATH } = require("../config/paths");
const { createAssigneesStore } = require("../../shared/assignees-store");
const { showDialog } = require("./dialogs");
const { ensureFolderFor } = require("./storage");

const store = createAssigneesStore({
    assigneesPath: ASSIGNEES_PATH,
    showDialog,
    readErrorMessage: "Impossibile leggere la lista dipendenti.",
    writeErrorMessage: "Impossibile salvare la lista dipendenti.",
    createIfMissing: false,
    ensureFolderFor,
});

const { loadAssigneeOptions, saveAssigneeOptions } = store;

module.exports = {
    loadAssigneeOptions,
    saveAssigneeOptions,
};
