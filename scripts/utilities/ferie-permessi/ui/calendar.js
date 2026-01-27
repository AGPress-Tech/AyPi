const { UI_TEXTS } = require("../utils/ui-texts");

function applyCalendarButtonStyles(document) {
    const root = document.getElementById("fp-calendar");
    if (!root) return;
    const getPalette = () => {
        const isDark = document.body.classList.contains("fp-dark");
        const isAyPi = document.body.classList.contains("fp-aypi");
        return {
            baseBackground: isDark ? "#15181d" : isAyPi ? "#2b2824" : "#ffffff",
            baseBorder: isDark ? "#2b2f36" : isAyPi ? "#4a433d" : "#dadce0",
            baseColor: isDark ? "#8ab4f8" : isAyPi ? "#f3e6d5" : "#1a73e8",
            hoverBackground: isDark ? "#1a1e24" : isAyPi ? "#3a3932" : "#f6f8fe",
            hoverBorder: isDark ? "#2b2f36" : isAyPi ? "#6a5d52" : "#d2e3fc",
            activeBackground: isDark ? "#1f2937" : isAyPi ? "#3a3328" : "#e8f0fe",
            activeBorder: isDark ? "#2b2f36" : isAyPi ? "#6a5d52" : "#d2e3fc",
            baseShadow: isDark ? "none" : isAyPi ? "0 2px 6px rgba(0, 0, 0, 0.45)" : "0 1px 2px rgba(60, 64, 67, 0.15)",
        };
    };
    const buttons = root.querySelectorAll(".fc .fc-button");
    buttons.forEach((btn) => {
        const palette = getPalette();
        btn.style.background = palette.baseBackground;
        btn.style.borderColor = palette.baseBorder;
        btn.style.color = palette.baseColor;
        btn.style.borderRadius = "999px";
        btn.style.padding = "7px 14px";
        btn.style.fontSize = "13px";
        btn.style.fontWeight = "600";
        btn.style.boxShadow = palette.baseShadow;
        btn.style.transition = "background 0.15s ease, border-color 0.15s ease, color 0.15s ease";
        btn.style.opacity = btn.disabled ? "0.5" : "1";

        const setBase = () => {
            if (btn.disabled) {
                btn.style.opacity = "0.5";
                return;
            }
            const current = getPalette();
            btn.style.background = current.baseBackground;
            btn.style.borderColor = current.baseBorder;
            btn.style.color = current.baseColor;
            btn.style.boxShadow = current.baseShadow;
        };

        const setHover = () => {
            if (btn.disabled) return;
            const current = getPalette();
            btn.style.background = current.hoverBackground;
            btn.style.borderColor = current.hoverBorder;
        };

        const setActive = () => {
            if (btn.disabled) return;
            if (btn.classList.contains("fc-button-active")) {
                const current = getPalette();
                btn.style.background = current.activeBackground;
                btn.style.borderColor = current.activeBorder;
                btn.style.boxShadow = "none";
            }
        };

        if (!btn.dataset.fpStyled) {
            btn.addEventListener("mouseenter", () => {
                if (btn.classList.contains("fc-button-active")) return;
                setHover();
            });
            btn.addEventListener("mouseleave", () => {
                if (btn.classList.contains("fc-button-active")) {
                    setActive();
                    return;
                }
                setBase();
            });
            btn.addEventListener("click", () => {
                setTimeout(() => {
                    if (btn.classList.contains("fc-button-active")) {
                        setActive();
                        return;
                    }
                    setBase();
                }, 0);
            });
            btn.dataset.fpStyled = "1";
        }

        if (btn.classList.contains("fc-button-active")) {
            const current = getPalette();
            btn.style.background = current.activeBackground;
            btn.style.borderColor = current.activeBorder;
            btn.style.boxShadow = "none";
        }
    });
}

function applyCalendarListStyles(document) {
    const root = document.getElementById("fp-calendar");
    if (!root) return;
    const isDark = document.body.classList.contains("fp-dark");
    const isAyPi = document.body.classList.contains("fp-aypi");
    if (!isDark && !isAyPi) return;
    const dayBg = isAyPi ? "#f0dfbf" : "#f1f3f4";
    const dayText = "#202124";
    const dayRows = root.querySelectorAll(".fc .fc-list-day");
    dayRows.forEach((row) => {
        row.style.background = dayBg;
        row.style.color = dayText;
        const cells = row.querySelectorAll("th, td");
        cells.forEach((cell) => {
            cell.style.background = dayBg;
            cell.style.color = dayText;
        });
        const texts = row.querySelectorAll(".fc-list-day-text, .fc-list-day-side-text");
        texts.forEach((text) => {
            text.style.color = dayText;
        });
    });
    const cushions = root.querySelectorAll(".fc .fc-list-day-cushion");
    cushions.forEach((item) => {
        item.style.background = dayBg;
        item.style.color = dayText;
    });
}

function applyCalendarListHoverStyles(document) {
    const root = document.getElementById("fp-calendar");
    if (!root) return;
    const isDark = document.body.classList.contains("fp-dark");
    const isAyPi = document.body.classList.contains("fp-aypi");
    const hoverBg = isAyPi ? "#3a3328" : isDark ? "#2a3037" : "#eef2ff";
    const rows = root.querySelectorAll(".fc .fc-list-table tbody tr.fc-list-event");
    rows.forEach((row) => {
        if (row.dataset.fpHoverBound) return;
        row.addEventListener("mouseenter", () => {
            row.querySelectorAll("td").forEach((cell) => {
                cell.style.background = hoverBg;
            });
        });
        row.addEventListener("mouseleave", () => {
            row.querySelectorAll("td").forEach((cell) => {
                cell.style.background = "";
            });
        });
        row.dataset.fpHoverBound = "1";
    });
}

function initCalendar(options) {
    const {
        document,
        FullCalendar,
        onEventSelect,
        getRequestById,
        buildHoverText,
        openPasswordModal,
        getLastNonListViewType,
        setLastNonListViewType,
        getHandlingListRedirect,
        setHandlingListRedirect,
    } = options || {};

    const calendarEl = document.getElementById("fp-calendar");
    if (!calendarEl || !FullCalendar) return null;

    const calendar = new FullCalendar.Calendar(calendarEl, {
        initialView: "dayGridMonth",
        locale: "it",
        height: "100%",
        headerToolbar: {
            left: "prev,next today",
            center: "title",
            right: "dayGridMonth,timeGridWeek,timeGridDay,listWeek",
        },
        buttonText: {
            today: "Oggi",
            month: "Mese",
            week: "Settimana",
            day: "Giorno",
            list: "Lista",
            listWeek: "Lista",
        },
        businessHours: [
            { daysOfWeek: [1, 2, 3, 4, 5], startTime: "08:00", endTime: "12:00" },
            { daysOfWeek: [1, 2, 3, 4, 5], startTime: "13:30", endTime: "17:30" },
        ],
        eventTimeFormat: {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
        },
        dateClick: (info) => {
            const event = info?.jsEvent;
            const target = event?.target;
            if (target && target.closest && !target.closest(".fc-daygrid-day-number")) {
                return;
            }
            if (!event || event.detail !== 2) return;
            calendar.changeView("timeGridDay", info.dateStr);
            setTimeout(() => {
                if (typeof calendar.scrollToTime === "function") {
                    calendar.scrollToTime("08:00");
                }
            }, 0);
        },
        eventClick: (info) => {
            if (info?.event?.extendedProps?.isHoliday || info?.event?.extendedProps?.isClosure) {
                return;
            }
            if (typeof onEventSelect === "function") {
                onEventSelect(info?.event?.id || null);
            }
        },
        eventDidMount: (info) => {
            if (!info || !info.el) return;
            if (info.event?.extendedProps?.isHoliday || info.event?.extendedProps?.isClosure) {
                const name = info.event?.extendedProps?.holidayName || info.event?.extendedProps?.closureName;
                if (name) {
                    info.el.title = name;
                }
                return;
            }
            if (typeof getRequestById === "function") {
                const request = getRequestById(info.event?.id);
                if (request) {
                    info.el.title = buildHoverText(request);
                }
            }
            info.el.addEventListener("dblclick", () => {
                const requestId = info.event?.id;
                if (!requestId) return;
                if (typeof openPasswordModal === "function") {
                    openPasswordModal({
                        type: "edit",
                        id: requestId,
                        title: "Modifica richiesta",
                        description: UI_TEXTS.requestEditPasswordDescription,
                    });
                }
            });
        },
        datesSet: (info) => {
            const viewType = info?.view?.type || "";
            const isList = viewType === "listWeek" || viewType === "listMonth";
            if (!isList) {
                if (typeof setLastNonListViewType === "function") {
                    setLastNonListViewType(viewType);
                }
                applyCalendarButtonStyles(document);
                applyCalendarListStyles(document);
                applyCalendarListHoverStyles(document);
                return;
            }
            if (typeof getHandlingListRedirect === "function" && getHandlingListRedirect()) {
                if (typeof setHandlingListRedirect === "function") {
                    setHandlingListRedirect(false);
                }
                applyCalendarButtonStyles(document);
                applyCalendarListStyles(document);
                applyCalendarListHoverStyles(document);
                return;
            }
            if (
                viewType === "listWeek" &&
                typeof getLastNonListViewType === "function" &&
                getLastNonListViewType() === "dayGridMonth"
            ) {
                if (typeof setHandlingListRedirect === "function") {
                    setHandlingListRedirect(true);
                }
                calendar.changeView("listMonth");
                applyCalendarButtonStyles(document);
                applyCalendarListStyles(document);
                applyCalendarListHoverStyles(document);
            }
            setTimeout(() => {
                applyCalendarListStyles(document);
                applyCalendarListHoverStyles(document);
            }, 0);
        },
    });
    calendar.render();
    applyCalendarButtonStyles(document);
    applyCalendarListStyles(document);
    applyCalendarListHoverStyles(document);
    return calendar;
}

module.exports = {
    applyCalendarButtonStyles,
    applyCalendarListStyles,
    applyCalendarListHoverStyles,
    initCalendar,
};
