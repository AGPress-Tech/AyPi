const NETWORK_PATHS = {
    dl360ServerCheck: "\\\\Dl360\\private\\AyPi Server Validator.txt",
    feriePermessiData: "\\\\Dl360\\pubbliche\\TECH\\AyPi\\AGPRESS\\ferie-permessi.json",
    feriePermessiAdmins: "\\\\Dl360\\pubbliche\\TECH\\AyPi\\AGPRESS\\ferie-permessi-admins.json",
    otpMailServer: "\\\\Dl360\\pubbliche\\TECH\\AyPi\\AGPRESS\\otp-mail.json",
    amministrazioneAssignees: "\\\\Dl360\\pubbliche\\TECH\\AyPi\\AGPRESS\\amministrazione-assignees.json",
    amministrazioneObiettivi: "\\\\Dl360\\pubbliche\\TECH\\AyPi\\AGPRESS\\amministrazione-obiettivi.json",
};

const PRODUZIONE_FILES = [
    "\\\\Dl360\\pubbliche\\INFO\\REGISTRAZIONE PRODUZIONE STAMPAGGIO\\2026 Registrazione produzione stampaggio.xls",
    "\\\\Dl360\\pubbliche\\TECH\\In Edit\\Registrazione Produzione Tranceria.xlsx",
    "\\\\Dl360\\pubbliche\\INFO\\REGISTRAZIONE PRODUZIONE TORNERIA\\Controllo_Valorizzazione.xlsm",
];

const MODULI_FILES = [
    "\\\\Dl360\\pubbliche\\TECH\\In Edit\\AyPi Valutazione Fornitori\\AyPi - Valutazione Fornitori.accdb",
    "\\\\Dl360\\pubbliche\\MAGAZZINO\\DDT FORNITORI\\Controllo DDT fornitori.accdb",
    "\\\\Dl360\\pubbliche\\QUALITA'\\MANUTENZIONI MACCHINE\\AyPi - Manutenzione Macchine.accdb",
    "\\\\Dl360\\pubbliche\\QUALITA'\\CERTIFICAZIONE ISO 9001-2015\\STRUMENTI E TARATURE\\AyPi - Strumenti e Tarature.accdb",
    "\\\\Dl360\\pubbliche\\TECNICO\\MODULO STAMPI\\S1 - Scheda Montaggio Stampi.xlsm",
    "\\\\Dl360\\pubbliche\\OFF. MECCANICA\\Gestione Morsetti\\AyPi - Gestione Morsetti.accdb",
    "\\\\Dl360\\pubbliche\\TECH\\In Edit\\AyPi Gestione Utensili e Attrezzature\\AyPi - Gestione Utensili e Attrezzature.accdb",
    "\\\\Dl360\\pubbliche\\TECH\\In Edit\\AyPi Ticket Support\\AyPi - Ticket Support.accdb",
];

const PROGRAMMI_FILES = [
    "\\\\Dl360\\condivisa\\Programmi Reparti AGPress\\1 - Programma Ufficio Tecnico.xlsx",
    "\\\\Dl360\\condivisa\\Programmi Reparti AGPress\\2 - Programma Officina Stampi.xlsx",
    "\\\\Dl360\\condivisa\\Programmi Reparti AGPress\\3 - Programma Stampaggio.xlsx",
    "\\\\Dl360\\condivisa\\Programmi Reparti AGPress\\4 - Programma Tranceria.xlsx",
    "\\\\Dl360\\condivisa\\Programmi Reparti AGPress\\5 - Programma Torneria.xlsx",
    "\\\\Dl360\\condivisa\\Programmi Reparti AGPress\\6 - Programma Magazzino.xlsx",
    "\\\\Dl360\\pubbliche\\SCAMBIO DOCUMENTI\\USCITE CAMION_FURGONE\\PROGRAMMA SETTIMANALE CONSEGNE.xlsx",
];

const INFOARTICOLI_PATHS = [
    "\\\\Dl360\\pubbliche\\TECNICO\\PROGETTAZIONE\\A.G.PRESS TORNITI\\A.G.PRESS DISEGNI TORNITI",
    "\\\\Dl360\\pubbliche\\TECNICO\\QUALITA' E MODULISTICA\\DOCUMENTI CONDIVISI A.G.PRESS\\CICLI DI LAVORAZIONE",
    "\\\\Dl360\\pubbliche\\TECNICO\\QUALITA' E MODULISTICA\\DOCUMENTI CONDIVISI A.G.PRESS\\SCHEDE MONTAGGIO STAMPI M10-7",
    "\\\\Dl360\\pubbliche\\TECNICO\\QUALITA' E MODULISTICA\\DOCUMENTI CONDIVISI A.G.PRESS\\SCHEDE DIFETTI DI PRODUZIONE M06-8",
];

module.exports = {
    NETWORK_PATHS,
    PRODUZIONE_FILES,
    MODULI_FILES,
    PROGRAMMI_FILES,
    INFOARTICOLI_PATHS,
};
