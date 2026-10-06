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

const scopedCss = sources.map((fileName) => {
    let css = fs.readFileSync(path.join(stylesDir, fileName), "utf8");
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
