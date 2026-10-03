// Sistemi di lancio. L'estrazione è separata dalla rappresentazione animata:
// qui si definiscono solo gli esiti elementari, le distribuzioni esatte e la mappatura.
// La sorgente di casualità è iniettata (crypto sul server, crypto.getRandomValues in locale).

/** Restituisce un intero uniforme in [0, n). */
export type RandomInt = (n: number) => number;

export type DiceSystemId = 'binari-4' | 'finkel-d4-si-no';

export interface DiceSystemInfo {
  id: DiceSystemId;
  name: string;
  components: string;
  status: string;
  distribution: { value: number; p: number; label: string }[];
}

/** Quattro dadi tetraedrici, ciascuno con due vertici marcati su quattro: P(marcato in alto) = 1/2. */
export function rollBinary4(rand: RandomInt): number[] {
  return [rand(2), rand(2), rand(2), rand(2)];
}

export function binaryValue(dice: number[]): number {
  return dice.reduce((a, b) => a + b, 0);
}

function binom(n: number, k: number): number {
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
}

/** Distribuzione esatta della somma di n dadi binari equi: C(n,k)/2^n. */
export function binaryDistribution(n = 4): number[] {
  return Array.from({ length: n + 1 }, (_, k) => binom(n, k) / 2 ** n);
}

/** Dado a quattro facce numerate 1–4 (attrezzatura moderna proposta da Finkel 2007 per la ricostruzione). */
export function rollD4(rand: RandomInt): number {
  return rand(4) + 1;
}

/** Dado a quattro facce, due "sì" e due "no". */
export function rollYesNo(rand: RandomInt): 0 | 1 {
  return rand(2) as 0 | 1;
}

/** Conversione di Finkel: con "sì" il punteggio primario 1, 2, 3, 4 diventa 5, 6, 7, 10. */
export const FINKEL_CONVERSION: Record<number, number> = { 1: 5, 2: 6, 3: 7, 4: 10 };

export const DICE_SYSTEMS: Record<DiceSystemId, DiceSystemInfo> = {
  'binari-4': {
    id: 'binari-4',
    name: 'Quattro dadi tetraedrici binari',
    components: '4 tetraedri; due dei quattro vertici di ciascuno sono marcati da punti intarsiati. Il punteggio è il numero di vertici marcati rivolti verso l\'alto.',
    status: 'Dadi tetraedrici attestati a Ur (Woolley 1934; Finkel 2007). Con il reperto BM ne furono trovati tre; l\'uso di quattro è convenzione moderna.',
    distribution: binaryDistribution(4).map((p, k) => ({ value: k, p, label: `${k}` })),
  },
  'finkel-d4-si-no': {
    id: 'finkel-d4-si-no',
    name: 'Dado 1–4 + dado sì/no',
    components: 'Un dado a quattro facce numerate 1, 2, 3, 4 e un dado a quattro facce con due "sì" e due "no" (attrezzatura proposta da Finkel 2007, p. 27).',
    status: 'La tavoletta BM 33333B nomina un astragalo di bue e uno di pecora; la corrispondenza fra ossi e punteggi non è documentata. Si usano i dadi equi proposti da Finkel: non si assume che gli astragali reali siano equiprobabili.',
    distribution: [
      ...[1, 2, 3, 4].map((v) => ({ value: v, p: 1 / 4, label: `${v} (primario)` })),
      ...[1, 2, 3, 4].map((v) => ({ value: FINKEL_CONVERSION[v], p: 1 / 8, label: `${FINKEL_CONVERSION[v]} (dopo "sì", se si sceglie la conversione)` })),
    ],
  },
};
