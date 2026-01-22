const { formatDate, formatDateParts } = require("../utils/date-format");

function createRangeLine(document, request) {
    const line = document.createElement("p");
    line.className = "fp-pending-range";
    if (request.allDay) {
        const startLabel = formatDate(request.start);
        const endLabel = formatDate(request.end || request.start);
        const startStrong = document.createElement("strong");
        startStrong.textContent = startLabel;
        line.appendChild(startStrong);
        if (endLabel && endLabel !== startLabel) {
            line.appendChild(document.createTextNode(" - "));
            const endStrong = document.createElement("strong");
            endStrong.textContent = endLabel;
            line.appendChild(endStrong);
        }
        return line;
    }
    const startParts = formatDateParts(request.start);
    const endParts = formatDateParts(request.end);
    const startDate = document.createElement("strong");
    startDate.textContent = startParts.date;
    line.appendChild(startDate);
    if (startParts.time) {
        line.appendChild(document.createTextNode(` ${startParts.time}`));
    }
    line.appendChild(document.createTextNode(" - "));
    const endDate = document.createElement("strong");
    endDate.textContent = endParts.date;
    line.appendChild(endDate);
    if (endParts.time) {
        line.appendChild(document.createTextNode(` ${endParts.time}`));
    }
    return line;
}

module.exports = { createRangeLine };
