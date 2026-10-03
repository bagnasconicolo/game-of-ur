// Texture originali generate a runtime su canvas (nessuna fotografia incorporata).
// Ogni motivo produce: mappa colore, mappa di rilievo (incisioni) e mappa di rugosità.
// I motivi seguono la mappatura casella per casella in engine/decorations.ts.

import * as THREE from 'three';
import type { MotifId } from '../../engine/decorations.ts';

export const PALETTE = {
  shell: '#e9dfc9',
  shellWarm: '#dccfb2',
  shellShadow: '#c7b896',
  incision: '#2a1e14',
  lapis: '#1e3276',
  lapisDeep: '#1a2c66',
  red: '#a8452d',
  redDeep: '#7e3020',
  bitumen: '#151210',
  ivory: '#e4d8bd',
  ivoryWarm: '#d6c6a2',
  wood: '#b48d5e',
};

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

interface Layers {
  color: CanvasRenderingContext2D;
  bump: CanvasRenderingContext2D;
  rough: CanvasRenderingContext2D;
  size: number;
  r: () => number;
}

function canvas(size: number) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c.getContext('2d')!;
}

function layers(size: number, seed: number): Layers {
  return { color: canvas(size), bump: canvas(size), rough: canvas(size), size, r: rng(seed) };
}

/** Fondo in conchiglia: crema con venature di accrescimento, macchie e piccole crepe. */
function shellBase(L: Layers, base = PALETTE.shell) {
  const { color: c, bump: b, rough: ro, size: s, r } = L;
  c.fillStyle = base;
  c.fillRect(0, 0, s, s);
  // venature di accrescimento della conchiglia
  for (let i = 0; i < 26; i++) {
    c.strokeStyle = `rgba(${150 + r() * 40},${130 + r() * 30},${95 + r() * 25},${0.05 + r() * 0.07})`;
    c.lineWidth = s * (0.004 + r() * 0.01);
    c.beginPath();
    const y = r() * s;
    c.moveTo(0, y);
    c.bezierCurveTo(s * 0.3, y + (r() - 0.5) * s * 0.2, s * 0.7, y + (r() - 0.5) * s * 0.2, s, y + (r() - 0.5) * s * 0.1);
    c.stroke();
  }
  // macchie di patina
  for (let i = 0; i < 14; i++) {
    const g = c.createRadialGradient(r() * s, r() * s, 0, r() * s, r() * s, s * (0.08 + r() * 0.25));
    g.addColorStop(0, `rgba(140,112,70,${0.05 + r() * 0.08})`);
    g.addColorStop(1, 'rgba(140,112,70,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, s, s);
  }
  b.fillStyle = '#b8b8b8';
  b.fillRect(0, 0, s, s);
  ro.fillStyle = '#7a7a7a';
  ro.fillRect(0, 0, s, s);
  // micro-crepe (incise poco profonde)
  for (let i = 0; i < 5; i++) {
    let x = r() * s, y = r() * s;
    c.strokeStyle = 'rgba(90,70,45,0.25)';
    b.strokeStyle = '#8a8a8a';
    c.lineWidth = b.lineWidth = s * 0.0025;
    c.beginPath(); b.beginPath();
    c.moveTo(x, y); b.moveTo(x, y);
    for (let k = 0; k < 6; k++) {
      x += (r() - 0.5) * s * 0.12;
      y += (r() - 0.5) * s * 0.12;
      c.lineTo(x, y); b.lineTo(x, y);
    }
    c.stroke(); b.stroke();
  }
  // bordo leggermente consumato
  const e = c.createLinearGradient(0, 0, s, s);
  e.addColorStop(0, 'rgba(255,250,235,0.08)');
  e.addColorStop(1, 'rgba(60,40,20,0.10)');
  c.fillStyle = e;
  c.fillRect(0, 0, s, s);
}

/** Traccia un'incisione riempita di pasta scura (colore) e incavata (rilievo). */
function incise(L: Layers, draw: (ctx: CanvasRenderingContext2D) => void, width = 0.012) {
  for (const [ctx, style] of [[L.color, PALETTE.incision], [L.bump, '#303030'], [L.rough, '#b0b0b0']] as const) {
    ctx.save();
    ctx.strokeStyle = style;
    ctx.lineWidth = L.size * width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    draw(ctx);
    ctx.stroke();
    ctx.restore();
  }
}

/** Intarsio (lapislazzuli o pasta rossa): colore pieno, leggermente più basso e più ruvido del guscio. */
function inlay(L: Layers, color: string, draw: (ctx: CanvasRenderingContext2D) => void, rimInc = true) {
  const r = L.r;
  L.color.save();
  L.color.beginPath();
  draw(L.color);
  L.color.fillStyle = color;
  L.color.fill();
  L.color.clip();
  // variazione del materiale: pirite nel lapislazzuli, venature nel calcare rosso
  for (let i = 0; i < 40; i++) {
    const isLapis = color === PALETTE.lapis;
    const isRed = color === PALETTE.red;
    L.color.fillStyle = isLapis
      ? (r() < 0.12 ? `rgba(214,182,96,${0.5 + r() * 0.4})` : `rgba(${20 + r() * 40},${40 + r() * 40},${110 + r() * 60},0.35)`)
      : isRed ? `rgba(${130 + r() * 60},${50 + r() * 30},${30 + r() * 20},0.35)` : `rgba(${200 + r() * 40},${190 + r() * 30},${160 + r() * 30},0.3)`;
    const rad = L.size * (isLapis && r() < 0.12 ? 0.004 : 0.012 + r() * 0.02);
    L.color.beginPath();
    L.color.arc(r() * L.size, r() * L.size, rad, 0, Math.PI * 2);
    L.color.fill();
  }
  L.color.restore();
  for (const [ctx, fill] of [[L.bump, '#888888'], [L.rough, '#9a9a9a']] as const) {
    ctx.save();
    ctx.beginPath();
    draw(ctx);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.restore();
  }
  if (rimInc) incise(L, draw, 0.008);
}

function circle(cx: number, cy: number, rad: number) {
  return (ctx: CanvasRenderingContext2D) => {
    ctx.moveTo(cx + rad, cy);
    ctx.arc(cx, cy, rad, 0, Math.PI * 2);
  };
}

function almond(ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number, hgt: number, angle = 0) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  ctx.moveTo(-w / 2, 0);
  ctx.quadraticCurveTo(0, -hgt, w / 2, 0);
  ctx.quadraticCurveTo(0, hgt, -w / 2, 0);
  ctx.restore();
}

function petalPath(cx: number, cy: number, r0: number, r1: number, width: number, angle: number) {
  return (ctx: CanvasRenderingContext2D) => {
    const ca = Math.cos(angle), sa = Math.sin(angle);
    const p = (d: number, o: number): [number, number] => [cx + ca * d - sa * o, cy + sa * d + ca * o];
    const [ax, ay] = p(r0, 0);
    const [bx, by] = p(r1, 0);
    const [c1x, c1y] = p((r0 + r1) / 2, width);
    const [c2x, c2y] = p((r0 + r1) / 2, -width);
    ctx.moveTo(ax, ay);
    ctx.quadraticCurveTo(c1x, c1y, bx, by);
    ctx.quadraticCurveTo(c2x, c2y, ax, ay);
  };
}

function drawMotif(L: Layers, motif: MotifId) {
  const s = L.size;
  const m = s * 0.08; // margine della placchetta
  switch (motif) {
    case 'rosetta': {
      shellBase(L);
      const cx = s / 2, cy = s / 2;
      // contorno stellato esterno a punte, inciso
      incise(L, (ctx) => {
        for (let i = 0; i < 8; i++) {
          const a0 = (i / 8) * Math.PI * 2 + Math.PI / 8;
          const a1 = a0 + Math.PI / 8;
          const a2 = a0 + Math.PI / 4;
          const p = (a: number, rr: number) => [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr] as const;
          const [x0, y0] = p(a0, s * 0.3);
          const [x1, y1] = p(a1, s * 0.46);
          const [x2, y2] = p(a2, s * 0.3);
          if (i === 0) ctx.moveTo(x0, y0);
          ctx.lineTo(x1, y1);
          ctx.lineTo(x2, y2);
        }
        ctx.closePath();
      }, 0.009);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        // petali: rosso e lapislazzuli alternati, come nelle rosette del reperto
        inlay(L, i % 2 === 0 ? PALETTE.red : PALETTE.lapis, petalPath(cx, cy, s * 0.07, s * 0.41, s * 0.085, a));
        incise(L, petalPath(cx, cy, s * 0.055, s * 0.44, s * 0.115, a), 0.007);
      }
      inlay(L, PALETTE.red, circle(cx, cy, s * 0.07));
      break;
    }
    case 'occhi': {
      shellBase(L);
      incise(L, (ctx) => { ctx.moveTo(s / 2, m); ctx.lineTo(s / 2, s - m); ctx.moveTo(m, s / 2); ctx.lineTo(s - m, s / 2); }, 0.01);
      const q = [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]];
      q.forEach(([qx, qy], i) => {
        const cx = qx * s, cy = qy * s;
        // scaletta verticale fra occhio e divisorio
        incise(L, (ctx) => {
          const x0 = cx + (i % 2 === 0 ? s * 0.19 : -s * 0.19);
          for (let k = -3; k <= 3; k++) { ctx.moveTo(x0 - s * 0.025, cy + k * s * 0.03); ctx.lineTo(x0 + s * 0.025, cy + k * s * 0.03); }
          ctx.moveTo(x0 - s * 0.025, cy - s * 0.1); ctx.lineTo(x0 - s * 0.025, cy + s * 0.1);
          ctx.moveTo(x0 + s * 0.025, cy - s * 0.1); ctx.lineTo(x0 + s * 0.025, cy + s * 0.1);
        }, 0.006);
        for (const k of [1, 0.72, 0.46]) incise(L, (ctx) => almond(ctx, cx - (i % 2 === 0 ? s * 0.03 : -s * 0.03), cy, s * 0.3 * k, s * 0.17 * k), 0.008);
        inlay(L, PALETTE.lapis, circle(cx - (i % 2 === 0 ? s * 0.03 : -s * 0.03), cy, s * 0.033));
      });
      break;
    }
    case 'cinque-cerchi': {
      shellBase(L);
      const pts = [[0.26, 0.26], [0.74, 0.26], [0.5, 0.5], [0.26, 0.74], [0.74, 0.74]];
      for (const [x, y] of pts) {
        incise(L, circle(x * s, y * s, s * 0.115), 0.01);
        incise(L, circle(x * s, y * s, s * 0.085), 0.006);
        inlay(L, PALETTE.lapis, circle(x * s, y * s, s * 0.05));
      }
      break;
    }
    case 'griglia-16': {
      shellBase(L);
      const step = (s - 2 * m) / 4;
      incise(L, (ctx) => {
        for (let i = 0; i <= 4; i++) {
          ctx.moveTo(m + i * step, m); ctx.lineTo(m + i * step, s - m);
          ctx.moveTo(m, m + i * step); ctx.lineTo(s - m, m + i * step);
        }
      }, 0.008);
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
        const cx = m + (i + 0.5) * step, cy = m + (j + 0.5) * step;
        incise(L, (ctx) => { ctx.moveTo(cx - step * 0.32, cy); ctx.lineTo(cx - step * 0.16, cy); ctx.moveTo(cx + step * 0.16, cy); ctx.lineTo(cx + step * 0.32, cy); }, 0.005);
        inlay(L, PALETTE.lapis, circle(cx, cy, step * 0.13));
      }
      break;
    }
    case 'zigzag-punti': {
      shellBase(L);
      incise(L, (ctx) => { ctx.moveTo(s / 2, m); ctx.lineTo(s / 2, s - m); ctx.moveTo(m, s / 2); ctx.lineTo(s - m, s / 2); }, 0.01);
      for (const [qx, qy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) {
        const cx = qx * s, cy = qy * s, half = s * 0.2;
        incise(L, (ctx) => {
          // cornice a zig-zag su due lati del quadrante
          const n = 7;
          ctx.moveTo(cx - half, cy - half);
          for (let k = 1; k <= n; k++) ctx.lineTo(cx - half + (k / n) * 2 * half, cy - half + (k % 2 ? s * 0.035 : 0));
          ctx.moveTo(cx - half, cy + half);
          for (let k = 1; k <= n; k++) ctx.lineTo(cx - half + (k / n) * 2 * half, cy + half - (k % 2 ? s * 0.035 : 0));
        }, 0.006);
        for (const [dx, dy] of [[-0.09, -0.06], [0.09, -0.06], [0, 0.0], [-0.09, 0.07], [0.09, 0.07]]) inlay(L, PALETTE.lapis, circle(cx + dx * s, cy + dy * s, s * 0.026));
      }
      break;
    }
    case 'stella-zigzag': {
      shellBase(L);
      const cx = s / 2, cy = s / 2;
      for (const rr of [0.42, 0.3, 0.19]) {
        incise(L, (ctx) => {
          const n = 16;
          for (let k = 0; k <= n; k++) {
            const a = (k / n) * Math.PI * 2 + Math.PI / 4;
            const rad = s * rr * (k % 2 ? 0.82 : 1);
            const x = cx + Math.cos(a) * rad, y = cy + Math.sin(a) * rad;
            if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
        }, 0.0075);
      }
      for (const [dx, dy] of [[0, 0], [-0.07, -0.07], [0.07, -0.07], [-0.07, 0.07], [0.07, 0.07]]) inlay(L, PALETTE.lapis, circle(cx + dx * s, cy + dy * s, s * 0.03));
      break;
    }
    case 'liscia': {
      ivoryBase(L);
      break;
    }
  }
}

/** Avorio: tono caldo, grana fine con linee di Schreger appena accennate, macchie di patina. */
function ivoryBase(L: Layers) {
  const { color: c, bump: b, rough: ro, size: s, r } = L;
  c.fillStyle = PALETTE.ivory;
  c.fillRect(0, 0, s, s);
  for (let i = 0; i < 60; i++) {
    c.strokeStyle = `rgba(${150 + r() * 30},${125 + r() * 25},${85 + r() * 20},${0.04 + r() * 0.05})`;
    c.lineWidth = s * 0.004;
    c.beginPath();
    const x = r() * s;
    c.moveTo(x, 0);
    c.bezierCurveTo(x + (r() - 0.5) * s * 0.1, s * 0.3, x + (r() - 0.5) * s * 0.1, s * 0.7, x + (r() - 0.5) * s * 0.08, s);
    c.stroke();
  }
  for (let i = 0; i < 10; i++) {
    const g = c.createRadialGradient(r() * s, r() * s, 0, r() * s, r() * s, s * (0.06 + r() * 0.2));
    g.addColorStop(0, `rgba(150,105,55,${0.06 + r() * 0.12})`);
    g.addColorStop(1, 'rgba(150,105,55,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, s, s);
  }
  b.fillStyle = '#b4b4b4';
  b.fillRect(0, 0, s, s);
  ro.fillStyle = '#909090';
  ro.fillRect(0, 0, s, s);
}

function toTextures(L: Layers, anisotropy: number) {
  const mk = (ctx: CanvasRenderingContext2D, srgb: boolean) => {
    const t = new THREE.CanvasTexture(ctx.canvas);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = anisotropy;
    t.needsUpdate = true;
    return t;
  };
  return { map: mk(L.color, true), bumpMap: mk(L.bump, false), roughnessMap: mk(L.rough, false) };
}

const cache = new Map<string, ReturnType<typeof toTextures>>();

export function motifTextures(motif: MotifId, seed: number, size: number, anisotropy: number) {
  const key = `${motif}:${seed}:${size}`;
  let t = cache.get(key);
  if (!t) {
    const L = layers(size, seed);
    drawMotif(L, motif);
    t = toTextures(L, anisotropy);
    cache.set(key, t);
  }
  return t;
}

/** Lapislazzuli in listelli: blu profondo con calcite chiara e punti di pirite. */
export function lapisTexture(size: number, anisotropy: number) {
  const L = layers(size, 99);
  const { color: c, r } = L;
  c.fillStyle = PALETTE.lapis;
  c.fillRect(0, 0, size, size);
  for (let i = 0; i < 900; i++) {
    const v = r();
    c.fillStyle = v < 0.04 ? 'rgba(218,186,104,0.85)' : v < 0.1 ? 'rgba(170,180,210,0.25)' : `rgba(${15 + r() * 40},${30 + r() * 40},${100 + r() * 70},0.35)`;
    c.beginPath();
    c.arc(r() * size, r() * size, size * (v < 0.04 ? 0.0025 : 0.004 + r() * 0.012), 0, Math.PI * 2);
    c.fill();
  }
  // giunzioni fra i listelli
  c.strokeStyle = 'rgba(8,10,20,0.55)';
  c.lineWidth = size * 0.006;
  for (let i = 1; i < 8; i++) {
    c.beginPath();
    c.moveTo((i / 8) * size + (r() - 0.5) * 6, 0);
    c.lineTo((i / 8) * size + (r() - 0.5) * 6, size);
    c.stroke();
  }
  L.bump.fillStyle = '#9a9a9a';
  L.bump.fillRect(0, 0, size, size);
  L.rough.fillStyle = '#b4b4b4';
  L.rough.fillRect(0, 0, size, size);
  const t = toTextures(L, anisotropy);
  for (const k of Object.values(t)) { k.wrapS = k.wrapT = THREE.RepeatWrapping; }
  return t;
}

/** Fascia di losanghe in conchiglia e calcare rosso su fondo di bitume (bordo superiore). */
export function lozengeBand(w: number, hgt: number, count: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = hgt;
  const g = c.getContext('2d')!;
  g.fillStyle = PALETTE.bitumen;
  g.fillRect(0, 0, w, hgt);
  const r = rng(7);
  const step = w / count;
  for (let i = 0; i < count; i++) {
    const cx = (i + 0.5) * step, cy = hgt / 2;
    g.fillStyle = i % 2 ? PALETTE.red : PALETTE.shell;
    g.beginPath();
    g.moveTo(cx - step * 0.42, cy);
    g.lineTo(cx, cy - hgt * 0.38);
    g.lineTo(cx + step * 0.42, cy);
    g.lineTo(cx, cy + hgt * 0.38);
    g.closePath();
    g.fill();
    g.fillStyle = `rgba(80,60,40,${0.1 + r() * 0.2})`;
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Fianco della tavola A: listelli verticali rossi e bianchi con placchette a occhio. */
export function sidePanelTexture(w: number, hgt: number, units: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = hgt;
  const g = c.getContext('2d')!;
  const r = rng(13);
  g.fillStyle = PALETTE.bitumen;
  g.fillRect(0, 0, w, hgt);
  const step = w / units;
  for (let i = 0; i < units; i++) {
    const x0 = i * step;
    if (i % 4 === 1) {
      // placchetta con occhio
      g.fillStyle = PALETTE.shellWarm;
      g.fillRect(x0 + 2, hgt * 0.12, step * 2 - 4, hgt * 0.76);
      g.strokeStyle = PALETTE.incision;
      g.lineWidth = 2;
      g.beginPath();
      almond(g, x0 + step, hgt / 2, step * 1.4, hgt * 0.42);
      g.stroke();
      g.beginPath();
      almond(g, x0 + step, hgt / 2, step * 0.9, hgt * 0.26);
      g.stroke();
      g.fillStyle = PALETTE.lapisDeep;
      g.beginPath();
      g.arc(x0 + step, hgt / 2, hgt * 0.08, 0, Math.PI * 2);
      g.fill();
      i++;
      continue;
    }
    g.fillStyle = i % 2 ? PALETTE.redDeep : PALETTE.shellShadow;
    g.fillRect(x0 + 1, hgt * 0.12, step - 2, hgt * 0.76);
    g.fillStyle = `rgba(0,0,0,${r() * 0.15})`;
    g.fillRect(x0 + 1, hgt * 0.12, step - 2, hgt * 0.76);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Pannello inciso della tavola B: animali in corsa resi in modo semplificato (cfr. Met 16.10.475a). */
export function animalFriezeTexture(w: number, hgt: number, seed: number) {
  const L = { color: canvas(w), bump: canvas(w), rough: canvas(w), size: w, r: rng(seed) } as Layers;
  for (const k of ['color', 'bump', 'rough'] as const) {
    L[k].canvas.width = w;
    L[k].canvas.height = hgt;
  }
  const c = L.color;
  c.fillStyle = PALETTE.ivory;
  c.fillRect(0, 0, w, hgt);
  for (let i = 0; i < 40; i++) {
    c.strokeStyle = `rgba(150,125,85,${0.04 + L.r() * 0.05})`;
    c.lineWidth = 2;
    c.beginPath();
    const y = L.r() * hgt;
    c.moveTo(0, y);
    c.lineTo(w, y + (L.r() - 0.5) * 10);
    c.stroke();
  }
  L.bump.fillStyle = '#b4b4b4';
  L.bump.fillRect(0, 0, w, hgt);
  L.rough.fillStyle = '#909090';
  L.rough.fillRect(0, 0, w, hgt);
  const n = 3;
  for (let i = 0; i < n; i++) {
    const cx = ((i + 0.5) / n) * w, cy = hgt * 0.55, bw = (w / n) * 0.42, bh = hgt * 0.2;
    const lineW = 0.0022;
    // corpo allungato, testa, zampe tese: sagoma generica di quadrupede in corsa
    incise(L as Layers, (ctx) => {
      ctx.moveTo(cx - bw, cy);
      ctx.bezierCurveTo(cx - bw * 0.6, cy - bh * 1.3, cx + bw * 0.5, cy - bh * 1.2, cx + bw * 0.85, cy - bh * 0.6);
      ctx.lineTo(cx + bw * 1.15, cy - bh * 1.1);
      ctx.lineTo(cx + bw * 1.25, cy - bh * 0.5);
      ctx.lineTo(cx + bw * 0.9, cy - bh * 0.1);
      ctx.bezierCurveTo(cx + bw * 0.4, cy + bh * 0.6, cx - bw * 0.5, cy + bh * 0.6, cx - bw, cy);
      ctx.moveTo(cx - bw * 0.8, cy + bh * 0.2); ctx.lineTo(cx - bw * 1.35, cy + bh * 1.4);
      ctx.moveTo(cx - bw * 0.6, cy + bh * 0.35); ctx.lineTo(cx - bw * 1.1, cy + bh * 1.6);
      ctx.moveTo(cx + bw * 0.5, cy + bh * 0.3); ctx.lineTo(cx + bw * 1.1, cy + bh * 1.4);
      ctx.moveTo(cx + bw * 0.35, cy + bh * 0.4); ctx.lineTo(cx + bw * 0.8, cy + bh * 1.6);
      ctx.moveTo(cx - bw, cy); ctx.lineTo(cx - bw * 1.4, cy - bh * 0.6);
    }, lineW);
    // tratteggio del mantello
    incise(L as Layers, (ctx) => {
      for (let k = 0; k < 22; k++) {
        const x = cx - bw * 0.8 + L.r() * bw * 1.5, y = cy - bh * 0.6 + L.r() * bh * 0.9;
        ctx.moveTo(x, y);
        ctx.lineTo(x + bw * 0.06, y + bh * 0.12);
      }
    }, lineW * 0.7);
  }
  const mk = (ctx: CanvasRenderingContext2D, srgb: boolean) => {
    const t = new THREE.CanvasTexture(ctx.canvas);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  return { map: mk(L.color, true), bumpMap: mk(L.bump, false), roughnessMap: mk(L.rough, false) };
}

/** Legno moderno della scatola Met (indicato come "modern wood"). */
export function woodTexture(size: number) {
  const c = canvas(size);
  const r = rng(5);
  c.fillStyle = PALETTE.wood;
  c.fillRect(0, 0, size, size);
  for (let i = 0; i < 70; i++) {
    c.strokeStyle = `rgba(${90 + r() * 40},${60 + r() * 30},${30 + r() * 20},${0.12 + r() * 0.15})`;
    c.lineWidth = 1 + r() * 2.5;
    c.beginPath();
    const y = r() * size;
    c.moveTo(0, y);
    c.bezierCurveTo(size * 0.3, y + (r() - 0.5) * 18, size * 0.6, y + (r() - 0.5) * 18, size, y + (r() - 0.5) * 10);
    c.stroke();
  }
  const t = new THREE.CanvasTexture(c.canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Faccia superiore delle pedine di Ur: cinque punti intarsiati (lapislazzuli su conchiglia, conchiglia su pietra scura). */
export function pieceTopTexture(dark: boolean, size: number) {
  const L = layers(size, dark ? 31 : 37);
  if (dark) {
    L.color.fillStyle = '#26221e';
    L.color.fillRect(0, 0, size, size);
    for (let i = 0; i < 200; i++) {
      L.color.fillStyle = `rgba(${60 + L.r() * 30},${55 + L.r() * 25},${50 + L.r() * 20},0.25)`;
      L.color.fillRect(L.r() * size, L.r() * size, 2, 2);
    }
    L.bump.fillStyle = '#a0a0a0';
    L.bump.fillRect(0, 0, size, size);
    L.rough.fillStyle = '#a8a8a8';
    L.rough.fillRect(0, 0, size, size);
  } else {
    shellBase(L, PALETTE.shellWarm);
  }
  incise(L, circle(size / 2, size / 2, size * 0.47), dark ? 0.012 : 0.02);
  const pts = [[0.5, 0.5], [0.29, 0.29], [0.71, 0.29], [0.29, 0.71], [0.71, 0.71]];
  for (const [x, y] of pts) inlay(L, dark ? PALETTE.shell : PALETTE.lapis, circle(x * size, y * size, size * 0.075), false);
  return toTextures(L, 4);
}
