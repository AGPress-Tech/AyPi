function getTypeLabel(value) {
    if (value === "permesso") return "Permesso";
    if (value === "straordinari") return "Straordinari";
    if (value === "mutua") return "Mutua";
    if (value === "speciale") return "Speciale";
    return "Ferie";
}

module.exports = { getTypeLabel };
