# Giacenze — analisi commerciali

Il modulo **Analisi commerciali → Giacenze** legge i saldi del gestionale ERP. Non legge il prototipo di inventario fisico AyPi e non modifica il gestionale.

## Fonte e calcoli

Schema verificato in sola lettura su NuovaAGP il 20 novembre 2026:

- `MA_ItemsStorageQty`: chiave articolo, deposito, tipo/codice specificatore, esercizio e periodo. Giacenza = `InitialQty + ReceivedQty − IssuedQty`.
- `MA_Items`: descrizione, unità base e stato dell’articolo.
- `MA_Storages`: descrizione del deposito, stato e flag `OwnedGoods`. Il flag distingue proprietà aziendale / di terzi; un’anagrafica mancante resta non definita.
- `MA_CustSupp`: codice **e tipo**. Specificatore `6750208` → cliente `3211264`; `6750209` → fornitore `3211265`. Codici omonimi cliente/fornitore non devono moltiplicare le righe o scambiare le ragioni sociali. Gli altri specificatori rimangono espliciti.

Il soggetto associato non certifica da solo chi sia il proprietario legale della merce; il deposito può riferirsi anche a lavorazioni o merce presso terzi. `DefaultLocation` è un’ubicazione predefinita, non una rilevazione fisica. Le tabelle lotti non contenevano saldi nella fonte verificata: non sono aggiunti dettagli inventati per lotto.

Disponibile netto impegni = giacenza − `ReservedSaleOrd` − `ReservedByProd`. Disponibilità prevista aggiunge `OrderedPurchOrd` e `OrderedToProd`, senza una verifica delle date di consegna. `PickedQty` e `AllocatedQty` sono visibili separatamente, senza sottrarli di nuovo. Queste quantità non sono un’autorizzazione operativa al prelievo. Non viene calcolata una valorizzazione economica dai prezzi anagrafici.

Il filtro **Esercizio / periodo** permette la selezione multipla con checkbox e Applica selezione. All’apertura si usa l’ultimo esercizio presente non successivo all’anno corrente del server e il suo ultimo periodo disponibile; Ultimo ripristina questa lettura. I saldi selezionati rimangono distinti: non si sommano giacenze di esercizi/periodi successivi dello stesso articolo. Con più periodi, tabella ed Excel mostrano esercizio e periodo subito dopo il codice articolo; anche i totali per U.M. sono distinti per periodo. Aggiorna conserva la selezione. Il limite di 100.000 posizioni si applica alla lettura complessiva: una lettura incompleta o fallita non sostituisce la selezione già visualizzata. I periodi registrati non ricostruiscono uno storico a una data arbitraria.

## Interfaccia

Una riga per articolo, U.M., esercizio e periodo, espandibile nel dettaglio magazzino / soggetto. Le quantità con unità differenti restano separate, anche nei KPI. Il riepilogo superiore usa al massimo tre decimali; valori originali, tabelle, tooltip ed Excel mantengono la precisione precedente. I filtri selezionano prima le posizioni e quindi i riepiloghi: scegliendo un deposito si vedono le quantità di quel deposito. Codice articolo esatto, descrizione, U.M., magazzini multipli, proprietà, nome/codice e tipo soggetto, saldi zero, negativi, impegni oltre giacenza e sotto scorta minima sono disponibili nel menu laterale.

Le anomalie del dettaglio non scompaiono se due depositi si compensano nel totale articolo. I dati quantitativi mancanti non diventano zero; i totali per U.M. parziali sono marcati. Scorte minime/massime diverse per posizione non si sommano nel riepilogo.

Colonne personali e dieci preset di ricerca riutilizzano le interazioni delle altre analisi. I preset conservano filtri e colonne, mentre gli esercizi / periodi rimangono quelli della lettura corrente. Intestazioni e codice articolo fissi, divisori, ordinamento multiplo sull’intera selezione e caricamento per append tramite `table-scroll-loader.ts`. Gli esplosi rimangono aperti durante l’append. Il menu contestuale per cella usa la navigazione condivisa; gli altri moduli propongono Giacenze solo quando la ricerca esatta ha saldi pertinenti.

Excel contiene il riepilogo nelle colonne scelte, il dettaglio completo, i totali per U.M. e le informazioni sulla lettura/formule. Numeri, codici testuali e date conservano il tipo e la precisione. La lettura usata per esportare è la stessa cache applicativa visualizzata, filtrata nuovamente nel processo principale.

## Installazione e verifiche

Richiede **frontend e backend aggiornati**, con la nuova rotta `POST /api/erp/stock-analysis`. Riutilizza la connessione SQL analytics esistente; non richiede migrazioni o importazioni dati. Le query sono statiche e parametrizzate, con limiti di concorrenza e risultati. La rotta segue il perimetro di accesso già usato dalle altre letture ERP; i canali Electron accettano soltanto la finestra proprietaria.

- `node tools/test-stock-analysis.cjs`: calcoli, filtri, proprietà/unità, anomalie, validazione, query parametrizzate, limite risultati e HTTP.
- `electron tools/test-stock-analysis-ui.cjs`: autorizzazione IPC, append, esplosi, filtri/preset, Excel, esercizi, errori, contesto esatto e riuso finestra, intestazioni fisse e geometria nei due temi a 1500×940 e 1000×680.
- `AYPI_TEST_REAL_STOCK=1` abilita una verifica opzionale contro lo snapshot locale ignorato da Git `.private/stock-live.json`; non incorpora dati aziendali nel test o nel prodotto.

Riferimenti: `backend/src/modules/analytics/stock-analysis.ts`, `src/main/modules/stock-analysis/`, pagina/script/stile `stock-analysis`.

La selezione multipla riutilizza l’endpoint backend per periodo, con al massimo due letture contemporanee e pubblicazione della sola raccolta completa. Per questa estensione non occorre modificare il backend già compatibile con Giacenze. I test Electron coprono anche confronto 2026/2025 senza somme, metadati periodo obbligatori, Excel, tre decimali nei KPI e fallimento di una singola lettura senza sostituire i dati precedenti.
