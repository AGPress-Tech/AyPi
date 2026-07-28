# Refactoring architetturale AyPi

## Obiettivo

Ridurre progressivamente i file monolitici senza cambiare il comportamento
dell'applicazione. Ogni tranche deve compilare autonomamente e lasciare gli entry
point esistenti compatibili.

## Baseline del 27 luglio 2026

Le aree più critiche rilevate dall'audit iniziale sono:

| Area | File | Righe iniziali |
| --- | --- | ---: |
| Electron main | `src/main/modules/fileManager.ts` | 4.076 |
| Calendar renderer | `ferie-permessi-scripts.ts` | 3.483 |
| Purchasing renderer | `product-manager-scripts.ts` | 3.352 |
| Hierarchy renderer | `hierarchy-scripts.ts` | 2.485 |
| Attrezzaggio renderer | `attrezzaggio-scripts.ts` | 2.237 |
| Ticket renderer | `ticket-support-scripts.ts` | 2.007 |

Non è presente una suite di test automatizzati generale. Le verifiche disponibili
sono compilazione TypeScript, build renderer e alcuni smoke test mirati.

## Struttura target

### Electron main

`fileManager.ts` rimane temporaneamente una façade di registrazione IPC. La logica
viene spostata per responsabilità in `src/main/modules/file-manager/`:

- servizi senza stato UI, per esempio address book e client backend;
- controller IPC, raggruppati per feature;
- factory e registro delle finestre;
- esportazione report e integrazioni Git/GitHub.

La façade non deve tornare ad acquisire logica di dominio.

### Renderer

Ogni utility mantiene un entry point piccolo che esegue solo il bootstrap. Il
codice della feature vive nella cartella omonima ed è separato in:

- `state/`: stato e sessione;
- `services/`: I/O e chiamate backend;
- `domain/` o `utils/`: trasformazioni pure;
- `ui/`: rendering e binding DOM;
- `sections/`: coordinamento di una singola sezione della pagina.

Il codice realmente condiviso tra feature vive in `scripts/shared/`; non vanno
create dipendenze da una feature verso cartelle interne di un'altra feature.

### Backend

La struttura `route -> service -> repository` già presente viene mantenuta.
Codec, backup, database e primitive di storage comuni vivono in `shared/`.
Le repository di feature non devono duplicare primitive generiche.

## Regole operative

1. Una tranche sposta una sola responsabilità coerente.
2. Prima dello spostamento si esegue la build di baseline.
3. Gli entry point e i canali IPC restano stabili durante la migrazione.
4. Le funzioni pure condivise vengono estratte solo quando la semantica è
   identica, non soltanto perché il nome coincide.
5. Niente nuove dipendenze circolari tra feature.
6. Ogni tranche termina con `npm run build:ts` e `npm run build:backend`.

## Roadmap

1. **Fondazioni condivise — completato**: address book, client backend, percorsi
   Calendar, codec JSON, validazioni comuni e storage allegati delle schede
   Attrezzaggio.
2. **Electron main — in corso**: preset e IPC Batch Rename ed esportazione
   Gerarchia, accesso file di rete, client GitHub, snapshot e calcoli data Git
   sono stati estratti. Anche gli otto canali CRUD Transfer/Haas e la costruzione
   dei codici scheda vivono in un registrar Attrezzaggio coperto da smoke test.
   Selezione cartelle, salvataggio file e relativo stato del dialogo sono
   centralizzati in un registrar filesystem testato separatamente. Anche
   caricamento e riconfigurazione della rubrica percorsi e l'apertura di
   file, cartelle e URL sono isolati nel controller di navigazione. Lo stato
   amministratore e il relativo broadcast verso tutte le finestre sono gestiti
   da un registrar dedicato. La sessione condivisa Product Manager/Ticket
   Support e il flag monouso di logout forzato sono incapsulati in uno state
   object, mentre i relativi canali IPC vivono nello stesso modulo. I bridge
   sincroni per directory dati, URL backend e debug renderer di Ferie-Permessi
   sono raccolti in un registrar di configurazione testato. Selettore immagini,
   message box condivisa e lettura versione sono stati spostati nel registrar
   delle utility native. Ricerca repository, parsing del log e dei tag Git,
   aggregazione dei diff settimanali usata dal fallback GitHub, cache locale e
   persistenza delle statistiche sono ora nel servizio Git locale con registrar
   IPC dedicato. Anche i resize legacy della finestra principale e la protezione
   del layout persistente Blue Archive sono isolati in un controller finestra.
   Generazione, pulizia temporanei, apertura e canale IPC dell'anteprima PDF
   Attrezzaggio vivono ora in un controller autonomo.
   Restano l'orchestrazione delle statistiche GitHub, il fallback del report, il
   registry delle finestre e gli altri controller IPC per feature.
   `fileManager.ts` è sceso a 2.786 righe.
3. **Calendar — in corso**: costruzione delle richieste e stato colori sono
   moduli autonomi; anche trasporto HTTP e operazioni atomiche su richieste,
   festività e chiusure sono ora nel client API dedicato. Dominio e client sono
   coperti da smoke test. Persistenza per utente, coercizione legacy, restrizioni
   di accesso e sincronizzazione UI dei filtri sono ora in un controller di stato
   testato. Trasporto, normalizzazione e decisioni della configurazione accessi
   sono centralizzati in una policy condivisa anche dal modale approvazioni.
   Il vecchio editor inline di reparti/dipendenti, ormai scollegato e sostituito
   dalla finestra `assignees-manager`, è stato rimosso insieme al relativo stato
   morto. Restano controller calendario e riduzione del bootstrap. L'entry point
   è sceso a 2.778 righe.
4. **Purchasing — in corso**: raccolta, validazione e costruzione delle richieste
   sono nel dominio dedicato e coperte da smoke test; i renderer delle righe
   prodotto e intervento sono stati separati con dipendenze esplicite. Anche le
   regole di proprietà, modifica ed eliminazione delle righe sono ora nel dominio
   e coperte da casi automatici. Lettura, validazione, aggiornamento cache e
   persistenza backend delle richieste sono raccolti in un request store con
   smoke test dedicato. Il multiselect di modifica, il controller dei modali
   carrello e le mutazioni con relativo storico sono stati separati in UI e
   dominio; anche conferma e cancellazione sono coordinate da un controller
   dedicato. Catalogo, categorie e tipologie condividono ora uno store validato,
   mentre gli assegnatari usano la normalizzazione comune. I wrapper duplicati
   delle sezioni Catalogo e Interventi sono stati sostituiti da controller
   associati a context provider. Restano da restringere i context e separare
   bootstrap e amministrazione; il controller login e il guardrail dichiarativo
   dei binding sono già separati e coperti dagli smoke test di dominio. Anche
   verifica password, recupero e azioni amministrative protette hanno ora un
   controller con stato interno. Backup/ripristino e presentazione della modalità
   acquisto/intervento sono componenti UI autonomi. L'entry point è sceso a
   2.380 righe, sotto il renderer Attrezzaggio.
5. **Ticket e attrezzaggio — in corso**: lo storage allegati backend è condiviso;
   restano da separare dominio renderer, persistenza, notifiche e UI.
6. **Gerarchia — in corso**: clonazione e ordinamento dell'albero,
   normalizzazione ed esecuzione dei filtri, formattazione dimensioni e righe
   per l'export sono nel primo modulo di dominio testato. La scansione ricorsiva,
   i metadati file e il progresso sono in un servizio filesystem verificato su
   directory temporanee reali. Restano statistiche, ricerca e rendering.
   L'entry point è sceso a 2.606 righe.
7. **CSS e HTML**: suddividere per componenti dopo aver stabilizzato i confini
   TypeScript, evitando di fare contemporaneamente refactoring logico e visuale.
8. **Guardrail**: introdurre test per funzioni pure e limiti graduali alla
   crescita degli entry point.
