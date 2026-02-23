// @ts-nocheck
require("../../../shared/dev-guards");
import crypto from "crypto";

let argon2id;
let argon2Verify;
try {
    ({ argon2id, argon2Verify } = require("hash-wasm"));
} catch (err) {
    console.error(
        "Modulo 'hash-wasm' non trovato. Esegui: npm install hash-wasm",
    );
}

let authenticatorPromise = null;
async function getAuthenticator() {
    if (authenticatorPromise) return authenticatorPromise;
    authenticatorPromise = new Promise((resolve, reject) => {
        try {
            const mod = require("otplib");
            const auth =
                mod.authenticator || (mod.default && mod.default.authenticator);
            if (!auth) {
                reject(new Error("Authenticator non disponibile."));
                return;
            }
            auth.options = { step: 300, window: 0, digits: 6 };
            resolve(auth);
        } catch (err) {
            authenticatorPromise = null;
            reject(err);
        }
    });
    return authenticatorPromise;
}

const otpState = {
    adminName: "",
    adminEmail: "",
    secret: "",
    expiresAt: 0,
    resendAt: 0,
    verified: false,
};

function resetOtpState() {
    Object.assign(otpState, {
        adminName: "",
        adminEmail: "",
        secret: "",
        expiresAt: 0,
        resendAt: 0,
        verified: false,
    });
}

function isHashingAvailable() {
    return !!(argon2id && argon2Verify);
}

async function hashPassword(password) {
    if (!argon2id) {
        throw new Error("Modulo hashing non disponibile.");
    }
    const salt = crypto.randomBytes(16);
    return argon2id({
        password,
        salt,
        parallelism: 1,
        iterations: 1,
        memorySize: 1024,
        hashLength: 32,
        outputType: "encoded",
    });
}

async function verifyPasswordHash(hash, password) {
    if (!argon2Verify) return false;
    try {
        return await argon2Verify({ password, hash });
    } catch (err) {
        return false;
    }
}

if (typeof module !== "undefined" && module.exports && !(globalThis as any).__aypiBundled) module.exports = {
    getAuthenticator,
    otpState,
    resetOtpState,
    isHashingAvailable,
    hashPassword,
    verifyPasswordHash,
};

