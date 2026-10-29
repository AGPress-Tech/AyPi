# AyPi FORGE — roadmap MES / SCADA / Spatial

Stato: prima fondazione UI implementata il 29 ottobre 2026. Nome di lavoro scelto:
**AyPi FORGE**, il workspace industriale di AyPi; **FORGE Spatial** per la fabbrica
3D. Il nome richiama la lavorazione industriale e il forno, senza imporre un
acronimo artificiale. La direzione è un MES/SCADA moderno, personalizzabile e
leggero, costruito per il reparto e per i PC effettivamente disponibili.

## Fondazione consegnata

Percorso: **MES - SCADA → Apri FORGE → Centrale operativa**.

- Presentazione condivisa nei colori ambra AGPress e azzurro Blue Archive.
- Finestra FORGE dedicata, massimizzata e riutilizzata alla riapertura.
- Accesso al MES e Pianificatore attraverso il suo canale IPC esistente.
- Accesso a Scada Forno attraverso la sua finestra esistente.
- Verifica robot: 21D500, 21D600, 21D850 e selezione/verifica connessioni,
  con gli stessi handler, indirizzi e chiavi di lettura precedenti.
- Percorso reale `mes-scada.html`; `robot.html` mantiene compatibili i vecchi
  collegamenti mediante reindirizzamento. La navigazione principale usa `mes-scada`.
- FORGE Spatial e l'editor sono indicazioni di sviluppo futuro, senza azioni
  fittizie. La voce futura dell'editor appare solo in Blue Archive.

Questa fase aggiunge navigazione e identità grafica. L'hub non apre connessioni
alle macchine, non interroga il backend in background, non crea nuove tabelle
e non modifica acquisizioni, ordini, scheduler, analisi o registrazioni del forno.
La finestra forno rimane indipendente dalla chiusura dell'hub FORGE.

### Dove modificare l'interfaccia

- `src/renderer/pages/partials/forge-landing.html`: testi, pulsante e illustrazione
  della presentazione condivisa, sia in AGPress sia in Blue Archive.
- `src/renderer/pages/forge.html`: struttura della finestra operativa e della
  sottosezione Verifica robot.
- `src/renderer/styles/forge.css`: layout e colori dei due temi.
- `src/renderer/scripts/forge/landing.ts`: caricamento locale del frammento HTML
  e collegamento del pulsante. Non contiene markup o template HTML.
- `src/renderer/scripts/forge-scripts.ts`: navigazione, clic e orologio della
  finestra operativa.

Il normale `npm run build` copia anche il frammento HTML nel client e genera
l'installer. Per verificare soltanto la compilazione usare `npm run build:ts`.
Le modifiche si fanno sotto `src`, perché `dist-ts` viene rigenerata dalla build.

Per lavorare sulla grafica con ricaricamento automatico eseguire dalla cartella
AyPi `npm run preview:forge`. La finestra di sviluppo legge i sorgenti e prepara
i suoi file in una cartella temporanea, senza modificare `dist-ts` o gli installer.
Ogni salvataggio di HTML, CSS e script FORGE aggiorna la preview; in caso di errore
TypeScript l'ultima vista funzionante resta aperta e l'errore compare nel terminale.
Il menu **Pagina** offre Presentazione, Centrale FORGE e Verifica robot; **Tema**
sceglie ambra o azzurro; F12 apre gli strumenti sviluppatore. Si può partire in
azzurro con `npm run preview:forge -- --bluearchive`.
La presentazione viene mostrata nel contenitore di sviluppo, senza avviare tutto
il portale AyPi. I comandi verso MES, forno e robot sono simulati; richieste di
rete e apertura di finestre esterne sono bloccate. La chiusura della finestra
arresta la preview. Per la verifica automatica: `npm run preview:forge -- --smoke`.

## Riferimento e adattamento

Il riferimento indicato è [cc-mek-scada](https://github.com/MikaylaFischler/cc-mek-scada):
il repository distingue supervisore, coordinatore/HMI e collegamenti RTU/PLC.
In FORGE prendiamo come ispirazione la chiarezza dei ruoli e la supervisione
modulare. Grafica, dominio operativo, protocolli e modello dati rimangono propri
di AyPi; non si trasferiscono logiche dei reattori o asset del progetto Minecraft.

## Principi dell'ecosistema

1. **Un'identità macchina:** un ID stabile collega MES, segnali, layout, storico
   e note. Posizione e nome visualizzato possono cambiare senza perdere il legame.
2. **Acquisizione centrale:** il backend/collector raccoglie una volta; i client
   consumano snapshot e aggiornamenti. Il numero di finestre non moltiplica le
   letture di campo. Gli asset della scena non interrogano direttamente PLC/forno.
3. **Qualità esplicita:** ogni lettura ha valore, unità, timestamp, sorgente e
   qualità; Off, dato vecchio, errore e assenza di acquisizione sono stati distinti.
4. **2D e 3D condividono i dati:** la scena apre i dettagli MES e i grafici già
   presenti. Si evita una seconda implementazione delle regole di produzione.
5. **Personalizzazione ordinata:** preferenze di vista locali; layout e binding
   di impianto condivisi, versionati e modificabili da utenti autorizzati.
6. **Aggiornamenti progressivi:** ogni fase mantiene operativi i moduli esistenti,
   con un ritorno alla vista 2D quando il 3D non è disponibile o non serve.

## Piano per i prossimi mesi

L'ordine conta più delle date. Ogni fase si chiude con una verifica sul reparto;
il calendario si decide dopo il primo prototipo e i riscontri degli operatori.

| Fase | Risultato concreto | Criterio per passare alla fase successiva |
|---|---|---|
| 0 · Hub FORGE | Presentazione, temi e accessi ai tre moduli. | Navigazione, riapertura finestre e controlli robot verificati nei due temi. |
| 1 · Standard GUI e stati | Componenti comuni per intestazioni, navigazione, stato connessione, filtri, tooltip e dettagli. Migrazione un modulo alla volta. | Stato/qualità leggibili allo stesso modo in forno e MES; preferenze esistenti conservate. |
| 2 · Registro asset e segnali | Identità condivise di stabilimento, reparto, macchina, sorgente e segnale; associazione agli ID reali già presenti. | Una pressa e il forno identificati senza duplicare le anagrafiche MES o reinterpretare gli stati. |
| 3 · FORGE Spatial, primo viewer | Un reparto pilota 3D con pochi asset, navigazione, selezione, stato e collegamento alle schermate 2D. | Layout leggibile sul PC operatore, comportamento offline esplicito e traffico misurato. |
| 4 · Editor impianto | Posiziona/ruota/ridimensiona oggetti, imposta reparti e associa macchine/segnali. Bozza, annulla/ripeti, salva e pubblica. | Versioni concorrenti protette, recupero del layout precedente e autorizzazioni verificate. |
| 5 · Supervisione nello spazio | Valori selezionabili, colori per stato, etichette, dettagli macchina e timeline 2D/3D coerenti. | Letture uguali al MES/forno, qualità e tempi corretti, nessuna richiesta per ogni oggetto a ogni frame. |
| 6 · Contesto di produzione | Collegamento fra ordini, fasi, cicli forno, note ed eventi; filtri e confronti. | Tracciabilità verificata su casi reali, senza attribuzioni automatiche ambigue dei cicli agli ordini. |
| 7 · Workspace personalizzabili | Dashboard, viste per reparto/ruolo, preset operatore e condivisione delle configurazioni. | Una modifica di vista non altera layout pubblicato o acquisizione; prestazioni monitorate. |

Indicativamente: primo ciclo di sviluppo dedicato a standard e registro asset;
secondo ciclo al viewer di un reparto; terzo all'editor e ai binding. Estensione
all'intera fabbrica e analisi incrociate seguono i risultati del pilota.

## Come partire dal magazzino 3D esistente

Il viewer attuale usa Three.js, OrbitControls, raycasting e preferenze di vista
in `src/renderer/scripts/warehouse-3d-scripts.ts`; la finestra e il flusso dati
sono gestiti da `src/main/modules/file-manager/warehouse-inventory-ipc.ts`.
Il contenuto e il layout sono legati a scaffali, ubicazioni e movimenti di magazzino.

Prima del prototipo Spatial si inventariano i pezzi riutilizzabili: camera e
controlli, selezione, luci, materiali, gestione dimensioni e preferenze. Si estrae
un piccolo nucleo condiviso con test sul magazzino; il modello della fabbrica
resta separato dalle ubicazioni e dalle regole del magazzino. Si evitano una
copia integrale del viewer e una sua riscrittura simultanea.

Il primo prototipo comprende: pavimento, ingombri semplificati, forno, una pressa
e una cella robotizzata. Una vista dall'alto deve essere utile già senza modelli
realistici. Asset complessi/importazione CAD e l'intero stabilimento arrivano dopo.

## Modello dati proposto, da validare prima dell'implementazione

- `Plant`: stabilimento, reparti, unità di misura e coordinate di riferimento.
- `Asset`: UUID stabile, tipo, codice macchina MES esistente e metadati descrittivi.
- `SceneObject`: UUID, asset associato, geometria/modello e trasformazione spaziale.
- `SignalBinding`: asset, sorgente/segnale esistente, unità, formato e regola di qualità.
- `LayoutRevision`: revisione, autore, data, bozza/pubblicato e snapshot del layout.
- `ViewPreset`: camera, livelli, filtri, etichette e preferenze locali o condivise.

Gli ID del MES non si sostituiscono. Il registro crea riferimenti espliciti e
controlla le associazioni; un asset può avere più oggetti visivi e più segnali.
Ogni modifica pubblicata deve validare riferimenti, tipi, limiti e conflitti di
revisione. Collocazione delle nuove tabelle/archivi da decidere con una proposta
di migrazione concreta, senza cambiare preventivamente gli archivi attuali.

## Trasporto e prestazioni

Si parte dal trasporto forno già presente: snapshot storici compatti, frame live
con sequenza, qualità, timestamp e recupero dopo disconnessione. Per il MES si
definisce un contratto di lettura coerente con i servizi esistenti; frequenze e
priorità dipendono dai segnali, non dal refresh grafico o da un valore unico per
tutte le macchine.

La scena usa sottoscrizioni per reparto/asset e cache condivise; letture più
dettagliate soltanto per la macchina selezionata. Il rendering si misura su PC
aziendali: etichette limitate, geometrie riutilizzate, istanze dove utili, qualità
grafica regolabile, pausa in background e riduzione delle animazioni. Si separano
frequenza di acquisizione, frequenza di rete e frequenza di disegno.

Prima di ogni estensione si confrontano tempi di apertura, risposta ai comandi
grafici, RAM, CPU/GPU, byte/s per client e ritardi dei campioni con una baseline
reale. I limiti vengono fissati dopo il pilota, senza promettere prestazioni
da una semplice dimensione del DB o dal numero teorico di macchine.

## Editor e autorizzazioni

L'accesso grafico all'editor sarà visibile in Blue Archive come richiesto.
La scrittura richiederà comunque un'autorizzazione esplicita verificata dal
backend: il tema non è un permesso. La pubblicazione del layout avrà validazione,
controllo delle revisioni, storico autore/data e recupero della versione precedente.
I permessi di modifica degli ordini e le funzioni operative esistenti conservano
le loro regole. L'editor iniziale modifica il modello spaziale e le associazioni.

## Decisioni del prossimo passo

Prima di scrivere il 3D definiamo un reparto pilota, riferimento dimensionale
(planimetria o misure), asset iniziali, tre/quattro dati utili per macchina e PC
di riferimento. Poi produciamo un prototipo locale del viewer con dati simulati
chiaramente riconoscibili, seguito dall'associazione in lettura agli asset reali.
Il primo obiettivo è rendere utile la selezione di una macchina e l'apertura dei
suoi dati esistenti; l'editor completo segue quel risultato.
