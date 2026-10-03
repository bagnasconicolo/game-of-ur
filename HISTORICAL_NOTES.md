# Note storiche, scelte e fonti

Questo documento accompagna l'applicazione e spiega **che cosa sappiamo, che cosa ipotizzano gli studiosi e che cosa abbiamo scelto noi**. Ogni regola e ogni elemento visivo è classificato in uno di tre livelli:

| Livello | Significato |
|---|---|
| **Attestato** | Mostrato dai reperti o scritto in un testo antico. |
| **Interpretazione** | Ricostruzione proposta da uno studioso (con indicazione di chi). |
| **Convenzione moderna** | Scelta nostra, o di regolamenti moderni, necessaria per avere un gioco completo e giocabile. |

Le regole del gioco del III millennio a.C. **non sono note**. Nessuna parte dell'applicazione afferma il contrario.

---

## 1. Fonti consultate e stato di accesso

| Fonte | Accesso | Uso |
|---|---|---|
| I. L. Finkel, «On the Rules for the Royal Game of Ur», in *Ancient Board Games in Perspective*, British Museum Press 2007, pp. 16–32 (copia: genjam.org/wp-content/uploads/2021/09/onrules4gameofur.pdf; scheda BM BIB9988) | **Letto integralmente**, figure comprese (figg. 3.2, 3.4, 3.5) | Regolamento avanzato, tavola tarda, percorso, dadi, contesto |
| British Museum, scheda 1928,1009.378 (BM 120834) | **Non accessibile** agli strumenti automatici usati (HTTP 403). Dati verificati tramite CDLI P498293 e tramite estratti della scheda riportati dai risultati di ricerca | Misure, materiali, datazione |
| British Museum, scheda Rm-III.6.b (BM 33333B) | **Non accessibile** (HTTP 403). Contenuto del testo da Finkel 2007, che ne pubblica traduzione e traslitterazione | Regole della tavoletta |
| CDLI P498293 (cdli.earth/P498293) | Accessibile | 301 × 110 × 24 mm; nota: CDLI indica «ED I–II», mentre BM e letteratura datano la tavola al Protodinastico III (c. 2600–2400 a.C.) |
| Wikimedia Commons, «British Museum Royal Game of Ur.jpg» (BabelStone, 24/06/2010, **CC0**) | Accessibile, risoluzione 2716 × 2164 | Mappatura delle decorazioni casella per casella |
| Wikimedia Commons, «Ur Royal Cemetery Game Pieces.jpg» (Gary Todd, **CC0**) | Accessibile | Riferimento per le pedine |
| Metropolitan Museum of Art, 16.10.475a (Open Access API e immagini DP116122, DP160290, 16.10.475a.bot, **pubblico dominio**) | Accessibile | Tavola B: forma, misure, materiali, assenza di marcature, fregio |
| Wikipedia it, «Gioco reale di Ur» | Accessibile | Solo introduzione; nessun dato è stato preso esclusivamente da qui |
| RoyalUr.net, pagina regole | Accessibile | Attribuzione del ruleset moderno detto «Finkel» |
| Masters of Games (regole) e cyningstan/genjam «rules.pdf» | Accessibili | Percorso di 14 case attribuito a R. C. Bell (1960); evidenza che i regolamenti moderni combinano Bell, Finkel, Murray, Parlett |

Non abbiamo inventato contenuti delle schede inaccessibili: dove una scheda non era leggibile ci siamo limitati ai dati confermati da fonti accessibili.

---

## 2. Tavola A — Ur, III millennio a.C. (BM 1928,1009.378)

**Attestato**
- Venti caselle: blocco 3 × 4, ponte di due caselle, blocco 3 × 2.
- Misure: lunghezza 30,1 cm, larghezza 11 cm, altezza 2,4 cm (CDLI; BM).
- Placchette di conchiglia incise con intarsi di lapislazzuli e calcare rosso/pasta rossa su bitume; supporto ligneo non conservato; bordi con placchette «a occhio» e listelli; sul retro intarsi triangolari inseriti nella **ricostruzione moderna** (BM).
- Cinque rosette (due angoli lontani del blocco grande, quarta casella della fila centrale accanto al ponte, due caselle del blocco piccolo verso il ponte).

**Mappa delle decorazioni** (dalla foto CC0; colonna 0 = estremità del blocco grande lontana dal ponte; riga 0 = fila superiore della foto) — definita in `src/engine/decorations.ts`:

| | c0 | c1 | c2 | c3 | c4 | c5 | c6 | c7 |
|---|---|---|---|---|---|---|---|---|
| r0 | rosetta | occhi | cinque cerchi | occhi | — | — | rosetta | stella a zig-zag |
| r1 | griglia di 16 | cinque cerchi | punti e zig-zag | rosetta | cinque cerchi | punti e zig-zag | occhi | cinque cerchi |
| r2 | rosetta | occhi | cinque cerchi | occhi | — | — | rosetta | stella a zig-zag |

**Stimato** (marcato come tale nell'interfaccia e in `src/engine/boards.ts`): passo delle caselle (3,625 × 3,3 cm), cornice (0,55 cm), spessore delle placchette, diametro delle pedine (~2,3 cm), dimensioni dei dadi.

**Stato rappresentato**: lo **stato museale attuale**, dopo il restauro. Non proponiamo un'ipotesi dell'aspetto antico; la disposizione attuale delle placchette dipende dal restauro e non è garantita come originale.

**Pedine**: due serie di sette dischi, chiari (conchiglia) con cinque punti di lapislazzuli e scuri con cinque punti chiari (foto BM/Commons; BM 1928,1009.379.h è descritta come contatore in conchiglia con cinque punti di lapislazzuli). Il materiale delle pedine scure non è stato verificato su scheda: è reso come pietra scura opaca.

**Dadi**: tetraedri con due vertici su quattro marcati da punti intarsiati (Finkel 2007, p. 17). Con il reperto BM ne furono trovati **tre**; il gioco moderno ne usa **quattro** (convenzione).

## 3. Tavola B — forma allungata (Met 16.10.475a)

Il prompt chiede di non presentarla come seconda forma dell'oggetto BM: è un **reperto diverso** e la scheda/la UI lo dicono esplicitamente.

**Attestato** (Met Open Access): scatola da gioco per senet e venti caselle; Secondo Periodo Intermedio – inizio Nuovo Regno, XVII – inizio XVIII dinastia (c. 1580–1458 a.C.); da Tebe, Asasif (scavi del Met 1915–16, sepoltura E 3, nel sarcofago); avorio, lega di rame, **legno moderno**; L. 25 × w. 6,7 × h. 5 cm. Sul lato a venti caselle: blocco 3 × 4 e prolungamento di 8; il prolungamento è affiancato da due pannelli incisi con animali (il Met li elenca come gazzelle, cani, leoni). Nelle fotografie le **venti placchette non sono marcate**.

**Scelte**
- Le caselle speciali (rosette di regola) **non vengono aggiunte come decorazione**: appaiono come sovrapposizione tratteggiata disattivabile, nelle posizioni del diagramma della tavola tarda di Finkel 2007 (figg. 3.2b e 3.5): i due angoli lontani del blocco, la quarta casella della fila centrale, l'ottava e la dodicesima.
- Il fregio animale è reso in modo **semplificato** (sagome generiche con tratteggio): non è una copia del disegno del reperto.
- Le pedine sono modellate sui pezzi conici e a rocchetto fotografati con la scatola (Met DP160290): coni per il giocatore 1, rocchetti per il giocatore 2 (la distinzione per forma aiuta l'accessibilità). Per il regolamento moderno su questa tavola servono 7 pedine per lato: le due in più sono una convenzione.
- Il cassetto con anelli in lega di rame è accennato.

## 4. Percorsi

Il numero di caselle fisiche (20) non coincide con la lunghezza del percorso individuale.

| Percorso | Tavola | Case | Rosette sul percorso | Stato |
|---|---|---|---|---|
| «Bell 14» | A | 4 private + 8 condivise + 2 private | 4, 8, 14 | Convenzione moderna (R. C. Bell 1960) |
| «Finkel 16» | B | 4 private + 12 condivise | 4, 8, 12, 16 | Interpretazione (Finkel 2007, fig. 3.5, sulla scia di Kendall 1982): «there is no evidence on the point» |

Verifica di coerenza: con le rosette 4, 8, 12, 16 la Rondine (casa 4) ha 4 occasioni di rosetta, Uccello-tempesta/Corvo/Gallo (case 5, 6, 7) ne hanno 3 e l'Aquila (casa 10) 2 — esattamente i numeri della tabella 3.1 di Finkel. È un test automatico (`tests/engine.test.ts`).

## 5. Regolamento A — «Regolamento moderno adottato» (v1)

Il nome evita «regole di Finkel» o «regole del British Museum» perché il preset combina convenzioni di provenienza diversa: percorso di Bell, 7 pedine, 4 dadi tetraedrici, rosette sicure con lancio aggiuntivo (il ruleset che RoyalUr.net chiama «Finkel»; RoyalUr.net stessa osserva che queste regole sono dedotte dalla forma della tavola, non dalla tavoletta). Finkel 2007, p. 26, ipotizza che in origine la rosetta potesse dare semplicemente un secondo lancio: ne teniamo conto solo come contesto.

Regole complete (testo canonico in `src/engine/rulesets.ts`, mostrato in «Storia e regole»): percorso, ingresso alla casa n con un lancio di n, una pedina per lancio, divieto di sovrapporre le proprie pedine, cattura nelle caselle condivise con ritorno in riserva, rosette che danno un lancio aggiuntivo e proteggono dalla cattura, lancio 0 o nessuna mossa = turno perso, uscita con il punteggio esatto (mossa 15), vittoria con 7 pedine uscite, primo giocatore sorteggiato.

## 6. Regolamento B — «Ricostruzione sperimentale basata su Finkel» (v1)

**Attestato dalla tavoletta BM 33333B** (traduzione di Finkel 2007, pp. 19–20): cinque pedine «volanti» (Uccello-tempesta, Corvo, Gallo, Aquila, Rondine), un astragalo di bue e uno di pecora; lanci 2 → Rondine «alla testa di una rosetta»; 5, 6, 7, 10 → quinta, sesta, settima, decima casa; per ogni pedina fortuna se scende su una casella SÙR, sfortuna altrimenti.

**Interpretazione di Finkel** (pp. 20–23, 27): SÙR = *tanpaḫu* «rosetta»; dado 1–4 e dado sì/no con conversione 1, 2, 3, 4 → 5, 6, 7, 10 e turno perso con «no»; ordine d'ingresso; Rondine sulla casa 4 o davanti a una rosetta a scelta; gettoni (25 per giocatore, 10 a testa nella cassa; valori 3/4/4/4/5 — «scala ipotetica»); obbligo di muovere; cattura; rosette sicure; uscita esatta; penalità del vincitore per le pedine avversarie rimaste; sorteggio iniziale con il dado numerato.

**Convenzioni nostre** (necessarie per eseguire il gioco, elencate anche nell'interfaccia):
1. Niente sovrapposizioni delle proprie pedine (Finkel: «perhaps two of a player's men can share a square»).
2. L'ordine fisso vale per il primo ingresso; una pedina catturata rientra in qualunque momento con il suo lancio.
3. Rondine: primo ingresso sulla casa 4; rientro dopo cattura sulla casa che precede una rosetta a scelta (3, 7, 11, 15). Le due letture di Finkel sono combinate come egli stesso suggerisce.
4. L'ingresso diretto su una rosetta conta come «scendere» su di essa; l'ingresso non «supera» rosette.
5. Uscire superando la rosetta 16 conta come superarla.
6. I gettoni non scendono sotto zero e non si incassa più di quanto c'è nella cassa.
7. Penalità finale = valore della pedina per ogni pedina avversaria ancora sulla tavola.
8. Se il punteggio primario non permette mosse si può tentare la conversione o passare; se il convertito non permette mosse, il turno passa. Con mosse disponibili si può comunque tentare la conversione (Finkel: «if a sheep astragal throw was not helpful … there was the option»).
9. Nessun turno aggiuntivo sulle rosette.
10. In classifica conta chi esce per primo con tutte le pedine; i gettoni sono **punti virtuali interni alla partita**, mai poste reali.

**Dadi**: gli astragali veri non sono equiprobabili e la corrispondenza fra facce e punteggi non è documentata. Usiamo l'attrezzatura moderna che Finkel stesso propone (p. 27): un dado a quattro facce 1–4 e un dado a quattro facce sì/no, rappresentati come dadi lunghi a quattro facce (tipo attestato a Ur), **non** come ossa.

**Non è** il regolamento della tavola del III millennio: la tavoletta è del 177/176 a.C.

## 7. Matrice di compatibilità

| | Moderno adottato | Sperimentale Finkel |
|---|---|---|
| Tavola A (Ur) | Convenzione moderna — classificata (Elo) | **Adattamento moderno** — percorso 14, rosette 4/8/14, Rondine rientra su 3/7/13; senza Elo |
| Tavola B (tarda) | **Adattamento moderno** — percorso 16, rosette 4/8/12/16, uscita alla 17; senza Elo | Ricostruzione sperimentale — Elo separato |

Ogni combinazione supera i controlli di coerenza di `validateSpec` (20 caselle, percorsi senza ripetizioni e dentro la tavola, case d'ingresso nel percorso) e viene giocata fino alla fine in 40 partite simulate per combinazione nei test.

## 8. Dadi: correttezza matematica

- Quattro dadi binari equi: P(0..4) = 1, 4, 6, 4, 1 su 16. Ogni dado è estratto separatamente (`rollBinary4`), la somma non è mai estratta uniformemente.
- Online: estrazione sul server con `crypto.randomInt`; il client non invia mai esiti e non può modificarli (verificato da test: un `dice` inviato dal client viene ignorato).
- Locale: `crypto.getRandomValues` con campionamento a rifiuto.
- Test: enumerazione esatta dei 16 esiti; chi-quadro su 160 000 lanci reali del server (soglia p = 0,001) e rifiuto dell'ipotesi uniforme.
- L'animazione è una **visualizzazione** dell'esito già estratto, non una simulazione fisica validata.

## 9. Provenienza e licenze degli asset

- **Nessuna fotografia è incorporata.** Tutte le texture (conchiglia incisa, lapislazzuli con pirite, bitume, fascia di losanghe, fianchi a listelli, avorio, legno, fregio) sono generate a runtime dal codice di questo progetto (`src/client/render/textures.ts`).
- Riferimenti visivi consultati: foto CC0 di BabelStone e Gary Todd (Wikimedia Commons); foto Met Open Access (pubblico dominio). La disponibilità online di altre foto (ad es. quelle del sito BM, «© The Trustees of the British Museum», CC BY-NC-SA secondo CDLI) **non** ne implica il diritto di incorporazione: non le abbiamo usate.
- Font: Cormorant Garamond e Source Sans 3 (Google Fonts, SIL OFL). three.js (MIT), ws (MIT).

## 10. Incertezze aperte

- Disposizione originale delle placchette della tavola A prima del restauro.
- Materiale delle pedine scure di Ur (non verificato su scheda).
- Marcature eventualmente perdute sulla tavola Met.
- Percorso, valori dei gettoni, condivisione delle caselle e penalità del regolamento tardo.
- Numero di dadi e loro uso nel III millennio.
