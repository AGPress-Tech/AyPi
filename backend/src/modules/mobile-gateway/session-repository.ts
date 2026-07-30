import crypto from "crypto";
import {
    getSqliteDatabase,
    runSqliteTransaction,
} from "../../shared/db/sqlite";
import { backendConfig } from "../../config";

const TABLE = "mobile_admin_sessions";
const LAST_SEEN_WRITE_INTERVAL_MS = 15 * 60 * 1000;
const MAX_SESSIONS_PER_ADMIN = 10;

export type MobileAdminSession = {
    adminName: string;
    createdAt: string;
    expiresAt: string;
    lastSeenAt: string;
};

function hashToken(token: string) {
    return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

export function initializeMobileSessionStore() {
    const database = getSqliteDatabase();
    database.exec(`
        CREATE TABLE IF NOT EXISTS ${TABLE} (
            token_hash TEXT PRIMARY KEY,
            admin_name TEXT NOT NULL,
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            last_seen_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_mobile_admin_sessions_admin
            ON ${TABLE}(admin_name);
        CREATE INDEX IF NOT EXISTS idx_mobile_admin_sessions_expiry
            ON ${TABLE}(expires_at);
    `);
}

function deleteExpiredSessions(nowIso = new Date().toISOString()) {
    const database = getSqliteDatabase();
    const statement = database.prepare(
        `DELETE FROM ${TABLE} WHERE expires_at <= ?`,
    );
    statement.run([nowIso]);
    statement.free();
}

export function createMobileAdminSession(adminName: string) {
    const token = crypto.randomBytes(32).toString("base64url");
    const tokenHash = hashToken(token);
    const createdAt = new Date();
    const expiresAt = new Date(
        createdAt.getTime() +
            backendConfig.mobileGateway.sessionDays * 24 * 60 * 60 * 1000,
    );
    const session: MobileAdminSession = {
        adminName,
        createdAt: createdAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
        lastSeenAt: createdAt.toISOString(),
    };

    runSqliteTransaction((database) => {
        deleteExpiredSessions(session.createdAt);
        const insert = database.prepare(`
            INSERT INTO ${TABLE}
                (token_hash, admin_name, created_at, expires_at, last_seen_at)
            VALUES (?, ?, ?, ?, ?)
        `);
        insert.run([
            tokenHash,
            session.adminName,
            session.createdAt,
            session.expiresAt,
            session.lastSeenAt,
        ]);
        insert.free();

        const prune = database.prepare(`
            DELETE FROM ${TABLE}
            WHERE admin_name = ?
              AND token_hash NOT IN (
                  SELECT token_hash
                  FROM ${TABLE}
                  WHERE admin_name = ?
                  ORDER BY created_at DESC
                  LIMIT ?
              )
        `);
        prune.run([session.adminName, session.adminName, MAX_SESSIONS_PER_ADMIN]);
        prune.free();
    });

    return {
        token,
        session,
    };
}

export function findMobileAdminSession(
    token: string,
): MobileAdminSession | null {
    if (!token) return null;
    const tokenHash = hashToken(token);
    const database = getSqliteDatabase();
    const statement = database.prepare(`
        SELECT admin_name, created_at, expires_at, last_seen_at
        FROM ${TABLE}
        WHERE token_hash = ?
        LIMIT 1
    `);
    statement.bind([tokenHash]);
    if (!statement.step()) {
        statement.free();
        return null;
    }
    const row = statement.getAsObject() as Record<string, unknown>;
    statement.free();

    const session: MobileAdminSession = {
        adminName: String(row.admin_name || ""),
        createdAt: String(row.created_at || ""),
        expiresAt: String(row.expires_at || ""),
        lastSeenAt: String(row.last_seen_at || ""),
    };
    const now = Date.now();
    if (!session.adminName || Date.parse(session.expiresAt) <= now) {
        revokeMobileAdminSession(token);
        return null;
    }

    if (
        !Number.isFinite(Date.parse(session.lastSeenAt)) ||
        now - Date.parse(session.lastSeenAt) >= LAST_SEEN_WRITE_INTERVAL_MS
    ) {
        session.lastSeenAt = new Date(now).toISOString();
        runSqliteTransaction((transactionDatabase) => {
            const update = transactionDatabase.prepare(`
                UPDATE ${TABLE}
                SET last_seen_at = ?
                WHERE token_hash = ?
            `);
            update.run([session.lastSeenAt, tokenHash]);
            update.free();
        });
    }
    return session;
}

export function revokeMobileAdminSession(token: string) {
    if (!token) return;
    const tokenHash = hashToken(token);
    runSqliteTransaction((database) => {
        const statement = database.prepare(
            `DELETE FROM ${TABLE} WHERE token_hash = ?`,
        );
        statement.run([tokenHash]);
        statement.free();
    });
}

