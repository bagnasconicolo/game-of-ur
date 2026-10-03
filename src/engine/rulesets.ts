// Regolamenti selezionabili e matrice di compatibilità tavola × regolamento.
// Ogni regola è etichettata: 'attestato' (dal reperto/testo), 'interpretazione' (di uno studioso),
// 'convenzione' (scelta moderna per rendere il gioco completo e giocabile).

import type { BoardId } from './boards.ts';
import type { DiceSystemId } from './dice.ts';

export type RulesetId = 'moderno' | 'finkel-sperimentale';
export type RuleStatus = 'attestato' | 'interpretazione' | 'convenzione';

export interface RuleClause {
  id: string;
  title: string;
  text: string;
  status: RuleStatus;
  source?: string;
}

export interface PieceKind {
  /** Identificativo stabile del tipo di pedina. */
  id: string;
  name: string;
  /** Lancio richiesto per l'ingresso (solo regolamento avanzato). */
  entryThrow?: number;
  /** Casa d'ingresso (solo regolamento avanzato); per la Rondine vedi swallowEntry. */
  entryHouse?: number;
  /** Valore in gettoni vinto/pagato sulle rosette (solo regolamento avanzato). */
  value?: number;
}

export interface RulesetDef {
  id: RulesetId;
  version: number;
  name: string;
  author: string;
  historicalStatus: string;
  dice: DiceSystemId;
  piecesPerPlayer: number;
  pieceKinds: PieceKind[];
  extraTurnOnRosette: boolean;
  rosetteSafe: boolean;
  exactExit: boolean;
  allowStacking: boolean;
  /** Regolamento avanzato */
  advanced?: {
    startingCounters: number;
    poolStake: number;
    fixedLaunchOrder: boolean;
  };
  components: string[];
  clauses: RuleClause[];
}

const SWALLOW = 'rondine';

export const RULESETS: Record<RulesetId, RulesetDef> = {
  moderno: {
    id: 'moderno',
    version: 1,
    name: 'Regolamento moderno adottato',
    author: 'Sintesi di convenzioni moderne: percorso di R. C. Bell (1960), effetti delle rosette come nel set diffuso da I. L. Finkel / British Museum e nel ruleset «Finkel» di RoyalUr.net.',
    historicalStatus: 'Convenzione moderna di gioco. Non è il regolamento attestato del III millennio a.C., che resta sconosciuto.',
    dice: 'binari-4',
    piecesPerPlayer: 7,
    pieceKinds: [{ id: 'pedina', name: 'Pedina' }],
    extraTurnOnRosette: true,
    rosetteSafe: true,
    exactExit: true,
    allowStacking: false,
    components: [
      'Tavola di venti caselle',
      '7 pedine per giocatore (a Ur: due serie di sette, chiare con cinque punti scuri e scure con cinque punti chiari)',
      '4 dadi tetraedrici binari',
    ],
    clauses: [
      { id: 'pezzi', title: 'Pedine', status: 'attestato', text: 'Ogni giocatore ha sette pedine identiche. Due serie di sette pedine sono associate alle tavole di Ur.', source: 'Finkel 2007, p. 17; British Museum' },
      { id: 'dadi', title: 'Dadi', status: 'convenzione', text: 'Si lanciano quattro dadi tetraedrici: ciascuno vale 1 se un vertice marcato è in alto, 0 altrimenti. Somma 0–4 con probabilità 1, 4, 6, 4, 1 su 16.', source: 'Dadi tetraedrici attestati a Ur; il numero quattro è convenzione moderna' },
      { id: 'percorso', title: 'Percorso', status: 'convenzione', text: 'Ogni pedina entra nella casa 1 della propria fila laterale del blocco grande (accanto al ponte), percorre le quattro caselle verso l\'angolo, attraversa la fila centrale di otto caselle condivise e chiude con due caselle laterali del blocco piccolo: 14 case, la 15ª mossa è l\'uscita.', source: 'R. C. Bell 1960' },
      { id: 'ingresso', title: 'Ingresso', status: 'convenzione', text: 'Una pedina in riserva entra contando dall\'esterno: con un lancio di n arriva alla casa n del proprio percorso.' },
      { id: 'una-pedina', title: 'Una pedina per lancio', status: 'convenzione', text: 'Per ogni lancio si muove una sola pedina dell\'intero valore ottenuto.' },
      { id: 'sovrapposizione', title: 'Niente sovrapposizioni', status: 'convenzione', text: 'Una pedina non può fermarsi su una casella occupata da una propria pedina.' },
      { id: 'cattura', title: 'Cattura', status: 'convenzione', text: 'Fermandosi su una casella condivisa occupata da una pedina avversaria la si cattura: torna nella riserva del proprietario e dovrà ripartire.' },
      { id: 'rosette', title: 'Rosette', status: 'convenzione', text: 'Chi si ferma su una rosetta lancia di nuovo (turno aggiuntivo). Una pedina su una rosetta non può essere catturata: la casella è inaccessibile all\'avversario finché è occupata.', source: 'Effetti moderni; Finkel 2007, p. 26, ipotizza che in origine la rosetta desse un secondo lancio' },
      { id: 'zero', title: 'Zero o nessuna mossa', status: 'convenzione', text: 'Con un lancio di 0, o se nessuna mossa è legale, il turno passa all\'avversario.' },
      { id: 'uscita', title: 'Uscita esatta', status: 'convenzione', text: 'Per uscire serve il punteggio esatto: dalla casa 14 occorre 1, dalla 13 occorre 2 e così via.' },
      { id: 'vittoria', title: 'Vittoria', status: 'convenzione', text: 'Vince chi porta per primo fuori dalla tavola tutte e sette le pedine.' },
      { id: 'inizio', title: 'Primo turno', status: 'convenzione', text: 'Il primo giocatore è sorteggiato dal server (o dal dispositivo, in locale).' },
    ],
  },
  'finkel-sperimentale': {
    id: 'finkel-sperimentale',
    version: 1,
    name: 'Ricostruzione sperimentale basata su Finkel',
    author: 'I. L. Finkel, «On the Rules for the Royal Game of Ur», in I. L. Finkel (ed.), Ancient Board Games in Perspective, British Museum Press 2007, pp. 16–32; tavoletta BM 33333B (Rm-III.6.b), 177/176 a.C.',
    historicalStatus: 'Interpretazione di una tavoletta seleucide (II sec. a.C.) applicata alla tavola tarda. Le lacune sono colmate da convenzioni esplicite. Non è il regolamento della tavola di Ur del III millennio.',
    dice: 'finkel-d4-si-no',
    piecesPerPlayer: 5,
    pieceKinds: [
      { id: SWALLOW, name: 'Rondine', entryThrow: 2, entryHouse: 4, value: 3 },
      { id: 'uccello-tempesta', name: 'Uccello-tempesta', entryThrow: 5, entryHouse: 5, value: 4 },
      { id: 'corvo', name: 'Corvo', entryThrow: 6, entryHouse: 6, value: 4 },
      { id: 'gallo', name: 'Gallo', entryThrow: 7, entryHouse: 7, value: 4 },
      { id: 'aquila', name: 'Aquila', entryThrow: 10, entryHouse: 10, value: 5 },
    ],
    extraTurnOnRosette: false,
    rosetteSafe: true,
    exactExit: true,
    allowStacking: false,
    advanced: { startingCounters: 25, poolStake: 10, fixedLaunchOrder: true },
    components: [
      'Tavola tarda con fila centrale di dodici caselle',
      '5 pedine diverse per giocatore: Rondine, Uccello-tempesta, Corvo, Gallo, Aquila',
      'Un dado a quattro facce 1–4 e un dado sì/no (al posto dell\'astragalo di pecora e di bue nominati dalla tavoletta)',
      '25 gettoni virtuali per giocatore e una cassa comune (solo punti interni alla partita)',
    ],
    clauses: [
      { id: 'pezzi', title: 'Cinque pedine diverse', status: 'attestato', text: 'La tavoletta elenca cinque pedine «volanti» con nomi di uccelli: Uccello-tempesta (UD.GAL), Corvo, Gallo, Aquila, Rondine; la Rondine è distinta dalle altre (NU ŠE.BI.DA).', source: 'BM 33333B rev. i 1–6; Finkel 2007, pp. 19–20' },
      { id: 'astragali', title: 'Due astragali', status: 'attestato', text: 'La tavoletta nomina un astragalo di bue e uno di pecora «che muovono le pedine».', source: 'BM 33333B rev. i 7–8' },
      { id: 'lanci-ingresso', title: 'Lanci d\'ingresso', status: 'attestato', text: 'Con 2 la Rondine «siede alla testa di una rosetta»; con 5, 6, 7 e 10 Uccello-tempesta, Corvo, Gallo e Aquila siedono nella quinta, sesta, settima e decima casa.', source: 'BM 33333B rev. i 9 – ii 29' },
      { id: 'rosette-esiti', title: 'Esito delle rosette', status: 'attestato', text: 'Per ogni pedina il testo indica una fortuna se «scende» su una rosetta e una sfortuna se non vi scende (donne e benessere, cibo, birra, carne).', source: 'BM 33333B; lettura di SÙR come tanpaḫu «rosetta» proposta da Finkel' },
      { id: 'dadi', title: 'Dadi e conversione', status: 'interpretazione', text: 'Si lancia il dado 1–4. Si può usare il punteggio oppure lanciare il dado sì/no: con «sì» 1, 2, 3, 4 diventano 5, 6, 7, 10; con «no» il turno è perso.', source: 'Finkel 2007, pp. 22–23 e 27 (ipotesi «double-or-quits»)' },
      { id: 'percorso', title: 'Percorso', status: 'interpretazione', text: 'Quattro case laterali verso l\'angolo (la casa 4 è la prima rosetta), poi la fila centrale di dodici caselle condivise (case 5–16) e uscita. Rosette sul percorso: case 4, 8, 12, 16.', source: 'Finkel 2007, fig. 3.5: «there is no evidence on the point»' },
      { id: 'ordine', title: 'Ordine d\'ingresso', status: 'interpretazione', text: 'Il primo ingresso delle pedine segue l\'ordine Rondine, Uccello-tempesta, Corvo, Gallo, Aquila. Una pedina già entrata può muoversi prima che le altre entrino.', source: 'Finkel 2007, pp. 25 e 27' },
      { id: 'rondine', title: 'Ingresso della Rondine', status: 'interpretazione', text: 'Al primo ingresso la Rondine va sulla casa 4 (prima rosetta). Se catturata, rientra con 2 sulla casa che precede una rosetta a scelta (3, 7, 11, 15).', source: 'Finkel 2007, pp. 20 e 27 (entrambe le letture, combinate)' },
      { id: 'gettoni', title: 'Gettoni e cassa', status: 'interpretazione', text: 'Ognuno parte con 25 gettoni e ne versa 10 nella cassa. Chi si ferma su una rosetta incassa il valore della pedina (Rondine 3; Uccello-tempesta, Corvo, Gallo 4; Aquila 5); chi supera una rosetta senza fermarsi paga lo stesso valore alla cassa.', source: 'Finkel 2007, tab. 3.1 e p. 27 (scala «ipotetica»)' },
      { id: 'obbligo', title: 'Obbligo di muovere', status: 'interpretazione', text: 'Se una mossa è possibile con il punteggio scelto, va giocata.', source: 'Finkel 2007, p. 27, n. 5' },
      { id: 'cattura', title: 'Cattura', status: 'interpretazione', text: 'Fermandosi su una pedina avversaria la si cattura; questa dovrà rientrare con il proprio lancio specifico. Anche l\'ingresso su una casa occupata dall\'avversario cattura.', source: 'Finkel 2007, p. 27, n. 6 e n. 3' },
      { id: 'rosette-sicure', title: 'Rosette sicure', status: 'interpretazione', text: 'Una pedina su una rosetta non può essere catturata.', source: 'Finkel 2007, p. 27, n. 7' },
      { id: 'uscita', title: 'Uscita esatta', status: 'interpretazione', text: 'Per uscire serve il punteggio esatto (dalla casa 16 occorre 1).', source: 'Finkel 2007, p. 27, n. 8' },
      { id: 'vittoria', title: 'Fine della partita', status: 'interpretazione', text: 'Vince chi porta fuori per primo tutte e cinque le pedine. Ogni pedina avversaria ancora sulla tavola paga al vincitore il proprio valore in gettoni.', source: 'Finkel 2007, p. 27, n. 9; l\'entità della penalità è convenzione' },
      { id: 'c-sovrapposizione', title: 'Niente sovrapposizioni', status: 'convenzione', text: 'Due pedine dello stesso giocatore non possono occupare la stessa casella (Finkel lascia aperta la possibilità: «perhaps»).' },
      { id: 'c-rientro', title: 'Rientro libero', status: 'convenzione', text: 'L\'ordine fisso vale solo per il primo ingresso; una pedina catturata può rientrare in qualsiasi momento con il proprio lancio.' },
      { id: 'c-ingresso-rosetta', title: 'Ingresso su rosetta', status: 'convenzione', text: 'L\'ingresso diretto su una rosetta conta come fermarsi su di essa; l\'ingresso non conta come «superare» rosette.' },
      { id: 'c-cassa', title: 'Cassa e debiti', status: 'convenzione', text: 'Si incassa al massimo quanto c\'è nella cassa e si paga al massimo quanto si possiede: i gettoni non scendono sotto zero.' },
      { id: 'c-passo', title: 'Passare', status: 'convenzione', text: 'Se il punteggio primario non consente mosse si può tentare la conversione oppure passare. Se anche il punteggio convertito non consente mosse, il turno passa.' },
      { id: 'c-inizio', title: 'Primo turno', status: 'interpretazione', text: 'Ciascuno lancia il dado 1–4: inizia il punteggio più alto, si ripete in caso di parità (eseguito dal server).', source: 'Finkel 2007, p. 27, n. 1' },
      { id: 'c-vincitore', title: 'Classifica', status: 'convenzione', text: 'Per la classifica conta chi esce per primo con tutte le pedine; i gettoni sono punti virtuali interni alla partita.' },
    ],
  },
};

export function getRuleset(id: string, version?: number): RulesetDef {
  const r = (RULESETS as Record<string, RulesetDef>)[id];
  if (!r) throw new Error(`Regolamento sconosciuto: ${id}`);
  if (version !== undefined && version !== r.version) throw new Error(`Versione ${version} del regolamento ${id} non disponibile`);
  return r;
}

export type CompatStatus = 'convenzione-moderna' | 'ricostruzione-sperimentale' | 'adattamento-moderno';

export interface CompatEntry {
  boardId: BoardId;
  rulesetId: RulesetId;
  status: CompatStatus;
  label: string;
  note: string;
  /** Categoria per classifiche: competitiva (Elo), sperimentale (Elo separato) o personalizzata (senza Elo). */
  category: 'competitiva' | 'sperimentale' | 'personalizzata';
}

export const COMPATIBILITY: CompatEntry[] = [
  { boardId: 'ur-iii', rulesetId: 'moderno', status: 'convenzione-moderna', category: 'competitiva', label: 'Convenzione moderna', note: 'Abbinamento moderno standard sulla tavola del III millennio. Le regole sono moderne.' },
  { boardId: 'tarda', rulesetId: 'finkel-sperimentale', status: 'ricostruzione-sperimentale', category: 'sperimentale', label: 'Ricostruzione sperimentale', note: 'La tavola per cui Finkel propone le regole della tavoletta BM 33333B.' },
  { boardId: 'ur-iii', rulesetId: 'finkel-sperimentale', status: 'adattamento-moderno', category: 'personalizzata', label: 'Adattamento moderno', note: 'Non attestato. Percorso di 14 case (rosette 4, 8, 14); la Rondine rientra sulle case 3, 7, 13.' },
  { boardId: 'tarda', rulesetId: 'moderno', status: 'adattamento-moderno', category: 'personalizzata', label: 'Adattamento moderno', note: 'Non attestato. Percorso di 16 case (rosette 4, 8, 12, 16), uscita alla 17ª mossa.' },
];

export function compat(boardId: string, rulesetId: string): CompatEntry {
  const e = COMPATIBILITY.find((c) => c.boardId === boardId && c.rulesetId === rulesetId);
  if (!e) throw new Error(`Combinazione non prevista: ${boardId} + ${rulesetId}`);
  return e;
}

export const SWALLOW_ID = SWALLOW;
