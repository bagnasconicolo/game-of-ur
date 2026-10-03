// Valutazione delle mosse per l'anteprima: conseguenze immediate e rischio di cattura al turno successivo.
// Funzioni pure; servono solo come aiuto al giocatore e non influiscono sulle regole.

import { binaryDistribution, FINKEL_CONVERSION } from './dice.ts';
import { cellOf, kindOf, opponent, type GameSpec, type GameState, type Move, type PieceState, type Player } from './engine.ts';

export interface MoveInsight {
  capture: boolean;
  exit: boolean;
  rosette: boolean;
  extraTurn: boolean;
  /** Variazione dei gettoni (solo regolamento avanzato). */
  counters: number | null;
  /** Probabilità che l'avversario possa catturare la pedina all'arrivo, al suo prossimo lancio (null = impossibile). */
  riskAfter: number | null;
  /** Probabilità di cattura nella posizione attuale (null = al sicuro o fuori tavola). */
  riskBefore: number | null;
}

/** Probabilità che, in un turno, il giocatore possa ottenere almeno uno dei valori indicati. */
export function chanceOfAny(spec: GameSpec, values: Set<number>): number {
  if (!values.size) return 0;
  if (spec.ruleset.dice === 'binari-4') {
    const d = binaryDistribution(4);
    let p = 0;
    for (const v of values) if (v >= 1 && v <= 4) p += d[v];
    return p;
  }
  // dado 1–4 seguito, a scelta, dal dado sì/no che converte 1,2,3,4 in 5,6,7,10
  let p = 0;
  for (const k of [1, 2, 3, 4]) {
    if (values.has(k)) p += 1 / 4;
    else if (values.has(FINKEL_CONVERSION[k])) p += 1 / 8;
  }
  return p;
}

/** Rischio che una pedina di `owner` posta su `cellId` venga catturata al prossimo turno avversario. */
export function captureRisk(spec: GameSpec, state: GameState, owner: Player, cellId: string, ignorePieceId?: string): number | null {
  const opp = opponent(owner);
  const oppPath = spec.route.paths[opp];
  const oppHouse = oppPath.indexOf(cellId) + 1;
  if (oppHouse === 0) return null; // casella privata
  if (spec.ruleset.rosetteSafe && spec.rosetteCells.has(cellId)) return null;
  const values = new Set<number>();
  for (const p of state.pieces) {
    if (p.owner !== opp || p.id === ignorePieceId) continue;
    if (p.pos >= 1 && p.pos < oppHouse) values.add(oppHouse - p.pos);
    else if (p.pos === 0) {
      if (!spec.ruleset.advanced) {
        if (oppHouse <= 4) values.add(oppHouse);
      } else {
        const k = kindOf(spec, p.kind);
        const order = spec.ruleset.pieceKinds;
        const canLaunch = p.launched || order[state.launchedCount[opp]]?.id === p.kind;
        if (canLaunch && k.entryHouse === oppHouse && k.entryThrow !== undefined) values.add(k.entryThrow);
      }
    }
  }
  const r = chanceOfAny(spec, values);
  return r > 0 ? r : null;
}

export function moveInsight(spec: GameSpec, state: GameState, move: Move): MoveInsight {
  const piece = state.pieces.find((p) => p.id === move.pieceId) as PieceState;
  const value = spec.ruleset.advanced ? (kindOf(spec, piece.kind).value ?? 0) : 0;
  const counters = spec.ruleset.advanced ? (move.landsRosette ? value : 0) - value * move.passedRosettes.length : null;
  // stato dopo la mossa (solo posizioni) per il calcolo del rischio
  const after: GameState = { ...state, pieces: state.pieces.map((p) => (p.id === move.pieceId ? { ...p, pos: move.to } : p.id === move.capture ? { ...p, pos: 0 } : p)) };
  const destCell = move.exit ? null : spec.route.paths[move.owner][move.to - 1];
  const fromCell = cellOf(spec, piece);
  return {
    capture: !!move.capture,
    exit: move.exit,
    rosette: move.landsRosette,
    extraTurn: spec.ruleset.extraTurnOnRosette && move.landsRosette,
    counters,
    riskAfter: destCell ? captureRisk(spec, after, move.owner, destCell) : null,
    riskBefore: fromCell ? captureRisk(spec, state, move.owner, fromCell) : null,
  };
}
