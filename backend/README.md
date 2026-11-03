# AyPi Backend

Backend generale di `AyPi`.

Primo modulo migrato:

- `ferie-permessi`

Comandi dal repository root:

- `npm run start:backend`
- `npm run build:backend`
- `npm run start:backend:tray`
- `npm run dist:backend`

Profili:

- `start:backend` usa profilo `dev`
  - host `127.0.0.1`
  - dati `C:\Users\admin\Desktop\AyPi\AGPRESS`
- `dist:backend` produce un installer Windows per il backend server
  - host `192.168.1.240`
  - calendar `\\Dl360\pubbliche\TECH\AyPi\AGPRESS\AyPi Calendar`
  - general `\\Dl360\pubbliche\TECH\AyPi\AGPRESS\General`

Configurazione runtime opzionale:

- file `aypi-backend.runtime.json` accanto all'exe
- oppure env:
  - `AYPI_BACKEND_HOST`
  - `AYPI_BACKEND_ADVERTISED_HOST`
  - `AYPI_BACKEND_PORT`
  - `AYPI_FP_CALENDAR_DIR`
  - `AYPI_FP_GENERAL_DIR`
  - `AYPI_LOG_DIR`
  - `AYPI_MES_DB_PATH` (archivio separato dedicato al MES)
  - `AYPI_MOBILE_GATEWAY_ENABLED` (`true` di default)
  - `AYPI_MOBILE_GATEWAY_HOST` (`127.0.0.1` di default)
  - `AYPI_MOBILE_GATEWAY_PORT` (`3010` di default)
  - `AYPI_MOBILE_SESSION_DAYS` (da 1 a 30, `7` di default)

Gateway mobile Calendar:

- parte insieme al backend generale, ma ascolta solo su `127.0.0.1:3010`
- accetta esclusivamente amministratori con accesso Calendar
- usa sessioni Bearer revocabili e WebSocket autenticato
- non pubblicare direttamente la porta backend `3000`
- dopo l'installazione sul server, pubblicare il solo gateway con:
  - `tailscale funnel --bg http://127.0.0.1:3010`

Avvio automatico server:

- l'installer Windows richiede i privilegi amministrativi e registra automaticamente
  l'attività pianificata `AyPiBackend`
- l'attività parte all'accensione del PC come `SYSTEM`, senza attendere il login,
  avvia l'exe con `--headless` e lo riavvia in caso di arresto anomalo
- la disinstallazione arresta il backend e rimuove automaticamente l'attività
- per la gestione manuale restano disponibili:
  - `backend/scripts/install-server-task.ps1`
  - `backend/scripts/uninstall-server-task.ps1`


### Gestione completa dei programmi (03/11/2026)

Dopo il collaudo riuscito, la nuova revisione abilita manage in produzione.
Aggiornare sia backend sia applicazione desktop. Il nuovo installer eredita
manage anche dai JSON precedenti privi di forno.programTransfers. Un valore
tests esplicito resta limitato ai TEST_; impostare manage per gestire anche i
preesistenti. off e ambiente esplicito restano rispettati. Nessun avvio remoto.

Lista in Reset: selezionare un ciclo lo carica in Reset e legge la versione
salvata; Modifica programma apre l'editor. Salva bozza conserva sul PC; Invia al
forno permette Nuovo oppure Sovrascrivi, con riepilogo e conferma separata.
Elimina dal forno prepara una cancellazione distinta dall'eliminazione locale.
L'archivio locale apre una versione nell'editor per l'invio esplicito.

Backup completo prima delle operazioni, riferimento di lettura per evitare
conflitti e nuovo Load/confronto prima di sovrascrivere o eliminare. Copia locale
della ricevuta e, quando convertibile, bozza precedente anche nell'archivio.
Le letture aggiornano il programma caricato, senza avviarlo. Non usare pannello
o iTools durante le operazioni. Dettagli: [revisione programmi forno](../docs/backend-forno-management-2026-11-03.md).
