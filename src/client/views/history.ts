// Storia e regole: fonti, distinzione fra attestato / interpretazione / convenzione, regolamenti completi.

import { h } from '../ui/dom.ts';
import { RULESETS, DICE_SYSTEMS, BOARDS, DECORATIONS, MOTIFS, COMPATIBILITY, rosettePositions, routeFor } from '../../engine/index.ts';
import { boardSvg } from '../render/svgboard.ts';
import { STATUS_TAG } from '../labels.ts';

export const ELO_DOC = 'Ogni giocatore parte da 1200 per ciascuna configurazione competitiva o sperimentale (tavola + regolamento + versione). A fine partita il server calcola il punteggio atteso del vincitore E = 1 / (1 + 10^((R_sconfitto − R_vincitore)/400)) e aggiorna R_vincitore += 32·(1 − E) e R_sconfitto −= 32·(1 − E), arrotondando al decimo. Gli adattamenti non attestati registrano vittorie e sconfitte ma non modificano l\'Elo; le partite locali non sono conteggiate. Il risultato è scritto una sola volta, nella stessa transazione che chiude la partita.';

const tag = (s: string) => h('span', { class: `tag ${STATUS_TAG[s].cls}` }, STATUS_TAG[s].label);

export async function renderHistory(main: HTMLElement, anchor: string) {
  const ur = BOARDS['ur-iii'];
  const late = BOARDS.tarda;
  const decoRows = Object.entries(DECORATIONS['ur-iii'].cells);

  main.append(h('article', { class: 'prose' },
    h('h1', null, 'Storia e fonti'),
    h('p', { class: 'lead' }, 'Questa ricostruzione distingue sempre tre livelli: ', tag('attestato'), ' ciò che mostrano i reperti e i testi; ', tag('interpretazione'), ' le ricostruzioni degli studiosi; ', tag('convenzione'), ' le scelte moderne necessarie per avere un gioco completo. Non conosciamo con certezza le regole del III millennio a.C.'),

    h('h2', null, 'Il gioco delle venti caselle'),
    h('p', null, tag('attestato'), ' Le tavole più antiche e celebri provengono dal Cimitero Reale di Ur (scavi di Sir Leonard Woolley, anni Venti del Novecento) e risalgono alla metà del III millennio a.C. Hanno venti caselle: un blocco di 3 × 4 unito da un «ponte» di due caselle a un blocco di 3 × 2. A Ur sono associati due gruppi di sette pedine e dadi tetraedrici, oltre a dadi lunghi a quattro facce (Finkel 2007, p. 17).'),
    h('p', null, tag('attestato'), ' Dal II millennio a.C. la forma cambia: il blocco di 3 × 2 diventa un prolungamento di otto caselle del ponte, per una fila centrale di dodici. Oltre cento tavole sono note fra Iraq, Iran, Levante, Anatolia, Cipro, Egitto e Creta; dopo il 2000 a.C. le caselle d\'angolo tendono a non essere più marcate (Finkel 2007, p. 17).'),

    h('h2', { id: 'tavola-a' }, 'Tavola A — British Museum 1928,1009.378 (BM 120834)'),
    h('p', null, `Protodinastico III (c. 2600–2400 a.C.), Ur. Misure pubblicate: ${ur.dims.length.value} × ${ur.dims.width.value} × ${ur.dims.height.value} cm. Faccia con venti placchette di conchiglia variamente intarsiate; bordi con placchette e listelli, alcuni con un «occhio»; materiali indicati: conchiglia, lapislazzuli, calcare rosso / pasta rossa, bitume, su un supporto ligneo non conservato.`),
    h('p', null, tag('attestato'), ' La disposizione dei motivi è stata ricavata casella per casella dalla fotografia CC0 di BabelStone (2010). Colonne numerate dall\'estremità del blocco grande; riga 0 = fila superiore della foto:'),
    h('div', { class: 'table-wrap' }, h('table', null, h('thead', null, h('tr', null, h('th', null, 'Casella'), h('th', null, 'Motivo'), h('th', null, 'Descrizione'))),
      h('tbody', null, ...decoRows.map(([id, m]) => h('tr', null, h('td', null, id), h('td', null, MOTIFS[m].label), h('td', { style: 'white-space:normal' }, MOTIFS[m].description)))))),
    h('p', { class: 'notice' }, 'La resa 3D riproduce lo stato museale attuale, cioè l\'oggetto dopo il restauro: il British Museum segnala elementi inseriti nella ricostruzione moderna (per esempio gli intarsi triangolari sul retro). Non proponiamo un\'ipotesi dell\'aspetto antico originale. Lo spessore delle placchette, la larghezza delle fasce e il diametro delle pedine sono misure stimate.'),

    h('h2', { id: 'tavola-b' }, 'Tavola B — scatola del Metropolitan Museum 16.10.475a'),
    h('p', null, `Secondo Periodo Intermedio – inizio Nuovo Regno, XVII – inizio XVIII dinastia (c. 1580–1458 a.C.), Tebe, Asasif (scavi del Met 1915–16). Avorio, lega di rame, legno moderno; ${late.dims.length.value} × ${late.dims.width.value} × ${late.dims.height.value} cm. Su un lato il senet, sull\'altro la forma tarda delle venti caselle; il prolungamento è affiancato da pannelli incisi con animali (il Met cita gazzelle, cani e leoni).`),
    h('p', null, tag('attestato'), ' Le venti placchette in avorio del reperto non mostrano marcature nelle fotografie del museo. Per questo la resa non aggiunge rosette: le caselle con effetto di regola sono mostrate solo come ', h('em', null, 'sovrapposizione tratteggiata disattivabile'), ', nelle posizioni del diagramma della tavola tarda in Finkel 2007 (figg. 3.2b e 3.5: i due angoli lontani, la quarta casella della fila centrale e poi ogni quarta).'),
    h('p', null, 'Questa tavola è un oggetto egizio diverso dal reperto del British Museum, non una sua «seconda forma». Il fregio animale è reso in forma semplificata.'),

    h('h2', { id: 'tavoletta' }, 'La tavoletta BM 33333B (Rm-III.6.b)'),
    h('p', null, tag('attestato'), ' Tavoletta cuneiforme scritta a Babilonia da Itti-Marduk-balāṭu il 3 novembre 177/176 a.C., copiata da un originale di Iddin-Bēl. Il recto reca un diagramma di dodici rettangoli associati ai segni zodiacali, con brevi formule di presagio; il verso contiene le regole: cinque pedine «volanti» con nomi di uccelli, un astragalo di bue e uno di pecora, i lanci d\'ingresso (2, 5, 6, 7, 10) e la fortuna o sfortuna legata al «scendere» o meno su una casella marcata. Una seconda tavoletta (DLB, andata perduta e nota da foto) chiama il gioco «Branco di cani».'),
    h('p', null, tag('interpretazione'), ' Finkel legge il segno SÙR come tanpaḫu, «cosa che brilla», cioè rosetta; collega i dodici rettangoli alla fila centrale della tavola tarda; propone che l\'astragalo di bue funzioni come dado «raddoppia o niente» che converte 1, 2, 3, 4 in 5, 6, 7, 10; propone un percorso di 16 case (con la cautela «there is no evidence on the point») e una scala di gettoni «ipotetica».'),
    h('p', { class: 'notice warn' }, 'La tavoletta è di oltre due millenni posteriore alle tavole di Ur e descrive con ogni probabilità una variante con scommesse della forma tarda. Non va presa come il regolamento della tavola del III millennio.'),

    h('h2', { id: 'dadi' }, 'Dadi e probabilità'),
    h('p', null, tag('attestato'), ' I dadi tetraedrici di Ur hanno due vertici su quattro marcati da punti intarsiati: un dado dà quindi 1 con probabilità 1/2. Insieme al reperto BM ne furono trovati tre; il set moderno ne usa quattro (', tag('convenzione'), ').'),
    h('p', null, 'Con quattro dadi binari equi la somma segue la distribuzione binomiale: 0 → 1/16, 1 → 4/16, 2 → 6/16, 3 → 4/16, 4 → 1/16. Il gioco estrae i quattro dadi uno per uno, non un numero uniforme fra 0 e 4.'),
    h('p', null, 'Nella ricostruzione avanzata si usano i dadi equi proposti da Finkel per il gioco moderno (1–4 con 1/4 ciascuno; sì/no con 1/2). Gli astragali veri non sono equiprobabili e la corrispondenza fra facce dell\'osso e punteggi non è documentata: non la simuliamo.'),
    h('p', null, 'Nelle partite online l\'esito è estratto dal server con il generatore crittografico di Node.js (crypto.randomInt); il client mostra soltanto un\'animazione coerente con l\'esito già deciso. L\'animazione è una visualizzazione, non una simulazione scientificamente validata della dinamica dei dadi antichi.'),

    h('h2', { id: 'regole' }, 'Regolamenti'),
    ...Object.values(RULESETS).map((r) => {
      const ex = COMPATIBILITY.filter((c) => c.rulesetId === r.id);
      return h('section', { id: `regole-${r.id}`, class: 'card', style: 'margin:16px 0' },
        h('h3', null, r.name, ` (versione ${r.version})`),
        h('p', { class: 'small' }, h('strong', null, 'Riferimento: '), r.author),
        h('p', { class: 'small' }, h('strong', null, 'Stato storico: '), r.historicalStatus),
        h('p', { class: 'small' }, h('strong', null, 'Componenti: '), r.components.join('; '), '.'),
        h('p', { class: 'small' }, h('strong', null, 'Dadi: '), DICE_SYSTEMS[r.dice].components, ' ', DICE_SYSTEMS[r.dice].status),
        h('ol', null, ...r.clauses.map((c) => h('li', null, h('strong', null, c.title), ' ', tag(c.status), ' — ', c.text, c.source ? h('span', { class: 'small muted' }, ` [${c.source}]`) : ''))),
        h('p', { class: 'small' }, h('strong', null, 'Abbinamenti: '), ex.map((c) => `${BOARDS[c.boardId].shortName}: ${c.label} — ${c.note}`).join(' · ')),
        h('div', { class: 'figure-grid' }, ...ex.map((c) => h('figure', null, boardSvg(c.boardId, { paths: [0, 1], numbers: 0 }).svg,
          h('figcaption', null, `${BOARDS[c.boardId].shortName}: rosette sul percorso alle case ${rosettePositions(routeFor(c.boardId), 0).join(', ')}.`)))));
    }),

    h('h2', { id: 'elo' }, 'Classifiche ed Elo'),
    h('p', null, ELO_DOC),

    h('h2', { id: 'fonti' }, 'Fonti'),
    h('ul', { class: 'refs' },
      h('li', null, 'I. L. Finkel, «On the Rules for the Royal Game of Ur», in I. L. Finkel (ed.), ', h('em', null, 'Ancient Board Games in Perspective'), ', British Museum Press, 2007, pp. 16–32 — letto integralmente dalla copia ', h('a', { href: 'https://genjam.org/wp-content/uploads/2021/09/onrules4gameofur.pdf', rel: 'noopener', target: '_blank' }, 'genjam.org'), '; scheda bibliografica ', h('a', { href: 'https://www.britishmuseum.org/collection/term/BIB9988', rel: 'noopener', target: '_blank' }, 'BM BIB9988'), '.'),
      h('li', null, 'British Museum, ', h('a', { href: 'https://www.britishmuseum.org/collection/object/W_1928-1009-378', rel: 'noopener', target: '_blank' }, '1928,1009.378'), ' e ', h('a', { href: 'https://www.britishmuseum.org/collection/object/W_Rm-III-6-b', rel: 'noopener', target: '_blank' }, 'Rm-III.6.b'), ' — le schede non erano accessibili agli strumenti automatici usati (HTTP 403): misure e descrizione sono state verificate tramite CDLI P498293 e citazioni delle schede nei risultati di ricerca; i dati della tavoletta provengono da Finkel 2007.'),
      h('li', null, h('a', { href: 'https://cdli.earth/P498293', rel: 'noopener', target: '_blank' }, 'CDLI P498293'), ' (BM 120834: 301 × 110 × 24 mm). Nota: CDLI indica il periodo ED I–II; il British Museum e la letteratura datano la tavola al Protodinastico III.'),
      h('li', null, 'Metropolitan Museum of Art, ', h('a', { href: 'https://www.metmuseum.org/art/collection/search/553268', rel: 'noopener', target: '_blank' }, '16.10.475a'), ', Open Access (dati e immagini di pubblico dominio).'),
      h('li', null, h('a', { href: 'https://it.wikipedia.org/wiki/Gioco_reale_di_Ur', rel: 'noopener', target: '_blank' }, 'Wikipedia, «Gioco reale di Ur»'), ' — usata solo come introduzione.'),
      h('li', null, 'R. C. Bell, ', h('em', null, 'Board and Table Games from Many Civilizations'), ', 1960 (percorso di 14 case, citato tramite le schede di ', h('a', { href: 'https://www.mastersofgames.com/rules/royal-ur-rules.htm', rel: 'noopener', target: '_blank' }, 'Masters of Games'), '); ', h('a', { href: 'https://royalur.net/rules', rel: 'noopener', target: '_blank' }, 'RoyalUr.net'), ' per il ruleset moderno «Finkel» (7 pedine, 4 dadi, rosette sicure con lancio aggiuntivo).'),
      h('li', null, 'T. Kendall, 1982 (citato in Finkel 2007, p. 18) per il percorso ipotetico sulla tavola tarda.'),
    ),

    h('h2', { id: 'asset' }, 'Provenienza degli asset'),
    h('ul', null,
      h('li', null, 'Nessuna fotografia è incorporata nell\'applicazione. Tutte le texture (conchiglia incisa, lapislazzuli, bitume, avorio, legno, fregio) sono disegnate proceduralmente dal codice di questo progetto.'),
      h('li', null, 'Riferimenti visivi consultati: «British Museum Royal Game of Ur.jpg» di BabelStone (Wikimedia Commons, CC0); fotografie Met DP116122, DP160290 e 16.10.475a.bot (Open Access, CC0). La disponibilità online di altre immagini non implica il diritto di incorporarle.'),
      h('li', null, 'Caratteri tipografici: Cormorant Garamond e Source Sans 3 (Google Fonts, SIL Open Font License). Libreria 3D: three.js (MIT).'),
    ),
  ));
  if (anchor) requestAnimationFrame(() => document.getElementById(anchor)?.scrollIntoView());
  return () => {};
}
