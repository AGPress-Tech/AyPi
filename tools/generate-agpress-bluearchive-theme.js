const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const sourcePath = path.join(rootDir, "src", "renderer", "styles", "bluearchive-preview.css");
const destinationPath = path.join(rootDir, "src", "renderer", "styles", "agpress-bluearchive.css");

function rgbToHsl(red, green, blue) {
    const r = red / 255;
    const g = green / 255;
    const b = blue / 255;
    const maximum = Math.max(r, g, b);
    const minimum = Math.min(r, g, b);
    const lightness = (maximum + minimum) / 2;
    const delta = maximum - minimum;
    if (delta === 0) return { hue: 0, saturation: 0, lightness };
    const saturation = delta / (1 - Math.abs(2 * lightness - 1));
    let hue;
    if (maximum === r) hue = 60 * (((g - b) / delta) % 6);
    else if (maximum === g) hue = 60 * ((b - r) / delta + 2);
    else hue = 60 * ((r - g) / delta + 4);
    if (hue < 0) hue += 360;
    return { hue, saturation, lightness };
}

function hslToRgb(hue, saturation, lightness) {
    const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
    const segment = hue / 60;
    const x = chroma * (1 - Math.abs((segment % 2) - 1));
    let r = 0;
    let g = 0;
    let b = 0;
    if (segment < 1) [r, g] = [chroma, x];
    else if (segment < 2) [r, g] = [x, chroma];
    else if (segment < 3) [g, b] = [chroma, x];
    else if (segment < 4) [g, b] = [x, chroma];
    else if (segment < 5) [r, b] = [x, chroma];
    else [r, b] = [chroma, x];
    const match = lightness - chroma / 2;
    return [r, g, b].map((value) => Math.round((value + match) * 255));
}

function recolor(red, green, blue) {
    const exactPalette = new Map([
        ["23,36,61", [51, 47, 43]],
        ["32,41,54", [43, 40, 36]],
        ["22,137,237", [204, 147, 14]],
        ["38,191,243", [228, 171, 50]],
        ["239,249,255", [255, 248, 232]],
    ]);
    const exactMatch = exactPalette.get(`${red},${green},${blue}`);
    if (exactMatch) return exactMatch;

    const { hue, saturation, lightness } = rgbToHsl(red, green, blue);
    if (hue < 175 || hue > 245 || saturation < 0.12) return [red, green, blue];
    if (lightness < 0.28) {
        return hslToRgb(32, Math.min(0.18, saturation * 0.3), lightness * 1.03);
    }
    const amberLightness = Math.max(0.34, Math.min(0.92, lightness * 0.94));
    return hslToRgb(41, Math.min(0.88, saturation * 0.92), amberLightness);
}

function toHex(value) {
    return Math.max(0, Math.min(255, value)).toString(16).padStart(2, "0");
}

function transformHex(match, value) {
    const expanded = value.length === 3
        ? value.split("").map((character) => character + character).join("")
        : value;
    const [red, green, blue] = [0, 2, 4].map((offset) =>
        Number.parseInt(expanded.slice(offset, offset + 2), 16),
    );
    const transformed = recolor(red, green, blue);
    if (transformed[0] === red && transformed[1] === green && transformed[2] === blue) return match;
    return `#${transformed.map(toHex).join("")}`;
}

function transformRgb(match, redValue, greenValue, blueValue, alphaValue) {
    const red = Number(redValue);
    const green = Number(greenValue);
    const blue = Number(blueValue);
    const transformed = recolor(red, green, blue);
    if (transformed[0] === red && transformed[1] === green && transformed[2] === blue) return match;
    const suffix = alphaValue === undefined ? "" : `, ${alphaValue}`;
    return `${alphaValue === undefined ? "rgb" : "rgba"}(${transformed.join(", ")}${suffix})`;
}

function transformCss(source) {
    let output = source.replace(
        /#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-fA-F])/g,
        transformHex,
    );
    output = output.replace(
        /rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*([\d.]+))?\s*\)/g,
        transformRgb,
    );
    return output;
}

let css = transformCss(fs.readFileSync(sourcePath, "utf8"));
css += `

/* AGPress excludes the Blue Archive identity and pointer effects. */
.assistant,
.cursor-aura,
.click-layer,
.startup-personal-greeting,
.name-backdrop {
    display: none !important;
}

/* Keep controls legible on charcoal cards without changing their geometry. */
.module-card.navy .card-icon,
.module-card.navy .card-arrow {
    --card-accent: #ffffff;
}
`;
css = `/* Generated from bluearchive-preview.css. Do not edit directly. */\n${css}`;
fs.writeFileSync(destinationPath, css, "utf8");

module.exports = { transformCss };
