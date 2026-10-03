// Motore di gioco puro e deterministico: stesso stato + stessa azione (con esito del lancio incluso) = stesso risultato.
// Nessuna dipendenza da rendering, rete o sorgenti di casualità.

import { getBoard, type BoardDef, type BoardId } from './boards.ts';
import { DICE_SYSTEMS, FINKEL_CONVERSION, binaryValue, rollBinary4, rollD4, rollYesNo, type RandomInt } from './dice.ts';
import { RULE_MARKS, routeFor, rosettePositions, type Player, type RouteDef } from './routes.ts';
import { compat, getRuleset, SWALLOW_ID, type CompatEntry, type PieceKind, type RulesetDef, type RulesetId } from './rulesets.ts';

export type { Player } from './routes.ts';

export const ENGINE_SCHEMA = 1;

export interface GameConfig {
  boardId: BoardId;
  boardVersion: number;
  rulesetId: RulesetId;
  rulesetVersion: number;
}

export interface GameSpec {
  config: GameConfig;
  key: string;
  board: BoardDef;
  ruleset: RulesetDef;
  route: RouteDef;
  compat: CompatEntry;
  /** Lunghezza del percorso individuale N. Posizioni: 0 = riserva, 1..N = sulla tavola, N+1 = uscita. */
  length: number;
  rosettes: [Set<number>, Set<number>];
  rosetteCells: Set<string>;
}

export interface PieceState {
  id: string;
  owner: Player;
  kind: string;
  pos: number;
  /** true se la pedina è già entrata almeno una volta (regolamento avanzato: rientro libero dopo la cattura). */
  launched: boolean;
}

export type Phase = 'roll' | 'decide' | 'move' | 'finished';

export interface RollInfo {
  dice: number[];
  /** Regolamento avanzato: punteggio del dado 1–4. */
  primary?: number;
  /** Regolamento avanzato: esito del dado sì/no (null = non lanciato). */
  converted?: 0 | 1 | null;
  value: number;
}

export interface GameState {
  schema: number;
  config: GameConfig;
  /** Versione dello stato: cresce di 1 a ogni azione applicata. */
  version: number;
  turn: Player;
  phase: Phase;
  roll: RollInfo | null;
  pieces: PieceState[];
  launchedCount: [number, number];
  counters: [number, number] | null;
  pool: number | null;
  winner: Player | null;
  finishReason: string | null;
  turnNumber: number;
  firstPlayer: Player;
  startRolls: [number, number][] | null;
  lastMove: Move | null;
}

export interface Move {
  pieceId: string;
  owner: Player;
  from: number;
  to: number;
  enter: boolean;
  exit: boolean;
  capture: string | null;
  landsRosette: boolean;
  passedRosettes: number[];
}

export type Action =
  | { type: 'roll'; dice: number[] }
  | { type: 'convert'; yes: 0 | 1 }
  | { type: 'pass' }
  | { type: 'move'; pieceId: string; to: number };

export type GameEvent =
  | { type: 'rolled'; player: Player; dice: number[]; value: number; primary?: number }
  | { type: 'converted'; player: Player; yes: 0 | 1; value: number }
  | { type: 'moved'; player: Player; move: Move }
  | { type: 'captured'; player: Player; pieceId: string }
  | { type: 'counters'; player: Player; delta: number; reason: 'rosetta' | 'superata' | 'penalita' }
  | { type: 'extra-turn'; player: Player }
  | { type: 'turn-passed'; player: Player; reason: 'zero' | 'nessuna-mossa' | 'conversione-no' | 'passa' }
  | { type: 'finished'; winner: Player; reason: string };

export class RuleError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export function configKey(c: GameConfig): string {
  return `${c.boardId}@${c.boardVersion}/${c.rulesetId}@${c.rulesetVersion}`;
}

export function resolveSpec(config: GameConfig): GameSpec {
  const board = getBoard(config.boardId);
  if (board.version !== config.boardVersion) throw new RuleError('versione', `Versione ${config.boardVersion} della tavola non disponibile`);
  const ruleset = getRuleset(config.rulesetId, config.rulesetVersion);
  const entry = compat(config.boardId, config.rulesetId);
  const route = routeFor(board.id);
  const length = route.paths[0].length;
  const spec: GameSpec = {
    config,
    key: configKey(config),
    board,
    ruleset,
    route,
    compat: entry,
    length,
    rosettes: [new Set(rosettePositions(route, 0)), new Set(rosettePositions(route, 1))],
    rosetteCells: new Set(RULE_MARKS[board.id].cells),
  };
  validateSpec(spec);
  return spec;
}

/** Controlli di coerenza: nessuna combinazione deve produrre una partita incoerente. */
export function validateSpec(spec: GameSpec): void {
  const cellIds = new Set(spec.board.cells.map((c) => c.id));
  if (spec.board.cells.length !== 20) throw new Error('La tavola deve avere venti caselle');
  for (const p of [0, 1] as Player[]) {
    const path = spec.route.paths[p];
    if (new Set(path).size !== path.length) throw new Error('Percorso con caselle ripetute');
    for (const c of path) if (!cellIds.has(c)) throw new Error(`Percorso fuori tavola: ${c}`);
  }
  for (const k of spec.ruleset.pieceKinds) {
    if (k.entryHouse !== undefined && (k.entryHouse < 1 || k.entryHouse > spec.length)) throw new Error(`Casa d'ingresso ${k.entryHouse} fuori percorso`);
  }
  for (const c of spec.rosetteCells) if (!cellIds.has(c)) throw new Error(`Rosetta fuori tavola: ${c}`);
}

export function kindOf(spec: GameSpec, kindId: string): PieceKind {
  const k = spec.ruleset.pieceKinds.find((x) => x.id === kindId);
  if (!k) throw new Error(`Tipo di pedina sconosciuto: ${kindId}`);
  return k;
}

export function initialState(spec: GameSpec, firstPlayer: Player, startRolls: [number, number][] | null = null): GameState {
  const pieces: PieceState[] = [];
  const kinds = spec.ruleset.pieceKinds;
  for (const owner of [0, 1] as Player[]) {
    for (let i = 0; i < spec.ruleset.piecesPerPlayer; i++) {
      const kind = kinds.length === 1 ? kinds[0].id : kinds[i].id;
      pieces.push({ id: `p${owner}-${i}`, owner, kind, pos: 0, launched: false });
    }
  }
  const adv = spec.ruleset.advanced;
  return {
    schema: ENGINE_SCHEMA,
    config: { ...spec.config },
    version: 0,
    turn: firstPlayer,
    phase: 'roll',
    roll: null,
    pieces,
    launchedCount: [0, 0],
    counters: adv ? [adv.startingCounters - adv.poolStake, adv.startingCounters - adv.poolStake] : null,
    pool: adv ? adv.poolStake * 2 : null,
    winner: null,
    finishReason: null,
    turnNumber: 1,
    firstPlayer,
    startRolls,
    lastMove: null,
  };
}

/** Sorteggio iniziale: moderno = moneta; avanzato = lancio del dado 1–4 ripetuto in caso di parità (Finkel p. 27). */
export function drawFirstPlayer(spec: GameSpec, rand: RandomInt): { firstPlayer: Player; startRolls: [number, number][] | null } {
  if (!spec.ruleset.advanced) return { firstPlayer: rand(2) as Player, startRolls: null };
  const rolls: [number, number][] = [];
  for (let i = 0; i < 100; i++) {
    const a = rollD4(rand);
    const b = rollD4(rand);
    rolls.push([a, b]);
    if (a !== b) return { firstPlayer: a > b ? 0 : 1, startRolls: rolls };
  }
  return { firstPlayer: rand(2) as Player, startRolls: rolls };
}

export function cellOf(spec: GameSpec, piece: PieceState): string | null {
  if (piece.pos < 1 || piece.pos > spec.length) return null;
  return spec.route.paths[piece.owner][piece.pos - 1];
}

export function occupantAt(spec: GameSpec, state: GameState, cellId: string): PieceState | undefined {
  return state.pieces.find((p) => cellOf(spec, p) === cellId);
}

export function opponent(p: Player): Player {
  return (1 - p) as Player;
}

export function piecesOff(spec: GameSpec, state: GameState, p: Player): number {
  return state.pieces.filter((x) => x.owner === p && x.pos === spec.length + 1).length;
}

export function piecesInReserve(state: GameState, p: Player): number {
  return state.pieces.filter((x) => x.owner === p && x.pos === 0).length;
}

/** Valore utilizzabile per muovere nella fase corrente. */
function activeValue(state: GameState): number | null {
  if (!state.roll) return null;
  if (state.phase === 'decide') return state.roll.primary ?? null;
  if (state.phase === 'move') return state.roll.value;
  return null;
}

interface TargetCheck {
  ok: boolean;
  reason?: string;
  capture?: PieceState;
}

function checkTarget(spec: GameSpec, state: GameState, owner: Player, to: number): TargetCheck {
  if (to === spec.length + 1) return { ok: true };
  if (to > spec.length + 1) return { ok: false, reason: `Serve il punteggio esatto per uscire.` };
  const cellId = spec.route.paths[owner][to - 1];
  const occ = occupantAt(spec, state, cellId);
  if (!occ) return { ok: true };
  if (occ.owner === owner) return { ok: false, reason: 'La casella di arrivo è occupata da una tua pedina.' };
  if (spec.ruleset.rosetteSafe && spec.rosetteCells.has(cellId)) return { ok: false, reason: 'La pedina avversaria è su una rosetta ed è protetta.' };
  return { ok: true, capture: occ };
}

function passedRosettes(spec: GameSpec, owner: Player, from: number, to: number): number[] {
  const out: number[] = [];
  for (let i = from + 1; i < Math.min(to, spec.length + 1); i++) if (spec.rosettes[owner].has(i)) out.push(i);
  return out;
}

function makeMove(spec: GameSpec, state: GameState, piece: PieceState, to: number, enter: boolean): Move | null {
  const t = checkTarget(spec, state, piece.owner, to);
  if (!t.ok) return null;
  return {
    pieceId: piece.id,
    owner: piece.owner,
    from: piece.pos,
    to,
    enter,
    exit: to === spec.length + 1,
    capture: t.capture ? t.capture.id : null,
    landsRosette: to <= spec.length && spec.rosettes[piece.owner].has(to),
    passedRosettes: enter ? [] : passedRosettes(spec, piece.owner, piece.pos, to),
  };
}

/** Case d'ingresso possibili per una pedina in riserva nel regolamento avanzato, dato il valore. */
function advancedEntryHouses(spec: GameSpec, state: GameState, piece: PieceState, value: number): { houses: number[]; reason?: string } {
  const kind = kindOf(spec, piece.kind);
  if (kind.entryThrow !== value) return { houses: [], reason: `${kind.name} entra solo con un lancio di ${kind.entryThrow}.` };
  if (!piece.launched) {
    const order = spec.ruleset.pieceKinds;
    const next = order[state.launchedCount[piece.owner]];
    if (spec.ruleset.advanced?.fixedLaunchOrder && next && next.id !== piece.kind) {
      return { houses: [], reason: `Le pedine entrano in ordine: ora tocca a ${next.name}.` };
    }
    return { houses: [kind.entryHouse!] };
  }
  if (kind.id === SWALLOW_ID) {
    const houses = [...spec.rosettes[piece.owner]].sort((a, b) => a - b).map((r) => r - 1).filter((h) => h >= 1);
    return { houses };
  }
  return { houses: [kind.entryHouse!] };
}

export function movesForValue(spec: GameSpec, state: GameState, player: Player, value: number): Move[] {
  const moves: Move[] = [];
  const mine = state.pieces.filter((p) => p.owner === player && p.pos <= spec.length);
  if (!spec.ruleset.advanced) {
    if (value <= 0) return [];
    const reserve = mine.find((p) => p.pos === 0);
    if (reserve) {
      const m = makeMove(spec, state, reserve, value, true);
      if (m) moves.push(m);
    }
    for (const p of mine) {
      if (p.pos === 0) continue;
      const m = makeMove(spec, state, p, p.pos + value, false);
      if (m) moves.push(m);
    }
    return moves;
  }
  for (const p of mine) {
    if (p.pos === 0) {
      for (const h of advancedEntryHouses(spec, state, p, value).houses) {
        const m = makeMove(spec, state, p, h, true);
        if (m) moves.push(m);
      }
    } else {
      const m = makeMove(spec, state, p, p.pos + value, false);
      if (m) moves.push(m);
    }
  }
  return moves;
}

export function legalMoves(spec: GameSpec, state: GameState): Move[] {
  const v = activeValue(state);
  if (v === null) return [];
  return movesForValue(spec, state, state.turn, v);
}

export interface AvailableActions {
  roll: boolean;
  convert: boolean;
  pass: boolean;
  moves: Move[];
}

export function availableActions(spec: GameSpec, state: GameState): AvailableActions {
  if (state.phase === 'finished') return { roll: false, convert: false, pass: false, moves: [] };
  if (state.phase === 'roll') return { roll: true, convert: false, pass: false, moves: [] };
  const moves = legalMoves(spec, state);
  if (state.phase === 'decide') return { roll: false, convert: true, pass: moves.length === 0, moves };
  return { roll: false, convert: false, pass: false, moves };
}

function clone(state: GameState): GameState {
  return structuredClone(state);
}

function endTurn(s: GameState): void {
  s.turn = opponent(s.turn);
  s.phase = 'roll';
  s.turnNumber += 1;
}

function validateDice(spec: GameSpec, dice: unknown): number[] {
  if (!Array.isArray(dice)) throw new RuleError('dadi', 'Esito del lancio mancante.');
  if (spec.ruleset.dice === 'binari-4') {
    if (dice.length !== 4 || dice.some((d) => d !== 0 && d !== 1)) throw new RuleError('dadi', 'Esito dei dadi binari non valido.');
  } else if (dice.length !== 1 || ![1, 2, 3, 4].includes(dice[0] as number)) {
    throw new RuleError('dadi', 'Esito del dado 1–4 non valido.');
  }
  return dice as number[];
}

/** Genera l'esito casuale richiesto dall'azione (da chiamare fuori dal motore: server o dispositivo locale). */
export function randomnessFor(spec: GameSpec, type: 'roll' | 'convert', rand: RandomInt): { dice?: number[]; yes?: 0 | 1 } {
  if (type === 'roll') return { dice: spec.ruleset.dice === 'binari-4' ? rollBinary4(rand) : [rollD4(rand)] };
  return { yes: rollYesNo(rand) };
}

function applyMove(spec: GameSpec, s: GameState, move: Move, events: GameEvent[]): void {
  const piece = s.pieces.find((p) => p.id === move.pieceId)!;
  const adv = spec.ruleset.advanced;
  const value = kindOf(spec, piece.kind).value ?? 0;
  if (move.capture) {
    const victim = s.pieces.find((p) => p.id === move.capture)!;
    victim.pos = 0;
    events.push({ type: 'captured', player: s.turn, pieceId: victim.id });
  }
  if (move.enter && !piece.launched) {
    piece.launched = true;
    s.launchedCount[piece.owner] += 1;
  }
  piece.launched = true;
  piece.pos = move.to;
  s.lastMove = move;
  events.push({ type: 'moved', player: s.turn, move });

  if (adv && s.counters && s.pool !== null) {
    for (let i = 0; i < move.passedRosettes.length; i++) {
      const pay = Math.min(value, s.counters[s.turn]);
      s.counters[s.turn] -= pay;
      s.pool += pay;
      events.push({ type: 'counters', player: s.turn, delta: -pay, reason: 'superata' });
    }
    if (move.landsRosette) {
      const gain = Math.min(value, s.pool);
      s.pool -= gain;
      s.counters[s.turn] += gain;
      events.push({ type: 'counters', player: s.turn, delta: gain, reason: 'rosetta' });
    }
  }

  if (piecesOff(spec, s, s.turn) === spec.ruleset.piecesPerPlayer) {
    const winner = s.turn;
    if (adv && s.counters) {
      const loser = opponent(winner);
      for (const p of s.pieces) {
        if (p.owner === loser && p.pos >= 1 && p.pos <= spec.length) {
          const pen = Math.min(kindOf(spec, p.kind).value ?? 0, s.counters[loser]);
          s.counters[loser] -= pen;
          s.counters[winner] += pen;
          if (pen > 0) events.push({ type: 'counters', player: loser, delta: -pen, reason: 'penalita' });
        }
      }
    }
    s.phase = 'finished';
    s.winner = winner;
    s.finishReason = 'percorso-completato';
    events.push({ type: 'finished', winner, reason: 'percorso-completato' });
    return;
  }

  if (spec.ruleset.extraTurnOnRosette && move.landsRosette) {
    s.phase = 'roll';
    s.turnNumber += 1;
    events.push({ type: 'extra-turn', player: s.turn });
    return;
  }
  endTurn(s);
}

/** Applica un'azione del giocatore di turno. Lancia RuleError se l'azione non è legale. */
export function applyAction(spec: GameSpec, state: GameState, action: Action): { state: GameState; events: GameEvent[] } {
  if (state.phase === 'finished') throw new RuleError('finita', 'La partita è terminata.');
  const s = clone(state);
  const events: GameEvent[] = [];
  const player = s.turn;

  switch (action.type) {
    case 'roll': {
      if (s.phase !== 'roll') throw new RuleError('fase', 'Hai già lanciato: ora scegli una mossa.');
      const dice = validateDice(spec, action.dice);
      if (spec.ruleset.dice === 'binari-4') {
        const value = binaryValue(dice);
        s.roll = { dice, value };
        events.push({ type: 'rolled', player, dice, value });
        if (value === 0) {
          events.push({ type: 'turn-passed', player, reason: 'zero' });
          endTurn(s);
        } else if (movesForValue(spec, s, player, value).length === 0) {
          events.push({ type: 'turn-passed', player, reason: 'nessuna-mossa' });
          endTurn(s);
        } else {
          s.phase = 'move';
        }
      } else {
        const primary = dice[0];
        s.roll = { dice, primary, converted: null, value: primary };
        events.push({ type: 'rolled', player, dice, value: primary, primary });
        s.phase = 'decide';
      }
      break;
    }
    case 'convert': {
      if (s.phase !== 'decide' || !s.roll || s.roll.primary === undefined) throw new RuleError('fase', 'La conversione è possibile solo dopo il lancio del dado 1–4.');
      if (action.yes !== 0 && action.yes !== 1) throw new RuleError('dadi', 'Esito del dado sì/no non valido.');
      s.roll.converted = action.yes;
      if (action.yes === 0) {
        events.push({ type: 'converted', player, yes: 0, value: 0 });
        events.push({ type: 'turn-passed', player, reason: 'conversione-no' });
        endTurn(s);
        break;
      }
      const value = FINKEL_CONVERSION[s.roll.primary];
      s.roll.value = value;
      events.push({ type: 'converted', player, yes: 1, value });
      s.phase = 'move';
      if (movesForValue(spec, s, player, value).length === 0) {
        events.push({ type: 'turn-passed', player, reason: 'nessuna-mossa' });
        endTurn(s);
      }
      break;
    }
    case 'pass': {
      if (s.phase !== 'decide') throw new RuleError('fase', 'Non puoi passare in questa fase.');
      if (legalMoves(spec, s).length > 0) throw new RuleError('obbligo', 'Una mossa è possibile con questo punteggio: va giocata (oppure tenta la conversione).');
      events.push({ type: 'turn-passed', player, reason: 'passa' });
      endTurn(s);
      break;
    }
    case 'move': {
      if (s.phase !== 'move' && s.phase !== 'decide') throw new RuleError('fase', 'Prima devi lanciare.');
      const moves = legalMoves(spec, s);
      let move = moves.find((m) => m.pieceId === action.pieceId && m.to === action.to);
      if (!move) {
        // Le pedine in riserva dello stesso tipo sono intercambiabili.
        const piece = s.pieces.find((p) => p.id === action.pieceId);
        if (piece && piece.owner === player && piece.pos === 0) {
          move = moves.find((m) => m.enter && m.to === action.to && s.pieces.find((p) => p.id === m.pieceId)!.kind === piece.kind);
        }
      }
      if (!move) throw new RuleError('mossa-illegale', explainIllegal(spec, state, action.pieceId, action.to));
      applyMove(spec, s, move, events);
      break;
    }
    default:
      throw new RuleError('azione', 'Azione sconosciuta.');
  }
  s.version = state.version + 1;
  return { state: s, events };
}

/** Termina la partita per motivi esterni al regolamento (resa, tempo scaduto, abbandono). */
export function finishExternally(state: GameState, winner: Player, reason: string): GameState {
  const s = clone(state);
  s.phase = 'finished';
  s.winner = winner;
  s.finishReason = reason;
  s.version = state.version + 1;
  return s;
}

/** Spiega in italiano perché una pedina non può muoversi (o fermarsi in `to`). */
export function explainIllegal(spec: GameSpec, state: GameState, pieceId: string, to?: number): string {
  if (state.phase === 'finished') return 'La partita è terminata.';
  const piece = state.pieces.find((p) => p.id === pieceId);
  if (!piece) return 'Pedina inesistente.';
  if (piece.owner !== state.turn) return 'Questa pedina appartiene all\'avversario.';
  if (state.phase === 'roll') return 'Prima devi lanciare i dadi.';
  if (piece.pos === spec.length + 1) return 'Questa pedina ha già completato il percorso.';
  const v = activeValue(state);
  if (v === null) return 'Nessun punteggio disponibile.';
  if (!spec.ruleset.advanced && v === 0) return 'Hai ottenuto 0: il turno passa.';
  const name = spec.ruleset.advanced ? kindOf(spec, piece.kind).name : 'La pedina';
  if (piece.pos === 0 && spec.ruleset.advanced) {
    const e = advancedEntryHouses(spec, state, piece, v);
    if (e.reason) return e.reason;
    for (const h of e.houses) {
      if (to !== undefined && to !== h) continue;
      const t = checkTarget(spec, state, piece.owner, h);
      if (!t.ok) return `${name}: ${t.reason}`;
    }
    return `${name} non può entrare in quella casa.`;
  }
  const target = (piece.pos === 0 ? 0 : piece.pos) + v;
  if (to !== undefined && to !== target) return `Con ${v} la pedina può arrivare solo alla casa ${target > spec.length ? 'di uscita' : target}.`;
  if (target > spec.length + 1) {
    const need = spec.length + 1 - piece.pos;
    return `${name} è alla casa ${piece.pos}: per uscire serve esattamente ${need}, hai ${v}.`;
  }
  const t = checkTarget(spec, state, piece.owner, target);
  if (!t.ok) return `${name}: ${t.reason}`;
  return 'Mossa non consentita.';
}

export function describeDice(spec: GameSpec): string {
  return DICE_SYSTEMS[spec.ruleset.dice].name;
}

/** Riproduce una partita da una sequenza di azioni (usato per verifiche e audit). */
export function replay(spec: GameSpec, start: GameState, actions: Action[]): GameState {
  let s = start;
  for (const a of actions) s = applyAction(spec, s, a).state;
  return s;
}
