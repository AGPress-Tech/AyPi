# Analisi Offerte per Articolo

Terzo pulsante della scheda **Analisi**, dopo Controllo di gestione e Analisi Venduto per Articolo. Accessibile ai normali utenti AyPi, apre una finestra indipendente e massimizzata, nello stesso tema della home. Può restare aperta insieme alle altre analisi.

Partendo da almeno un articolo mostra le offerte clienti in cui compare, con **Articolo, N. offerta, Data offerta, Codice cliente/contatto, Cliente, Quantità offerta, U.M., Prezzo offerto e Valuta**. Descrizione articolo, riga, tipo destinatario e prezzo netto sono colonne aggiuntive selezionabili. L’articolo rimane sempre visibile.

## Filtri e risultati

Le intestazioni supportano [ordinamenti multipli](ordinamento-analisi.md): clic per aggiungere/invertire, Ctrl+clic per rimuovere il criterio, **Rimuovi ordinamenti** per azzerare la sequenza. L’ordine di scelta resta la priorità dell’ordinamento anche cambiando i filtri, caricando altre pagine ed esportando in Excel.

Stesso funzionamento dell’Analisi Venduto: ogni filtro parte da una condizione e ne può aggiungere fino a 20. Alternative dello stesso filtro in OR, tipi diversi in AND.

- Articolo, cliente, numero offerta e U.M.: esatto, contiene, inizia con o intervallo di codici.
- Data offerta, quantità e prezzo offerto: intervalli inclusivi, anche con un solo estremo; usare Da = A per cercare un valore preciso.
- Ricerca su uno o più articoli e su più periodi, senza un anno predefinito che nasconda lo storico.

La tabella scorre internamente, con intestazioni e articolo fissi, caricamento progressivo di 250 righe e separatori quando si confrontano più articoli. Ogni voce d’offerta resta distinta, anche se lo stesso articolo compare più volte nello stesso documento. Le preferenze delle colonne sono separate da quelle del Venduto.

Il totale delle righe è quello della ricerca SQL; gli indicatori di offerte, articoli e quantità si riferiscono alle righe caricate. Le quantità sono distinte per U.M. I prezzi mantengono la valuta dell’offerta, senza conversioni o medie tra valute differenti.

Esporta Excel include tutti i risultati e le colonne selezionate, con un foglio di filtri/metadati; oltre 100.000 righe richiede di restringere la ricerca, senza salvare un export parziale. Come nel Venduto, le letture successive riflettono il gestionale corrente e non costituiscono uno snapshot transazionale.

## Dati del gestionale

API `POST /api/erp/article-offers`, solo SELECT parametrizzate tramite il login di sola lettura già predisposto. Non richiede credenziali SQL sui client o accesso admin AyPi.

- Testata `dbo.MA_CustQuotas`, righe `dbo.MA_CustQuotasDetail`, join su CustQuotaId; chiave della riga CustQuotaId + Line.
- Numero e data: QuotationNo e QuotationDate della testata. Date convenzionali precedenti al 1900 trattate come assenti.
- Quantità e U.M.: Qty e UoM della riga d’offerta, non le quantità dell’ordine successivo.
- Prezzo offerto: UnitValue della riga, prima degli sconti di riga. Prezzo netto selezionabile: NetPrice. Valuta: Currency della testata.
- Clienti: MA_CustSupp con codice e CustSuppType, evitando fornitori omonimi. Per offerte con UseContact = 1 si usano codice e ragione sociale di MA_Contacts.
- Sono consultabili anche offerte storiche, archiviate o trasformate in ordine; non viene applicato un filtro implicito sul loro stato.

Esempio verificato sul database reale: articolo `1272AOA77`, offerta `26/00622`, riga 3, data 02/11/2026, cliente `0567` — RAF 1933 SERVICE SRLS, **1 NR a 5,58 EUR**. Il successivo ordine `26/00913` contiene 30 NR: le due analisi preservano le rispettive quantità.

## Verifiche

`tools/test-article-offers.cjs`: filtri obbligatori, limiti, periodi, parametri SQL, origine offerte, clienti/contatti e separazione dalle API economiche admin. `tools/test-article-orders-ui.cjs`: nuovo pulsante, finestre contemporanee, isolamento IPC, filtri multipli e più periodi, colonne e preferenze separate, export completo e layout nei due temi a 1920×1080, 1366×768 e 1024×680. Query reali di sola lettura verificano il caso sopra e il confronto su più periodi; le regressioni del Venduto restano attive.
