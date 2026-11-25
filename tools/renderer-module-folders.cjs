const fs = require("node:fs");
const path = require("node:path");

// Colocated modules have their own page. Flat shared TS helpers are not entries.
function rendererModuleFolders(rendererRoot) {
    const root = path.join(rendererRoot, "modules");
    return fs.readdirSync(root, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => path.join(root, entry.name))
        .filter(folder => fs.readdirSync(folder).some(name => name.endsWith(".html")));
}

module.exports = { rendererModuleFolders };
