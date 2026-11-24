export type ToolingGrouping = "tool" | "article";
/** Group references without merging articles, tool stock or individual operating requirements. */
export function groupToolingLinks(
    links: any[],
    tools: any[],
    articles: any[],
    by: ToolingGrouping,
) {
    const groups = new Map<string, any>();
    for (const link of links) {
        const id = by === "tool" ? link.toolId : link.articleId;
        let group = groups.get(id);
        if (!group) {
            const source = (by === "tool" ? tools : articles).find(
                (row) => row.id === id,
            );
            if (!source) continue;
            group = {
                ...source,
                id,
                code:
                    by === "article"
                        ? source.erpCode || source.code
                        : source.code,
                description: source.description,
                relatedCount: 0,
                status:
                    by === "article"
                        ? source.erpCode
                            ? "Gestionale"
                            : "Temporaneo Access"
                        : source.status,
                links: [],
            };
            groups.set(id, group);
        }
        group.links.push(link);
    }
    for (const group of groups.values())
        group.relatedCount = new Set(
            group.links.map((link: any) =>
                by === "tool" ? link.articleId : link.toolId,
            ),
        ).size;
    return [...groups.values()];
}
export function groupRelatedLinks(links: any[], by: ToolingGrouping) {
    const pairs = new Map<string, any[]>();
    for (const link of links) {
        const key = by === "tool" ? link.articleId : link.toolId;
        pairs.set(key, [...(pairs.get(key) || []), link]);
    }
    return [...pairs].map(([id, links]) => ({ id, links }));
}
