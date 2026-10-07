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
) button:focus-visible:not(:disabled) {
    color: #2f2923;
    border-color: #b77f00;
    background: #fff3d5;
    box-shadow: 0 0 0 3px rgba(204, 147, 14, .22), 0 6px 14px rgba(93, 68, 19, .17);
    outline: none;
    transform: translateY(-2px);
}

:is(
    body.bluearchive-qr,
    body.bluearchive-compare,
    body.bluearchive-file-list,
    body.bluearchive-batch-rename,
    body.bluearchive-hierarchy
) button:active:not(:disabled) {
    border-color: #8e6200;
    background: #e9b94f;
    box-shadow: inset 0 2px 5px rgba(71, 49, 0, .2);
    transform: translateY(1px);
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
