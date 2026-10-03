import { describe, it, expect } from 'vitest';
import {
  BOARDS, ROUTES, RULE_MARKS, DECORATIONS, COMPATIBILITY, resolveSpec, initialState, applyAction, legalMoves,
  availableActions, explainIllegal, binaryDistribution, binaryValue, FINKEL_CONVERSION, rosettePositions, drawFirstPlayer,
  randomnessFor, type GameConfig, type GameState, type GameSpec, type Action, type Player,
} from '../src/engine/index.ts';

const MODERN_A: GameConfig = { boardId: 'ur-iii', boardVersion: 1, rulesetId: 'moderno', rulesetVersion: 1 };
const ADV_B: GameConfig = { boardId: 'tarda', boardVersion: 1, rulesetId: 'finkel-sperimentale', rulesetVersion: 1 };
const MODERN_B: GameConfig = { boardId: 'tarda', boardVersion: 1, rulesetId: 'moderno', rulesetVersion: 1 };
const ADV_A: GameConfig = { boardId: 'ur-iii', boardVersion: 1, rulesetId: 'finkel-sperimentale', rulesetVersion: 1 };

function bits(n: number): number[] {
  return [0, 1, 2, 3].map((i) => (i < n ? 1 : 0));
}

/** Prepara uno stato con le pedine in posizioni date. */
function place(spec: GameSpec, s: GameState, pos: Record<string, number>, launched = true): GameState {
  const c = structuredClone(s);
  for (const [id, p] of Object.entries(pos)) {
    const piece = c.pieces.find((x) => x.id === id)!;
    piece.pos = p;
    piece.launched = launched || p > 0;
  }
  c.launchedCount = [0, 1].map((o) => c.pieces.filter((p) => p.owner === o && p.launched).length) as [number, number];
  return c;
}

function seeded(seed: number) {
  let x = seed >>> 0 || 1;
  return (n: number) => {
    x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0;
    return x % n;
  };
}

describe('tavole: integrità delle venti caselle', () => {
  for (const b of Object.values(BOARDS)) {
    it(`${b.id} ha 20 caselle uniche`, () => {
      expect(b.cells).toHaveLength(20);
      expect(new Set(b.cells.map((c) => c.id)).size).toBe(20);
    });
    it(`${b.id} ha una decorazione per ogni casella`, () => {
      const d = DECORATIONS[b.id].cells;
      expect(Object.keys(d).sort()).toEqual(b.cells.map((c) => c.id).sort());
    });
  }
  it('tavola A: blocco 3×4, ponte di 2, blocco 3×2', () => {
    const ids = new Set(BOARDS['ur-iii'].cells.map((c) => c.id));
    for (const r of [0, 1, 2]) for (const c of [0, 1, 2, 3, 6, 7]) expect(ids.has(`r${r}c${c}`)).toBe(true);
    expect(ids.has('r1c4') && ids.has('r1c5')).toBe(true);
    expect(ids.has('r0c4') || ids.has('r2c5')).toBe(false);
  });
  it('tavola B: blocco 3×4 e fila centrale di dodici', () => {
    const cells = BOARDS.tarda.cells;
    expect(cells.filter((c) => c.row === 1)).toHaveLength(12);
    expect(cells.filter((c) => c.col >= 4).every((c) => c.row === 1)).toBe(true);
  });
  it('tavola A: cinque rosette fisiche nelle posizioni del reperto', () => {
    expect(DECORATIONS['ur-iii'].physicalRosettes.sort()).toEqual(['r0c0', 'r0c6', 'r1c3', 'r2c0', 'r2c6']);
    expect(RULE_MARKS['ur-iii'].cells.sort()).toEqual(DECORATIONS['ur-iii'].physicalRosettes.sort());
  });
  it('tavola B: nessuna marcatura fisica, caselle speciali solo come sovrapposizione', () => {
    expect(DECORATIONS.tarda.physicalRosettes).toEqual([]);
    expect(RULE_MARKS.tarda.display).toBe('sovrapposizione');
  });
});

describe('percorsi', () => {
  it('Bell 14: 4 private + 8 condivise + 2 private, rosette 4, 8, 14', () => {
    const r = ROUTES['bell-14'];
    for (const p of [0, 1] as Player[]) {
      expect(r.paths[p]).toHaveLength(14);
      expect(rosettePositions(r, p)).toEqual([4, 8, 14]);
    }
    const shared = r.paths[0].filter((c) => r.paths[1].includes(c));
    expect(shared).toEqual(r.paths[0].slice(4, 12));
  });
  it('Finkel 16: 4 private + 12 condivise, rosette 4, 8, 12, 16', () => {
    const r = ROUTES['finkel-16'];
    for (const p of [0, 1] as Player[]) {
      expect(r.paths[p]).toHaveLength(16);
      expect(rosettePositions(r, p)).toEqual([4, 8, 12, 16]);
    }
    const shared = r.paths[0].filter((c) => r.paths[1].includes(c));
    expect(shared).toEqual(r.paths[0].slice(4));
  });
  it('le probabilità di Finkel tornano: Rondine 4 rosette dalla casa 4, Uccello-tempesta 3 dalla 5, Aquila 2 dalla 10', () => {
    const ros = rosettePositions(ROUTES['finkel-16'], 0);
    expect(ros.filter((r) => r >= 4)).toHaveLength(4);
    expect(ros.filter((r) => r > 5)).toHaveLength(3);
    expect(ros.filter((r) => r > 7)).toHaveLength(3);
    expect(ros.filter((r) => r > 10)).toHaveLength(2);
  });
  it('tutte le combinazioni della matrice producono specifiche coerenti', () => {
    for (const c of COMPATIBILITY) {
      const spec = resolveSpec({ boardId: c.boardId, boardVersion: 1, rulesetId: c.rulesetId, rulesetVersion: 1 });
      expect(spec.length).toBeGreaterThanOrEqual(14);
    }
  });
  it('versioni inesistenti sono rifiutate', () => {
    expect(() => resolveSpec({ ...MODERN_A, rulesetVersion: 99 })).toThrow();
  });
});

describe('dadi', () => {
  it('distribuzione esatta di quattro dadi binari: 1,4,6,4,1 su 16', () => {
    expect(binaryDistribution(4).map((p) => p * 16)).toEqual([1, 4, 6, 4, 1]);
  });
  it('enumerazione completa dei 16 esiti', () => {
    const counts = [0, 0, 0, 0, 0];
    for (let m = 0; m < 16; m++) counts[binaryValue([0, 1, 2, 3].map((i) => (m >> i) & 1))]++;
    expect(counts).toEqual([1, 4, 6, 4, 1]);
  });
  it('mappatura di Finkel 1→5, 2→6, 3→7, 4→10', () => {
    expect(FINKEL_CONVERSION).toEqual({ 1: 5, 2: 6, 3: 7, 4: 10 });
  });
  it('esiti dei dadi non validi sono rifiutati', () => {
    const spec = resolveSpec(MODERN_A);
    const s = initialState(spec, 0);
    expect(() => applyAction(spec, s, { type: 'roll', dice: [2, 0, 0, 0] })).toThrow();
    expect(() => applyAction(spec, s, { type: 'roll', dice: [1, 1] })).toThrow();
    const a = resolveSpec(ADV_B);
    expect(() => applyAction(a, initialState(a, 0), { type: 'roll', dice: [5] })).toThrow();
  });
});

describe('regolamento moderno', () => {
  const spec = resolveSpec(MODERN_A);
  const s0 = initialState(spec, 0);

  it('stato iniziale: 7 pedine in riserva per lato', () => {
    expect(s0.pieces.filter((p) => p.owner === 0 && p.pos === 0)).toHaveLength(7);
    expect(s0.pieces.filter((p) => p.owner === 1 && p.pos === 0)).toHaveLength(7);
  });
  it('ingresso: con n la pedina va alla casa n', () => {
    const { state } = applyAction(spec, s0, { type: 'roll', dice: bits(3) });
    const moves = legalMoves(spec, state);
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ from: 0, to: 3, enter: true });
    const after = applyAction(spec, state, { type: 'move', pieceId: moves[0].pieceId, to: 3 }).state;
    expect(after.turn).toBe(1);
    expect(after.version).toBe(2);
  });
  it('zero: il turno passa', () => {
    const r = applyAction(spec, s0, { type: 'roll', dice: bits(0) });
    expect(r.state.turn).toBe(1);
    expect(r.events.some((e) => e.type === 'turn-passed' && e.reason === 'zero')).toBe(true);
  });
  it('rosetta: turno aggiuntivo', () => {
    const r = applyAction(spec, s0, { type: 'roll', dice: bits(4) });
    const m = applyAction(spec, r.state, { type: 'move', pieceId: 'p0-0', to: 4 });
    expect(m.state.turn).toBe(0);
    expect(m.state.phase).toBe('roll');
    expect(m.events.some((e) => e.type === 'extra-turn')).toBe(true);
  });
  it('cattura su casella condivisa e rientro in riserva', () => {
    let s = place(spec, s0, { 'p0-0': 5, 'p1-0': 7 });
    s = applyAction(spec, s, { type: 'roll', dice: bits(2) }).state;
    const r = applyAction(spec, s, { type: 'move', pieceId: 'p0-0', to: 7 });
    expect(r.state.pieces.find((p) => p.id === 'p1-0')!.pos).toBe(0);
    expect(r.events.some((e) => e.type === 'captured')).toBe(true);
  });
  it('rosetta centrale protegge dalla cattura', () => {
    let s = place(spec, s0, { 'p0-0': 6, 'p1-0': 8 });
    s = applyAction(spec, s, { type: 'roll', dice: bits(2) }).state;
    expect(legalMoves(spec, s).find((m) => m.pieceId === 'p0-0')).toBeUndefined();
    expect(explainIllegal(spec, s, 'p0-0')).toMatch(/protetta/);
  });
  it('caselle private: nessuna interferenza fra i lati', () => {
    let s = place(spec, s0, { 'p0-0': 2, 'p1-0': 3 });
    s = applyAction(spec, s, { type: 'roll', dice: bits(1) }).state;
    const m = legalMoves(spec, s).find((x) => x.pieceId === 'p0-0')!;
    expect(m.capture).toBeNull();
  });
  it('divieto di sovrapporre le proprie pedine', () => {
    let s = place(spec, s0, { 'p0-0': 5, 'p0-1': 7 });
    s = applyAction(spec, s, { type: 'roll', dice: bits(2) }).state;
    expect(legalMoves(spec, s).find((m) => m.pieceId === 'p0-0')).toBeUndefined();
    expect(explainIllegal(spec, s, 'p0-0')).toMatch(/tua pedina/);
  });
  it('uscita con risultato esatto', () => {
    let s = place(spec, s0, { 'p0-0': 13 });
    const s3 = applyAction(spec, s, { type: 'roll', dice: bits(3) }).state;
    expect(legalMoves(spec, s3).find((m) => m.pieceId === 'p0-0')).toBeUndefined();
    expect(explainIllegal(spec, s3, 'p0-0')).toMatch(/esattamente 2/);
    s = applyAction(spec, s, { type: 'roll', dice: bits(2) }).state;
    const m = legalMoves(spec, s).find((x) => x.pieceId === 'p0-0')!;
    expect(m).toMatchObject({ to: 15, exit: true });
  });
  it('nessuna mossa legale: il turno passa', () => {
    // tutte le pedine fuori tranne una alla casa 14, lancio 4
    const pos: Record<string, number> = {};
    for (let i = 1; i < 7; i++) pos[`p0-${i}`] = 15;
    pos['p0-0'] = 14;
    let s = place(spec, s0, pos);
    const r = applyAction(spec, s, { type: 'roll', dice: bits(4) });
    expect(r.events.some((e) => e.type === 'turn-passed' && e.reason === 'nessuna-mossa')).toBe(true);
    expect(r.state.turn).toBe(1);
  });
  it('vittoria con l\'ultima pedina', () => {
    const pos: Record<string, number> = {};
    for (let i = 1; i < 7; i++) pos[`p0-${i}`] = 15;
    pos['p0-0'] = 14;
    let s = place(spec, s0, pos);
    s = applyAction(spec, s, { type: 'roll', dice: bits(1) }).state;
    const r = applyAction(spec, s, { type: 'move', pieceId: 'p0-0', to: 15 });
    expect(r.state.phase).toBe('finished');
    expect(r.state.winner).toBe(0);
    expect(() => applyAction(spec, r.state, { type: 'roll', dice: bits(1) })).toThrow();
  });
  it('una sola pedina per lancio e solo il giocatore di turno', () => {
    let s = applyAction(spec, s0, { type: 'roll', dice: bits(2) }).state;
    expect(() => applyAction(spec, s, { type: 'roll', dice: bits(2) })).toThrow(/Hai già lanciato/);
    expect(() => applyAction(spec, s, { type: 'move', pieceId: 'p1-0', to: 2 })).toThrow();
  });
  it('tavola B con regolamento moderno: uscita alla 17', () => {
    const b = resolveSpec(MODERN_B);
    let s = place(b, initialState(b, 0), { 'p0-0': 16 });
    s = applyAction(b, s, { type: 'roll', dice: bits(1) }).state;
    expect(legalMoves(b, s).find((m) => m.pieceId === 'p0-0')).toMatchObject({ to: 17, exit: true });
  });
});

describe('ricostruzione sperimentale basata su Finkel', () => {
  const spec = resolveSpec(ADV_B);
  const s0 = initialState(spec, 0);
  const roll = (s: GameState, d: number) => applyAction(spec, s, { type: 'roll', dice: [d] }).state;

  it('componenti: 5 pedine diverse, 25 gettoni, 10 a testa nella cassa', () => {
    expect(s0.pieces.filter((p) => p.owner === 0).map((p) => p.kind)).toEqual(['rondine', 'uccello-tempesta', 'corvo', 'gallo', 'aquila']);
    expect(s0.counters).toEqual([15, 15]);
    expect(s0.pool).toBe(20);
  });
  it('la Rondine entra con 2 sulla casa 4 (rosetta) e incassa 3', () => {
    let s = roll(s0, 2);
    expect(s.phase).toBe('decide');
    const m = legalMoves(spec, s);
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ pieceId: 'p0-0', to: 4, enter: true, landsRosette: true });
    const r = applyAction(spec, s, { type: 'move', pieceId: 'p0-0', to: 4 });
    expect(r.state.counters![0]).toBe(18);
    expect(r.state.pool).toBe(17);
    expect(r.state.turn).toBe(1); // niente turno aggiuntivo
  });
  it('ordine d\'ingresso: l\'Uccello-tempesta non entra prima della Rondine', () => {
    let s = roll(s0, 1);
    s = applyAction(spec, s, { type: 'convert', yes: 1 }).state; // 5
    expect(s.turn).toBe(1); // nessuna mossa → turno passato
    expect(explainIllegal(spec, { ...roll(s0, 1), phase: 'move', roll: { dice: [1], primary: 1, converted: 1, value: 5 } }, 'p0-1')).toMatch(/Rondine/);
  });
  it('conversione: "sì" trasforma 1,2,3,4 in 5,6,7,10; "no" perde il turno', () => {
    let s = place(spec, s0, { 'p0-0': 4 });
    for (const [p, v] of [[1, 5], [2, 6], [3, 7], [4, 10]]) {
      const c = applyAction(spec, roll(s, p), { type: 'convert', yes: 1 }).state;
      expect(c.roll!.value).toBe(v);
    }
    const no = applyAction(spec, roll(s, 3), { type: 'convert', yes: 0 });
    expect(no.state.turn).toBe(1);
    expect(no.events.some((e) => e.type === 'turn-passed' && e.reason === 'conversione-no')).toBe(true);
  });
  it('ingressi alle case 5, 6, 7, 10 con i lanci convertiti', () => {
    let s = place(spec, s0, { 'p0-0': 2 });
    const houses: [string, number, number][] = [['p0-1', 1, 5], ['p0-2', 2, 6], ['p0-3', 3, 7], ['p0-4', 4, 10]];
    for (const [id, primary, house] of houses) {
      s = { ...s, turn: 0, phase: 'roll' };
      s = roll(s, primary);
      s = applyAction(spec, s, { type: 'convert', yes: 1 }).state;
      const m = legalMoves(spec, s).find((x) => x.pieceId === id);
      expect(m).toMatchObject({ to: house, enter: true });
      s = applyAction(spec, s, { type: 'move', pieceId: id, to: house }).state;
    }
    expect(s.launchedCount[0]).toBe(5);
  });
  it('superare una rosetta senza fermarsi costa il valore della pedina', () => {
    let s = place(spec, s0, { 'p0-1': 6 });
    s = roll(s, 3); // 6 → 9, supera la 8
    const r = applyAction(spec, s, { type: 'move', pieceId: 'p0-1', to: 9 });
    expect(r.state.counters![0]).toBe(11);
    expect(r.state.pool).toBe(24);
  });
  it('obbligo di muovere: non si può passare se esiste una mossa', () => {
    let s = place(spec, s0, { 'p0-0': 5 });
    s = roll(s, 1);
    expect(availableActions(spec, s).pass).toBe(false);
    expect(() => applyAction(spec, s, { type: 'pass' })).toThrow(/va giocata/);
  });
  it('cattura e rientro della Rondine davanti a una rosetta a scelta', () => {
    let s = place(spec, s0, { 'p0-1': 5, 'p1-0': 6 });
    s = roll(s, 1);
    s = applyAction(spec, s, { type: 'move', pieceId: 'p0-1', to: 6 }).state;
    const sw = s.pieces.find((p) => p.id === 'p1-0')!;
    expect(sw.pos).toBe(0);
    expect(sw.launched).toBe(true);
    s = roll(s, 2);
    const entries = legalMoves(spec, s).filter((m) => m.pieceId === 'p1-0').map((m) => m.to).sort((a, b) => a - b);
    expect(entries).toEqual([3, 7, 11, 15]);
  });
  it('rosette sicure anche nella fila condivisa', () => {
    let s = place(spec, s0, { 'p0-1': 5, 'p1-1': 8 });
    s = roll(s, 3);
    expect(legalMoves(spec, s).find((m) => m.pieceId === 'p0-1')).toBeUndefined();
  });
  it('uscita esatta dalla casa 16 e penalità per le pedine avversarie rimaste', () => {
    const pos: Record<string, number> = { 'p0-0': 17, 'p0-1': 17, 'p0-2': 17, 'p0-3': 17, 'p0-4': 16, 'p1-4': 9, 'p1-0': 3 };
    let s = place(spec, s0, pos);
    s = roll(s, 2);
    expect(legalMoves(spec, s).find((m) => m.pieceId === 'p0-4')).toBeUndefined();
    s = roll({ ...s, phase: 'roll', turn: 0 }, 1);
    const r = applyAction(spec, s, { type: 'move', pieceId: 'p0-4', to: 17 });
    expect(r.state.winner).toBe(0);
    // penalità: Aquila 5 + Rondine 3 = 8
    expect(r.state.counters).toEqual([15 + 8, 15 - 8]);
  });
  it('i gettoni non scendono sotto zero', () => {
    let s = place(spec, s0, { 'p0-4': 10 });
    s = { ...s, counters: [2, 15] };
    s = roll(s, 3); // 10 → 13 supera la 12, Aquila vale 5
    const r = applyAction(spec, s, { type: 'move', pieceId: 'p0-4', to: 13 });
    expect(r.state.counters![0]).toBe(0);
  });
  it('passare senza mosse con il primario è consentito', () => {
    const s = roll(s0, 3);
    expect(availableActions(spec, s).pass).toBe(true);
    expect(applyAction(spec, s, { type: 'pass' }).state.turn).toBe(1);
  });
  it('adattamento su tavola A: rientro Rondine su 3, 7, 13', () => {
    const a = resolveSpec(ADV_A);
    let s = place(a, initialState(a, 0), { 'p0-0': 0 });
    s.pieces[0].launched = true;
    s.launchedCount = [1, 0];
    s = applyAction(a, s, { type: 'roll', dice: [2] }).state;
    expect(legalMoves(a, s).map((m) => m.to).sort((x, y) => x - y)).toEqual([3, 7, 13]);
  });
  it('sorteggio iniziale con il dado 1–4 ripetuto alla parità', () => {
    const r = drawFirstPlayer(spec, seeded(7));
    const last = r.startRolls![r.startRolls!.length - 1];
    expect(last[0]).not.toBe(last[1]);
    expect(r.firstPlayer).toBe(last[0] > last[1] ? 0 : 1);
  });
});

describe('determinismo e partite complete casuali', () => {
  for (const cfg of [MODERN_A, ADV_B, MODERN_B, ADV_A]) {
    it(`partite simulate fino alla fine: ${cfg.boardId}/${cfg.rulesetId}`, () => {
      const spec = resolveSpec(cfg);
      for (let g = 0; g < 40; g++) {
        const rand = seeded(1000 + g);
        let s = initialState(spec, (g % 2) as Player);
        const actions: Action[] = [];
        let steps = 0;
        while (s.phase !== 'finished' && steps++ < 20000) {
          const av = availableActions(spec, s);
          let a: Action;
          if (av.roll) a = { type: 'roll', dice: randomnessFor(spec, 'roll', rand).dice! };
          else if (av.moves.length && !(s.phase === 'decide' && rand(3) === 0)) {
            const m = av.moves[rand(av.moves.length)];
            a = { type: 'move', pieceId: m.pieceId, to: m.to };
          } else if (av.convert) a = { type: 'convert', yes: randomnessFor(spec, 'convert', rand).yes! };
          else a = { type: 'pass' };
          actions.push(a);
          s = applyAction(spec, s, a).state;
          // invarianti
          const cells = s.pieces.map((p) => (p.pos >= 1 && p.pos <= spec.length ? spec.route.paths[p.owner][p.pos - 1] : null)).filter(Boolean);
          expect(new Set(cells).size).toBe(cells.length);
          if (s.counters) expect(s.counters[0] + s.counters[1] + s.pool!).toBe(50);
        }
        expect(s.phase).toBe('finished');
        // determinismo: il replay produce lo stesso stato
        let r = initialState(spec, (g % 2) as Player);
        for (const a of actions) r = applyAction(spec, r, a).state;
        expect(r).toEqual(s);
      }
    });
  }
});
