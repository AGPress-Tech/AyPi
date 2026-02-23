// @ts-nocheck
require("../../shared/dev-guards");
import path from "path";
import { state } from "./state";
import { updateSelectedFolderLabel } from "./ui/status";

function buildFolderTreeData(rootPath) {
    const rootNameRaw = rootPath.replace(/[\\/]+$/, "");
    const rootName = path.basename(rootNameRaw) || rootPath;

    function walkDir(currentPath) {
        let entries;
        try {
            entries = require("fs").readdirSync(currentPath, {
                withFileTypes: true,
            });
        } catch (err) {
            console.error(
                "Impossibile leggere la cartella per l'albero:",
                currentPath,
                err,
            );
            return [];
        }

        const dirs = entries.filter((e) => e.isDirectory());
        dirs.sort((a, b) =>
            a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
        );

        return dirs.map((dirEntry) => {
            const full = path.join(currentPath, dirEntry.name);
            return {
                id: full,
                text: dirEntry.name,
                children: walkDir(full),
            };
        });
    }

    return [
        {
            id: rootPath,
            text: rootName,
            state: { opened: true, selected: true },
            children: walkDir(rootPath),
        },
    ];
}

function refreshFolderTree() {
    const treeElement = document.getElementById("folderTree");
    if (!treeElement || typeof window === "undefined") return;

    const $ = window.jQuery || window.$;
    if (!$ || !$.fn || !$.fn.jstree) {
        return;
    }

    const $tree = $(treeElement);

    if (!state.rootFolder) {
        try {
            $tree.jstree("destroy").empty();
        } catch (err) {
            // ignore
        }
        return;
    }

    const data = buildFolderTreeData(state.rootFolder);

    try {
        $tree.jstree("destroy").empty();
    } catch (err) {
        // ignore
    }

    $tree.jstree({
        core: {
            data,
            themes: {
                stripes: true,
            },
        },
    });

    $tree.off("changed.jstree").on("changed.jstree", (e, dataEvent) => {
        const selected = dataEvent.selected && dataEvent.selected[0];
        if (!selected) return;
        state.rootFolder = selected;
        updateSelectedFolderLabel();
    });
}

export {
    buildFolderTreeData,
    refreshFolderTree,
};


