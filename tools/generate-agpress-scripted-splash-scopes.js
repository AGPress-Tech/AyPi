const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const stylesDir = path.join(rootDir, "src", "renderer", "styles", "utilities");
const sources = [
    "ferie-permessi-bluearchive-style.css",
    "product-manager-bluearchive-style.css",
    "ticket-support-bluearchive-style.css",
];
const replacements = [
    ["body.fp-bluearchive", ".agpress-scripted-splash-scope.fp-bluearchive"],
    ["body.bluearchive-purchasing", ".agpress-scripted-splash-scope.bluearchive-purchasing"],
    ["body.bluearchive-ticket-support", ".agpress-scripted-splash-scope.bluearchive-ticket-support"],
];

const splashMarkers = [
    "fp-calendar-splash",
    "fp-ba-boot",
    "ba-purchasing-splash",
    "ts-ba-splash",
];
const themeRoots = new Set([
    "body.fp-bluearchive",
    "body.bluearchive-purchasing",
    "body.bluearchive-ticket-support",
]);

function readTopLevelBlocks(css) {
    const blocks = [];
    let cursor = 0;
    let index = 0;
    let quote = "";
    let inComment = false;

    while (index < css.length) {
        const current = css[index];
        const next = css[index + 1];
        if (inComment) {
            if (current === "*" && next === "/") {
                inComment = false;
                index += 2;
                continue;
            }
            index += 1;
            continue;
        }
        if (!quote && current === "/" && next === "*") {
            inComment = true;
            index += 2;
            continue;
        }
        if (quote) {
            if (current === "\\") index += 2;
            else {
                if (current === quote) quote = "";
                index += 1;
            }
            continue;
        }
        if (current === '"' || current === "'") {
            quote = current;
            index += 1;
            continue;
        }
        if (current !== "{") {
            index += 1;
            continue;
        }

        const open = index;
        let depth = 1;
        index += 1;
        quote = "";
        inComment = false;
        while (index < css.length && depth > 0) {
            const nested = css[index];
            const nestedNext = css[index + 1];
            if (inComment) {
                if (nested === "*" && nestedNext === "/") {
                    inComment = false;
                    index += 2;
                    continue;
                }
                index += 1;
                continue;
            }
            if (!quote && nested === "/" && nestedNext === "*") {
                inComment = true;
                index += 2;
                continue;
            }
            if (quote) {
                if (nested === "\\") index += 2;
                else {
                    if (nested === quote) quote = "";
                    index += 1;
                }
                continue;
            }
            if (nested === '"' || nested === "'") quote = nested;
            else if (nested === "{") depth += 1;
            else if (nested === "}") depth -= 1;
            index += 1;
        }
        blocks.push({
            header: css.slice(cursor, open).trim(),
            body: css.slice(open + 1, index - 1),
        });
        cursor = index;
    }
    return blocks;
}

function isThemeRootRule(header) {
    return header
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .split(",")
        .map((selector) => selector.trim())
        .some((selector) => themeRoots.has(selector));
}

function filterSplashCss(css) {
    return readTopLevelBlocks(css)
        .map(({ header, body }) => {
            if (/^@(media|supports|container|layer)\b/i.test(header)) {
                const nested = filterSplashCss(body);
                return nested ? `${header} {\n${nested}\n}` : "";
            }
            if (
                splashMarkers.some((marker) => header.includes(marker)) ||
                isThemeRootRule(header)
            ) {
                return `${header} {${body}}`;
            }
            return "";
        })
        .filter(Boolean)
        .join("\n\n");
}

const scopedCss = sources.map((fileName) => {
    let css = filterSplashCss(
        fs.readFileSync(path.join(stylesDir, fileName), "utf8"),
    );
    for (const [source, replacement] of replacements) {
        css = css.split(source).join(replacement);
    }
    return `/* Scoped from ${fileName}. */\n${css}`;
}).join("\n\n");

fs.writeFileSync(
    path.join(stylesDir, "agpress-scripted-splash-scopes.css"),
    `/* Generated file. Do not edit directly. */\n${scopedCss}\n`,
    "utf8",
);
