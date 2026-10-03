import { describe, it, expect } from 'vitest';
import { randomInt } from 'node:crypto';
import { resolveSpec, randomnessFor, binaryValue, binaryDistribution, FINKEL_CONVERSION } from '../src/engine/index.ts';

const rand = (n: number) => randomInt(n);

/** Chi-quadro di Pearson. */
function chi2(observed: number[], expected: number[]) {
  return observed.reduce((s, o, i) => s + (o - expected[i]) ** 2 / expected[i], 0);
}

describe('estrazione dei dadi con la sorgente crittografica del server', () => {
  it('somma di quattro dadi binari: distribuzione 1-4-6-4-1 (non uniforme 0–4)', () => {
    const spec = resolveSpec({ boardId: 'ur-iii', boardVersion: 1, rulesetId: 'moderno', rulesetVersion: 1 });
    const N = 160_000;
    const counts = [0, 0, 0, 0, 0];
    for (let i = 0; i < N; i++) counts[binaryValue(randomnessFor(spec, 'roll', rand).dice!)]++;
    const expected = binaryDistribution(4).map((p) => p * N);
    // gradi di libertà 4, soglia p = 0,001: 18,47
    expect(chi2(counts, expected)).toBeLessThan(18.47);
    // una distribuzione uniforme sarebbe nettamente respinta
    expect(chi2(counts, [N / 5, N / 5, N / 5, N / 5, N / 5])).toBeGreaterThan(1000);
  });

  it('dado 1–4 equo e dado sì/no equo (regolamento avanzato)', () => {
    const spec = resolveSpec({ boardId: 'tarda', boardVersion: 1, rulesetId: 'finkel-sperimentale', rulesetVersion: 1 });
    const N = 80_000;
    const d4 = [0, 0, 0, 0];
    const yn = [0, 0];
    for (let i = 0; i < N; i++) {
      d4[randomnessFor(spec, 'roll', rand).dice![0] - 1]++;
      yn[randomnessFor(spec, 'convert', rand).yes!]++;
    }
    expect(chi2(d4, [N / 4, N / 4, N / 4, N / 4])).toBeLessThan(16.27); // df 3, p 0,001
    expect(chi2(yn, [N / 2, N / 2])).toBeLessThan(10.83); // df 1, p 0,001
  });

  it('valori convertiti possibili: soltanto 5, 6, 7, 10', () => {
    expect(Object.values(FINKEL_CONVERSION).sort((a, b) => a - b)).toEqual([5, 6, 7, 10]);
  });
});
