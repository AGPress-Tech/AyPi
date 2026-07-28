import fs from "fs";
import path from "path";
import log from "electron-log";
import { ADDRESS_DEFAULTS } from "../../config/addresses";

const ADDRESS_BOOK_DIR = "\\\\Dl360\\pubbliche\\TECH\\AyPi\\addresses";
const ADDRESS_BOOK_PATH = path.join(ADDRESS_BOOK_DIR, "aypi-addresses.json");

export type AddressEntry = {
    path: string;
    kind?: "file" | "directory";
    id?: string;
};

type AddressBook = {
    version: number;
    updatedAt: string;
    items: Record<string, AddressEntry>;
};

let addressBookCache: AddressBook | null = null;

function ensureAddressBookDir() {
    try {
        if (!fs.existsSync(ADDRESS_BOOK_DIR)) {
            fs.mkdirSync(ADDRESS_BOOK_DIR, { recursive: true });
        }
    } catch (err) {
        log.warn(
            "[addresses] impossibile creare cartella:",
            ADDRESS_BOOK_DIR,
            err,
        );
    }
}

function buildDefaultAddressBook(): AddressBook {
    return {
        version: 1,
        updatedAt: new Date().toISOString(),
        items: JSON.parse(JSON.stringify(ADDRESS_DEFAULTS)),
    };
}

export function loadAddressBook(): AddressBook {
    if (addressBookCache) return addressBookCache;

    const defaults = buildDefaultAddressBook();
    ensureAddressBookDir();

    if (!fs.existsSync(ADDRESS_BOOK_PATH)) {
        addressBookCache = defaults;
        try {
            fs.writeFileSync(
                ADDRESS_BOOK_PATH,
                JSON.stringify(addressBookCache, null, 2),
                "utf8",
            );
        } catch (err) {
            log.warn("[addresses] impossibile salvare file iniziale:", err);
        }
        return addressBookCache;
    }

    try {
        const raw = fs.readFileSync(ADDRESS_BOOK_PATH, "utf8");
        const parsed = JSON.parse(raw);
        const items =
            parsed && typeof parsed === "object" ? parsed.items || {} : {};
        const merged = buildDefaultAddressBook();

        Object.keys(items || {}).forEach((key) => {
            const entry = items[key];
            if (!entry || typeof entry !== "object") return;
            if (typeof entry.path === "string" && entry.path.trim()) {
                merged.items[key] = {
                    path: entry.path.trim(),
                    kind: entry.kind || merged.items[key]?.kind || "file",
                    id: entry.id || merged.items[key]?.id,
                };
            }
        });

        addressBookCache = {
            version: parsed && parsed.version ? parsed.version : 1,
            updatedAt:
                parsed && parsed.updatedAt
                    ? parsed.updatedAt
                    : merged.updatedAt,
            items: merged.items,
        };
    } catch (err) {
        log.warn("[addresses] errore lettura, uso default:", err);
        addressBookCache = defaults;
    }

    try {
        fs.writeFileSync(
            ADDRESS_BOOK_PATH,
            JSON.stringify(addressBookCache, null, 2),
            "utf8",
        );
    } catch (err) {
        log.warn("[addresses] impossibile salvare file dopo merge:", err);
    }

    return addressBookCache;
}

function saveAddressBook(book: AddressBook) {
    addressBookCache = book;
    ensureAddressBookDir();
    try {
        fs.writeFileSync(
            ADDRESS_BOOK_PATH,
            JSON.stringify(book, null, 2),
            "utf8",
        );
        return true;
    } catch (err) {
        log.warn("[addresses] errore salvataggio:", err);
        return false;
    }
}

export function getAddressEntry(key: string): AddressEntry | null {
    const book = loadAddressBook();
    return book.items[key] || null;
}

export function updateAddressEntry(
    key: string,
    nextPath: string,
): AddressEntry | null {
    if (!key || typeof nextPath !== "string" || !nextPath.trim()) return null;
    const book = loadAddressBook();
    const entry = book.items[key] || { path: "", kind: "file" };
    const updated: AddressEntry = {
        path: nextPath.trim(),
        kind: entry.kind || "file",
        id: entry.id,
    };
    book.items[key] = updated;
    book.updatedAt = new Date().toISOString();
    saveAddressBook(book);
    return updated;
}
