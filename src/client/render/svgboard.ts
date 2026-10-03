// Vista 2D in SVG: anteprima dei percorsi nella scelta dei preset e ripiego giocabile senza WebGL.

import { BOARDS, DECORATIONS, RULE_MARKS, routeFor, kindOf, type BoardId, type GameSpec, type GameState, type Move, type Player } from '../../engine/index.ts';

const NS = 'http://www.w3.org/2000/svg';
const CELL = 40;

function el(tag: string, attrs: Record<string, string | number>, ...children: (SVGElement | string)[]) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  for (const c of children) e.append(typeof c === 'string' ? document.createTextNode(c) : c);
  return e;
}

function rosette(cx: number, cy: number, r: number, cls: string) {
  const g = el('g', { class: cls });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    g.append(el('ellipse', { cx: cx + Math.cos(a) * r * 0.45, cy: cy + Math.sin(a) * r * 0.45, rx: r * 0.42, ry: r * 0.14, transform: `rotate(${(a * 180) / Math.PI} ${cx + Math.cos(a) * r * 0.45} ${cy + Math.sin(a) * r * 0.45})` }));
  }
  g.append(el('circle', { cx, cy, r: r * 0.14 }));
  return g;
}

export interface SvgOptions {
  paths?: Player[];
  numbers?: Player | null;
  title?: string;
}

/** Disegna la tavola con percorsi opzionali. Restituisce l'elemento SVG e una funzione per le coordinate delle caselle. */
export function boardSvg(boardId: BoardId, opts: SvgOptions = {}) {
  const b = BOARDS[boardId];
  const pad = 14;
  const W = b.cols * CELL + pad * 2, H = b.rows * CELL + pad * 2;
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'preview-svg', role: 'img' }) as SVGSVGElement;
  svg.append(el('title', {}, opts.title ?? `Schema della ${b.name}`));
  svg.append(el('style', {}, `
    .cell{fill:#e6dbc4;stroke:#2a1e14;stroke-width:1.2}
    .late .cell{fill:#e8dcc0}
    .ros{fill:#a8452d;stroke:none}
    .ros-overlay{fill:none;stroke:#b08a3c;stroke-width:1.4;stroke-dasharray:3 2}
    .path0{fill:none;stroke:#2f4aa0;stroke-width:2.6;stroke-linecap:round;stroke-linejoin:round}
    .path1{fill:none;stroke:#b5523b;stroke-width:2.6;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:6 3}
    .num{font:600 10px sans-serif;fill:#1b150f}
    .bg{fill:${boardId === 'ur-iii' ? '#151210' : '#b48d5e'}}
  `));
  const center = (row: number, col: number) => ({ x: pad + col * CELL + CELL / 2, y: pad + row * CELL + CELL / 2 });
  const g = el('g', { class: boardId === 'ur-iii' ? 'ur' : 'late' });
  svg.append(g);
  if (boardId === 'tarda') g.append(el('rect', { class: 'bg', x: pad - 6, y: pad - 6, width: b.cols * CELL + 12, height: b.rows * CELL + 12, rx: 3 }));
  else {
    for (const blk of [[0, 3, 0, 2], [4, 5, 1, 1], [6, 7, 0, 2]]) {
      g.append(el('rect', { class: 'bg', x: pad + blk[0] * CELL - 5, y: pad + blk[2] * CELL - 5, width: (blk[1] - blk[0] + 1) * CELL + 10, height: (blk[3] - blk[2] + 1) * CELL + 10, rx: 3 }));
    }
  }
  const physical = new Set(DECORATIONS[boardId].physicalRosettes);
  const marks = RULE_MARKS[boardId];
  for (const c of b.cells) {
    const { x, y } = center(c.row, c.col);
    g.append(el('rect', { class: 'cell', x: x - CELL / 2 + 2, y: y - CELL / 2 + 2, width: CELL - 4, height: CELL - 4, rx: 2, 'data-cell': c.id }));
    if (physical.has(c.id)) g.append(rosette(x, y, CELL * 0.4, 'ros'));
    else if (marks.cells.includes(c.id)) g.append(rosette(x, y, CELL * 0.36, 'ros-overlay'));
  }
  const route = routeFor(boardId);
  for (const p of opts.paths ?? []) {
    const pts = route.paths[p].map((id) => {
      const cell = b.cells.find((c) => c.id === id)!;
      const { x, y } = center(cell.row, cell.col);
      const off = p === 0 ? 4 : -4;
      return `${x + (cell.row === 1 ? 0 : 0)},${y + (cell.row === 1 ? off : 0)}`;
    });
    // ingresso dall'esterno e uscita
    const first = b.cells.find((c) => c.id === route.paths[p][0])!;
    const f = center(first.row, first.col);
    const startPt = `${f.x + CELL * 0.55},${f.y + (p === 0 ? CELL * 0.45 : -CELL * 0.45)}`;
    const last = b.cells.find((c) => c.id === route.paths[p][route.paths[p].length - 1])!;
    const l = center(last.row, last.col);
    const endPt = route.id === 'bell-14' ? `${l.x - CELL * 0.1},${l.y + (p === 0 ? CELL * 0.62 : -CELL * 0.62)}` : `${l.x + CELL * 0.62},${l.y + (p === 0 ? 4 : -4)}`;
    const mk = `arrow${p}-${boardId}`;
    svg.append(el('defs', {}, el('marker', { id: mk, viewBox: '0 0 10 10', refX: 6, refY: 5, markerWidth: 5, markerHeight: 5, orient: 'auto-start-reverse' },
      el('path', { d: 'M0,0 L10,5 L0,10 z', fill: p === 0 ? '#2f4aa0' : '#b5523b' }))));
    g.append(el('polyline', { class: `path${p}`, points: [startPt, ...pts, endPt].join(' '), 'marker-end': `url(#${mk})` }));
  }
  if (opts.numbers !== undefined && opts.numbers !== null) {
    route.paths[opts.numbers].forEach((id, i) => {
      const cell = b.cells.find((c) => c.id === id)!;
      const { x, y } = center(cell.row, cell.col);
      g.append(el('text', { class: 'num', x: x - CELL / 2 + 5, y: y - CELL / 2 + 13 }, String(i + 1)));
    });
  }
  return { svg, center, W, H };
}

/** Tavola 2D giocabile (ripiego senza WebGL). */
export class SvgBoardView {
  root: HTMLElement;
  spec: GameSpec;
  private svg: SVGSVGElement;
  private center: (r: number, c: number) => { x: number; y: number };
  private layer: SVGGElement;
  onPick: (t: { pieceId?: string; to?: number }) => void = () => {};

  constructor(root: HTMLElement, spec: GameSpec) {
    this.root = root;
    this.spec = spec;
    const b = boardSvg(spec.board.id, { numbers: null, title: 'Tavola (vista 2D)' });
    // spazio per riserve e uscite
    b.svg.setAttribute('viewBox', `0 -46 ${b.W} ${b.H + 92}`);
    this.svg = b.svg;
    this.center = b.center;
    this.layer = el('g', {}) as SVGGElement;
    this.svg.append(this.layer);
    const wrap = document.createElement('div');
    wrap.className = 'fallback-svg';
    wrap.append(this.svg);
    root.append(wrap);
  }

  render(state: GameState, moves: Move[], selected: string | null) {
    this.layer.replaceChildren();
    const spec = this.spec;
    const movable = new Set(moves.map((m) => m.pieceId));
    for (const owner of [0, 1] as Player[]) {
      const mine = state.pieces.filter((p) => p.owner === owner);
      const yRes = owner === 0 ? this.center(2, 0).y + 46 : this.center(0, 0).y - 46;
      let ri = 0, oi = 0;
      for (const p of mine) {
        let x: number, y: number;
        if (p.pos === 0) { x = 24 + ri++ * 24; y = yRes; }
        else if (p.pos === spec.length + 1) { x = this.center(1, spec.board.cols - 1).x + 14 - oi++ * 24; y = yRes; }
        else {
          const cell = spec.board.cells.find((c) => c.id === spec.route.paths[owner][p.pos - 1])!;
          ({ x, y } = this.center(cell.row, cell.col));
        }
        const g = el('g', { class: 'piece', tabindex: -1, style: 'cursor:pointer' });
        const fill = owner === 0 ? '#efe4cf' : '#2b2722';
        const stroke = movable.has(p.id) ? '#d2ad63' : owner === 0 ? '#2a1e14' : '#efe4cf';
        g.append(el('circle', { cx: x, cy: y, r: 11, fill, stroke, 'stroke-width': movable.has(p.id) ? (p.id === selected ? 4 : 3) : 1.5 }));
        // forma diversa oltre al colore: cerchio pieno vs anello
        if (owner === 1) g.append(el('circle', { cx: x, cy: y, r: 5, fill: 'none', stroke: '#efe4cf', 'stroke-width': 1.5 }));
        else g.append(el('circle', { cx: x, cy: y, r: 3, fill: '#2f4aa0' }));
        if (spec.ruleset.advanced) g.append(el('text', { x, y: y - 14, 'text-anchor': 'middle', style: 'font:700 8px sans-serif;fill:#f0e7d7' }, `${kindOf(spec, p.kind).entryThrow}`));
        g.addEventListener('click', () => this.onPick({ pieceId: p.id }));
        this.layer.append(g);
      }
    }
    const sel = moves.filter((m) => m.pieceId === selected);
    for (const m of sel) {
      let x: number, y: number;
      if (m.to > spec.length) { x = this.center(1, spec.board.cols - 1).x + 14; y = m.owner === 0 ? this.center(2, 0).y + 46 : this.center(0, 0).y - 46; }
      else {
        const cell = spec.board.cells.find((c) => c.id === spec.route.paths[m.owner][m.to - 1])!;
        ({ x, y } = this.center(cell.row, cell.col));
      }
      const t = el('circle', { cx: x, cy: y, r: 15, fill: 'rgba(159,183,255,0.35)', stroke: '#9fb7ff', 'stroke-width': 2, style: 'cursor:pointer' });
      t.addEventListener('click', () => this.onPick({ pieceId: m.pieceId, to: m.to }));
      this.layer.append(t);
    }
  }

  dispose() {
    this.root.querySelector('.fallback-svg')?.remove();
  }
}
