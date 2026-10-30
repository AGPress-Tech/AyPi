# Scada Forno su Android

> **Aggiornamento sospeso il 30/10/2026.** Il backend è stato ripristinato al
> contenuto dell'installer 1.4.0 delle 13:38. Il gateway Android non espone più
> le API del forno. Le istruzioni seguenti descrivono il lavoro sperimentale
> conservato, non una versione da installare. Usare il desktop per il forno.
> Vedi [ripristino backend](backend-ripristino-1338.md).

La home dell'app Android include **Scada Forno**. Il modulo usa HTML, CSS e logica
dei grafici desktop, compilati nell'APK, con layout e gesti per telefono/tablet.
Non apre una pagina remota né si collega direttamente al nanodac.

La versione Android **0.5.1** corregge il layout sui telefoni stretti: header su
più righe, area del grafico più alta e finestre impostazioni/analisi quasi a
tutta pagina. Il fullscreen azzera lo scorrimento precedente, misura l'altezza
effettiva della WebView e aggiorna il grafico dopo la rotazione. Il tasto Indietro
chiude prima una finestra aperta o la vista espansa. Per passare da 0.5.0 a 0.5.1
è sufficiente aggiornare l'APK; backend e client Windows 1.4.1 restano compatibili.

## Funzioni

- Quattro temperature live, stato Off/errori e canali selezionabili.
- Storico, risoluzione, data/range, scale e preferenze locali.
- Trascinamento per scorrere; pinch per zoomare; **Leggi** per il campione al tocco;
  **Analizza** per selezionare un intervallo e aprire l'analisi desktop.
- Note/eventi e aggiunta di note con data/ora del campione prima del salvataggio.
- Cicli e grafici delle ricette, con le stesse verifiche Reset/Run/Hold del desktop.
  La lettura di un altro ciclo in Reset richiede **Leggi e ripristina**.
- Pulsanti nativi per ruotare lo schermo ed espandere il grafico, mantenendo i
  comandi touch. Indietro chiude prima la finestra aperta.

Il live usa il recupero HTTP incrementale, normalmente circa ogni secondo, con
gli stessi campioni originali raccolti dal backend ogni 500 ms. Le temperature
in testata si aggiornano anche quando si consulta lo storico. Quando l'app passa
in background, le richieste della vista vengono sospese; il collector sul server
prosegue. Android non usa la connessione WebSocket binaria del desktop.

## Integrazione

Il gateway mobile registra le API `/api/forno/*` dietro l'autenticazione Bearer
già usata dagli altri moduli Android. Il token rimane in Kotlin/OkHttp: la WebView
conosce solo comandi forno esplicitamente ammessi e non dispone di una API HTTP
generica. Le note ricevono l'autore della sessione autenticata dal gateway.

Le risorse sono servite localmente da `appassets.androidplatform.net`, con accesso
a file/contenuti esterni disabilitato e navigazione esterna bloccata. Le preferenze
del grafico sono locali al telefono. I cicli non vengono precaricati o inventati.

Aggiornare sia **backend/gateway** sia **APK**. Il modulo non richiede modifiche
alla configurazione del nanodac o ai database MES.

## Build e verifiche

Prerequisiti: Node con `npm ci`, JDK 21, Android SDK 36 e toolchain prevista dal
progetto. Configurare `JAVA_HOME` e `ANDROID_HOME` oppure `local.properties`.

```powershell
node tools/build-forno-mobile.cjs
npx tsc -p tsconfig.mobile-forno.json --noEmit
node tools/test-forno-mobile.cjs
npx tsc -p backend/tsconfig.json
node --test tools/test-forno-mobile-gateway.cjs
mobile/android-calendar/gradlew.bat -p mobile/android-calendar assembleDebug
```

Gradle esegue automaticamente `buildFornoAssets` prima di preparare l'APK.
L'output generato è in `app/build/generated/fornoAssets`; non va modificato a mano.
Il test browser verifica layout a 320/360/390/768/844 pixel con densità mobile,
dimensioni dei dialoghi, fullscreen dopo scorrimento e durante rotazione,
gesti touch tramite CDP, ciclo in Run, lettura puntuale, note e sospensione/ripresa.
Usa un backend simulato e non invia comandi al forno.
