// @ts-nocheck
require("../../shared/dev-guards");
import { parseInteger, buildWildcardRegexes } from "./utils";

function getFilterConfigFromUI(options = {}) {
    const { showWarning } = options;

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
            if (showWarning) {
                showWarning("Regex filtro non valida.", err.message || String(err));
            }
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
            if (showWarning) {
                showWarning("Condizione JS non valida.", err.message || String(err));
            }
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
        const matched = filterConfig.wildcardRegexes.some((r) => r.test(name));
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

export {
    getFilterConfigFromUI,
    applyFiltersToItem,
};



