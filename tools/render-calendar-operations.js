const { app, BrowserWindow, ipcMain } = require("electron");
const fs = require("fs");
const http = require("http");
const path = require("path");

const departments = {
    "Back Office": ["Elisa Caldi", "Lorenzo Perovani Vicari", "Marco Riva"],
    Magazzino: ["Paola Giacobini", "Cristina Dell'Oro", "Davide Sala"],
    Stampaggio: ["Antonio Scaramozza", "Antonello Cocco", "Marco Cerutti"],
    Torneria: ["Federico Grosso", "Giuseppe Bonina", "Avdulla Llausha"],
    Tranceria: ["Emanuele Romanini", "Raffaele Primatesta", "Ba Bame"],
    "Ufficio Tecnico": ["Andrea Lucchini", "Alessio Passerini", "Diego Vittoni"],
};
const emails = Object.fromEntries(
    Object.entries(departments).flatMap(([department, names]) =>
        names.map(name => [
            `${department}|${name}`,
            `${name.toLowerCase().replaceAll(" ", ".")}@agpress-srl.it`,
        ])
    )
);
const balances = Object.fromEntries(
    Object.entries(departments).flatMap(([department, names]) =>
        names.map((name, index) => [
            `${department}|${name}`,
            {
                hours: 24 + index * 8,
                monthlyCredit: 8,
                lastCreditMonth: "2026-07",
            },
        ])
    )
);
const payload = {
    requests: [],
    balances,
    holidays: [
        { date: "2026-08-15", name: "Ferragosto" },
        { date: "2026-12-08", name: "Immacolata" },
        { date: "2026-12-25", name: "Natale" },
    ],
    closures: [
        {
            start: "2026-08-10",
            end: "2026-08-21",
            name: "Chiusura estiva",
        },
        {
            start: "2026-12-24",
            end: "2027-01-06",
            name: "Chiusura natalizia",
        },
    ],
};
const admins = [
    {
        name: "Mario Rossi",
        email: "mario.rossi@agpress-srl.it",
        accessCalendar: true,
        accessPurchasing: true,
    },
    {
        name: "Laura Bianchi",
        email: "laura.bianchi@agpress-srl.it",
        accessCalendar: true,
        accessPurchasing: false,
    },
];

const server = http.createServer((request, response) => {
    response.setHeader("Content-Type", "application/json");
    if (request.url?.startsWith("/api/shared/assignees")) {
        response.end(JSON.stringify({ groups: departments, emails }));
        return;
    }
    if (request.url?.startsWith("/api/shared/admins")) {
        response.end(JSON.stringify({ admins }));
        return;
    }
    if (request.url?.startsWith("/api/ferie-permessi")) {
        response.end(JSON.stringify(payload));
        return;
    }
    response.end(JSON.stringify({}));
});

ipcMain.handle("show-message-box", async () => ({ response: 0 }));
ipcMain.handle("save-file-dialog", async () => ({ canceled: true }));
ipcMain.on("close-assignees-manager-window", () => {});
ipcMain.on("close-admin-manager-window", () => {});
ipcMain.on("close-ferie-permessi-hours-window", () => {});

async function load(window, file) {
    await window.loadFile(
        path.join(
            __dirname,
            "..",
            "dist-ts",
            "pages",
            "utilities",
            file
        ),
        {
            query: { theme: "bluearchive", fpSplash: "0" },
        }
    );
    await new Promise(resolve => setTimeout(resolve, 900));
}

async function capture(window, outputDirectory, name) {
    await new Promise(resolve => setTimeout(resolve, 280));
    const image = await window.webContents.capturePage();
    fs.writeFileSync(path.join(outputDirectory, `${name}.png`), image.toPNG());
}

app.whenReady()
    .then(async () => {
        await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
        const { port } = server.address();
        ipcMain.on("fp-get-backend-base-url", event => {
            event.returnValue = `http://127.0.0.1:${port}/api/ferie-permessi`;
        });

        const outputDirectory = path.join(
            __dirname,
            "..",
            ".tmp-calendar-operations"
        );
        fs.mkdirSync(outputDirectory, { recursive: true });

        const window = new BrowserWindow({
            show: false,
            width: 1500,
            height: 900,
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false,
            },
        });
        const checks = [];

        await load(window, "assignees-manager.html");
        checks.push(
            await window.webContents.executeJavaScript(`(() => {
                const card = document.querySelector(".am-card");
                const sections = [...card.querySelectorAll(":scope > .fp-assignees-section")];
                const rows = [...document.querySelectorAll(".fp-assignees-row")];
                return (
                    card.getBoundingClientRect().width > 1200 &&
                    sections.length === 2 &&
                    new Set(sections.map(section => Math.round(section.getBoundingClientRect().top))).size === 1 &&
                    rows.length >= 10 &&
                    rows.every(row => row.getBoundingClientRect().height >= 40)
                );
            })()`)
        );
        await capture(window, outputDirectory, "assignees");

        await load(window, "ferie-permessi-hours.html");
        checks.push(
            await window.webContents.executeJavaScript(`(() => {
                const card = document.querySelector(".fp-hours-card");
                const rows = [...document.querySelectorAll(".fp-hours-table tbody tr")];
                return (
                    card.getBoundingClientRect().height > 600 &&
                    getComputedStyle(card).overflowY === "auto" &&
                    rows.length >= 10 &&
                    rows.every(row => row.getBoundingClientRect().height >= 50)
                );
            })()`)
        );
        await capture(window, outputDirectory, "hours");

        await load(window, "admin-manager.html");
        checks.push(
            await window.webContents.executeJavaScript(`(() => {
                const modal = document.getElementById("fp-admin-modal");
                const card = modal?.querySelector(".fp-modal__card");
                const subtitle = card?.querySelector(".fp-assignees-subtitle");
                const list = card?.querySelector(".fp-admin-list");
                return (
                    getComputedStyle(card).opacity === "1" &&
                    card.getBoundingClientRect().height > 600 &&
                    list.children.length >= 2 &&
                    list.getBoundingClientRect().top - subtitle.getBoundingClientRect().bottom < 20
                );
            })()`)
        );
        await capture(window, outputDirectory, "admins");

        await load(window, "ferie-permessi.html");
        await window.webContents.executeJavaScript(`(() => {
            document.querySelectorAll(".fp-modal").forEach(modal => {
                modal.classList.add("is-hidden");
                modal.setAttribute("aria-hidden", "true");
            });
            const modal = document.getElementById("fp-edit-modal");
            modal.classList.remove("is-hidden");
            modal.setAttribute("aria-hidden", "false");
            const values = {
                "fp-edit-start-date": "2026-07-27",
                "fp-edit-end-date": "2026-07-31",
                "fp-edit-start-time": "08:00",
                "fp-edit-end-time": "17:30",
                "fp-edit-note": "Richiesta ferie pianificata per chiusura reparto."
            };
            Object.entries(values).forEach(([id, value]) => {
                const input = document.getElementById(id);
                if (input) input.value = value;
            });
        })()`);
        checks.push(
            await window.webContents.executeJavaScript(`(() => {
                const card = document.querySelector("#fp-edit-modal > .fp-modal__card");
                const form = document.getElementById("fp-edit-form");
                return (
                    getComputedStyle(card).opacity === "1" &&
                    card.getBoundingClientRect().width >= 760 &&
                    getComputedStyle(form).gridTemplateColumns.split(" ").length === 3
                );
            })()`)
        );
        await capture(window, outputDirectory, "edit-request");

        await window.webContents.executeJavaScript(`(() => {
            document.querySelectorAll(".fp-modal").forEach(modal => {
                modal.classList.add("is-hidden");
                modal.setAttribute("aria-hidden", "true");
            });
            const modal = document.getElementById("fp-config-modal");
            modal.classList.remove("is-hidden");
            modal.setAttribute("aria-hidden", "false");
        })()`);
        checks.push(
            await window.webContents.executeJavaScript(`(() => {
                const card = document.querySelector("#fp-config-modal > .fp-modal__card");
                const body = card.querySelector(".fp-config-body");
                return (
                    getComputedStyle(card).opacity === "1" &&
                    card.getBoundingClientRect().width >= 1000 &&
                    getComputedStyle(body).gridTemplateColumns.split(" ").length === 2 &&
                    body.scrollHeight >= body.clientHeight
                );
            })()`)
        );
        await capture(window, outputDirectory, "access-config");

        await window.webContents.executeJavaScript(`(() => {
            document.querySelectorAll(".fp-modal").forEach(modal => {
                modal.classList.add("is-hidden");
                modal.setAttribute("aria-hidden", "true");
            });
            const modal = document.getElementById("fp-holidays-list-modal");
            modal.classList.remove("is-hidden");
            modal.setAttribute("aria-hidden", "false");
            const list = document.getElementById("fp-holidays-future-list");
            list.innerHTML = [
                ["Ferragosto", "2026-08-15"],
                ["Immacolata", "2026-12-08"],
                ["Natale", "2026-12-25"],
                ["Capodanno", "2027-01-01"]
            ].map(([name, date]) => \`
                <div class="fp-holidays-row">
                    <div class="fp-holidays-row__info">
                        <div class="fp-holidays-row__name">\${name}</div>
                        <div class="fp-holidays-row__date">\${date}</div>
                    </div>
                    <div class="fp-assignees-row__actions">
                        <button class="fp-btn">Modifica</button>
                        <button class="fp-btn fp-btn--ghost">Rimuovi</button>
                    </div>
                </div>
            \`).join("");
        })()`);
        checks.push(
            await window.webContents.executeJavaScript(`(() => {
                const card = document.querySelector("#fp-holidays-list-modal > .fp-modal__card");
                const rows = [...card.querySelectorAll(".fp-holidays-row")];
                return (
                    getComputedStyle(card).opacity === "1" &&
                    rows.length === 4 &&
                    rows.every(row => row.getBoundingClientRect().height >= 58)
                );
            })()`)
        );
        await capture(window, outputDirectory, "holidays");

        await window.webContents.executeJavaScript(`(() => {
            document.querySelectorAll(".fp-modal").forEach(modal => {
                modal.classList.add("is-hidden");
                modal.setAttribute("aria-hidden", "true");
            });
            const modal = document.getElementById("fp-approve-modal");
            modal.classList.add("fp-identity-gate");
            modal.classList.remove("is-hidden");
            modal.setAttribute("aria-hidden", "false");
            document.getElementById("fp-login-admin-field").classList.remove("is-hidden");
            document.getElementById("fp-approve-title").textContent = "Accesso amministratore";
            document.getElementById("fp-approve-desc").textContent =
                "Seleziona il profilo e inserisci la password per continuare.";
            document.getElementById("fp-login-admin-name").innerHTML =
                '<option>Mario Rossi</option><option>Laura Bianchi</option>';
        })()`);
        await new Promise(resolve => setTimeout(resolve, 280));
        const loginCheck = await window.webContents.executeJavaScript(`(() => {
                const card = document.querySelector("#fp-approve-modal > .fp-modal__card");
                const panel = card.querySelector(".fp-login-identity-panel");
                const content = card.querySelector(".fp-login-identity-content");
                const visibleModals = [...document.querySelectorAll(".fp-modal")]
                    .filter(modal => getComputedStyle(modal).display !== "none")
                    .map(modal => modal.id);
                return {
                    ok:
                    card.getBoundingClientRect().width >= 760 &&
                    panel.getBoundingClientRect().left < content.getBoundingClientRect().left &&
                    panel.getBoundingClientRect().width >= 290 &&
                    content.getBoundingClientRect().width >= 400,
                    visibleModals,
                    cardWidth: card.getBoundingClientRect().width,
                    cardOpacity: getComputedStyle(card).opacity,
                    panelWidth: panel.getBoundingClientRect().width,
                    contentWidth: content.getBoundingClientRect().width,
                };
            })()`);
        checks.push(loginCheck.ok);
        await capture(window, outputDirectory, "login-original");

        const result = {
            ok: checks.every(Boolean),
            checks,
            loginCheck,
            outputDirectory,
        };
        console.log(JSON.stringify(result, null, 2));
        window.destroy();
        server.close();
        app.exit(result.ok ? 0 : 1);
    })
    .catch(error => {
        console.error(error);
        server.close();
        app.exit(1);
    });
