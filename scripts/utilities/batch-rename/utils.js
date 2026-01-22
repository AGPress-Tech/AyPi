const path = require("path");

function splitNameExt(filename) {
    const ext = path.extname(filename);
    const name = filename.slice(0, ext.length > 0 ? -ext.length : undefined);
    return { name, ext };
}

function parseExtensions(extString) {
    if (!extString) return [];
    return extString
        .split(/[;,]/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => (s.startsWith(".") ? s.toLowerCase() : "." + s.toLowerCase()));
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
        .map((s) => s.trim())
        .filter(Boolean)
        .map((pattern) => {
            const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
            const regexString = "^" + escaped.replace(/\*/g, ".*").replace(/\?/g, ".") + "$";
            return new RegExp(regexString, "i");
        });
}

module.exports = {
    splitNameExt,
    parseExtensions,
    parseInteger,
    buildWildcardRegexes,
};
