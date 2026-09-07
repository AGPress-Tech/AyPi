const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");

require.extensions[".ts"] = (module, filename) => {
    const result = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    });
    module._compile(result.outputText, filename);
};
const { Router } = require("../backend/src/shared/http/router.ts");
const { registerUploadRoutes } = require("../backend/src/shared/http/upload-routes.ts");
const { readJsonBody } = require("../backend/src/shared/http/request.ts");
const { sendJson, sendError } = require("../backend/src/shared/http/response.ts");
const { createAttachmentStore } = require("../backend/src/shared/storage/attachment-store.ts");
const store = require("../backend/src/shared/storage/upload-store.ts");
const { withUploadedAttachments } = require("../src/main/modules/file-manager/attachment-upload.ts");

test("25 heavy attachments over HTTP, retry, integrity, metadata and cleanup", async () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "aypi-upload-test-"));
    const router = new Router();
    registerUploadRoutes(router);
    const attachments = createAttachmentStore(path.join(temp, "saved"));
    let saveCount = 0;
    let largestRequest = 0;
    router.register("PUT", "/save", async (req, res) => {
        const payload = await readJsonBody(req);
        assert.ok(JSON.stringify(payload).length < 20000);
        assert.ok(!JSON.stringify(payload).includes(temp));
        saveCount++;
        sendJson(res, 200, { attachments: attachments.saveNew(payload.newAttachments) });
    });
    const server = http.createServer(async (req, res) => {
        largestRequest = Math.max(largestRequest, Number(req.headers["content-length"] || 0));
        try { await router.handle(req, res); } catch (error) { sendError(res, error); }
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const tokens = [];
    let loseResponse = true;
    const request = async (url, options = {}) => {
        const response = await fetch(base + url, {
            method: options.method || "GET",
            headers: { "Content-Type": "application/json" },
            body: options.body === undefined ? undefined : JSON.stringify(options.body),
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error);
        if (body.token) tokens.push(body.token);
        if (loseResponse && options.method === "PUT" && url.startsWith("/api/uploads/")) {
            loseResponse = false;
            throw new Error("Simulated lost response after the server wrote the block");
        }
        return body;
    };
    try {
        const source = path.join(temp, "large-photo.jpg");
        const bytes = crypto.randomBytes(12 * 1024 * 1024 + 17);
        fs.writeFileSync(source, bytes);
        const expected = crypto.createHash("sha256").update(bytes).digest("hex");
        const draft = { newAttachments: Array.from({ length: 25 }, (_, i) => ({
            fileName: `foto-${i}.jpg`, dataFilePath: source, mimeType: "image/jpeg", size: bytes.length,
            workflowKey: `phase-${i}`,
        })) };
        const original = JSON.stringify(draft);
        const saved = await withUploadedAttachments(draft, request, (body) => request("/save", { method: "PUT", body }));
        assert.equal(saved.attachments.length, 25);
        assert.equal(saveCount, 1);
        assert.equal(JSON.stringify(draft), original);
        for (const attachment of saved.attachments) {
            assert.equal(attachment.size, bytes.length);
            assert.equal(crypto.createHash("sha256").update(fs.readFileSync(attachments.resolvePath(attachment.storedName))).digest("hex"), expected);
        }
        assert.ok(largestRequest < 1.1 * 1024 * 1024);
        for (const token of tokens) assert.throws(() => store.writeAttachmentData(store.UPLOAD_PREFIX + token, path.join(temp, "missing")), /scaduto/);

        // Older callers with inline Base64 also use blocks; business fields survive.
        await withUploadedAttachments({ newAttachments: [{ fileName: "legacy.jpg", dataBase64: bytes.toString("base64"), workflowKey: "phase-a" }] }, request, async (body) => {
            assert.equal(body.newAttachments[0].workflowKey, "phase-a");
            const [meta] = attachments.saveNew(body.newAttachments);
            assert.equal(meta.size, bytes.length);
            assert.equal(crypto.createHash("sha256").update(fs.readFileSync(attachments.resolvePath(meta.storedName))).digest("hex"), expected);
        });

        const prior = tokens.length;
        await assert.rejects(withUploadedAttachments(draft, async (url, options) => {
            if (options.method === "PUT") throw new Error("Network unavailable");
            return request(url, options);
        }, async () => assert.fail("An incomplete upload must not save the record")), /Network unavailable/);
        assert.equal(tokens.length, prior + 1);
        assert.equal(saveCount, 1);
        assert.equal(JSON.stringify(draft), original);
        assert.throws(() => store.finishUpload(tokens.at(-1), 0), /incompleto/);
    } finally {
        await new Promise((resolve) => server.close(resolve));
        const resolved = path.resolve(temp);
        assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
        assert.ok(path.basename(resolved).startsWith("aypi-upload-test-"));
        fs.rmSync(resolved, { recursive: true, force: true });
    }
});

test("upload validation, completion and safe repeated blocks", () => {
    const token = store.createUpload();
    try {
        assert.throws(() => store.appendUpload("../escape", 0, "YQ=="), /non valido/);
        assert.throws(() => store.appendUpload(token, 0, "!!!!"), /non valido/);
        assert.throws(() => store.appendUpload(token, 1, "YQ=="), /Ordine/);
        assert.equal(store.appendUpload(token, 0, "YQ=="), 1);
        assert.equal(store.appendUpload(token, 0, "YQ=="), 1);
        assert.throws(() => store.appendUpload(token, 0, "Yg=="), /differente/);
        assert.throws(() => store.appendUpload(token, store.MAX_UPLOAD_BYTES, "YQ=="), /1 GiB/);
        assert.throws(() => store.finishUpload(token, 2), /incompleto/);
        assert.equal(store.finishUpload(token, 1), store.UPLOAD_PREFIX + token);
        assert.throws(() => store.appendUpload(token, 1, "YQ=="), /non disponibile/);
    } finally { store.removeUpload(token); }
});

test("real Transfer, HAAS, project and catalog routes save and reload attachments", async () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "aypi-upload-test-"));
    const { backendConfig } = require("../backend/src/config/index.ts");
    backendConfig.modules.feriePermessi.baseDir = path.join(temp, "AGPRESS");
    backendConfig.modules.feriePermessi.generalDir = path.join(temp, "AGPRESS", "General");
    for (const name of ["productManager", "ticketSupport", "transferAttrezzaggio", "haasAttrezzaggio", "registrazioniProgettazioneStampi"]) {
        backendConfig.modules[name].dir = path.join(temp, "AGPRESS", name);
    }
    backendConfig.database.path = path.join(temp, "AGPRESS", "General", "aypi.db");
    backendConfig.logging.dir = path.join(temp, "logs");
    const db = require("../backend/src/shared/db/sqlite.ts");
    const router = new Router();
    registerUploadRoutes(router);
    require("../backend/src/modules/transfer-attrezzaggio/routes.ts").registerTransferAttrezzaggioRoutes(router);
    require("../backend/src/modules/haas-attrezzaggio/routes.ts").registerHaasAttrezzaggioRoutes(router);
    require("../backend/src/modules/registrazioni-progettazione-stampi/routes.ts").registerRegistrazioniProgettazioneStampiRoutes(router);
    require("../backend/src/modules/product-manager/routes.ts").registerProductManagerRoutes(router);
    const server = http.createServer(async (req, res) => {
        try { await router.handle(req, res); } catch (error) { sendError(res, error); }
    });
    await db.initializeSqliteDatabase();
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const request = async (url, options = {}) => {
        const response = await fetch(`http://127.0.0.1:${server.address().port}${url}`, {
            method: options.method || "GET", headers: { "Content-Type": "application/json" },
            body: options.body === undefined ? undefined : JSON.stringify(options.body),
        });
        const body = await response.json();
        assert.ok(response.ok, JSON.stringify(body));
        return body;
    };
    try {
        const source = path.join(temp, "photo.jpg");
        const bytes = crypto.randomBytes(1024 + 1);
        fs.writeFileSync(source, bytes);
        for (const module of ["transfer-attrezzaggio", "haas-attrezzaggio", "registrazioni-progettazione-stampi"]) {
            const endpoint = `/api/${module}/items/test`;
            const payload = {
                code: "test", progettoNumero: "test", codiceArticolo: "A", fase: "1", codiceMacchina: "T", metodo: "M", numeroProgramma: "P", macchina: "H",
                newAttachments: Array.from({ length: 25 }, (_, i) => ({ fileName: `${i}.jpg`, dataFilePath: source, mimeType: "image/jpeg", size: bytes.length, workflowKey: `phase-${i}` })),
            };
            const saved = await withUploadedAttachments(payload, request, (body) => request(endpoint, { method: "PUT", body }));
            assert.equal(saved.item.attachments.length, 25, module);
            const loaded = await request(endpoint);
            assert.deepEqual(loaded.item.attachments, saved.item.attachments);
            for (const attachment of loaded.item.attachments) {
                const response = await fetch(`http://127.0.0.1:${server.address().port}/api/${module}/attachments/${attachment.storedName}`);
                assert.ok(response.ok);
                assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
            }
            if (module === "registrazioni-progettazione-stampi") assert.equal(loaded.item.attachments[24].workflowKey, "phase-24");
            const updated = await request(endpoint, { method: "PUT", body: { ...loaded.item, newAttachments: [] } });
            assert.equal(updated.item.attachments.length, 25);
        }
        const catalog = await withUploadedAttachments({ catalogId: "catalog", fileName: "photo.jpg", dataFilePath: source }, request,
            (body) => request("/api/product-manager/catalog-image", { method: "POST", body }));
        assert.equal(catalog.imageFile, "catalog.jpg");
    } finally {
        await new Promise((resolve) => server.close(resolve));
        db.closeSqliteDatabase();
        const resolved = path.resolve(temp);
        assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
        assert.ok(path.basename(resolved).startsWith("aypi-upload-test-"));
        fs.rmSync(resolved, { recursive: true, force: true });
    }
});
