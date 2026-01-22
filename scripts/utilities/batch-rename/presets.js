const { ipcRenderer } = require("electron");

function buildPresetFromUI(name) {
    const scopeInput = document.querySelector('input[name="renameScope"]:checked');
    const scope = scopeInput ? scopeInput.value : "files";
    const includeSubfolders = document.getElementById("chkIncludeSubfolders")?.checked || false;
    const extFilter = document.getElementById("extFilter")?.value || "";
    const sortOrder = document.getElementById("sortOrder")?.value || "nameAsc";

    const preset = {
        name: name || "",
        options: {
            scope,
            includeSubfolders,
            extFilter,
            sortOrder,
        },
        filters: {
            mask: document.getElementById("filterMask")?.value || "",
            nameLenMin: document.getElementById("nameLenMin")?.value || "",
            nameLenMax: document.getElementById("nameLenMax")?.value || "",
            pathLenMin: document.getElementById("pathLenMin")?.value || "",
            pathLenMax: document.getElementById("pathLenMax")?.value || "",
            filterRegex: document.getElementById("filterRegex")?.value || "",
            filterRegexFlags: document.getElementById("filterRegexFlags")?.value || "",
            filterJsCondition: document.getElementById("filterJsCondition")?.value || "",
        },
        transforms: {
            addRemove: {
                enabled: document.getElementById("chkAddRemoveEnabled")?.checked || false,
                prefix: document.getElementById("prefixInput")?.value || "",
                suffix: document.getElementById("suffixInput")?.value || "",
                insertText: document.getElementById("insertText")?.value || "",
                insertPosition: document.getElementById("insertPosition")?.value || "",
                insertFrom: document.getElementById("insertFrom")?.value || "start",
                rmDigits: document.getElementById("rmDigits")?.checked || false,
                rmSymbols: document.getElementById("rmSymbols")?.checked || false,
                rmExtraSpaces: document.getElementById("rmExtraSpaces")?.checked || false,
                rmAll: document.getElementById("rmAll")?.checked || false,
            },
            replace: {
                enabled: document.getElementById("chkReplaceEnabled")?.checked || false,
                findText: document.getElementById("findText")?.value || "",
                replaceText: document.getElementById("replaceText")?.value || "",
                replaceAll: document.getElementById("chkReplaceAll")?.checked || false,
                caseSensitive: document.getElementById("chkReplaceCaseSensitive")?.checked || false,
                useRegex: document.getElementById("chkReplaceRegex")?.checked || false,
            },
            case: {
                enabled: document.getElementById("chkCaseEnabled")?.checked || false,
                mode: document.getElementById("caseMode")?.value || "keep",
            },
            numbering: {
                enabled: document.getElementById("chkNumberingEnabled")?.checked || false,
                start: document.getElementById("numberStart")?.value || "",
                step: document.getElementById("numberStep")?.value || "",
                padding: document.getElementById("numberPadding")?.value || "",
                position: document.getElementById("numberPosition")?.value || "prefix",
                separator: document.getElementById("numberSeparator")?.value || "",
                resetPerFolder: document.getElementById("numberResetPerFolder")?.checked || false,
                resetPerExtension: document.getElementById("numberResetPerExtension")?.checked || false,
            },
            date: {
                enabled: document.getElementById("chkDateEnabled")?.checked || false,
                type: document.getElementById("dateType")?.value || "mtime",
                preset: document.getElementById("dateFormatPreset")?.value || "YYYYMMDD",
                customFormat: document.getElementById("dateFormatCustom")?.value || "",
                position: document.getElementById("datePosition")?.value || "prefix",
                separator: document.getElementById("dateSeparator")?.value || "_",
            },
            removeAdvanced: {
                enabled: document.getElementById("chkRemoveAdvancedEnabled")?.checked || false,
                firstN: document.getElementById("removeFirstN")?.value || "",
                lastN: document.getElementById("removeLastN")?.value || "",
                rangeFrom: document.getElementById("removeRangeFrom")?.value || "",
                rangeTo: document.getElementById("removeRangeTo")?.value || "",
                cropMode: document.getElementById("removeCropMode")?.value || "none",
                cropText: document.getElementById("removeCropText")?.value || "",
                trimSpaces: document.getElementById("removeTrimSpaces")?.checked || false,
                leadingDots: document.getElementById("removeLeadingDots")?.checked || false,
            },
            parts: {
                enabled: document.getElementById("chkPartsEnabled")?.checked || false,
                delimiterMode: document.getElementById("partsDelimiter")?.value || "auto",
                delimiterCustom: document.getElementById("partsDelimiterCustom")?.value || "",
                moveFrom: document.getElementById("partsMoveFrom")?.value || "",
                moveTo: document.getElementById("partsMoveTo")?.value || "",
                appendFolderPosition: document.getElementById("appendFolderPosition")?.value || "none",
                appendFolderSeparator: document.getElementById("appendFolderSeparator")?.value || "_",
                appendFolderLevels: document.getElementById("appendFolderLevels")?.value || "1",
                extensionMode: document.getElementById("extensionMode")?.value || "keep",
                extensionReplace: document.getElementById("extensionReplace")?.value || "",
            },
            copyMove: {
                enabled: document.getElementById("chkCopyMoveEnabled")?.checked || false,
                destPath: document.getElementById("copyMovePath")?.value || "",
                copyNotMove: document.getElementById("copyMoveCopyNotMove")?.checked || false,
                keepFolders: document.getElementById("copyMoveKeepFolders")?.checked || false,
            },
            special: {
                enabled: document.getElementById("chkSpecialEnabled")?.checked || false,
                setMtimeNow: document.getElementById("specialSetMtimeNow")?.checked || false,
                setAtimeNow: document.getElementById("specialSetAtimeNow")?.checked || false,
                attrReadOnly: document.getElementById("specialAttrReadOnly")?.checked || false,
                attrHidden: document.getElementById("specialAttrHidden")?.checked || false,
            },
        },
    };

    return preset;
}

function applyPresetToUI(preset) {
    if (!preset || !preset.transforms) return;

    const opts = preset.options || {};
    const filters = preset.filters || {};
    const t = preset.transforms;

    if (opts.scope) {
        const scopeRadio = document.querySelector(`input[name="renameScope"][value="${opts.scope}"]`);
        if (scopeRadio) scopeRadio.checked = true;
    }
    const chkSub = document.getElementById("chkIncludeSubfolders");
    if (chkSub) chkSub.checked = !!opts.includeSubfolders;
    const extFilter = document.getElementById("extFilter");
    if (extFilter) extFilter.value = opts.extFilter || "";
    const sortOrder = document.getElementById("sortOrder");
    if (sortOrder && opts.sortOrder) sortOrder.value = opts.sortOrder;

    if (filters) {
        const idMap = {
            filterMask: filters.mask,
            nameLenMin: filters.nameLenMin,
            nameLenMax: filters.nameLenMax,
            pathLenMin: filters.pathLenMin,
            pathLenMax: filters.pathLenMax,
            filterRegex: filters.filterRegex,
            filterRegexFlags: filters.filterRegexFlags,
            filterJsCondition: filters.filterJsCondition,
        };
        Object.keys(idMap).forEach((id) => {
            const el = document.getElementById(id);
            if (el != null && typeof idMap[id] === "string") {
                el.value = idMap[id];
            }
        });
    }

    function applyBlock(block, map) {
        if (!block) return;
        Object.keys(map).forEach((id) => {
            const el = document.getElementById(id);
            if (!el) return;
            const key = map[id];
            const value = block[key];
            if (el.type === "checkbox") {
                el.checked = !!value;
            } else if (value != null) {
                el.value = value;
            }
        });
    }

    applyBlock(t.addRemove, {
        chkAddRemoveEnabled: "enabled",
        prefixInput: "prefix",
        suffixInput: "suffix",
        insertText: "insertText",
        insertPosition: "insertPosition",
        insertFrom: "insertFrom",
        rmDigits: "rmDigits",
        rmSymbols: "rmSymbols",
        rmExtraSpaces: "rmExtraSpaces",
        rmAll: "rmAll",
    });

    applyBlock(t.replace, {
        chkReplaceEnabled: "enabled",
        findText: "findText",
        replaceText: "replaceText",
        chkReplaceAll: "replaceAll",
        chkReplaceCaseSensitive: "caseSensitive",
        chkReplaceRegex: "useRegex",
    });

    applyBlock(t.case, {
        chkCaseEnabled: "enabled",
        caseMode: "mode",
    });

    applyBlock(t.numbering, {
        chkNumberingEnabled: "enabled",
        numberStart: "start",
        numberStep: "step",
        numberPadding: "padding",
        numberPosition: "position",
        numberSeparator: "separator",
        numberResetPerFolder: "resetPerFolder",
        numberResetPerExtension: "resetPerExtension",
    });

    applyBlock(t.date, {
        chkDateEnabled: "enabled",
        dateType: "type",
        dateFormatPreset: "preset",
        dateFormatCustom: "customFormat",
        datePosition: "position",
        dateSeparator: "separator",
    });

    applyBlock(t.removeAdvanced, {
        chkRemoveAdvancedEnabled: "enabled",
        removeFirstN: "firstN",
        removeLastN: "lastN",
        removeRangeFrom: "rangeFrom",
        removeRangeTo: "rangeTo",
        removeCropMode: "cropMode",
        removeCropText: "cropText",
        removeTrimSpaces: "trimSpaces",
        removeLeadingDots: "leadingDots",
    });

    applyBlock(t.parts, {
        chkPartsEnabled: "enabled",
        partsDelimiter: "delimiterMode",
        partsDelimiterCustom: "delimiterCustom",
        partsMoveFrom: "moveFrom",
        partsMoveTo: "moveTo",
        appendFolderPosition: "appendFolderPosition",
        appendFolderSeparator: "appendFolderSeparator",
        appendFolderLevels: "appendFolderLevels",
        extensionMode: "extensionMode",
        extensionReplace: "extensionReplace",
    });

    applyBlock(t.copyMove, {
        chkCopyMoveEnabled: "enabled",
        copyMovePath: "destPath",
        copyMoveCopyNotMove: "copyNotMove",
        copyMoveKeepFolders: "keepFolders",
    });

    applyBlock(t.special, {
        chkSpecialEnabled: "enabled",
        specialSetMtimeNow: "setMtimeNow",
        specialSetAtimeNow: "setAtimeNow",
        specialAttrReadOnly: "attrReadOnly",
        specialAttrHidden: "attrHidden",
    });
}

async function loadPresetsIntoUI(selectedName) {
    const presetSelect = document.getElementById("presetSelect");
    const btnDelete = document.getElementById("btnPresetDelete");
    if (!presetSelect) return;

    let presets = [];
    try {
        presets = await ipcRenderer.invoke("batch-rename-load-presets");
    } catch (err) {
        console.error("Errore caricando i preset:", err);
    }

    presetSelect.innerHTML = "";
    const optNone = document.createElement("option");
    optNone.value = "";
    optNone.textContent = "(Nessun preset selezionato)";
    presetSelect.appendChild(optNone);

    let hasSelection = false;

    (presets || []).forEach((p) => {
        if (!p || !p.name) return;
        const opt = document.createElement("option");
        opt.value = p.name;
        opt.textContent = p.name;
        if (selectedName && selectedName === p.name) {
            opt.selected = true;
            hasSelection = true;
        }
        presetSelect.appendChild(opt);
    });

    if (!hasSelection) {
        presetSelect.value = "";
    }

    if (btnDelete) {
        btnDelete.disabled = !presetSelect.value;
    }
}

module.exports = {
    buildPresetFromUI,
    applyPresetToUI,
    loadPresetsIntoUI,
};
