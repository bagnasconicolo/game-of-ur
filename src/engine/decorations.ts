// Decorazione casella per casella. Separata da geometria, percorsi e regole.
// Tavola A: mappatura ricavata dalla fotografia CC0 "British Museum Royal Game of Ur.jpg"
// (BabelStone, 24/06/2010) che mostra lo stato museale attuale del reperto 1928,1009.378.
// Orientamento: colonna 0 = estremità del blocco 3×4 lontana dal ponte; riga 0 = fila superiore nella foto.

export type MotifId =
  | 'rosetta' // rosetta a otto petali, petali con intarsi rossi e blu
  | 'occhi' // quattro "occhi" a mandorla con ornati a scaletta (2×2)
  | 'cinque-cerchi' // cinque cerchi concentrici con centro in lapislazzuli (quinconce)
  | 'griglia-16' // griglia 4×4 di riquadri, ciascuno con un punto
  | 'zigzag-punti' // quattro quadranti con cinque punti e bordi a zig-zag
  | 'stella-zigzag' // motivo a stella con contorni a zig-zag e cinque punti centrali
  | 'liscia'; // placchetta senza decorazione (tavola B)

export interface MotifInfo {
  id: MotifId;
  label: string;
  description: string;
}

export const MOTIFS: Record<MotifId, MotifInfo> = {
  rosetta: { id: 'rosetta', label: 'Rosetta', description: 'Rosetta a otto petali incisa nella conchiglia; petali con intarsi rossi (calcare rosso / pasta rossa) e blu (lapislazzuli), centro rosso.' },
  occhi: { id: 'occhi', label: 'Quattro occhi', description: 'Placchetta divisa in quattro con occhi a mandorla dal centro blu e motivi a scaletta.' },
  'cinque-cerchi': { id: 'cinque-cerchi', label: 'Cinque cerchi', description: 'Cinque cerchi concentrici con centro in lapislazzuli, disposti a quinconce.' },
  'griglia-16': { id: 'griglia-16', label: 'Griglia di sedici', description: 'Griglia 4×4 di riquadri incisi, ciascuno con un punto blu.' },
  'zigzag-punti': { id: 'zigzag-punti', label: 'Punti e zig-zag', description: 'Quattro quadranti con cinque punti blu e cornici a zig-zag.' },
  'stella-zigzag': { id: 'stella-zigzag', label: 'Stella a zig-zag', description: 'Motivo stellare a linee spezzate con cinque punti blu al centro.' },
  liscia: { id: 'liscia', label: 'Liscia', description: 'Placchetta in avorio priva di decorazione visibile.' },
};

/** Mappa cella → motivo per la tavola A (stato museale attuale). */
export const UR_DECORATION: Record<string, MotifId> = {
  r0c0: 'rosetta', r0c1: 'occhi', r0c2: 'cinque-cerchi', r0c3: 'occhi',
  r1c0: 'griglia-16', r1c1: 'cinque-cerchi', r1c2: 'zigzag-punti', r1c3: 'rosetta',
  r2c0: 'rosetta', r2c1: 'occhi', r2c2: 'cinque-cerchi', r2c3: 'occhi',
  r1c4: 'cinque-cerchi', r1c5: 'zigzag-punti',
  r0c6: 'rosetta', r0c7: 'stella-zigzag',
  r1c6: 'occhi', r1c7: 'cinque-cerchi',
  r2c6: 'rosetta', r2c7: 'stella-zigzag',
};

/** Tavola B (Met 16.10.475a): le venti placchette in avorio non mostrano marcature nelle fotografie del museo. */
export const LATE_DECORATION: Record<string, MotifId> = Object.fromEntries(
  [
    ...[0, 1, 2].flatMap((r) => [0, 1, 2, 3].map((c) => `r${r}c${c}`)),
    ...[4, 5, 6, 7, 8, 9, 10, 11].map((c) => `r1c${c}`),
  ].map((id) => [id, 'liscia' as MotifId]),
);

export interface DecorationSet {
  boardId: string;
  /** Che cosa rappresenta la resa: lo stato attuale del reperto, non un'ipotesi dell'aspetto antico. */
  state: 'stato-museale';
  cells: Record<string, MotifId>;
  /** Caselle marcate fisicamente come rosette sul reperto. */
  physicalRosettes: string[];
  notes: string[];
}

export const DECORATIONS: Record<string, DecorationSet> = {
  'ur-iii': {
    boardId: 'ur-iii',
    state: 'stato-museale',
    cells: UR_DECORATION,
    physicalRosettes: Object.entries(UR_DECORATION).filter(([, m]) => m === 'rosetta').map(([id]) => id),
    notes: [
      'Mappa ricavata dalla fotografia CC0 di BabelStone (Wikimedia Commons, 2010).',
      'Il supporto ligneo originale non si è conservato: la disposizione attuale è il risultato del restauro museale; il British Museum segnala elementi inseriti nella ricostruzione moderna.',
      'Cornice: bitume nero, fascia di losanghe in conchiglia e calcare rosso; fianchi con placchette a occhio e listelli rossi/bianchi.',
    ],
  },
  tarda: {
    boardId: 'tarda',
    state: 'stato-museale',
    cells: LATE_DECORATION,
    physicalRosettes: [],
    notes: [
      'Venti placchette in avorio senza marcature visibili (fotografie Met DP116122, 16.10.475a.bot, CC0).',
      'Il prolungamento di otto caselle è affiancato da due pannelli incisi con animali in corsa (il Met indica gazzelle, cani e leoni); qui resi in forma semplificata.',
      'Il legno della scatola è indicato dal Met come moderno ("modern wood").',
    ],
  },
};
