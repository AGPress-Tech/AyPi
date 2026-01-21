const fs = require("fs");
const path = require("path");

function ensureFolderFor(targetPath) {
    const dir = path.dirname(targetPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

module.exports = { ensureFolderFor };
