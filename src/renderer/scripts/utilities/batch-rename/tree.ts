// @ts-nocheck
require("../../shared/dev-guards");
import path from "path";
import fs from "fs";
import { state } from "./state";
import { updateSelectedFolderLabel } from "./ui/status";
import { mapWithConcurrency } from "../../shared/async-pool";

async function buildFolderTreeData(rootPath) {
    const rootNameRaw = rootPath.replace(/[\\/]+$/, "");
    const rootName = path.basename(rootNameRaw) || rootPath;

    async function walkDir(currentPath) {
        let entries;
        try {
            entries = await fs.promises.readdir(currentPath, {
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

        return mapWithConcurrency(dirs, 12, async (dirEntry) => {
            const full = path.join(currentPath, dirEntry.name);
            return {
                id: full,
                text: dirEntry.name,
                children: await walkDir(full),
            };
        });
    }

    return [
        {
            id: rootPath,
            text: rootName,
            state: { opened: true, selected: true },
            children: await walkDir(rootPath),
        },
    ];
}

async function refreshFolderTree() {
    const treeElement = document.getElementById("folderTree");
    if (!treeElement || typeof window === "undefined") return;
    treeElement.replaceChildren();
    if (!state.rootFolder) {
        return;
    }

    const data = await buildFolderTreeData(state.rootFolder);
    const renderBranch = (nodes, depth = 0) => {
        const list = document.createElement("ul");
        list.className = "folder-tree-native__list";
        list.setAttribute("role", depth ? "group" : "tree");
        nodes.forEach((node) => {
            const item = document.createElement("li");
            item.className = "folder-tree-native__item";
            item.setAttribute("role", "treeitem");
            item.setAttribute("aria-level", String(depth + 1));

            const row = document.createElement("div");
            row.className = "folder-tree-native__row";
            row.style.setProperty("--folder-depth", String(depth));

            const children = Array.isArray(node.children) ? node.children : [];
            const branch = children.length ? renderBranch(children, depth + 1) : null;
            const toggle = document.createElement("button");
            toggle.type = "button";
            toggle.className = "folder-tree-native__toggle";
            toggle.disabled = !branch;
            toggle.textContent = branch ? "▾" : "";
            toggle.setAttribute("aria-label", branch ? `Comprimi ${node.text}` : "");

            const select = document.createElement("button");
            select.type = "button";
            select.className = "folder-tree-native__select";
            select.textContent = node.text;
            select.title = node.id;
            select.classList.toggle("is-selected", node.id === state.rootFolder);
            select.addEventListener("click", () => {
                state.rootFolder = node.id;
                treeElement
                    .querySelectorAll(".folder-tree-native__select")
                    .forEach((button) =>
                        button.classList.toggle("is-selected", button === select),
                    );
                updateSelectedFolderLabel();
            });

            if (branch) {
                item.setAttribute("aria-expanded", "true");
                toggle.addEventListener("click", () => {
                    const expanded = item.getAttribute("aria-expanded") !== "false";
                    item.setAttribute("aria-expanded", String(!expanded));
                    branch.hidden = expanded;
                    toggle.textContent = expanded ? "▸" : "▾";
                    toggle.setAttribute(
                        "aria-label",
                        `${expanded ? "Espandi" : "Comprimi"} ${node.text}`,
                    );
                });
            }
            row.append(toggle, select);
            item.appendChild(row);
            if (branch) item.appendChild(branch);
            list.appendChild(item);
        });
        return list;
    };

    treeElement.appendChild(renderBranch(data));
}

export { buildFolderTreeData, refreshFolderTree };
