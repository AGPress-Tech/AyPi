function getTypeLabel(value) {
    if (value === "permesso") return "Permesso";
    if (value === "straordinari") return "Straordinari";
    if (value === "mutua") return "Mutua";
    if (value === "speciale") return "Permesso Chiusura Aziendale";
    return "Ferie";
}

module.exports = { getTypeLabel };
