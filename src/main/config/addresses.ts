import {
    MODULI_FILES,
    PROGRAMMI_FILES,
    PRODUZIONE_FILES,
    INFOARTICOLI_PATHS,
} from "./paths";

export const ADDRESS_ENTRIES = [
    { key: "moduli.openFornitori", id: "openFornitori", kind: "file", defaultPath: MODULI_FILES[0] },
    { key: "moduli.openDDT", id: "openDDT", kind: "file", defaultPath: MODULI_FILES[1] },
    { key: "moduli.openManutenzioni", id: "openManutenzioni", kind: "file", defaultPath: MODULI_FILES[2] },
    { key: "moduli.openTarature", id: "openTarature", kind: "file", defaultPath: MODULI_FILES[3] },
    { key: "moduli.openModuloStampi", id: "openModuloStampi", kind: "file", defaultPath: MODULI_FILES[4] },
    { key: "moduli.openMorsetti", id: "openMorsetti", kind: "file", defaultPath: MODULI_FILES[5] },
    { key: "moduli.openUtensili", id: "openUtensili", kind: "file", defaultPath: MODULI_FILES[6] },
    { key: "moduli.openTicket", id: "openTicket", kind: "file", defaultPath: MODULI_FILES[7] },

    { key: "programmi.openTecnico", id: "openTecnico", kind: "file", defaultPath: PROGRAMMI_FILES[0] },
    { key: "programmi.openOfficina", id: "openOfficina", kind: "file", defaultPath: PROGRAMMI_FILES[1] },
    { key: "programmi.openStampaggio", id: "openStampaggio", kind: "file", defaultPath: PROGRAMMI_FILES[2] },
    { key: "programmi.openTranceria", id: "openTranceria", kind: "file", defaultPath: PROGRAMMI_FILES[3] },
    { key: "programmi.openTorneria", id: "openTorneria", kind: "file", defaultPath: PROGRAMMI_FILES[4] },
    { key: "programmi.openMagazzino", id: "openMagazzino", kind: "file", defaultPath: PROGRAMMI_FILES[5] },
    { key: "programmi.openConsegne", id: "openConsegne", kind: "file", defaultPath: PROGRAMMI_FILES[6] },

    { key: "produzioni.openRegStampaggio", id: "openRegStampaggio", kind: "file", defaultPath: PRODUZIONE_FILES[0] },
    { key: "produzioni.openRegTranceria", id: "openRegTranceria", kind: "file", defaultPath: PRODUZIONE_FILES[1] },
    { key: "produzioni.openRegTorneria", id: "openRegTorneria", kind: "file", defaultPath: PRODUZIONE_FILES[2] },

    { key: "infoarticoli.openTavole", id: "openTavole", kind: "directory", defaultPath: INFOARTICOLI_PATHS[0] },
    { key: "infoarticoli.openCicli", id: "openCicli", kind: "directory", defaultPath: INFOARTICOLI_PATHS[1] },
    { key: "infoarticoli.openMontaggioStampi", id: "openMontaggioStampi", kind: "directory", defaultPath: INFOARTICOLI_PATHS[2] },
    { key: "infoarticoli.openDifettiProduzione", id: "openDifettiProduzione", kind: "directory", defaultPath: INFOARTICOLI_PATHS[3] },
];

export const ADDRESS_DEFAULTS = ADDRESS_ENTRIES.reduce((acc, entry) => {
    acc[entry.key] = {
        path: entry.defaultPath,
        kind: entry.kind,
        id: entry.id,
    };
    return acc;
}, {});

export const ADDRESS_BY_ID = ADDRESS_ENTRIES.reduce((acc, entry) => {
    acc[entry.id] = entry;
    return acc;
}, {});

// CommonJS interop for legacy requires
module.exports = {
    ADDRESS_ENTRIES,
    ADDRESS_DEFAULTS,
    ADDRESS_BY_ID,
};
