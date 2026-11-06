// Query del Power Query aziendale; nomi già trasformati come nel foglio Bilancino.
const source = `FROM dbo.MA_JournalEntriesGLDetail AS m
LEFT JOIN dbo.MA_ChartOfAccounts AS c ON m.Account = c.Account
WHERE (@fromDate IS NULL OR m.AccrualDate >= @fromDate)
  AND (@toDate IS NULL OR m.AccrualDate < @toDate)`;
export const ANALYTICS_QUERIES = {
    bilancino:{title:"Movimenti contabili",columns:["Riga","DataRegistrazione","DataCompetenza","Codice","Descrizione","CodSegno","TipoCodice","TipoImporto","CodClienteFornitore","Dare","Avere","Valore","IDRegistrazione"],
        sql:`SELECT m.Line AS Riga, m.PostingDate AS DataRegistrazione, m.AccrualDate AS DataCompetenza,
m.Account AS Codice, c.Description AS Descrizione, m.DebitCreditSign AS CodSegno,
m.CodeType AS TipoCodice, m.AmountType AS TipoImporto, m.CustSupp AS CodClienteFornitore,
CASE WHEN m.DebitCreditSign = 4980736 THEN m.Amount ELSE 0 END AS Dare,
CASE WHEN m.DebitCreditSign = 4980737 THEN m.Amount ELSE 0 END AS Avere,
CASE WHEN m.DebitCreditSign = 4980736 THEN m.Amount WHEN m.DebitCreditSign = 4980737 THEN -m.Amount ELSE NULL END AS Valore,
m.JournalEntryId AS IDRegistrazione
${source}
ORDER BY m.AccrualDate,m.JournalEntryId,m.Line`},
    "saldi-conti-annuali":{title:"Saldi contabili per anno e conto",columns:["Anno","Codice","Descrizione","Dare","Avere","Valore","Movimenti"],
        sql:`SELECT YEAR(m.AccrualDate) AS Anno,m.Account AS Codice,c.Description AS Descrizione,
SUM(CASE WHEN m.DebitCreditSign = 4980736 THEN m.Amount ELSE 0 END) AS Dare,
SUM(CASE WHEN m.DebitCreditSign = 4980737 THEN m.Amount ELSE 0 END) AS Avere,
SUM(CASE WHEN m.DebitCreditSign = 4980736 THEN m.Amount WHEN m.DebitCreditSign = 4980737 THEN -m.Amount ELSE 0 END) AS Valore,
COUNT_BIG(*) AS Movimenti
${source} AND m.CodeType <> 5177346
GROUP BY YEAR(m.AccrualDate),m.Account,c.Description
ORDER BY YEAR(m.AccrualDate),m.Account`},
};
export type AnalyticsQueryId = keyof typeof ANALYTICS_QUERIES;
export function queryDefinition(id:string) {
    if(!Object.prototype.hasOwnProperty.call(ANALYTICS_QUERIES,id))throw new Error("Analisi non disponibile.");
    return ANALYTICS_QUERIES[id as AnalyticsQueryId];
}
export function queryParameters(input:unknown) {
    if(!input || typeof input!=="object" || Array.isArray(input))throw new Error("Parametri non validi.");
    const params=input as Record<string,unknown>;
    if(Object.keys(params).some(key=>!["fromYear","toYear"].includes(key)))throw new Error("Parametro di analisi non previsto.");
    for(const name of ["fromYear","toYear"])if(params[name]!==undefined&&(!Number.isInteger(params[name])||Number(params[name])<1900||Number(params[name])>9998))throw new Error("Anno non valido.");
    if(params.fromYear!==undefined&&params.toYear!==undefined&&Number(params.fromYear)>Number(params.toYear))throw new Error("Intervallo anni non valido.");
    return {fromDate:params.fromYear===undefined ? null : new Date(Date.UTC(Number(params.fromYear),0,1)),toDate:params.toYear===undefined ? null : new Date(Date.UTC(Number(params.toYear)+1,0,1))};
}
