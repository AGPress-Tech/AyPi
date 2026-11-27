import {
    stockAnalysisQuery,
    stockCustomerCommitmentsQuery,
} from "./stock-analysis";
import { barContractsQuery } from "./bar-contracts";
import { loadAnalyticsConfig, AnalyticsConfig } from "./config";
import { queryDefinition, queryParameters } from "./catalog";
import { buildArticleOrderQuery } from "./article-orders";
import { buildArticleOfferQuery } from "./article-offers";
import {
    customerSearchQuery,
    customerAnalysisQuery,
} from "./customer-analysis";
import { documentLinksQuery } from "./document-links";
import { documentLinesQuery } from "./document-lines";
import { readErpExplorer } from "./erp-explorer";
import { bomAnalysisQuery } from "./bom-analysis";
import { businessTableQuery, managerQuery, validateBusinessRequest } from "./business-analysis";
const sql = require("mssql");

export type AnalyticsDataset = {
    queryId: string;
    columns: string[];
    rows: unknown[][];
    queriedAt: string;
    source: string;
    rowCount: number;
};
export function createAnalyticsService(
    getConfig = loadAnalyticsConfig,
    driver = sql,
    maxRows = 750000,
) {
    let configPromise: Promise<AnalyticsConfig> | null = null,
        poolPromise: Promise<any> | null = null;
    const pending = new Map<string, Promise<AnalyticsDataset>>();
    const config = () =>
        (configPromise ||= getConfig().catch((error) => {
            configPromise = null;
            throw error;
        }));
    async function pool() {
        if (!poolPromise)
            poolPromise = (async () => {
                const c = await config();
                const connection = new driver.ConnectionPool({
                    server: c.server,
                    database: c.database,
                    user: c.user,
                    password: c.password,
                    ...(c.port ? { port: c.port } : {}),
                    connectionTimeout: 15000,
                    requestTimeout: 90000,
                    pool: { min: 0, max: 3, idleTimeoutMillis: 30000 },
                    options: {
                        ...(c.port ? {} : { instanceName: c.instance }),
                        encrypt: c.encrypt,
                        trustServerCertificate: c.trustServerCertificate,
                        useUTC: true,
                        appName: "AyPi Analytics",
                    },
                });
                connection.on("error", () => {
                    poolPromise = null;
                    void connection.close().catch(() => {});
                });
                return connection.connect();
            })().catch((error) => {
                poolPromise = null;
                throw error;
            });
        return poolPromise;
    }
    async function query(
        id: string,
        input: unknown,
    ): Promise<AnalyticsDataset> {
        const definition = queryDefinition(id),
            params = queryParameters(input),
            key = JSON.stringify([id, params]);
        if (pending.has(key)) return pending.get(key)!;
        if (pending.size >= 2)
            throw new Error(
                "Altre analisi sono in corso. Riprovare tra qualche secondo.",
            );
        const operation = (async () => {
            const c = await config(),
                connection = await pool(),
                request = connection.request();
            request.input("fromDate", driver.Date, params.fromDate);
            request.input("toDate", driver.Date, params.toDate);
            request.stream = true;
            return new Promise<AnalyticsDataset>((resolve, reject) => {
                const rows: unknown[][] = [];
                let failed = false;
                const fail = (error: unknown) => {
                    if (!failed) {
                        failed = true;
                        reject(error);
                    }
                };
                request.on("row", (row) => {
                    if (failed) return;
                    if (rows.length >= maxRows) {
                        fail(
                            new Error(
                                "Troppi movimenti: restringere il periodo di analisi.",
                            ),
                        );
                        request.cancel();
                        return;
                    }
                    rows.push(
                        definition.columns.map((name) =>
                            row[name] instanceof Date
                                ? row[name].toISOString().slice(0, 10)
                                : (row[name] ?? null),
                        ),
                    );
                });
                request.on("error", (error) => fail(error));
                request.on("done", () => {
                    if (!failed)
                        resolve({
                            queryId: id,
                            columns: [...definition.columns],
                            rows,
                            rowCount: rows.length,
                            queriedAt: new Date().toISOString(),
                            source: `${c.server}\\${c.instance} / ${c.database}`,
                        });
                });
                request.query(definition.sql).catch(fail);
            });
        })();
        pending.set(key, operation);
        try {
            return await operation;
        } finally {
            pending.delete(key);
        }
    }
    let articleRequests = 0;
    async function executeArticleQuery(
        definition: ReturnType<typeof buildArticleOrderQuery>,
    ) {
        if (articleRequests >= 3)
            throw new Error(
                "Altre ricerche sono in corso. Riprovare tra qualche secondo.",
            );
        articleRequests++;
        try {
            const connection = await pool(),
                request = connection.request();
            for (const p of definition.bindings)
                request.input(
                    p.name,
                    p.type === "text"
                        ? driver.VarChar(256 * 2 + 2)
                        : p.type === "date"
                          ? driver.Date
                          : p.type === "int"
                            ? driver.Int
                            : driver.Float,
                    p.type === "date"
                        ? new Date(`${p.value}T00:00:00Z`)
                        : p.value,
                );
            const result = await request.query(definition.sql);
            const rows = result.recordset.map((row: any) =>
                Object.fromEntries(
                    Object.entries(row)
                        .filter(([k]) => k !== "totalRows")
                        .map(([k, v]) => [
                            k,
                            v instanceof Date
                                ? v.toISOString().slice(0, 10)
                                : v,
                        ]),
                ),
            );
            return {
                rows,
                total: Number(result.recordset[0]?.totalRows ?? 0),
                offset: definition.filters.offset,
                queriedAt: new Date().toISOString(),
            };
        } finally {
            articleRequests--;
        }
    }
    const articleOrders = (input: unknown) =>
        executeArticleQuery(buildArticleOrderQuery(input));
    const articleOffers = (input: unknown) =>
        executeArticleQuery(buildArticleOfferQuery(input));
    async function customerQuery(input: unknown, lookup: boolean) {
        const definition = lookup
            ? customerSearchQuery(input)
            : customerAnalysisQuery(input);
        if (articleRequests >= 3)
            throw Error(
                "Altre ricerche sono in corso. Riprovare tra qualche secondo.",
            );
        articleRequests++;
        try {
            const connection = await pool(),
                request = connection.request();
            for (const p of definition.bindings) {
                const isDate = "type" in p && p.type === "date";
                request.input(
                    p.name,
                    isDate ? driver.Date : driver.VarChar(258),
                    isDate ? new Date(p.value + "T00:00:00Z") : p.value,
                );
            }
            const result = await request.query(definition.sql);
            if (!lookup && result.recordset.length > 100000)
                throw Error(
                    "Oltre 100.000 righe per questo cliente: restringere il periodo di lettura.",
                );
            const rows = result.recordset.map((row: any) =>
                Object.fromEntries(
                    Object.entries(row).map(([k, v]) => [
                        k,
                        v instanceof Date ? v.toISOString().slice(0, 10) : v,
                    ]),
                ),
            );
            return lookup
                ? { customers: rows.slice(0, 100), more: rows.length > 100 }
                : {
                      rows,
                      queriedAt: new Date().toISOString(),
                      customer: (input as any).customer,
                  };
        } finally {
            articleRequests--;
        }
    }
    const customerSearch = (input: unknown) => customerQuery(input, true),
        customerAnalysis = (input: unknown) => customerQuery(input, false);
    async function readDocument(input: unknown, ownLines = false) {
        const definition = ownLines ? documentLinesQuery(input) : documentLinksQuery(input);
        if (articleRequests >= 3)
            throw Error(
                "Altre ricerche sono in corso. Riprovare tra qualche secondo.",
            );
        articleRequests++;
        try {
            const connection = await pool(),
                request = connection.request();
            request.input("id", driver.Int, definition.bindings[0].value);
            const result = await request.query(definition.sql);
            if (result.recordset.length > (ownLines ? 100000 : 10000))
                throw Error("Troppi documenti collegati per questa ricerca.");
            return {
                rows: result.recordset.map((row: any) =>
                    Object.fromEntries(
                        Object.entries(row).map(([k, v]) => [
                            k,
                            v instanceof Date
                                ? v.toISOString().slice(0, 10)
                                : v,
                        ]),
                    ),
                ),
                queriedAt: new Date().toISOString(),
            };
        } finally {
            articleRequests--;
        }
    }
    async function bomAnalysis(input: unknown) {
        const definition = bomAnalysisQuery(input);
        if (articleRequests >= 3)
            throw Error(
                "Altre ricerche sono in corso. Riprovare tra qualche secondo.",
            );
        articleRequests++;
        try {
            const request = (await pool()).request();
            for (const p of definition.bindings)
                request.input(p.name, driver.VarChar(128), p.value);
            const result = await request.query(definition.sql);
            if (result.recordset.length > 100000)
                throw Error(
                    "Oltre 100.000 righe di distinta: lettura completa non disponibile.",
                );
            return {
                rows: result.recordset.map((row: any) =>
                    Object.fromEntries(
                        Object.entries(row).map(([k, v]) => [
                            k,
                            v instanceof Date
                                ? v.toISOString().slice(0, 10)
                                : v,
                        ]),
                    ),
                ),
                queriedAt: new Date().toISOString(),
            };
        } finally {
            articleRequests--;
        }
    }
    async function barContracts(input: unknown = {}) {
        const definition = barContractsQuery(input);
        if (articleRequests >= 3)
            throw Error(
                "Altre ricerche sono in corso. Riprovare tra qualche secondo.",
            );
        articleRequests++;
        try {
            const request = (await pool()).request();
            for (const binding of definition.bindings)
                request.input(binding.name, driver.VarChar(128), binding.value);
            const result = await request.query(definition.sql);
            if (result.recordsets.some((rows: any[]) => rows.length > 100000))
                throw Error(
                    "Oltre 100.000 righe: lettura contratti non troncata.",
                );
            const clean = (rows: any[]) =>
                rows.map((row) =>
                    Object.fromEntries(
                        Object.entries(row).map(([k, v]) => [
                            k,
                            v instanceof Date
                                ? v.getUTCFullYear() > 1800
                                    ? v.toISOString().slice(0, 10)
                                    : null
                                : v,
                        ]),
                    ),
                );
            return {
                contracts: clean(result.recordsets[0]),
                orders: clean(result.recordsets[1]),
                queriedAt: new Date().toISOString(),
            };
        } finally {
            articleRequests--;
        }
    }
    async function supplierDirectory() {
        const result = await (await pool())
            .request()
            .query(
                "SELECT TOP (100001) CustSupp AS code,CompanyName AS name,Disabled AS disabled,TaxIdNumber AS taxId,FiscalCode AS fiscalCode FROM dbo.MA_CustSupp WHERE CustSuppType=3211265 ORDER BY CustSupp",
            );
        if (result.recordset.length > 100000)
            throw Error("Oltre 100.000 fornitori: elenco non troncato.");
        return {
            suppliers: result.recordset.map((r: any) => ({
                ...r,
                code: String(r.code).trim(),
                name: String(r.name || "").trim(),
                taxId: String(r.taxId || "").trim(),
                fiscalCode: String(r.fiscalCode || "").trim(),
                disabled: r.disabled === true || String(r.disabled) === "1",
            })),
            queriedAt: new Date().toISOString(),
        };
    }
    async function articleDirectory(search: string, exact = false) {
        if (typeof search !== "string" || !search.trim() || search.length > 128)
            throw Error(
                "Indicare un codice o una descrizione (massimo 128 caratteri).",
            );
        const request = (await pool()).request();
        request.input(
            "search",
            driver.NVarChar(300),
            exact
                ? search.trim()
                : "%" +
                      search.trim().replace(/[\[%_]/g, (c) => "[" + c + "]") +
                      "%",
        );
        const result = await request.query(
            `SELECT TOP (101) Item AS code,Description AS description,BaseUoM AS unit,Disabled AS disabled FROM dbo.MA_Items WHERE ${exact ? "Item=@search" : "Item LIKE @search OR Description LIKE @search"} ORDER BY Item`,
        );
        return {
            articles: result.recordset.slice(0, 100).map((r: any) => ({
                ...r,
                code: String(r.code).trim(),
                description: String(r.description || "").trim(),
                unit: String(r.unit || "").trim(),
                disabled: r.disabled === true || String(r.disabled) === "1",
            })),
            more: result.recordset.length > 100,
            queriedAt: new Date().toISOString(),
        };
    }
    async function stockAnalysis(input: unknown = {}) {
        const definition = stockAnalysisQuery(input);
        if (articleRequests >= 3)
            throw Error(
                "Altre ricerche sono in corso. Riprovare tra qualche secondo.",
            );
        articleRequests++;
        try {
            const request = (await pool()).request();
            for (const key of ["year", "period"] as const)
                request.input(key, driver.Int, definition.filters[key] ?? null);
            for (const key of [
                "article",
                "supplierCode",
                "customerCode",
            ] as const)
                request.input(
                    key,
                    driver.VarChar(128),
                    definition.filters[key] ?? null,
                );
            const result = await request.query(definition.sql),
                rows = result.recordsets[0];
            if (rows.length > 100000)
                throw Error(
                    "Oltre 100.000 posizioni: lettura completa non disponibile.",
                );
            const customerCommitments = result.recordsets[3] || [];
            if (customerCommitments.length > 100000)
                throw Error(
                    "Oltre 100.000 impegni clienti: lettura completa non disponibile.",
                );
            return {
                rows: rows.map((r: any) =>
                    Object.fromEntries(
                        Object.entries(r).map(([k, v]) => [
                            k,
                            v instanceof Date ? v.toISOString() : v,
                        ]),
                    ),
                ),
                customerCommitments,
                commitmentsAvailable: result.recordsets.length > 3,
                periods: result.recordsets[1],
                selected: result.recordsets[2][0],
                queriedAt: new Date().toISOString(),
            };
        } finally {
            articleRequests--;
        }
    }
    async function stockCustomerCommitments(input: unknown) {
        const definition = stockCustomerCommitmentsQuery(input);
        if (articleRequests >= 3)
            throw Error(
                "Altre ricerche sono in corso. Riprovare tra qualche secondo.",
            );
        articleRequests++;
        try {
            const request = (await pool()).request();
            request.input("article", driver.VarChar(128), definition.article);
            const result = await request.query(definition.sql);
            if (result.recordset.length > 100000)
                throw Error("Oltre 100.000 righe ordine per questo articolo.");
            return {
                rows: result.recordset.map((r: any) =>
                    Object.fromEntries(
                        Object.entries(r).map(([key, value]) => [
                            key,
                            value instanceof Date
                                ? value.toISOString().slice(0, 10)
                                : value,
                        ]),
                    ),
                ),
                queriedAt: new Date().toISOString(),
            };
        } finally {
            articleRequests--;
        }
    }
    return {
        async businessAnalysis(input: unknown) {
            const filters = validateBusinessRequest(input);
            if (filters.mode !== "manager") return executeArticleQuery(businessTableQuery(filters) as any);
            if (articleRequests >= 3) throw Error("Altre ricerche sono in corso. Riprovare tra qualche secondo.");
            articleRequests++;
            try {
                const definition = managerQuery(filters), request = (await pool()).request();
                for (const key of ["from", "to", "asOf"] as const) request.input(key, driver.Date, new Date(`${filters[key]}T00:00:00Z`));
                const result = await request.query(definition.sql);
                const names = ["backlog", "acquired", "monthly", "customers", "backlogValues", "backlogUnits", "purchases", "production"];
                return { ...Object.fromEntries(names.map((key, index) => [key, (result.recordsets[index] || []).map((row: any) => Object.fromEntries(Object.entries(row).map(([field, value]) => [field, field === "rows" && typeof value === "string" && Number.isSafeInteger(Number(value)) ? Number(value) : value])))])), period: { from: filters.from, to: filters.to, asOf: filters.asOf }, queriedAt: new Date().toISOString() };
            } finally { articleRequests--; }
        },
        async erpExplorer(input: unknown) {
            if (articleRequests >= 3) throw Error("Altre ricerche sono in corso. Riprovare tra qualche secondo.");
            articleRequests++;
            try { return await readErpExplorer(await pool(), driver, input); }
            finally { articleRequests--; }
        },
        stockAnalysis,
        stockCustomerCommitments,
        config,
        query,
        articleOrders,
        articleOffers,
        customerSearch,
        customerAnalysis,
        documentLinks: (input: unknown) => readDocument(input),
        documentLines: (input: unknown) => readDocument(input, true),
        bomAnalysis,
        barContracts,
        supplierDirectory,
        articleDirectory,
        async close() {
            const current = poolPromise;
            poolPromise = null;
            configPromise = null;
            if (current) await (await current).close();
        },
    };
}
export const analyticsService = createAnalyticsService();
