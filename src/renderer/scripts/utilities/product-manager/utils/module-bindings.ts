type ModuleBindingGroup = [
    namespace: string,
    bindings: Record<string, unknown>,
];

export function validateModuleBindings(groups: ModuleBindingGroup[]) {
    groups.forEach(([namespace, bindings]) => {
        Object.entries(bindings).forEach(([name, value]) => {
            if (typeof value !== "function") {
                throw new Error(
                    `Modulo mancante o non valido: ${namespace}.${name}`,
                );
            }
        });
    });
}
