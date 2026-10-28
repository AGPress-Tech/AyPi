# Collector MES senza Python

La cattura e la decodifica PROFINET sono ora in `src/main/modules/plc-reader`:

- `capture.ts`: accesso in sola lettura a Npcap/libpcap tramite Koffi.
- `engine.ts`: decoder Ethernet/VLAN PN-RT, contatori e transizioni.
- `worker.ts`: processo separato, CSV compatibili e snapshot IPC.

Il processo viene avviato con lo stesso eseguibile Electron di AyPi: niente Python,
Scapy, Node separato o compilatori sui PC di produzione. Il pacchetto contiene Koffi
e i relativi binari Node-API. Npcap resta un prerequisito SOLO sul collector LIVE;
non si installa sul server per il forno o sui PC che consultano i dati. Npcap non
viene ridistribuito nel pacchetto AyPi.

Restano invariati mapping `macchine.json`, moltiplicatori, import CSV, invio snapshot
al backend ogni 5 s e schema/database MES. La selezione dell'interprete e stata
rimossa sia dal PLC Reader sia dal pannello MES del Production Planner. Le vecchie
impostazioni Python vengono ignorate; si conserva la scheda selezionata.

La cattura e passiva: non sono esposte API di invio o scrittura PLC. Un filtro BPF
limita i frame consegnati al collector a PROFINET/VLAN ed esclude il MAC della CPU
centrale. La lettura Npcap e non bloccante e viene eseguita nel processo separato,
con un budget per giro per permettere comandi e snapshot. I drop del driver sono
riportati nello snapshot `capture`; non vengono inventati conteggi mancanti.

I CSV mantengono nomi, colonne, separatore `;`, BOM UTF-8 e timestamp con offset.
La coda delle scritture e limitata: un errore disco o una coda eccessiva arresta il
collector con errore. Le transizioni su CSV restano limitate a 100.000/sessione.
Gli eventi di sola visualizzazione sono limitati in memoria (i contatori e CSV
continuano a conservare gli eventi di produzione).

Verifiche:

```powershell
npx tsc -p tsconfig.json
node --test tools/test-plc-engine.cjs
```

Il test `tools/test-plc-reader.cjs`, eseguito con Electron, verifica interfacce,
simulazione, marcatori, ciclo vita e layout; usa un backend HTTP locale simulato,
quindi i campioni DEMO del test non vengono inviati al MES aziendale.
E stata verificata anche la cattura LIVE sulla scheda reale, senza inviare frame,
con migliaia di pacchetti e nessun drop segnalato durante la breve prova. Questo
non sostituisce la verifica dei conteggi su un ciclo produttivo completo prima
di sostituire il collector in produzione.
