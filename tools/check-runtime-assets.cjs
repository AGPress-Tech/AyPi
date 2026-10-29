// Verify local HTML/CSS references in the built client, including linked partials.
// Guide sidebars and exported report templates use a different runtime base URL.
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..', 'dist-ts');

function walk(folder) {
    return fs.readdirSync(folder, { withFileTypes: true }).flatMap(entry => {
        const file = path.join(folder, entry.name);
        return entry.isDirectory() ? walk(file) : [file];
    });
}

const errors = new Set();
let checked = 0;
for (const folder of ['pages', 'styles']) {
    for (const file of walk(path.join(root, folder)).filter(file => /\.(html|css)$/.test(file))) {
        const text = fs.readFileSync(file, 'utf8');
        const references = /\b(?:src|href)\s*=\s*["']([^"']+)["']|url\(\s*["']?([^)'"\s]+)["']?\s*\)/g;
        for (const match of text.matchAll(references)) {
            const reference = match[1] || match[2];
            if (/^(?:[a-z][a-z\d+.-]*:|#|\/\/)/i.test(reference) || /[{}<>]/.test(reference)) continue;
            const localPath = reference.split(/[?#]/)[0];
            if (!localPath) continue;
            const target = path.resolve(path.dirname(file), decodeURIComponent(localPath));
            checked++;
            if (!fs.existsSync(target)) errors.add(`${path.relative(root, file)} → ${reference}`);
        }
    }
}
if (errors.size) {
    console.error([...errors].join('\n'));
    process.exitCode = 1;
} else {
    console.log(`OK: ${checked} riferimenti locali delle pagine e dei fogli di stile.`);
}
