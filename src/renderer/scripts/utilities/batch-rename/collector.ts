// @ts-nocheck
require("../../shared/dev-guards");
import fs from "fs";
import path from "path";
import { applyFiltersToItem } from "./filters";
import { mapWithConcurrency } from "../../shared/async-pool";

async function collectTargets(rootPath, options) {
    const results = [];
    const { includeSubfolders, extFilterList, scope, filterConfig } = options;

    async function walk(currentPath) {
        let entries;
        try {
            entries = await fs.promises.readdir(currentPath, {
                withFileTypes: true,
            });
        } catch (err) {
            console.error("Impossibile leggere la cartella:", currentPath, err);
            return;
        }

        const directories = [];
        await mapWithConcurrency(entries, 24, async (entry) => {
            const fullPath = path.join(currentPath, entry.name);
            const isDir = entry.isDirectory();
            const isFile = entry.isFile();

            if (isDir && includeSubfolders) directories.push(fullPath);

            const ext = path.extname(entry.name).toLowerCase();
            const dir = path.dirname(fullPath);

            const inScope =
                (scope === "files" && isFile) ||
                (scope === "folders" && isDir) ||
                (scope === "both" && (isFile || isDir));

            if (!inScope) return;

            if (isFile && extFilterList && extFilterList.length > 0) {
                if (!extFilterList.includes(ext)) return;
            }

            let stats = null;
            try {
                stats = await fs.promises.stat(fullPath);
            } catch (err) {
                console.error(
                    "Impossibile leggere gli attributi di:",
                    fullPath,
                    err,
                );
                return;
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
                return;
            }

            results.push(item);
        });
        for (const directory of directories) {
            await walk(directory);
        }
    }

    await walk(rootPath);
    return results;
}

export { collectTargets };
