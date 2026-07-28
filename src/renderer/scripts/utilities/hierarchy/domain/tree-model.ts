import path from "path";

export type HierarchyTreeNode = {
    type: "folder" | "file" | string;
    name: string;
    fullPath?: string;
    size?: number;
    mtimeMs?: number;
    children?: HierarchyTreeNode[];
    [key: string]: unknown;
};

export type HierarchyScanOptions = {
    maxDepth?: unknown;
    excludeExtensions?: unknown;
    excludeFolders?: unknown;
    excludeFiles?: unknown;
};

export function formatBytes(bytes: number) {
    if (!bytes || bytes <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let unitIndex = 0;
    let value = bytes;
    while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024;
        unitIndex += 1;
    }
    return `${value.toFixed(2)} ${units[unitIndex]}`;
}

export function cloneTree<T>(node: T): T | null {
    if (!node) return null;
    return JSON.parse(JSON.stringify(node)) as T;
}

export function normalizeScanOptions(options: HierarchyScanOptions = {}) {
    const rawDepth = Number(options.maxDepth);
    const maxDepth =
        Number.isFinite(rawDepth) && rawDepth > 0 ? rawDepth : null;
    const normalizeExtension = (value: unknown) =>
        String(value || "")
            .toLowerCase()
            .replace(/^\./, "")
            .trim();
    const normalizeName = (value: unknown) =>
        String(value || "").toLowerCase().trim();

    return {
        maxDepth,
        excludeExtensions: Array.isArray(options.excludeExtensions)
            ? options.excludeExtensions
                  .map(normalizeExtension)
                  .filter(Boolean)
            : [],
        excludeFolders: Array.isArray(options.excludeFolders)
            ? options.excludeFolders.map(normalizeName).filter(Boolean)
            : [],
        excludeFiles: Array.isArray(options.excludeFiles)
            ? options.excludeFiles.map(normalizeName).filter(Boolean)
            : [],
    };
}

export function buildFilteredTreeFromOptions(
    sourceRoot: HierarchyTreeNode | null,
    options: HierarchyScanOptions = {},
) {
    if (!sourceRoot) return null;

    const {
        maxDepth,
        excludeExtensions,
        excludeFolders,
        excludeFiles,
    } = normalizeScanOptions(options);
    const extensionSet = new Set(excludeExtensions);
    const folderSet = new Set(excludeFolders);
    const fileSet = new Set(excludeFiles);
    const normalizeName = (value: unknown) =>
        String(value || "").toLowerCase().trim();

    const isExcludedFolder = (name: string, depth: number) => {
        if (depth === 0) return false;
        const normalized = normalizeName(name);
        return Array.from(folderSet).some(
            (pattern) => pattern && normalized.includes(pattern),
        );
    };
    const isExcludedFile = (name: string) => {
        const normalized = normalizeName(name);
        if (
            Array.from(fileSet).some(
                (pattern) => pattern && normalized.includes(pattern),
            )
        ) {
            return true;
        }
        const extension = (path.extname(normalized) || "").replace(
            /^\./,
            "",
        );
        return !!extension && extensionSet.has(extension);
    };

    const cloneAndFilter = (
        node: HierarchyTreeNode,
        depth: number,
    ): HierarchyTreeNode | null => {
        if (node.type === "file") {
            return isExcludedFile(node.name) ? null : { ...node };
        }
        if (node.type !== "folder" || isExcludedFolder(node.name, depth)) {
            return null;
        }

        const cloned: HierarchyTreeNode = { ...node, children: [] };
        const nextDepth = depth + 1;
        for (const child of node.children || []) {
            if (maxDepth !== null && nextDepth > maxDepth) continue;
            const filteredChild = cloneAndFilter(child, nextDepth);
            if (filteredChild) cloned.children!.push(filteredChild);
        }
        if (depth > 0 && !cloned.children!.length) return null;
        return cloned;
    };

    return (
        cloneAndFilter(sourceRoot, 0) || {
            ...sourceRoot,
            children: [],
        }
    );
}

export function collectSubtreeRows(
    node: HierarchyTreeNode | null,
    basePath: string,
    rows: Array<Record<string, unknown>> = [],
) {
    if (!node) return rows;
    if (node.type === "folder") {
        for (const child of node.children || []) {
            collectSubtreeRows(child, basePath, rows);
        }
        return rows;
    }
    if (node.type !== "file") return rows;

    const relativePath =
        basePath && node.fullPath
            ? path.relative(basePath, node.fullPath)
            : node.fullPath || node.name;
    rows.push({
        Nome: node.name,
        Tipo: "File",
        "Percorso relativo": relativePath || "",
        "Percorso completo": node.fullPath || "",
        Dimensione: node.size ?? "",
        "Dimensione (formattata)": node.size
            ? formatBytes(node.size)
            : "",
        "Ultima modifica": node.mtimeMs
            ? new Date(node.mtimeMs).toLocaleString()
            : "",
    });
    return rows;
}

export function getSortedChildren(node: HierarchyTreeNode | null) {
    if (!node?.children) return [];
    return [...node.children].sort((left, right) => {
        if (left.type !== right.type) {
            return left.type === "folder" ? -1 : 1;
        }
        return left.name.localeCompare(right.name);
    });
}
