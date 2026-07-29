const matcherCache = new Map<string, RegExp>();
const MAX_CACHE_SIZE = 64;

function escapeRegex(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compileCharacterClass(content: string) {
    let body = content;
    let negated = false;
    if (body.startsWith("^")) {
        negated = true;
        body = body.slice(1);
    }
    if (!body) return null;

    const escaped = [...body]
        .map((character, index, characters) => {
            if (character === "\\") return "\\\\";
            if (character === "]" || character === "[") {
                return `\\${character}`;
            }
            if (character === "^") return "\\^";
            if (
                character === "-" &&
                (index === 0 || index === characters.length - 1)
            ) {
                return "\\-";
            }
            return character;
        })
        .join("");
    const source = `[${negated ? "^" : ""}${escaped}]`;
    try {
        new RegExp(source);
        return source;
    } catch {
        return null;
    }
}

function compileSqlWildcard(pattern: string) {
    let source = "^";
    let explicitEnd = false;
    for (let index = 0; index < pattern.length; index += 1) {
        const character = pattern[index];
        if (character === "|") {
            explicitEnd = true;
            break;
        }
        if (character === "%") {
            source += ".*";
            continue;
        }
        if (character === "_") {
            source += ".";
            continue;
        }
        if (character === "{") {
            const closingIndex = pattern.indexOf("}", index + 1);
            if (closingIndex > index + 1) {
                source += escapeRegex(
                    pattern.slice(index + 1, closingIndex),
                );
                index = closingIndex;
                continue;
            }
        }
        if (character === "[") {
            const closingIndex = pattern.indexOf("]", index + 1);
            if (closingIndex > index + 1) {
                const characterClass = compileCharacterClass(
                    pattern.slice(index + 1, closingIndex),
                );
                if (characterClass) {
                    source += characterClass;
                    index = closingIndex;
                    continue;
                }
            }
        }
        source += escapeRegex(character);
    }
    if (!explicitEnd && !source.endsWith(".*")) {
        source += ".*";
    }
    source += "$";

    try {
        return new RegExp(source, "i");
    } catch {
        return new RegExp(`^${escapeRegex(pattern)}$`, "i");
    }
}

function matchesArticleWildcard(value: string, pattern: string) {
    let matcher = matcherCache.get(pattern);
    if (!matcher) {
        matcher = compileSqlWildcard(pattern);
        if (matcherCache.size >= MAX_CACHE_SIZE) matcherCache.clear();
        matcherCache.set(pattern, matcher);
    }
    return matcher.test(value);
}

export { compileSqlWildcard, matchesArticleWildcard };
