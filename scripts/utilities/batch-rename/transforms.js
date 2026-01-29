const path = require("path");
const { parseInteger, splitNameExt } = require("./utils");

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
            rmAll: document.getElementById("rmAll")?.checked || false,
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
            resetPerExtension: document.getElementById("numberResetPerExtension")?.checked || false,
            separator: document.getElementById("numberSeparator")?.value || "",
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

    let pattern = config.preset === "custom" && config.customFormat ? config.customFormat : config.preset;

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

    if (config.rmAll) {
        result = "";
    }

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
            if (idx === -1) return result;
            result = result.slice(0, idx) + config.replaceText + result.slice(idx + find.length);
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
            .split(/([._\-\s]+)/)
            .map((part) => {
                if (/^[._\-\s]+$/.test(part)) return part;
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
    const sep = config.separator || "";

    if (config.position === "suffix") {
        return sep ? `${baseName}${sep}${padded}` : `${baseName}${padded}`;
    }

    return sep ? `${padded}${sep}${baseName}` : `${padded}${baseName}`;
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

module.exports = {
    getTransformsConfigFromUI,
    formatDateForName,
    applyAddRemoveTransform,
    applyRemoveAdvancedTransform,
    applyReplaceTransform,
    applyCaseTransform,
    applyNumberingTransform,
    applyDateTransform,
    resolvePartsDelimiter,
    applyPartsTransform,
    applyExtensionTransform,
    applyTransformPipeline,
};
