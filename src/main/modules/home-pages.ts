export type ActionItem = {
    label: string;
    description: string;
    addressKey?: string;
    channel?: string;
    channelArgs?: unknown[];
    invoke?: boolean;
    requiresAdmin?: boolean;
};

export type PageDefinition = {
    title: string;
    heading: string;
    description: string;
    code: string;
    actions?: ActionItem[];
    calculator?: boolean;
};

export function createHomePages(MODULE_THEME: "standard" | "bluearchive"): Record<string, PageDefinition> {
    const pages: Record<string, PageDefinition> = {
        moduli: {
            title: "Moduli",
            heading: "Seleziona un modulo",
            description: "Accedi agli strumenti e ai moduli aziendali di AyPi.",
            code: "MDL",
            actions: [
                {
                    label: "Valutazione Fornitori",
                    description: "Gestione e valutazione fornitori AGPress",
                    addressKey: "moduli.openFornitori",
                },
                {
                    label: "DDT Fornitori",
                    description: "Controllo documenti di trasporto",
                    addressKey: "moduli.openDDT",
                },
                {
                    label: "Gestione Manutenzioni",
                    description: "Manutenzioni macchine e impianti",
                    addressKey: "moduli.openManutenzioni",
                },
                {
                    label: "Strumenti di Misura",
                    description: "Tarature e strumenti di controllo",
                    addressKey: "moduli.openTarature",
                },
                {
                    label: "Gestione Stampi",
                    description: "Informazioni e Gestione Digitale Stampi",
                    addressKey: "moduli.openModuloStampi",
                },
                {
                    label: "Gestione Morsetti",
                    description: "Gestione morsetti officina",
                    addressKey: "moduli.openMorsetti",
                },
                {
                    label: "Utensili e Attrezzature",
                    description: "Gestione Utensili e Attrezzature Torneria",
                    addressKey: "moduli.openUtensili",
                },
                {
                    label: "Ticket Support",
                    description: "Richieste di assistenza interna",
                    channel: "open-ticket-support-window",
                    channelArgs: [{ theme: MODULE_THEME }],
                },
            ],
        },
        programmi: {
            title: "Programmi",
            heading: "Seleziona un reparto",
            description:
                "Apri il programma di pianificazione del reparto desiderato.",
            code: "PRG",
            actions: [
                {
                    label: "Ufficio Tecnico",
                    description: "Programmazione ufficio tecnico",
                    addressKey: "programmi.openTecnico",
                },
                {
                    label: "Officina Meccanica",
                    description: "Programmazione officina",
                    addressKey: "programmi.openOfficina",
                },
                {
                    label: "Stampaggio",
                    description: "Piano reparto stampaggio",
                    addressKey: "programmi.openStampaggio",
                },
                {
                    label: "Tranceria",
                    description: "Piano reparto tranceria",
                    addressKey: "programmi.openTranceria",
                },
                {
                    label: "Torneria",
                    description: "Piano reparto torneria",
                    addressKey: "programmi.openTorneria",
                },
                {
                    label: "Magazzino",
                    description: "Piano attività magazzino",
                    addressKey: "programmi.openMagazzino",
                },
                {
                    label: "Consegne",
                    description: "Programma settimanale consegne",
                    addressKey: "programmi.openConsegne",
                },
            ],
        },
        articoli: {
            title: "Articoli",
            heading: "Informazioni articoli",
            description: "Trova rapidamente disegni, cicli e schede di produzione.",
            code: "ART",
            actions: [
                {
                    label: "Tavole e Disegni",
                    description: "Disegni tecnici degli articoli",
                    addressKey: "infoarticoli.openTavole",
                },
                {
                    label: "Cicli di Lavorazione",
                    description: "Documenti e cicli produttivi",
                    addressKey: "infoarticoli.openCicli",
                },
                {
                    label: "Schede Montaggio Stampi",
                    description: "Istruzioni montaggio stampi",
                    addressKey: "infoarticoli.openMontaggioStampi",
                },
                {
                    label: "Schede Difetti di Produzione",
                    description: "Difetti e controlli qualità",
                    addressKey: "infoarticoli.openDifettiProduzione",
                },
                {
                    label: "Schede Attrezzaggio",
                    description: "Configurazioni di attrezzaggio",
                    channel: "open-attrezzaggio-window",
                },
                {
                    label: "Registrazioni Progettazione",
                    description: "Registrazioni stampi e progetti speciali",
                    channel: "open-registrazioni-progettazione-window",
                },
                {
                    label: "Inventario magazzino",
                    description: "Mappa e gestione dei cassoni",
                    channel: "open-inventario-magazzino-window",
                    channelArgs: [{ theme: MODULE_THEME }],
                },
            ],
        },
        produzioni: {
            title: "Produzioni",
            heading: "Seleziona una produzione",
            description: "Consulta e aggiorna i registri dei reparti produttivi.",
            code: "PRD",
            actions: [
                {
                    label: "Registrazione Stampaggio",
                    description: "Registro produzione stampaggio",
                    addressKey: "produzioni.openRegStampaggio",
                },
                {
                    label: "Registrazione Tranceria",
                    description: "Registro produzione tranceria",
                    addressKey: "produzioni.openRegTranceria",
                },
                {
                    label: "Registrazione Torneria",
                    description: "Registro produzione torneria",
                    addressKey: "produzioni.openRegTorneria",
                },
            ],
        },
        "mes-scada": {
            title: "MES - SCADA",
            heading:
                "Supervisory Control and Data Acquisition - Manufacturing Execution System",
            description: "Produzione, supervisione e impianti in AyPi FORGE.",
            code: "FRG",
        },
        calcolatore: {
            title: "Calcolatore",
            heading: "Calcolatore parametri",
            description: "Calcola numero di giri e avanzamento per le lavorazioni.",
            code: "CAL",
            calculator: true,
        },
        utilities: {
            title: "Utilities",
            heading: "Strumenti AyPi",
            description:
                "Una raccolta di strumenti rapidi per il lavoro quotidiano.",
            code: "UTL",
            actions: [
                {
                    label: "Elenca File",
                    description: "Trascrizione nomi dei file",
                    channel: "open-file-list-window",
                    channelArgs: [{ theme: MODULE_THEME }],
                },
                {
                    label: "Batch Rinomina",
                    description: "Rinomina multipla controllata",
                    channel: "open-batch-rename-window",
                    channelArgs: [{ theme: MODULE_THEME }],
                },
                {
                    label: "Generatore QR",
                    description: "Crea codici QR personalizzati",
                    channel: "open-qr-generator-window",
                    channelArgs: [{ theme: MODULE_THEME }],
                },
                {
                    label: "Confronta Cartelle",
                    description: "Confronto contenuti directory",
                    channel: "open-compare-folders-window",
                    channelArgs: [{ theme: MODULE_THEME }],
                },
                {
                    label: "Gerarchia",
                    description: "Visualizzatore Directory Server Aziendale",
                    channel: "open-hierarchy-window",
                    channelArgs: [{ theme: MODULE_THEME }],
                },
                {
                    label: "Calendario Dipendenti",
                    description: "Ferie, permessi, mutue e straordinari",
                    channel: "open-ferie-permessi-window",
                    channelArgs: [{ theme: MODULE_THEME }],
                },
                {
                    label: "Gestione Acquisti",
                    description: "Richieste acquisti e interventi",
                    channel: "open-product-manager-window",
                    channelArgs: [{ theme: MODULE_THEME }],
                },
            ],
        },
    };

    pages.analisi = {
        title: "Analisi",
        heading: "Analisi del gestionale",
        description: "Ricerche, report e analisi dei dati aziendali.",
        code: "ANL",
        actions: [
            {
                label: "Controllo di gestione",
                description:
                    "Dashboard economiche, confronti e obiettivi · Solo amministratori",
                channel: "management-open",
                invoke: true,
                requiresAdmin: true,
            },
            {
                label: "Analisi commerciali",
                description: "Venduto per articolo, offerte e analisi per cliente",
                channel: "commercial-analysis-open",
                invoke: true,
            },
            {
                label: "Analisi Torneria",
                description:
                    "Produzioni, valorizzazioni, saturazione macchine e confronti pluriennali",
                channel: "turning-analysis-open",
                invoke: true,
            },
        ],
    };
    return pages;
}
