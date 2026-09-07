# Caricamento allegati

Gli allegati di Transfer, HAAS, registrazioni di progettazione (comprese le fasi)
e le immagini del catalogo vengono trasferiti in blocchi. Il limite JSON di
10 MiB rimane per i dati della scheda e non limita più il totale degli allegati.

- Nessun limite aggiuntivo sul numero di allegati per scheda.
- Massimo 1 GiB per singolo file, senza compressione o modifica degli originali.
- Lettura dal disco e trasferimento sequenziale in blocchi da 768 KiB;
  non viene creata una copia Base64 di tutti gli allegati in memoria.
- Ogni blocco viene ritentato fino a tre volte. Il server riconosce i blocchi
  già ricevuti, controlla l'ordine e verifica la dimensione prima di finalizzare.
- La scheda viene inviata solo dopo il completamento di tutti i caricamenti.
  In caso di errore il modulo mantiene gli allegati selezionati per riprovare.
- I file temporanei vengono eliminati dopo il tentativo di salvataggio.
  Quelli abbandonati da client chiusi o disconnessi scadono dopo 24 ore e
  vengono rimossi all'avvio del server o al successivo caricamento.
- Il server necessita di spazio per i file temporanei nella cartella temporanea
  dell'account che esegue il servizio, oltre allo spazio per gli allegati definitivi.

## Aggiornamento

Aggiornare prima il backend, poi i client AyPi. Il backend aggiornato continua
ad accettare i vecchi allegati Base64; i nuovi client richiedono le nuove API
`/api/uploads`. La sola installazione del client non aggiorna il servizio remoto.

Non occorre migrare database o allegati esistenti.

## Verifica

`node --test tools/test-attachment-uploads.cjs`

Il test trasferisce 25 file da oltre 12 MiB ciascuno via HTTP, ne verifica
l'integrità SHA-256, simula una risposta persa e una rete indisponibile,
controlla la pulizia dei temporanei e la validazione dei blocchi. Verifica anche
salvataggio, lettura e conservazione di 25 allegati nelle API dei tre moduli,
i riferimenti alle fasi di progettazione e l'upload dell'immagine catalogo.
Database e file di prova sono isolati dai dati applicativi.
