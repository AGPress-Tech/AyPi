# Manuale Utente - Calendario Ferie, Permessi, Straordinari e Chiusure

Ultimo aggiornamento: 2026-01-28

Questo manuale spiega come usare il modulo "Ferie e Permessi" di AyPi per inserire richieste, consultare il calendario e gestire le funzionalita principali. E' pensato per dipendenti e operatori.

---

## 1) Panoramica del modulo

Il modulo permette di:
- Inserire richieste di Ferie/Permessi/Permessi Retribuiti.
- Registrare Straordinari.
- Registrare Mutua (inserimento con password, senza approvazione successiva).
- Registrare Permesso Chiusura Aziendale (inserimento con password, senza approvazione successiva).
- Visualizzare il calendario delle assenze/turni.
- Consultare richieste in attesa e approvate.

> Alcune funzioni sono riservate agli admin o richiedono password (es. sblocco filtri o inserimenti speciali).

---

## 2) Elementi principali dell'interfaccia

### 2.1 Barra in alto
- **Titolo e descrizione**: Calendario Dipendenti e Richieste.
- **Riepilogo**: mostra conteggio di richieste in attesa e approvate.
- **Filtri**: permettono di mostrare/nascondere i tipi di eventi (ferie/permessi, permessi retribuiti, straordinari, mutua, permesso chiusura aziendale).
- **Legenda**: indica i colori dei tipi evento.
- **Aggiorna**: ricarica i dati.
- **Impostazioni**: accesso a temi e ad alcune funzioni di configurazione.

### 2.2 Colonna sinistra (pannello gestione)
- **Richieste in attesa**: apre il pannello con le richieste da approvare.
- **Gestione**: pulsante che apre una finestra con:
  - Gestione dipendenti
  - Gestione ore
- **Festività e chiusure**: per configurare giorni festivi e chiusure aziendali.
- **Esporta ferie/permessi**: esporta dati in Excel.

### 2.3 Calendario centrale
- Visualizza le richieste approvate con colori diversi per tipologia.
- Le festivita/chiusure sono evidenziate con un colore di sfondo.
- Doppio click su un giorno: apre la vista giornaliera.

---

## 3) Inserimento di una nuova richiesta

Nella sezione Nuova richiesta:
1. **Seleziona reparto**.
2. **Seleziona dipendente**.
3. **Scegli il tipo**:
   - Ferie
   - Permesso
   - Permesso Retribuito
   - Straordinari
   - Mutua
   - Permesso Chiusura Aziendale
4. **Imposta date e orari**.
5. (Opzionale) **Aggiungi note**.
6. **Salva**.

### 3.1 Regole generali
- Le date devono essere coerenti (data fine non antecedente a data inizio).
- Per periodi di più giorni è richiesta la modalità "Giornata intera".

### 3.2 Tipi speciali

#### Permesso Retribuito
- Non necessita approvazione successiva.
- All'invio viene richiesta la **password admin**.
- Se la password � corretta, la richiesta viene inserita **direttamente nel calendario**.
- Non riduce il monte ore.

#### Mutua
- Non necessita approvazione successiva.
- All'invio viene richiesta la **password admin**.
- Se la password è corretta, la richiesta viene inserita **direttamente nel calendario**.

#### Permesso Chiusura Aziendale
- Funziona come lo straordinario (calcolo ore senza esclusione weekend).
- Se inserito durante giorni di **chiusura aziendale**, aumenta il saldo ore disponibili.
- Richiede **password admin** al momento dell'invio, senza approvazione successiva.

---

## 4) Filtri del calendario

I filtri permettono di mostrare o nascondere le tipologie.

- **Ferie/permessi**: attivo di default.
- **Straordinari**: disattivo di default (richiede password admin al primo utilizzo).
- **Mutua**: disattivo di default (richiede password admin al primo utilizzo).
- **Permesso Chiusura Aziendale**: disattivo di default (richiede password admin al primo utilizzo).
- **Permessi Retribuiti**: disattivo di default (richiede password admin al primo utilizzo).

> Una volta sbloccato un filtro, non richiede di nuovo la password finch� il modulo resta aperto.

---

## 5) Richieste in attesa

- Clicca su **Richieste in attesa** per aprire la lista.
- Da qui un admin può approvare o rifiutare.
- L'accesso richiede password admin.

---

## 6) Gestione (Dipendenti e Ore)

Clicca sul pulsante **Gestione**:
- Richiede password admin solo la prima volta.
- Si apre una finestra con due opzioni:
  - **Gestione dipendenti**
  - **Gestione ore**

### 6.1 Gestione dipendenti
- Permette di aggiungere o rimuovere reparti e dipendenti.

### 6.2 Gestione ore
- Mostra il saldo ore disponibile per ogni dipendente.
- Tiene conto delle richieste approvate, chiusure e permesso chiusura aziendale.

---

## 7) Festività e Chiusure aziendali

### 7.1 Festività
- Inserisci un nome e un intervallo date (da-a).
- Richiede password admin.
- Le festività non contano ai fini del conteggio ore ferie/permessi.

### 7.2 Chiusure aziendali
- Inserisci nome (opzionale) e intervallo date.
- Richiede password admin.
- Le chiusure scalano ore dal saldo dipendenti nel mese di riferimento.

---

## 8) Calendario

- **Colori**: ogni tipologia ha un colore dedicato (vedi legenda).
- **Tooltip**: passando col mouse su una richiesta, appare il dettaglio.
- **Festivit�/Chiusure**: evidenziate con sfondo colorato.
- **Doppio click**: entra nella vista giornaliera.

---

## 9) Export Excel

- Seleziona il periodo e le tipologie.
- Puoi filtrare per reparto.
- Se non ci sono dati, il sistema lo segnala.

---

## 10) Consigli utili

- Se non vedi una tipologia, controlla i filtri.
- Se un filtro � disattivo, potrebbe richiedere password.
- Usa �Aggiorna� se noti ritardi nei dati.

---

## 11) Glossario veloce

- **Ferie**: assenza programmata con consumo ore.
- **Permesso**: assenza breve con consumo ore.
- **Permesso Retribuito**: assenza giustificata che non riduce il monte ore.
- **Straordinari**: ore extra lavorate (non influenzano il saldo ferie).
- **Mutua**: assenza sanitaria inserita direttamente con password (non influenza il saldo ferie).
- **Permesso Chiusura Aziendale**: lavoro svolto in giorni di chiusura, accredita ore al saldo.

---

Per eventuali problemi o dubbi, contattare l'amministratore di sistema.

