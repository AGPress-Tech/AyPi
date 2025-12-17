const { ipcRenderer } = require("electron");
const fs = require("fs");
const path = require("path");

let rootFolder = null;
let previewData = [];
let selectedIndex = null;
let lastRenameOperations = null;

function setStatus(text) {
    const el = document.getElementById("statusLine");
    if (el) {
        el.textContent = text || "";
    }
}

function updateSelectedFolderLabel() {
    const lblFolder = document.getElementById("selectedFolder");
    if (lblFolder) {
        const value = rootFolder || "Nessuna";
        lblFolder.textContent = value;
        lblFolder.title = rootFolder || "";
    }
}

function showDialog(type, message, detail = "") {
    return ipcRenderer.invoke("show-message-box", { type, message, detail });
}

function showInfo(message, detail = "") {
    return showDialog("info", message, detail);
}

function showWarning(message, detail = "") {
    return showDialog("warning", message, detail);
}

function showError(message, detail = "") {
    return showDialog("error", message, detail);
}

function splitNameExt(filename) {
    const ext = path.extname(filename);
    const name = filename.slice(0, ext.length > 0 ? -ext.length : undefined);
    return { name, ext };
}

function parseExtensions(extString) {
    if (!extString) return [];
    return extString
        .split(/[;,]/)
        .map(s => s.trim())
        .filter(Boolean)
        .map(s => (s.startsWith(".") ? s.toLowerCase() : "." + s.toLowerCase()));
}

function parseInteger(value, fallback = null) {
    if (value === undefined || value === null || value === "") return fallback;
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return n;
}

function buildWildcardRegexes(maskString) {
    if (!maskString) return [];
    return maskString
        .split(/[;,]/)
        .map(s => s.trim())
        .filter(Boolean)
        .map(pattern => {
            const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
            const regexString = "^" + escaped.replace(/\*/g, ".*").replace(/\?/g, ".") + "$";
            return new RegExp(regexString, "i");
        });
}

function getFilterConfigFromUI() {
    const nameLenMin = parseInteger(document.getElementById("nameLenMin")?.value);
    const nameLenMax = parseInteger(document.getElementById("nameLenMax")?.value);
    const pathLenMin = parseInteger(document.getElementById("pathLenMin")?.value);
    const pathLenMax = parseInteger(document.getElementById("pathLenMax")?.value);

    const maskStr = document.getElementById("filterMask")?.value || "";
    const wildcardRegexes = buildWildcardRegexes(maskStr);

    const filterRegexText = document.getElementById("filterRegex")?.value || "";
    const filterRegexFlags = document.getElementById("filterRegexFlags")?.value || "";
    let filterRegex = null;
    if (filterRegexText) {
        try {
            filterRegex = new RegExp(filterRegexText, filterRegexFlags);
        } catch (err) {
            console.error("Regex filtro non valida:", err);
            showWarning("Regex filtro non valida.", err.message || String(err));
            filterRegex = null;
        }
    }

    const jsConditionText = document.getElementById("filterJsCondition")?.value || "";
    let jsConditionFn = null;
    if (jsConditionText.trim()) {
        try {
            jsConditionFn = new Function("item", `"use strict"; return (${jsConditionText});`);
        } catch (err) {
            console.error("Condizione JS filtro non valida:", err);
            showWarning("Condizione JS non valida.", err.message || String(err));
            jsConditionFn = null;
        }
    }

    return {
        nameLenMin,
        nameLenMax,
        pathLenMin,
        pathLenMax,
        wildcardRegexes,
        filterRegex,
        jsConditionFn,
    };
}

function applyFiltersToItem(item, filterConfig) {
    const name = item.name;
    const fullPath = item.fullPath;

    if (filterConfig.nameLenMin != null && name.length < filterConfig.nameLenMin) {
        return false;
    }
    if (filterConfig.nameLenMax != null && name.length > filterConfig.nameLenMax) {
        return false;
    }

    if (filterConfig.pathLenMin != null && fullPath.length < filterConfig.pathLenMin) {
        return false;
    }
    if (filterConfig.pathLenMax != null && fullPath.length > filterConfig.pathLenMax) {
        return false;
    }

    if (filterConfig.wildcardRegexes && filterConfig.wildcardRegexes.length > 0) {
        const matched = filterConfig.wildcardRegexes.some(r => r.test(name));
        if (!matched) return false;
    }

    if (filterConfig.filterRegex && !filterConfig.filterRegex.test(name)) {
        return false;
    }

    if (filterConfig.jsConditionFn) {
        try {
            const ok = !!filterConfig.jsConditionFn(item);
            if (!ok) return false;
        } catch (err) {
            console.error("Errore valutando condizione JS filtro:", err);
            return false;
        }
    }

    return true;
}

function collectTargets(rootPath, options) {
    const results = [];
    const {
        includeSubfolders,
        extFilterList,
        scope,
        filterConfig,
    } = options;

    function walk(currentPath) {
        let entries;
        try {
            entries = fs.readdirSync(currentPath, { withFileTypes: true });
        } catch (err) {
            console.error("Impossibile leggere la cartella:", currentPath, err);
            return;
        }

        for (const entry of entries) {
            const fullPath = path.join(currentPath, entry.name);
            const isDir = entry.isDirectory();
            const isFile = entry.isFile();

            if (isDir && includeSubfolders) {
                walk(fullPath);
            }

            const ext = path.extname(entry.name).toLowerCase();
            const dir = path.dirname(fullPath);

            const inScope =
                (scope === "files" && isFile) ||
                (scope === "folders" && isDir) ||
                (scope === "both" && (isFile || isDir));

            if (!inScope) continue;

            if (isFile && extFilterList && extFilterList.length > 0) {
                if (!extFilterList.includes(ext)) continue;
            }

            let stats = null;
            try {
                stats = fs.statSync(fullPath);
            } catch (err) {
                console.error("Impossibile leggere gli attributi di:", fullPath, err);
                continue;
            }

            const item = {
                fullPath,
                dir,
                name: entry.name,
                ext,
                isDirectory: isDir,
                isFile,
                stats,
            };

            if (!applyFiltersToItem(item, filterConfig)) {
                continue;
            }

            results.push(item);
        }
    }

    walk(rootPath);
    return results;
}

function buildFolderTreeData(rootPath) {
    const rootNameRaw = rootPath.replace(/[\\/]+$/, "");
    const rootName = path.basename(rootNameRaw) || rootPath;

    function walkDir(currentPath) {
        let entries;
        try {
            entries = fs.readdirSync(currentPath, { withFileTypes: true });
        } catch (err) {
            console.error("Impossibile leggere la cartella per l'albero:", currentPath, err);
            return [];
        }

        const dirs = entries.filter(e => e.isDirectory());
        dirs.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));

        return dirs.map(dirEntry => {
            const full = path.join(currentPath, dirEntry.name);
            return {
                id: full,
                text: dirEntry.name,
                children: walkDir(full),
            };
        });
    }

    return [
        {
            id: rootPath,
            text: rootName,
            state: { opened: true, selected: true },
            children: walkDir(rootPath),
        },
    ];
}

function refreshFolderTree() {
    const treeElement = document.getElementById("folderTree");
    if (!treeElement || typeof window === "undefined") return;

    const $ = window.jQuery || window.$;
    if (!$ || !$.fn || !$.fn.jstree) {
        return;
    }

    const $tree = $(treeElement);

    if (!rootFolder) {
        try {
            $tree.jstree("destroy").empty();
        } catch (err) {
            // ignore
        }
        return;
    }

    const data = buildFolderTreeData(rootFolder);

    try {
        $tree.jstree("destroy").empty();
    } catch (err) {
        // ignore
    }

    $tree.jstree({
        core: {
            data,
            themes: {
                stripes: true,
            },
        },
    });

    $tree.off("changed.jstree").on("changed.jstree", (e, dataEvent) => {
        const selected = dataEvent.selected && dataEvent.selected[0];
        if (!selected) return;
        rootFolder = selected;
        updateSelectedFolderLabel();
    });
}

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
                resetPerFolder: document.getElementById("numberResetPerFolder")?.checked || false,
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
        Object.keys(idMap).forEach(id => {
            const el = document.getElementById(id);
            if (el != null && typeof idMap[id] === "string") {
                el.value = idMap[id];
            }
        });
    }

    function applyBlock(block, map) {
        if (!block) return;
        Object.keys(map).forEach(id => {
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
        numberResetPerFolder: "resetPerFolder",
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

    (presets || []).forEach(p => {
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

function getTransformsConfigFromUI() {
    const addRemoveEnabled = document.getElementById("chkAddRemoveEnabled")?.checked ?? false;
    const replaceEnabled = document.getElementById("chkReplaceEnabled")?.checked ?? false;
    const caseEnabled = document.getElementById("chkCaseEnabled")?.checked ?? false;
    const numberingEnabled = document.getElementById("chkNumberingEnabled")?.checked ?? false;
    const dateEnabled = document.getElementById("chkDateEnabled")?.checked ?? false;
    const removeAdvancedEnabled = document.getElementById("chkRemoveAdvancedEnabled")?.checked ?? false;
    const partsEnabled = document.getElementById("chkPartsEnabled")?.checked ?? false;
    const copyMoveEnabled = document.getElementById("chkCopyMoveEnabled")?.checked ?? false;
    const specialEnabled = document.getElementById("chkSpecialEnabled")?.checked ?? false;

    return {
        addRemove: {
            enabled: addRemoveEnabled,
            prefix: document.getElementById("prefixInput")?.value || "",
            suffix: document.getElementById("suffixInput")?.value || "",
            insertText: document.getElementById("insertText")?.value || "",
            insertPosition: parseInteger(document.getElementById("insertPosition")?.value, null),
            insertFrom: document.getElementById("insertFrom")?.value || "start",
            rmDigits: document.getElementById("rmDigits")?.checked || false,
            rmSymbols: document.getElementById("rmSymbols")?.checked || false,
            rmExtraSpaces: document.getElementById("rmExtraSpaces")?.checked || false,
        },
        replace: {
            enabled: replaceEnabled,
            findText: document.getElementById("findText")?.value || "",
            replaceText: document.getElementById("replaceText")?.value || "",
            replaceAll: document.getElementById("chkReplaceAll")?.checked || false,
            caseSensitive: document.getElementById("chkReplaceCaseSensitive")?.checked || false,
            useRegex: document.getElementById("chkReplaceRegex")?.checked || false,
        },
        case: {
            enabled: caseEnabled,
            mode: document.getElementById("caseMode")?.value || "keep",
        },
        numbering: {
            enabled: numberingEnabled,
            start: parseInteger(document.getElementById("numberStart")?.value, 1),
            step: parseInteger(document.getElementById("numberStep")?.value, 1),
            padding: parseInteger(document.getElementById("numberPadding")?.value, 3),
            position: document.getElementById("numberPosition")?.value || "prefix",
            resetPerFolder: document.getElementById("numberResetPerFolder")?.checked || false,
            separator: document.getElementById("dateSeparator")?.value || "_",
        },
        date: {
            enabled: dateEnabled,
            type: document.getElementById("dateType")?.value || "mtime",
            preset: document.getElementById("dateFormatPreset")?.value || "YYYYMMDD",
            customFormat: document.getElementById("dateFormatCustom")?.value || "",
            position: document.getElementById("datePosition")?.value || "prefix",
            separator: document.getElementById("dateSeparator")?.value || "_",
        },
        removeAdvanced: {
            enabled: removeAdvancedEnabled,
            firstN: parseInteger(document.getElementById("removeFirstN")?.value, null),
            lastN: parseInteger(document.getElementById("removeLastN")?.value, null),
            rangeFrom: parseInteger(document.getElementById("removeRangeFrom")?.value, null),
            rangeTo: parseInteger(document.getElementById("removeRangeTo")?.value, null),
            cropMode: document.getElementById("removeCropMode")?.value || "none",
            cropText: document.getElementById("removeCropText")?.value || "",
            trimSpaces: document.getElementById("removeTrimSpaces")?.checked || false,
            leadingDots: document.getElementById("removeLeadingDots")?.checked || false,
        },
        parts: {
            enabled: partsEnabled,
            delimiterMode: document.getElementById("partsDelimiter")?.value || "auto",
            delimiterCustom: document.getElementById("partsDelimiterCustom")?.value || "",
            moveFrom: parseInteger(document.getElementById("partsMoveFrom")?.value, null),
            moveTo: parseInteger(document.getElementById("partsMoveTo")?.value, null),
            appendFolderPosition: document.getElementById("appendFolderPosition")?.value || "none",
            appendFolderSeparator: document.getElementById("appendFolderSeparator")?.value || "_",
            appendFolderLevels: parseInteger(document.getElementById("appendFolderLevels")?.value, 1),
            extensionMode: document.getElementById("extensionMode")?.value || "keep",
            extensionReplace: document.getElementById("extensionReplace")?.value || "",
        },
        copyMove: {
            enabled: copyMoveEnabled,
            destPath: document.getElementById("copyMovePath")?.value || "",
            copyNotMove: document.getElementById("copyMoveCopyNotMove")?.checked || false,
            keepFolders: document.getElementById("copyMoveKeepFolders")?.checked || false,
        },
        special: {
            enabled: specialEnabled,
            setMtimeNow: document.getElementById("specialSetMtimeNow")?.checked || false,
            setAtimeNow: document.getElementById("specialSetAtimeNow")?.checked || false,
            attrReadOnly: document.getElementById("specialAttrReadOnly")?.checked || false,
            attrHidden: document.getElementById("specialAttrHidden")?.checked || false,
        },
    };
}

function formatDateForName(date, config) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";

    const pad2 = (n) => String(n).padStart(2, "0");
    const pad4 = (n) => String(n).padStart(4, "0");

    const yyyy = pad4(date.getFullYear());
    const mm = pad2(date.getMonth() + 1);
    const dd = pad2(date.getDate());
    const HH = pad2(date.getHours());
    const MM = pad2(date.getMinutes());
    const SS = pad2(date.getSeconds());

    let pattern = config.preset === "custom" && config.customFormat
        ? config.customFormat
        : config.preset;

    pattern = pattern
        .replace(/YYYY/g, yyyy)
        .replace(/MM/g, mm)
        .replace(/DD/g, dd)
        .replace(/HH/g, HH)
        .replace(/mm/g, MM)
        .replace(/ss/g, SS);

    return pattern;
}

function applyAddRemoveTransform(baseName, config) {
    let result = baseName;

    if (config.rmDigits) {
        result = result.replace(/\d+/g, "");
    }
    if (config.rmSymbols) {
        result = result.replace(/[^\w\s]/g, "");
    }
    if (config.rmExtraSpaces) {
        result = result.replace(/\s+/g, " ").trim();
    }

    if (config.insertText && config.insertPosition != null && config.insertPosition >= 0) {
        const pos = Math.min(config.insertPosition, result.length);
        if (config.insertFrom === "end") {
            const idx = Math.max(0, result.length - pos);
            result = result.slice(0, idx) + config.insertText + result.slice(idx);
        } else {
            result = result.slice(0, pos) + config.insertText + result.slice(pos);
        }
    }

    result = (config.prefix || "") + result + (config.suffix || "");

    return result;
}

function applyRemoveAdvancedTransform(baseName, config) {
    if (!config.enabled) return baseName;

    let result = baseName;

    const firstN = config.firstN != null && config.firstN > 0 ? config.firstN : null;
    const lastN = config.lastN != null && config.lastN > 0 ? config.lastN : null;
    const rangeFrom = config.rangeFrom != null && config.rangeFrom > 0 ? config.rangeFrom : null;
    const rangeTo = config.rangeTo != null && config.rangeTo > 0 ? config.rangeTo : null;

    if (rangeFrom != null && rangeTo != null && rangeTo >= rangeFrom) {
        const start = Math.max(0, rangeFrom - 1);
        const endExclusive = Math.min(result.length, rangeTo);
        result = result.slice(0, start) + result.slice(endExclusive);
    }

    if (firstN != null) {
        result = result.slice(firstN);
    }

    if (lastN != null) {
        result = result.slice(0, Math.max(0, result.length - lastN));
    }

    if (config.cropMode && config.cropMode !== "none" && config.cropText) {
        const idx = result.indexOf(config.cropText);
        if (idx !== -1) {
            if (config.cropMode === "before") {
                result = result.slice(idx + config.cropText.length);
            } else if (config.cropMode === "after") {
                result = result.slice(0, idx);
            }
        }
    }

    if (config.trimSpaces) {
        result = result.trim();
    }

    if (config.leadingDots) {
        while (result.startsWith(".")) {
            result = result.slice(1);
        }
    }

    return result;
}

function applyReplaceTransform(baseName, config) {
    if (!config.findText) return baseName;

    let result = baseName;

    if (config.useRegex) {
        try {
            const flags = config.caseSensitive ? "g" : "gi";
            const re = new RegExp(config.findText, flags);
            result = result.replace(re, config.replaceText);
        } catch (err) {
            console.error("Errore nella RegEx di sostituzione:", err);
        }
    } else {
        const find = config.caseSensitive ? config.findText : config.findText.toLowerCase();
        if (!find) return baseName;

        const source = config.caseSensitive ? result : result.toLowerCase();

        if (config.replaceAll) {
            let idx = source.indexOf(find);
            if (idx === -1) return result;

            let out = "";
            let currentIndex = 0;
            while (idx !== -1) {
                out += result.slice(currentIndex, idx) + config.replaceText;
                currentIndex = idx + find.length;
                idx = source.indexOf(find, currentIndex);
            }
            out += result.slice(currentIndex);
            result = out;
        } else {
            const idx = source.indexOf(find);
            if (idx !== -1) {
                result = result.slice(0, idx) + config.replaceText + result.slice(idx + find.length);
            }
        }
    }

    return result;
}

function applyCaseTransform(baseName, config) {
    const mode = config.mode || "keep";

    if (!config.enabled || mode === "keep") return baseName;

    if (mode === "upper") {
        return baseName.toUpperCase();
    }
    if (mode === "lower") {
        return baseName.toLowerCase();
    }
    if (mode === "title") {
        return baseName
            .split(/([_\-\s]+)/)
            .map(part => {
                if (/^[_\-\s]+$/.test(part)) return part;
                if (!part) return part;
                return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
            })
            .join("");
    }
    if (mode === "sentence") {
        const lower = baseName.toLowerCase();
        return lower.charAt(0).toUpperCase() + lower.slice(1);
    }

    return baseName;
}

function applyNumberingTransform(baseName, numberIndex, config) {
    if (!config.enabled || numberIndex == null) return baseName;

    const num = config.start + config.step * numberIndex;
    const padded = String(num).padStart(config.padding || 1, "0");
    const sep = config.separator || "_";

    if (config.position === "suffix") {
        return `${baseName}${sep}${padded}`;
    }

    return `${padded}${sep}${baseName}`;
}

function applyDateTransform(baseName, stats, config) {
    if (!config.enabled) return baseName;

    const date = stats[config.type] instanceof Date ? stats[config.type] : stats.mtime;
    const formatted = formatDateForName(date, config);
    if (!formatted) return baseName;

    const sep = config.separator || "_";

    if (config.position === "suffix") {
        return `${baseName}${sep}${formatted}`;
    }
    return `${formatted}${sep}${baseName}`;
}

function resolvePartsDelimiter(config) {
    const mode = config.delimiterMode || "auto";
    if (mode === "space") return " ";
    if (mode === "underscore") return "_";
    if (mode === "dash") return "-";
    if (mode === "dot") return ".";
    if (mode === "custom" && config.delimiterCustom) return config.delimiterCustom;
    return null;
}

function applyPartsTransform(baseName, item, config) {
    if (!config.enabled) return baseName;

    let result = baseName;
    const delimiter = resolvePartsDelimiter(config);

    if (config.moveFrom != null && config.moveTo != null && delimiter) {
        const parts = result.split(delimiter);
        const fromIdx = config.moveFrom - 1;
        let toIdx = config.moveTo - 1;
        if (fromIdx >= 0 && fromIdx < parts.length) {
            const [part] = parts.splice(fromIdx, 1);
            if (toIdx < 0) toIdx = 0;
            if (toIdx > parts.length) toIdx = parts.length;
            parts.splice(toIdx, 0, part);
            result = parts.join(delimiter);
        }
    } else if (config.moveFrom != null && config.moveTo != null && !delimiter && config.delimiterMode === "auto") {
        const tokens = result.split(/([_\-\s]+)/);
        const wordIndexes = [];
        for (let i = 0; i < tokens.length; i++) {
            if (!/^[_\-\s]+$/.test(tokens[i])) {
                wordIndexes.push(i);
            }
        }
        const fromWordIdx = config.moveFrom - 1;
        const toWordIdx = config.moveTo - 1;
        if (fromWordIdx >= 0 && fromWordIdx < wordIndexes.length) {
            const tokenIndexFrom = wordIndexes[fromWordIdx];
            const part = tokens[tokenIndexFrom];
            tokens[tokenIndexFrom] = "";
            const tokenIndexTo = wordIndexes[Math.min(Math.max(toWordIdx, 0), wordIndexes.length - 1)];
            tokens.splice(tokenIndexTo, 0, part);
            result = tokens.join("");
        }
    }

    if (config.appendFolderPosition && config.appendFolderPosition !== "none") {
        const levels = config.appendFolderLevels || 1;
        const sep = config.appendFolderSeparator || "_";
        let dir = item.dir || "";
        const segments = dir.split(path.sep).filter(Boolean);
        if (segments.length > 0) {
            const startIdx = Math.max(0, segments.length - levels);
            const folderName = segments.slice(startIdx).join("_");
            if (folderName) {
                if (config.appendFolderPosition === "prefix") {
                    result = `${folderName}${sep}${result}`;
                } else if (config.appendFolderPosition === "suffix") {
                    result = `${result}${sep}${folderName}`;
                }
            }
        }
    }

    return result;
}

function applyExtensionTransform(ext, config) {
    if (!config.enabled) return ext;

    const mode = config.extensionMode || "keep";
    if (mode === "keep") return ext;

    if (mode === "lower") {
        return ext.toLowerCase();
    }
    if (mode === "upper") {
        return ext.toUpperCase();
    }
    if (mode === "replace") {
        const raw = config.extensionReplace || "";
        if (!raw) return ext;
        const e = raw.startsWith(".") ? raw : `.${raw}`;
        return e;
    }

    return ext;
}

function applyTransformPipeline(item, index, numberingIndex, transformsConfig) {
    const { name, ext } = splitNameExt(item.name);
    let base = name;
    let extension = ext;

    if (transformsConfig.addRemove.enabled) {
        base = applyAddRemoveTransform(base, transformsConfig.addRemove);
    }

    base = applyRemoveAdvancedTransform(base, transformsConfig.removeAdvanced);

    if (transformsConfig.replace.enabled) {
        base = applyReplaceTransform(base, transformsConfig.replace);
    }

    base = applyCaseTransform(base, transformsConfig.case);

    base = applyPartsTransform(base, item, transformsConfig.parts);

    base = applyNumberingTransform(base, numberingIndex, transformsConfig.numbering);
    base = applyDateTransform(base, item.stats, transformsConfig.date);

    extension = applyExtensionTransform(extension, transformsConfig.parts);

    return base + extension;
}

function buildPreviewWithCopyMove(items, transformsConfig, rootPath) {
    previewData = [];
    const usedTargets = new Map();

    const originalKeySet = new Set(items.map(it => it.fullPath.toLowerCase()));

    let globalNumberIndex = 0;
    const perFolderIndex = new Map();

    items.forEach((item, index) => {
        const fullPath = item.fullPath;
        const sourceDir = item.dir;
        const oldName = item.name;

        let newName = oldName;
        let status = "unchanged";
        let error = null;

        let targetDir = sourceDir;
        let operationKind = "rename";

        const copyCfg = transformsConfig.copyMove;
        const hasDest =
            copyCfg &&
            copyCfg.enabled &&
            typeof copyCfg.destPath === "string" &&
            copyCfg.destPath.trim() !== "";

        if (hasDest) {
            const destBase = copyCfg.destPath.trim();
            targetDir = destBase;
            operationKind = copyCfg.copyNotMove && !item.isDirectory ? "copy" : "move";

            if (copyCfg.keepFolders && rootPath) {
                try {
                    const rel = path.relative(rootPath, sourceDir);
                    if (rel && rel !== "." && !rel.startsWith("..")) {
                        targetDir = path.join(destBase, rel);
                    }
                } catch (e) {
                    // fallback: mantieni destBase
                }
            }
        }

        let numberingIndex = null;
        if (transformsConfig.numbering.enabled) {
            if (transformsConfig.numbering.resetPerFolder) {
                const key = sourceDir.toLowerCase();
                const current = perFolderIndex.get(key) || 0;
                numberingIndex = current;
                perFolderIndex.set(key, current + 1);
            } else {
                numberingIndex = globalNumberIndex;
                globalNumberIndex += 1;
            }
        }

        try {
            newName = applyTransformPipeline(item, index, numberingIndex, transformsConfig);
        } catch (e) {
            newName = oldName;
            status = "error";
            error = e.message || String(e);
        }

        const targetFullPath = path.join(targetDir, newName);

        const sourceKey = fullPath.toLowerCase();
        const targetKey = targetFullPath.toLowerCase();

        const hasChanges =
            !error && (newName !== oldName || targetKey !== sourceKey);

        if (hasChanges) {
            const existsOnDisk = fs.existsSync(targetFullPath);
            const targetIsSameFile = targetKey === sourceKey;
            const targetUsedByOthers = usedTargets.has(targetKey);
            const targetIsOtherOriginal = !targetIsSameFile && originalKeySet.has(targetKey);
            const targetIsExternalExisting =
                existsOnDisk && !targetIsSameFile && !originalKeySet.has(targetKey);

            if (targetUsedByOthers || targetIsOtherOriginal || targetIsExternalExisting) {
                status = "conflict";
                error = "Esiste già un elemento con lo stesso percorso di destinazione.";
            } else {
                status = "rename";
                usedTargets.set(targetKey, true);
            }
        }

        previewData.push({
            fullPath,
            dir: sourceDir,
            oldName,
            newName,
            status,
            error,
            isDirectory: item.isDirectory,
            isFile: item.isFile,
            stats: item.stats,
            targetDir,
            targetFullPath,
            operationKind,
        });
    });
}
function buildPreview(items, transformsConfig) {
    previewData = [];
    const usedTargets = new Map();

    const originalKeySet = new Set(items.map(it => it.fullPath.toLowerCase()));

    let globalNumberIndex = 0;
    const perFolderIndex = new Map();

    items.forEach((item, index) => {
        const fullPath = item.fullPath;
        const dir = item.dir;
        const oldName = item.name;

        let newName = oldName;
        let status = "unchanged";
        let error = null;

        let numberingIndex = null;
        if (transformsConfig.numbering.enabled) {
            if (transformsConfig.numbering.resetPerFolder) {
                const key = dir.toLowerCase();
                const current = perFolderIndex.get(key) || 0;
                numberingIndex = current;
                perFolderIndex.set(key, current + 1);
            } else {
                numberingIndex = globalNumberIndex;
                globalNumberIndex += 1;
            }
        }

        try {
            newName = applyTransformPipeline(item, index, numberingIndex, transformsConfig);
        } catch (e) {
            newName = oldName;
            status = "error";
            error = e.message || String(e);
        }

        if (!error && newName !== oldName) {
            const targetFullPath = path.join(dir, newName);

            const sourceKey = fullPath.toLowerCase();
            const targetKey = targetFullPath.toLowerCase();

            const existsOnDisk = fs.existsSync(targetFullPath);
            const targetIsSameFile = targetKey === sourceKey;
            const targetUsedByOthers = usedTargets.has(targetKey);
            const targetIsOtherOriginal = !targetIsSameFile && originalKeySet.has(targetKey);
            const targetIsExternalExisting =
                existsOnDisk && !targetIsSameFile && !originalKeySet.has(targetKey);

            if (targetUsedByOthers || targetIsOtherOriginal || targetIsExternalExisting) {
                status = "conflict";
                error = "Esiste già un file con lo stesso nome.";
            } else {
                status = "rename";
                usedTargets.set(targetKey, true);
            }
        }

        previewData.push({
            fullPath,
            dir,
            oldName,
            newName,
            status,
            error,
            isDirectory: item.isDirectory,
            isFile: item.isFile,
            stats: item.stats,
        });
    });
}

function renderPreviewTable() {
    const tbody = document.querySelector("#previewTable tbody");
    tbody.innerHTML = "";
    selectedIndex = null;

    previewData.forEach((item, index) => {
        const tr = document.createElement("tr");
        tr.classList.add(`status-${item.status}`);
        tr.dataset.index = index;

        const tdOld = document.createElement("td");
        tdOld.textContent = item.oldName;

        const tdNew = document.createElement("td");
        tdNew.textContent = item.newName;

        const tdStatus = document.createElement("td");
        if (item.status === "rename") {
            tdStatus.textContent = "Da rinominare";
        } else if (item.status === "unchanged") {
            tdStatus.textContent = "Invariato";
        } else if (item.status === "conflict") {
            tdStatus.textContent = `Conflitto: ${item.error}`;
        } else if (item.status === "error") {
            tdStatus.textContent = `Errore: ${item.error}`;
        }

        const tdInfo = document.createElement("td");
        const typeLabel = item.isDirectory ? "Cartella" : "File";
        const opLabel = item.operationKind === "copy"
            ? "Copia"
            : item.operationKind === "move"
                ? "Sposta"
                : "Rinomina";
        const sizeLabel = item.isDirectory ? "-" : `${item.stats.size} B`;
        const mtimeLabel = item.stats && item.stats.mtime
            ? new Date(item.stats.mtime).toLocaleString()
            : "";

        const shortTargetDir = item.targetDir || item.dir || "";
        tdInfo.textContent = `${typeLabel} (${opLabel}) | ${sizeLabel} | ${mtimeLabel}`;
        tdInfo.title = shortTargetDir ? `Destinazione: ${shortTargetDir}` : "";

        tr.appendChild(tdOld);
        tr.appendChild(tdNew);
        tr.appendChild(tdStatus);
        tr.appendChild(tdInfo);
        tbody.appendChild(tr);

        tr.addEventListener("click", () => {
            const rows = tbody.querySelectorAll("tr");
            rows.forEach(r => r.classList.remove("row-selected"));

            tr.classList.add("row-selected");
            selectedIndex = index;

            const btnOpenFolder = document.getElementById("btnOpenFolder");
            if (btnOpenFolder) {
                btnOpenFolder.disabled = false;
            }
        });
    });

    const btnOpenFolder = document.getElementById("btnOpenFolder");
    if (btnOpenFolder) {
        btnOpenFolder.disabled = previewData.length === 0;
    }
}

async function handlePreview() {
    if (!rootFolder) {
        await showWarning("Seleziona prima una cartella.");
        return;
    }

    const extFilterStr = document.getElementById("extFilter").value.trim();
    const includeSubfolders = document.getElementById("chkIncludeSubfolders").checked;
    const extList = parseExtensions(extFilterStr);

    const scopeInput = document.querySelector('input[name="renameScope"]:checked');
    const scope = scopeInput ? scopeInput.value : "files";

    const filterConfig = getFilterConfigFromUI();

    setStatus("Scansione in corso...");

    const items = collectTargets(rootFolder, {
        includeSubfolders,
        extFilterList: extList,
        scope,
        filterConfig,
    });

    const totalFound = items.length;
    const lblTotalFound = document.getElementById("lblTotalFound");
    if (lblTotalFound) lblTotalFound.textContent = String(totalFound);

    let itemsFiltered = items;

    const sortOrderSelect = document.getElementById("sortOrder");
    const sortOrder = sortOrderSelect ? sortOrderSelect.value : "nameAsc";

    itemsFiltered.sort((a, b) => {
        const nameA = a.name.toLowerCase();
        const nameB = b.name.toLowerCase();
        const extA = a.ext || "";
        const extB = b.ext || "";

        const sizeA = a.stats ? a.stats.size : 0;
        const sizeB = b.stats ? b.stats.size : 0;
        const timeA = a.stats && a.stats.mtime ? a.stats.mtime.getTime() : 0;
        const timeB = b.stats && b.stats.mtime ? b.stats.mtime.getTime() : 0;

        switch (sortOrder) {
            case "nameDesc": {
                const cmp = nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: "base" });
                return -cmp;
            }
            case "extAsc": {
                const cmp = extA.localeCompare(extB, undefined, { numeric: true, sensitivity: "base" });
                return cmp || nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: "base" });
            }
            case "extDesc": {
                const cmp = extA.localeCompare(extB, undefined, { numeric: true, sensitivity: "base" });
                return -cmp || nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: "base" });
            }
            case "sizeAsc":
                return sizeA - sizeB;
            case "sizeDesc":
                return sizeB - sizeA;
            case "dateAsc":
                return timeA - timeB;
            case "dateDesc":
                return timeB - timeA;
            case "nameAsc":
            default: {
                const cmp = nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: "base" });
                return cmp;
            }
        }
    });

    if (itemsFiltered.length === 0) {
        previewData = [];
        renderPreviewTable();
        await showWarning("Nessun file trovato con i criteri specificati.");
        document.getElementById("btnApply").disabled = true;
        const lblFilteredIncluded = document.getElementById("lblFilteredIncluded");
        if (lblFilteredIncluded) lblFilteredIncluded.textContent = "0";
        setStatus("Nessun elemento incluso dai filtri.");
        return;
    }

    const lblFilteredIncluded = document.getElementById("lblFilteredIncluded");
    if (lblFilteredIncluded) lblFilteredIncluded.textContent = String(itemsFiltered.length);

    const transformsConfig = getTransformsConfigFromUI();

    if (transformsConfig.copyMove.enabled) {
        const dest = transformsConfig.copyMove.destPath || "";
        if (!dest.trim()) {
            await showWarning(
                "Blocco Copia/Sposta attivo ma percorso vuoto.",
                "Specifica un percorso di destinazione oppure disattiva il blocco Copia / Sposta in cartella."
            );
        }
    }

    buildPreviewWithCopyMove(itemsFiltered, transformsConfig, rootFolder);
    renderPreviewTable();

    const toRename = previewData.filter(x => x.status === "rename").length;
    const conflicts = previewData.filter(x => x.status === "conflict" || x.status === "error").length;

    const hasConflicts = conflicts > 0;

    document.getElementById("btnApply").disabled = toRename === 0 || hasConflicts;

    const btnUndoLast = document.getElementById("btnUndoLast");
    if (btnUndoLast) {
        btnUndoLast.disabled = !lastRenameOperations;
    }

    await showInfo(
        "Anteprima generata.",
        `File totali: ${previewData.length}\nDa rinominare: ${toRename}\nConflitti/Errori: ${conflicts}`
    );

    if (conflicts > 0) {
        setStatus("Sono presenti conflitti o errori: risolvi prima di procedere.");
    } else {
        setStatus("Anteprima pronta. Nessun conflitto rilevato.");
    }
}

async function handleApply() {
    const toRename = previewData.filter(x => x.status === "rename");
    if (toRename.length === 0) {
        await showWarning("Non ci sono elementi da rinominare/spostare.");
        return;
    }

    const conflicts = previewData.filter(x => x.status === "conflict" || x.status === "error").length;
    if (conflicts > 0) {
        await showWarning("Ci sono conflitti o errori. Risolvili prima di procedere.");
        return;
    }

    const transformsConfig = getTransformsConfigFromUI();
    const specialCfg = transformsConfig.special || { enabled: false };

    const now = new Date();
    const timestampSafe = now.toISOString().replace(/[:]/g, "-").replace(/\.\d+Z$/, "Z");

    const logDir = path.join(rootFolder, "AyPi_BatchRename_Logs");
    try {
        fs.mkdirSync(logDir, { recursive: true });
    } catch (err) {
        console.error("Impossibile creare la cartella di log:", logDir, err);
    }

    const logCsvPath = path.join(logDir, `batch-rename-log-${timestampSafe}.csv`);
    const undoScriptPath = path.join(logDir, `batch-rename-undo-${timestampSafe}.bat`);

    let ok = 0;
    let fail = 0;

    const fileOps = [];
    const dirOps = [];

    const operations = [];

    for (const item of toRename) {
        const source = item.fullPath;
        const targetDir = item.targetDir || item.dir || path.dirname(source);
        const target = item.targetFullPath || path.join(targetDir, item.newName);
        const kind = item.operationKind || "rename";

        const op = {
            source,
            target,
            isDirectory: item.isDirectory,
            kind: kind === "copy" && item.isDirectory ? "move" : kind,
        };

        if (item.isDirectory) {
            dirOps.push(op);
        } else {
            fileOps.push(op);
        }
    }

    const sortedDirOps = dirOps.sort((a, b) => {
        const depthA = a.source.split(path.sep).length;
        const depthB = b.source.split(path.sep).length;
        return depthB - depthA;
    });

    const allOps = [...fileOps, ...sortedDirOps];

    for (const op of allOps) {
        try {
            const parentDir = path.dirname(op.target);
            if (!fs.existsSync(parentDir)) {
                fs.mkdirSync(parentDir, { recursive: true });
            }

            if (op.kind === "copy" && !op.isDirectory) {
                fs.copyFileSync(op.source, op.target);
            } else {
                fs.renameSync(op.source, op.target);
            }

            if (specialCfg.enabled && !op.isDirectory) {
                try {
                    const stats = fs.statSync(op.target);
                    let atime = stats.atime;
                    let mtime = stats.mtime;

                    if (specialCfg.setAtimeNow) {
                        atime = now;
                    }
                    if (specialCfg.setMtimeNow) {
                        mtime = now;
                    }

                    if (specialCfg.setAtimeNow || specialCfg.setMtimeNow) {
                        fs.utimesSync(op.target, atime, mtime);
                    }

                    if (specialCfg.attrReadOnly) {
                        const newMode = stats.mode & ~0o222;
                        fs.chmodSync(op.target, newMode);
                    }

                    if (specialCfg.attrHidden && process.platform === "win32") {
                        try {
                            await ipcRenderer.invoke("batch-rename-set-hidden", {
                                path: op.target,
                                hidden: true,
                            });
                        } catch (hiddenErr) {
                            console.warn("Impossibile impostare attributo nascosto per:", op.target, hiddenErr);
                        }
                    }
                } catch (attrErr) {
                    console.warn("Impossibile applicare attributi speciali a:", op.target, attrErr);
                }
            }

            ok++;
            operations.push({
                from: op.source,
                to: op.target,
                isDirectory: op.isDirectory,
                kind: op.kind,
            });
        } catch (err) {
            console.error("Errore applicando operazione:", op.source, "->", op.target, err);
            fail++;
        }
    }

    lastRenameOperations = operations;

    try {
        const lines = [];
        lines.push("from,to,isDirectory,kind");
        for (const op of operations) {
            const fromEsc = `"${op.from.replace(/"/g, '""')}"`;
            const toEsc = `"${op.to.replace(/"/g, '""')}"`;
            lines.push(`${fromEsc},${toEsc},${op.isDirectory ? "1" : "0"},${op.kind}`);
        }
        fs.writeFileSync(logCsvPath, lines.join("\r\n"), "utf8");
    } catch (err) {
        console.error("Errore scrivendo il log CSV:", err);
    }

    try {
        const batLines = [];
        batLines.push("@echo off");
        batLines.push("REM Script di undo generato da AyPi - Batch Rename");
        batLines.push(`REM Data: ${now.toString()}`);
        batLines.push("");

        for (const op of operations.slice().reverse()) {
            if (op.kind === "copy" && !op.isDirectory) {
                batLines.push(`if exist "${op.to}" del "${op.to}"`);
            } else {
                const src = op.to;
                const dst = op.from;
                batLines.push(`if exist "${src}" ren "${src}" "${path.basename(dst)}"`);
            }
        }

        fs.writeFileSync(undoScriptPath, batLines.join("\r\n"), "utf8");
    } catch (err) {
        console.error("Errore scrivendo il file di undo:", err);
    }

    const btnUndoLast = document.getElementById("btnUndoLast");
    if (btnUndoLast) {
        btnUndoLast.disabled = !lastRenameOperations || lastRenameOperations.length === 0;
    }

    await showInfo(
        "Rinomina completata.",
        `Rinomine riuscite: ${ok}\nRinomine fallite: ${fail}\n\nLog:\n${logCsvPath}\nUndo script:\n${undoScriptPath}`
    );

    setStatus("Rinomina completata. È stato creato un log e uno script di undo.");
}

async function handleOpenFolder() {
    if (selectedIndex === null || selectedIndex < 0 || selectedIndex >= previewData.length) {
        await showWarning("Seleziona prima una riga nell'anteprima.");
        return;
    }

    const item = previewData[selectedIndex];
    const dir = path.dirname(item.fullPath);

    if (!dir) {
        await showError("Impossibile determinare la cartella del file selezionato.");
        return;
    }

    ipcRenderer.send("open-file", dir);
}

async function handleUndoLast() {
    if (!lastRenameOperations || lastRenameOperations.length === 0) {
        await showWarning("Non ci sono operazioni da annullare.");
        return;
    }

    const ops = lastRenameOperations.slice();

    let ok = 0;
    let fail = 0;

    const copyOps = ops.filter(o => o.kind === "copy" && !o.isDirectory);
    const nonCopyOps = ops.filter(o => o.kind !== "copy");

    const fileOps = nonCopyOps.filter(o => !o.isDirectory);
    const dirOps = nonCopyOps.filter(o => o.isDirectory).sort((a, b) => {
        const depthA = a.to.split(path.sep).length;
        const depthB = b.to.split(path.sep).length;
        return depthB - depthA;
    });

    for (const op of copyOps) {
        try {
            if (fs.existsSync(op.to)) {
                fs.unlinkSync(op.to);
                ok++;
            }
        } catch (err) {
            console.error("Errore durante l'undo (copia):", op.to, err);
            fail++;
        }
    }

    for (const op of [...fileOps, ...dirOps]) {
        const src = op.to;
        const dst = op.from;

        try {
            if (fs.existsSync(src)) {
                fs.renameSync(src, dst);
                ok++;
            } else {
                console.warn("Percorso non trovato durante l'undo:", src);
                fail++;
            }
        } catch (err) {
            console.error("Errore durante l'undo:", src, "->", dst, err);
            fail++;
        }
    }

    lastRenameOperations = null;

    const btnUndoLast = document.getElementById("btnUndoLast");
    if (btnUndoLast) {
        btnUndoLast.disabled = true;
    }

    await showInfo(
        "Undo completato.",
        `Ripristini riusciti: ${ok}\nRipristini falliti: ${fail}`
    );

    setStatus("Ultima operazione annullata (dove possibile).");
}

window.addEventListener("DOMContentLoaded", () => {
    console.log("batch-rename-scripts.js caricato");

    const btnSelectFolder = document.getElementById("btnSelectFolder");
    const btnPreview = document.getElementById("btnPreview");
    const btnApply = document.getElementById("btnApply");
    const btnClose = document.getElementById("btnClose");
    const btnOpenFolder = document.getElementById("btnOpenFolder");
    const btnUndoLast = document.getElementById("btnUndoLast");
    const presetSelect = document.getElementById("presetSelect");
    const presetNameInput = document.getElementById("presetName");
    const btnPresetSave = document.getElementById("btnPresetSave");
    const btnPresetDelete = document.getElementById("btnPresetDelete");

    btnSelectFolder.addEventListener("click", async () => {
        const folder = await ipcRenderer.invoke("select-root-folder");
        if (!folder) return;
        rootFolder = folder;
        updateSelectedFolderLabel();
        refreshFolderTree();
    });

    btnPreview.addEventListener("click", handlePreview);
    btnApply.addEventListener("click", handleApply);
    btnClose.addEventListener("click", () => {
        window.close();
    });
    btnOpenFolder.addEventListener("click", handleOpenFolder);
    if (btnUndoLast) {
        btnUndoLast.addEventListener("click", handleUndoLast);
        btnUndoLast.disabled = true;
    }
    if (btnPresetSave && presetSelect) {
        btnPresetSave.addEventListener("click", async () => {
            const rawName = presetNameInput ? presetNameInput.value : "";
            const currentName = rawName || presetSelect.value || "";
            const name = (currentName || "").trim();
            if (!name) {
                await showWarning("Inserisci un nome per il preset.");
                if (presetNameInput) presetNameInput.focus();
                return;
            }
            const preset = buildPresetFromUI(name);
            try {
                await ipcRenderer.invoke("batch-rename-save-preset", {
                    name,
                    data: preset,
                });
                await loadPresetsIntoUI(name);
                if (presetNameInput) presetNameInput.value = name;
                setStatus(`Preset "${name}" salvato.`);
            } catch (err) {
                console.error("Errore salvando il preset:", err);
                await showError("Errore durante il salvataggio del preset.", err.message || String(err));
            }
        });
    }
    if (btnPresetDelete && presetSelect) {
        btnPresetDelete.addEventListener("click", async () => {
            const name = presetSelect.value;
            if (!name) return;
            const conferma = window.confirm(`Vuoi eliminare il preset "${name}"?`);
            if (!conferma) return;
            try {
                await ipcRenderer.invoke("batch-rename-delete-preset", { name });
                await loadPresetsIntoUI("");
                setStatus(`Preset "${name}" eliminato.`);
            } catch (err) {
                console.error("Errore eliminando il preset:", err);
                await showError("Errore durante l'eliminazione del preset.", err.message || String(err));
            }
        });
    }
    if (presetSelect && btnPresetDelete) {
        presetSelect.addEventListener("change", async () => {
            const name = presetSelect.value;
            btnPresetDelete.disabled = !name;
            if (!name) return;

            try {
                const presets = await ipcRenderer.invoke("batch-rename-load-presets");
                const presetObj = (presets || []).find(p => p && p.name === name);
                if (presetObj && presetObj.data) {
                    applyPresetToUI(presetObj.data);
                    if (presetNameInput) presetNameInput.value = name;
                    setStatus(`Preset "${name}" caricato. Genera una nuova anteprima per vedere l'effetto.`);
                }
            } catch (err) {
                console.error("Errore caricando il preset selezionato:", err);
            }
        });
    }

    setStatus("Pronto");

    ipcRenderer.on("batch-rename-set-root", (event, folderPath) => {
        if (folderPath) {
            rootFolder = folderPath;
            updateSelectedFolderLabel();
            refreshFolderTree();
        }
    });

    updateSelectedFolderLabel();
    refreshFolderTree();
    if (presetSelect) {
        loadPresetsIntoUI("");
    }
});
