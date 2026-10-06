const fs = require("fs");
const path = require("path");
const { transformCss } = require("./generate-agpress-bluearchive-theme");

const rootDir = path.resolve(__dirname, "..");
const stylesDir = path.join(rootDir, "src", "renderer", "styles", "utilities");
const files = [
    "file-list-bluearchive-style.css",
    "batch-rename-bluearchive-style.css",
    "qr-generator-bluearchive-style.css",
    "compare-folders-bluearchive-style.css",
    "hierarchy-bluearchive-style.css",
    "bluearchive-design-system.css",
];

for (const fileName of files) {
    const sourcePath = path.join(stylesDir, fileName);
    const destinationName = fileName.replace("bluearchive", "agpress");
    const source = fs.readFileSync(sourcePath, "utf8");
    const contrastOverrides = fileName === "bluearchive-design-system.css"
        ? `
/* Contrasto testo pulsanti per la palette AGPress chiara. */
:is(
    body.bluearchive-qr,
    body.bluearchive-compare,
    body.bluearchive-file-list,
    body.bluearchive-batch-rename,
    body.bluearchive-hierarchy
) {
    --ba-ui-control-ink: #493d2f;
    --ba-ui-control-ink-hover: #2f2923;
}

:is(
    body.bluearchive-qr,
    body.bluearchive-compare,
    body.bluearchive-file-list,
    body.bluearchive-batch-rename,
    body.bluearchive-hierarchy
) button:not(:disabled) {
    color: #493d2f;
}

:is(
    body.bluearchive-qr,
    body.bluearchive-compare,
    body.bluearchive-file-list,
    body.bluearchive-batch-rename,
    body.bluearchive-hierarchy
) button:hover:not(:disabled) {
    color: #2f2923;
}

:is(
    body.bluearchive-qr,
    body.bluearchive-compare,
    body.bluearchive-file-list,
    body.bluearchive-batch-rename,
    body.bluearchive-hierarchy
) button:disabled {
    color: #665743;
    opacity: .68;
}
`
        : "";
    const output = [
        `/* Generated from ${fileName}. Do not edit directly. */`,
        transformCss(source),
        contrastOverrides,
        "",
    ].join("\n");
    fs.writeFileSync(path.join(stylesDir, destinationName), output, "utf8");
}
