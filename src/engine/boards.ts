// Geometria fisica delle tavole. Nessuna regola qui: solo caselle, coordinate e misure.
// Le decorazioni stanno in decorations.ts, i percorsi in routes.ts, i regolamenti in rulesets.ts.

export type BoardId = 'ur-iii' | 'tarda';

export interface CellDef {
  /** Identificativo stabile: r{riga}c{colonna}. Riga 0 = lato del giocatore 1 (Nord), riga 2 = lato del giocatore 0 (Sud). */
  id: string;
  row: number;
  col: number;
}

export interface Measure {
  value: number;
  /** 'reperto' = dato pubblicato dal museo; 'stimata' = ricavata dalle fotografie o dalle proporzioni. */
  status: 'reperto' | 'stimata';
  note?: string;
}

export interface BoardDef {
  id: BoardId;
  version: number;
  name: string;
  shortName: string;
  period: string;
  reference: string;
  cols: number;
  rows: number;
  cells: CellDef[];
  /** Misure in centimetri. */
  dims: {
    length: Measure;
    width: Measure;
    height: Measure;
    cellPitchX: Measure;
    cellPitchY: Measure;
    frame: Measure;
  };
}

function cell(row: number, col: number): CellDef {
  return { id: `r${row}c${col}`, row, col };
}

function block(rows: number[], cols: number[]): CellDef[] {
  const out: CellDef[] = [];
  for (const r of rows) for (const c of cols) out.push(cell(r, c));
  return out;
}

/** Tavola A: blocco 3×4 (colonne 0–3), ponte di due caselle (riga 1, colonne 4–5), blocco 3×2 (colonne 6–7). */
const urCells: CellDef[] = [
  ...block([0, 1, 2], [0, 1, 2, 3]),
  cell(1, 4),
  cell(1, 5),
  ...block([0, 1, 2], [6, 7]),
].sort((a, b) => a.row - b.row || a.col - b.col);

/** Tavola B: blocco 3×4 (colonne 0–3) e prolungamento di otto caselle (riga 1, colonne 4–11). */
const lateCells: CellDef[] = [
  ...block([0, 1, 2], [0, 1, 2, 3]),
  ...[4, 5, 6, 7, 8, 9, 10, 11].map((c) => cell(1, c)),
].sort((a, b) => a.row - b.row || a.col - b.col);

export const BOARDS: Record<BoardId, BoardDef> = {
  'ur-iii': {
    id: 'ur-iii',
    version: 1,
    name: 'Tavola di Ur, III millennio a.C.',
    shortName: 'Ur (III mill.)',
    period: 'Protodinastico III, c. 2600–2400 a.C.',
    reference: 'British Museum 1928,1009.378 (BM 120834), Cimitero Reale di Ur',
    cols: 8,
    rows: 3,
    cells: urCells,
    dims: {
      length: { value: 30.1, status: 'reperto', note: 'British Museum / CDLI P498293: 301 mm' },
      width: { value: 11.0, status: 'reperto', note: 'Larghezza dei blocchi; 110 mm' },
      height: { value: 2.4, status: 'reperto', note: '24 mm' },
      cellPitchX: { value: 3.625, status: 'stimata', note: '(30,1 − 2×cornice) / 8; coerente con la fotografia CC0 (BabelStone 2010)' },
      cellPitchY: { value: 3.3, status: 'stimata', note: '(11 − 2×cornice) / 3' },
      frame: { value: 0.55, status: 'stimata', note: 'Cornice in bitume con fascia di losanghe' },
    },
  },
  tarda: {
    id: 'tarda',
    version: 1,
    name: 'Tavola allungata, II–I millennio a.C.',
    shortName: 'Tarda (allungata)',
    period: 'Forma attestata dal II millennio a.C.; reperto di riferimento c. 1580–1458 a.C.',
    reference: 'Metropolitan Museum of Art 16.10.475a (scatola da gioco per senet e venti caselle, Tebe)',
    cols: 12,
    rows: 3,
    cells: lateCells,
    dims: {
      length: { value: 25.0, status: 'reperto', note: 'Met 16.10.475a: L. 25 cm' },
      width: { value: 6.7, status: 'reperto', note: 'Met: w. 6.7 cm' },
      height: { value: 5.0, status: 'reperto', note: 'Met: h. 5 cm (scatola con cassetto)' },
      cellPitchX: { value: 2.03, status: 'stimata', note: '(25 − 2×cornice) / 12; da fotografia Met DP116122 (CC0)' },
      cellPitchY: { value: 2.03, status: 'stimata', note: '(6,7 − 2×cornice) / 3' },
      frame: { value: 0.3, status: 'stimata', note: 'Listelli di avorio e legno' },
    },
  },
};

export function getBoard(id: string): BoardDef {
  const b = (BOARDS as Record<string, BoardDef>)[id];
  if (!b) throw new Error(`Tavola sconosciuta: ${id}`);
  return b;
}

export function cellById(board: BoardDef, id: string): CellDef | undefined {
  return board.cells.find((c) => c.id === id);
}
