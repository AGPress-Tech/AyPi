// @ts-nocheck
require("../../shared/dev-guards");
import fs from "fs";
import path from "path";
import { applyFiltersToItem } from "./filters";

function collectTargets(rootPath, options) {
    const results = [];
    const { includeSubfolders, extFilterList, scope, filterConfig } = options;

    function walk(currentPath) {
        let entries;
        try {
            entries = fs.readdirSync(currentPath, { withFileTypes: true });
        } catch (err) {
            console.error("Impossibile leggere la cartella:", currentPath, err);
            return;
        }

        for (const entry of entries) {
            const fullPath = path.join(currentPath, entry.name);
            const isDir = entry.isDirectory();
            const isFile = entry.isFile();

            if (isDir && includeSubfolders) {
                walk(fullPath);
            }

            const ext = path.extname(entry.name).toLowerCase();
            const dir = path.dirname(fullPath);

            const inScope =
                (scope === "files" && isFile) ||
                (scope === "folders" && isDir) ||
                (scope === "both" && (isFile || isDir));

            if (!inScope) continue;

            if (isFile && extFilterList && extFilterList.length > 0) {
                if (!extFilterList.includes(ext)) continue;
            }

            let stats = null;
            try {
                stats = fs.statSync(fullPath);
            } catch (err) {
                console.error(
                    "Impossibile leggere gli attributi di:",
                    fullPath,
                    err,
                );
                continue;
            }

            const item = {
                fullPath,
                dir,
                name: entry.name,
                ext,
                isDirectory: isDir,
                isFile,
                stats,
            };

            if (!applyFiltersToItem(item, filterConfig)) {
                continue;
            }

            results.push(item);
        }
    }

    walk(rootPath);
    return results;
}

export { collectTargets };


