// Percorsi individuali e caselle con effetto di regola. Separati da geometria e decorazione.
// Il numero di caselle fisiche (20) non coincide con la lunghezza del percorso individuale (14 o 16).

import type { BoardId } from './boards.ts';

export type RouteId = 'bell-14' | 'finkel-16';
export type Player = 0 | 1;

export interface RouteDef {
  id: RouteId;
  boardId: BoardId;
  name: string;
  attribution: string;
  status: 'convenzione-moderna' | 'ipotesi-studioso';
  /** paths[p][i] = cella della casa i+1 del giocatore p. */
  paths: [string[], string[]];
}

/** Lato del giocatore: 0 = riga 2 (Sud), 1 = riga 0 (Nord). */
export function sideRow(p: Player): number {
  return p === 0 ? 2 : 0;
}

function bellPath(p: Player): string[] {
  const s = sideRow(p);
  return [
    `r${s}c3`, `r${s}c2`, `r${s}c1`, `r${s}c0`,
    ...[0, 1, 2, 3, 4, 5, 6, 7].map((c) => `r1c${c}`),
    `r${s}c7`, `r${s}c6`,
  ];
}

function finkelPath(p: Player): string[] {
  const s = sideRow(p);
  return [
    `r${s}c3`, `r${s}c2`, `r${s}c1`, `r${s}c0`,
    ...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((c) => `r1c${c}`),
  ];
}

export const ROUTES: Record<RouteId, RouteDef> = {
  'bell-14': {
    id: 'bell-14',
    boardId: 'ur-iii',
    name: 'Percorso di 14 caselle (detto «di Bell»)',
    attribution: 'R. C. Bell, Board and Table Games from Many Civilizations (1960); adottato nelle regole moderne più diffuse.',
    status: 'convenzione-moderna',
    paths: [bellPath(0), bellPath(1)],
  },
  'finkel-16': {
    id: 'finkel-16',
    boardId: 'tarda',
    name: 'Percorso di 16 caselle sulla tavola allungata',
    attribution: 'I. L. Finkel 2007, fig. 3.5 (sulla scia di T. Kendall 1982). Finkel: «there is no evidence on the point».',
    status: 'ipotesi-studioso',
    paths: [finkelPath(0), finkelPath(1)],
  },
};

/** Caselle con effetto di regola ("rosette") per ciascuna tavola. */
export interface RuleMarks {
  boardId: BoardId;
  cells: string[];
  /** 'decorazione' = coincidono con le rosette fisiche del reperto; 'sovrapposizione' = non marcate sul reperto, mostrate come overlay. */
  display: 'decorazione' | 'sovrapposizione';
  source: string;
}

export const RULE_MARKS: Record<BoardId, RuleMarks> = {
  'ur-iii': {
    boardId: 'ur-iii',
    cells: ['r0c0', 'r2c0', 'r1c3', 'r0c6', 'r2c6'],
    display: 'decorazione',
    source: 'Rosette intarsiate del reperto BM 1928,1009.378.',
  },
  tarda: {
    boardId: 'tarda',
    cells: ['r0c0', 'r2c0', 'r1c3', 'r1c7', 'r1c11'],
    display: 'sovrapposizione',
    source: 'Finkel 2007, figg. 3.2b e 3.5 (diagramma della tavola tarda). Il reperto Met 16.10.475a non mostra marcature: le caselle sono indicate solo da una sovrapposizione disattivabile.',
  },
};

export function routeFor(boardId: BoardId): RouteDef {
  return boardId === 'ur-iii' ? ROUTES['bell-14'] : ROUTES['finkel-16'];
}

/** Posizioni (1-based) del percorso che cadono su una casella speciale. */
export function rosettePositions(route: RouteDef, p: Player): number[] {
  const marks = new Set(RULE_MARKS[route.boardId].cells);
  return route.paths[p].map((c, i) => (marks.has(c) ? i + 1 : 0)).filter((x) => x > 0);
}
