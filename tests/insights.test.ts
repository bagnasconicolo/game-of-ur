import { describe, it, expect } from 'vitest';
import { resolveSpec, initialState, applyAction, legalMoves, moveInsight, captureRisk, chanceOfAny, type GameState, type GameSpec } from '../src/engine/index.ts';

const A = resolveSpec({ boardId: 'ur-iii', boardVersion: 1, rulesetId: 'moderno', rulesetVersion: 1 });
const B = resolveSpec({ boardId: 'tarda', boardVersion: 1, rulesetId: 'finkel-sperimentale', rulesetVersion: 1 });
function place(spec: GameSpec, pos: Record<string, number>): GameState {
  const s = initialState(spec, 0);
  for (const [id, p] of Object.entries(pos)) { const x = s.pieces.find((q) => q.id === id)!; x.pos = p; x.launched = true; }
  s.launchedCount = [0, 1].map((o) => s.pieces.filter((p) => p.owner === o && p.launched).length) as [number, number];
  return s;
}

describe('valutazione delle mosse', () => {
  it('probabilità di ottenere almeno un valore (4 dadi binari)', () => {
    expect(chanceOfAny(A, new Set([2]))).toBeCloseTo(6 / 16);
    expect(chanceOfAny(A, new Set([1, 3]))).toBeCloseTo(8 / 16);
    expect(chanceOfAny(A, new Set([5]))).toBe(0);
  });
  it('probabilità con dado 1–4 e conversione', () => {
    expect(chanceOfAny(B, new Set([3]))).toBeCloseTo(1 / 4);
    expect(chanceOfAny(B, new Set([7]))).toBeCloseTo(1 / 8);
    expect(chanceOfAny(B, new Set([3, 7]))).toBeCloseTo(1 / 4);
  });
  it('rischio su casella condivisa con un avversario due case dietro', () => {
    // avversario alla casa 5 (r1c0), pedina nostra arriva alla casa 7 (r1c2)
    const s = place(A, { 'p1-0': 5, 'p0-0': 5 + 0 });
    s.pieces.find((p) => p.id === 'p0-0')!.pos = 4;
    const st = applyAction(A, s, { type: 'roll', dice: [1, 1, 1, 0] }).state;
    const m = legalMoves(A, st).find((x) => x.pieceId === 'p0-0')!;
    expect(m.to).toBe(7);
    const ins = moveInsight(A, st, m);
    expect(ins.riskAfter).toBeCloseTo(6 / 16);
    expect(ins.riskBefore).toBeNull(); // casa 4: privata
  });
  it('rosetta: turno extra e nessun rischio', () => {
    const s = place(A, { 'p0-0': 6, 'p1-0': 5 });
    const st = applyAction(A, s, { type: 'roll', dice: [1, 1, 0, 0] }).state;
    const ins = moveInsight(A, st, legalMoves(A, st).find((x) => x.pieceId === 'p0-0')!);
    expect(ins.rosette && ins.extraTurn).toBe(true);
    expect(ins.riskAfter).toBeNull();
  });
  it('caselle private al sicuro; cattura segnalata', () => {
    expect(captureRisk(A, initialState(A, 0), 0, 'r2c3')).toBeNull();
    const s = place(A, { 'p0-0': 5, 'p1-0': 7 });
    const st = applyAction(A, s, { type: 'roll', dice: [1, 1, 0, 0] }).state;
    expect(moveInsight(A, st, legalMoves(A, st).find((x) => x.pieceId === 'p0-0')!).capture).toBe(true);
  });
  it('regolamento avanzato: gettoni e minaccia d\'ingresso dell\'avversario', () => {
    const s = place(B, { 'p0-1': 6, 'p1-0': 4 }); // la Rondine avversaria è entrata: ora tocca all'Uccello-tempesta (casa 5)
    const st = applyAction(B, s, { type: 'roll', dice: [3] }).state; // 6 → 9 supera la rosetta 8
    const ins = moveInsight(B, st, legalMoves(B, st).find((x) => x.pieceId === 'p0-1')!);
    expect(ins.counters).toBe(-4);
    // casa 5 (r1c0): minacciata dalla Rondine a distanza 1 e dall'ingresso con 5; entrambi nascono dal primario 1 → 1/4
    expect(captureRisk(B, st, 0, 'r1c0')).toBeCloseTo(1 / 4);
    // casa 6 (r1c1): distanza 2 dalla Rondine (1/4) oppure ingresso del Corvo? no: tocca all'Uccello-tempesta → solo 1/4
    expect(captureRisk(B, st, 0, 'r1c1')).toBeCloseTo(1 / 4);
  });
});
