function getTypeLabel(value) {
    if (value === "permesso") return "Permesso";
    if (value === "straordinari") return "Straordinari";
    return "Ferie";
}

module.exports = { getTypeLabel };
