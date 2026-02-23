// @ts-nocheck
require("../../../shared/dev-guards");
let Ajv = null;
let ajv = null;

try {
    Ajv = require("ajv");
    ajv = new Ajv({ allErrors: true, coerceTypes: true, useDefaults: true });
} catch (err) {
    console.error("Modulo 'ajv' non trovato. Esegui: npm install ajv");
}

const REQUEST_LINE_SCHEMA = {
    type: "object",
    additionalProperties: true,
    properties: {
        product: { type: "string" },
        category: { type: "string" },
        quantity: { type: ["string", "number"] },
        unit: { type: "string" },
        urgency: { type: "string" },
        url: { type: "string" },
        note: { type: "string" },
        priceCad: { type: ["string", "number"] },
        deletedAt: { type: ["string", "null"] },
        approvedAt: { type: ["string", "null"] },
    },
};

const REQUEST_SCHEMA = {
    type: "object",
    additionalProperties: true,
    properties: {
        id: { type: "string" },
        createdAt: { type: "string" },
        status: { type: "string" },
        department: { type: "string" },
        employee: { type: "string" },
        createdBy: { type: "string" },
        adminName: { type: "string" },
        notes: { type: "string" },
        lines: { type: "array", items: REQUEST_LINE_SCHEMA },
        history: {
            type: "array",
            items: {
                type: "object",
                additionalProperties: true,
                properties: {
                    at: { type: "string" },
                    by: { type: "string" },
                    adminName: { type: "string" },
                    action: { type: "string" },
                },
            },
        },
    },
};

const REQUESTS_SCHEMA = {
    type: "array",
    items: REQUEST_SCHEMA,
};

const CATALOG_ITEM_SCHEMA = {
    type: "object",
    additionalProperties: true,
    properties: {
        id: { type: "string" },
        name: { type: "string" },
        description: { type: "string" },
        category: { type: "string" },
        unit: { type: "string" },
        url: { type: "string" },
        imageUrl: { type: "string" },
        imageFile: { type: "string" },
        createdAt: { type: "string" },
        updatedAt: { type: "string" },
    },
};

const CATALOG_SCHEMA = {
    type: "array",
    items: CATALOG_ITEM_SCHEMA,
};

const CATEGORIES_SCHEMA = {
    type: "array",
    items: { type: "string" },
};

let validateRequestsSchema = null;
let validateCatalogSchema = null;
let validateCategoriesSchema = null;
let validateInterventionTypesSchema = null;

if (ajv) {
    validateRequestsSchema = ajv.compile(REQUESTS_SCHEMA);
    validateCatalogSchema = ajv.compile(CATALOG_SCHEMA);
    validateCategoriesSchema = ajv.compile(CATEGORIES_SCHEMA);
    validateInterventionTypesSchema = ajv.compile(CATEGORIES_SCHEMA);
}

if (typeof module !== "undefined" && module.exports && !(globalThis as any).__aypiBundled) module.exports = {
    REQUEST_LINE_SCHEMA,
    REQUEST_SCHEMA,
    REQUESTS_SCHEMA,
    CATALOG_ITEM_SCHEMA,
    CATALOG_SCHEMA,
    CATEGORIES_SCHEMA,
    validators: {
        validateRequestsSchema,
        validateCatalogSchema,
        validateCategoriesSchema,
        validateInterventionTypesSchema,
    },
};

