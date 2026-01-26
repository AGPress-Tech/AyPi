function getTypeLabel(value) {
    if (value === "permesso") return "Permesso";
    if (value === "straordinari") return "Straordinari";
    if (value === "mutua") return "Mutua";
    return "Ferie";
}

module.exports = { getTypeLabel };
