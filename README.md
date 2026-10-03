# Gioco reale di Ur

Applicazione web completa del **Gioco reale di Ur / Gioco delle Venti Caselle**: rendering 3D in Three.js, due tavole storicamente distinte, due regolamenti documentati, partite sullo stesso dispositivo e online, account, amicizie, inviti, stanze private, ricerca avversario, classifiche Elo separate per configurazione. Interfaccia in italiano.

Fonti, scelte, incertezze e licenze: **[HISTORICAL_NOTES.md](HISTORICAL_NOTES.md)** (e la sezione «Storia e regole» dell'app).

## Avvio rapido

Requisiti: **Node.js ≥ 22.18** (usa `node:sqlite` e l'esecuzione diretta di TypeScript, senza compilazione del server). Nessun servizio esterno, nessun segreto.

```bash
npm install
npm run build        # client in dist/
npm run migrate      # facoltativo: le migrazioni vengono applicate anche all'avvio
npm start            # http://127.0.0.1:8787
```

Sviluppo con ricaricamento automatico (API su :8787, Vite su :5173 con proxy per `/api` e `/ws`):

```bash
npm run dev          # poi apri http://localhost:5173
```

Configurazione: copia `.env.example` in `.env` (porta, percorso del database, durata dei turni e degli inviti, `COOKIE_SECURE`, origini ammesse). Il database SQLite viene creato in `data/ur.db`.

## Test

```bash
npm test             # motore, dadi, server HTTP/WebSocket (vitest)
npm run typecheck
npm run build && npm run test:e2e   # due utenti reali in due contesti Chrome separati
```

`test:e2e` usa `playwright-core` con il **Google Chrome installato** (nessun browser scaricato). Per un altro canale: `E2E_CHANNEL=msedge npm run test:e2e`. Gli screenshot finiscono in `tests/e2e/out/`.

## Architettura

```
src/engine/        motore puro e deterministico (condiviso da client e server)
  boards.ts        geometria delle due tavole (20 caselle, misure attestate/stimate)
  decorations.ts   decorazione casella per casella (separata dalla geometria)
  routes.ts        percorsi individuali e caselle con effetto di regola
  dice.ts          sistemi di lancio e distribuzioni esatte
  rulesets.ts      regolamenti versionati, clausole etichettate, matrice di compatibilità
  engine.ts        stato, azioni, mosse legali, spiegazione delle mosse illegali
src/server/        Node http + ws + node:sqlite
  migrations/      migrazioni SQL versionate
  auth.ts          scrypt, sessioni opache (solo hash nel DB), rate limit
  games.ts         partite autorevoli, azioni idempotenti, risultati ed Elo atomici
  social.ts        amici, inviti con scadenza, ricerca avversario, profili, classifiche
  local.ts         partite locali di utenti autenticati, verifica del secondo giocatore
  realtime.ts      WebSocket: presenza, notifiche, sincronizzazione
src/client/        Vite + TypeScript + Three.js, nessun framework UI
  render/          scena 3D, texture procedurali, vista SVG (anteprime e ripiego 2D)
  views/           Gioca, Amici, Classifica, Profilo, Storia e regole, Partita
```

**Scelte motivate**
- *Backend Node senza framework*: poche rotte JSON, un router di 20 righe è più trasparente di una dipendenza.
- *SQLite (`node:sqlite`)*: database reale, transazionale, su file, senza dipendenze native né servizi da installare. Per carichi maggiori lo schema è portabile su PostgreSQL.
- *WebSocket (`ws`)*: canale bidirezionale per presenza e mosse; le stesse azioni sono disponibili via HTTP come ripiego.
- *Motore condiviso*: il client lo usa per partite locali, anteprime e spiegazioni; il server lo usa come unica autorità online. Dipendenze di runtime: `three`, `ws`.

**Garanzie del multiplayer**
- Il server estrae ogni lancio con `crypto.randomInt`; i dadi inviati dal client sono ignorati.
- Ogni azione porta un `actionId` (idempotenza: un duplicato restituisce lo stato senza riapplicare) e la `expectedVersion` dello stato (le azioni concorrenti o superate sono rifiutate con lo stato aggiornato).
- Partecipanti, turno e fase sono verificati sul server; chi non partecipa riceve 404.
- Il risultato è scritto una sola volta (`game_results` con chiave primaria sulla partita e transizione `active → finished` condizionata) nella stessa transazione che aggiorna statistiche ed Elo.
- Tavola, regolamento e versione sono salvati nella partita alla sua creazione (accettazione dell'invito, ingresso nella stanza, abbinamento) e non cambiano più.

**Politica del tempo e dell'abbandono**: turno di 120 s (configurabile). Se il turno scade mentre l'avversario è collegato alla partita, chi è di turno perde («tempo scaduto», o «abbandono» se si è disconnesso). Se l'avversario non è collegato, la partita va in pausa senza vincitore e il cronometro riparte quando un partecipante torna. La resa è sempre possibile. Le partite aperte si riprendono da «Gioca».

**Partite locali**: per gli ospiti sono salvate in `localStorage`; per gli utenti autenticati anche sul server, che ri-applica le azioni con il motore. Il secondo giocatore può confermare la propria identità con le sue credenziali (attestazione monouso di 15 minuti) senza sostituire la sessione del primo; scegliere un nome dalla lista amici lo segna come «non verificato». Le partite locali non entrano nelle classifiche.

**Elo**: 1200 iniziale, K = 32, separato per `tavola@versione/regolamento@versione`. Categorie: competitiva (Ur + moderno), sperimentale (tarda + Finkel), personalizzata (adattamenti: vittorie/sconfitte senza Elo), locale.

**Accessibilità**: tutte le mosse sono disponibili come pulsanti numerati (tasti 1–9, Spazio per lanciare, R/T per la camera, Esc per saltare l'animazione); il turno è indicato con testo, colore e forma; le pedine dei due lati differiscono anche per luminosità (tavola A) o forma (tavola B); `prefers-reduced-motion` e un'opzione dedicata eliminano le animazioni; vista 2D automatica se WebGL non è disponibile o se il contesto grafico si perde; qualità grafica automatica o manuale.

## Pubblicazione

Per mettere online serve solo un host Node ≥ 22.18 con disco persistente:
1. `npm ci && npm run build`, poi `NODE_ENV=production npm start` dietro un reverse proxy **HTTPS** che inoltri anche gli upgrade WebSocket su `/ws`.
2. Variabili: `HOST=0.0.0.0`, `PORT`, `DB_PATH` su volume persistente, `COOKIE_SECURE=1`, `ALLOWED_ORIGINS=https://tuo-dominio` se il dominio pubblico differisce dall'header Host.
3. Backup del file SQLite (in modalità WAL: copiare con `sqlite3 data/ur.db ".backup backup.db"`).
4. Con più istanze, sostituire SQLite con PostgreSQL e il canale realtime in memoria con un pub/sub (es. Redis): oggi il server è pensato come **istanza singola**.

Non servono credenziali di terze parti. Non c'è recupero password via email: richiederebbe un servizio SMTP (non configurato).
