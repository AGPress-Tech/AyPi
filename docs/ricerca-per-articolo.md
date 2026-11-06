# Analisi Venduto per Articolo

Disponibile nella home, scheda **Analisi**, dopo Utilities. Il primo pulsante è Controllo di gestione (solo admin), il secondo è Analisi Venduto per Articolo, disponibile a tutti. Entrambi aprono finestre indipendenti e massimizzate, nel tema corrente di AyPi.

## Filtri

Almeno una condizione articolo è obbligatoria. Articolo, cliente (codice o ragione sociale), numero ordine e unità di misura supportano corrispondenza esatta, contiene, inizia con e intervalli di codici. I caratteri `%`, `_` e le parentesi sono trattati come testo nelle ricerche parziali.

Data ordine, consegna prevista, quantità, prezzo unitario e residuo supportano intervalli inclusivi, anche con un solo estremo. Per cercare una quantità precisa, inserire lo stesso valore in Da e A. Ogni filtro parte da una condizione e ne ammette fino a 20 con **Aggiungi alternativa/intervallo**. Le condizioni dello stesso filtro sono in OR, tipi diversi in AND. Nessun periodo implicito esclude gli anni storici.

Consegnato può essere Tutti/Sì/No. Gli ordini e le righe annullati sono esclusi inizialmente, con opzione per includerli. Il comando Azzera ripristina i filtri; la scelta delle colonne resta memorizzata sul PC.

## Risultati ed esportazione

Una riga per voce d’ordine, identificata da SaleOrdId + Line: lo stesso articolo può comparire più volte nello stesso ordine con quantità e consegne differenti. Ordinamento per articolo, poi data ordine decrescente, identificativo e riga per stabilità. Articoli diversi hanno separatori visivi. Intestazione e prima colonna restano fisse; tabella e filtri scorrono internamente alla finestra.

**Colonne** permette di mostrare/nascondere descrizione, numero ordine, riga, data ordine, consegna prevista, quantità, U.M., quantità consegnata, residuo, consegnato, prezzo unitario, prezzo netto, valuta, codice cliente, ragione sociale e annullamento. Articolo rimane sempre visibile. Le colonne non cambiano i filtri applicati ai dati.

Caricamento progressivo di 250 righe, con scorrimento o Carica altri risultati. Il totale è quello della ricerca SQL, mentre gli indicatori di ordini, articoli e residuo si riferiscono alle righe caricate. I residui sono separati per unità di misura e i prezzi mantengono la valuta della testata. La ricerca non annualizza né converte quantità o valute.

Esporta Excel legge **tutti i risultati**, anche quelli non ancora caricati a video, con le colonne scelte e un foglio di metadati/filtri. Oltre 100.000 righe richiede di restringere i filtri, senza produrre un export parziale. Le letture sono aggiornate al momento della richiesta: una modifica concorrente agli ordini può richiedere una nuova ricerca; l’export non costituisce uno snapshot transazionale del gestionale.

Un errore mantiene i risultati precedenti con avviso. Modificare un filtro non aggiorna silenziosamente i dati: occorre premere Cerca ordini; l’export viene disabilitato finché i filtri visibili non corrispondono alla ricerca applicata.

## Origine e definizioni

`POST /api/erp/article-orders`, solo SELECT parametrizzate, senza SQL arbitrario. Disponibile ai normali client della rete aziendale, come gli altri moduli operativi; non accetta né espone credenziali SQL. Le API `/api/analytics/*` del Controllo di gestione mantengono la sessione amministratore.

- Righe: `dbo.MA_SaleOrdDetails`; testate: `dbo.MA_SaleOrd`, join su SaleOrdId.
- Clienti: `dbo.MA_CustSupp`, join sul codice **e CustSuppType**, evitando l’omonimo fornitore.
- Data ordine: testata; consegna prevista: riga, con fallback sulla testata. Date convenzionali precedenti al 1900 sono mostrate come assenti.
- Quantità: Qty; consegnato: flag Delivered della riga; quantità consegnata: DeliveredQty.
- Residuo: max(Qty − DeliveredQty, 0), azzerato per righe consegnate o annullate o testate annullate. Una consegna parziale non implica Consegnato = Sì.
- Prezzo unitario: UnitValue; prezzo netto: NetPrice; valuta: Currency della testata. Nessuna conversione automatica in euro per ordini in altre valute.

Esempio verificato sul database reale: articolo `1272AOA77`, ordine `26/00913`, riga 2, data 02/11/2026, consegna prevista 06/11/2026, 30 NR, consegnati 0, residuo 30, Consegnato NO, prezzo unitario 5,58 EUR, cliente `0567` — RAF 1933 SERVICE SRLS.

## Verifiche

`tools/test-article-orders.cjs` controlla validazione, parametri SQL, condizioni OR/AND, date e limiti, separazione delle API operative dalle analisi admin. `tools/test-article-orders-ui.cjs` prova il vero launcher, i permessi, il messaggio dell’assistente, IPC limitato alla finestra autorizzata, filtri multipli, scroll, colonne, persistenza, export completo, escaping dei testi SQL, errore rete e layout nei due temi a 1920×1080, 1366×768 e 1024×680. Il collaudo sul gestionale usa il login di sola lettura già predisposto.
