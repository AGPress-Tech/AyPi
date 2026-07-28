import fs from "fs";
import path from "path";

export type HierarchyScanProgress = {
    totalFiles: number;
    totalDirs: number;
};

export type HierarchyScanEntry =
    | {
          kind: "folder";
          fullPath: string;
          relPath: string;
      }
    | {
          kind: "file";
          fullPath: string;
          relPath: string;
          size: number;
          mtimeMs: number;
      };

export async function scanFolderRecursively(
    rootFolder: string,
    onProgress?: (progress: HierarchyScanProgress) => void,
) {
    const entries: HierarchyScanEntry[] = [];
    let totalFiles = 0;
    let totalDirs = 0;
    let processed = 0;
    const progressEvery = 200;

    const emitProgress = (force: boolean) => {
        if (!onProgress) return;
        if (!force && processed % progressEvery !== 0) return;
        onProgress({ totalFiles, totalDirs });
    };

    const walk = async (currentPath: string): Promise<void> => {
        let directoryEntries: fs.Dirent[];
        try {
            directoryEntries = await fs.promises.readdir(currentPath, {
                withFileTypes: true,
            });
        } catch (error) {
            console.error(
                "Errore lettura cartella:",
                currentPath,
                error,
            );
            return;
        }

        entries.push({
            kind: "folder",
            fullPath: currentPath,
            relPath: path.relative(rootFolder, currentPath) || "",
        });
        totalDirs += 1;
        processed += 1;
        emitProgress(false);

        for (const entry of directoryEntries) {
            const fullPath = path.join(currentPath, entry.name);
            let stats: fs.Stats;
            try {
                stats = await fs.promises.stat(fullPath);
            } catch (error) {
                console.error(
                    "Errore stat elemento:",
                    fullPath,
                    error,
                );
                continue;
            }

            if (stats.isDirectory()) {
                await walk(fullPath);
            } else if (stats.isFile()) {
                entries.push({
                    kind: "file",
                    fullPath,
                    relPath: path
                        .relative(rootFolder, fullPath)
                        .replace(/\\/g, "/"),
                    size: stats.size,
                    mtimeMs: stats.mtimeMs,
                });
                totalFiles += 1;
                processed += 1;
                emitProgress(false);
            }
        }
    };

    await walk(rootFolder);
    emitProgress(true);
    return entries;
}
