// Scena Three.js: tavola, pedine, dadi, luci, camera. Riceve stato e mosse legali dal controller;
// non contiene regole. Le animazioni visualizzano esiti già estratti e possono essere saltate.

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { DECORATIONS, RULE_MARKS, kindOf, type GameSpec, type GameState, type Move, type PieceState, type Player, type RollInfo } from '../../engine/index.ts';
import { PALETTE, animalFriezeTexture, lapisTexture, lozengeBand, motifTextures, pieceTopTexture, sidePanelTexture, woodTexture } from './textures.ts';

export type Quality = 'alta' | 'media' | 'bassa';

export interface SceneOptions {
  quality: Quality;
  reducedMotion: boolean;
}

interface Tween {
  t0: number;
  dur: number;
  update: (k: number) => void;
  done?: () => void;
}

const QUALITY = {
  alta: { pixelRatio: 2, shadow: 2048, tex: 512, aa: true, shadows: true },
  media: { pixelRatio: 1.5, shadow: 1024, tex: 256, aa: true, shadows: true },
  bassa: { pixelRatio: 1, shadow: 512, tex: 256, aa: false, shadows: false },
};

export function autoQuality(): Quality {
  const mobile = matchMedia('(pointer: coarse)').matches;
  const cores = navigator.hardwareConcurrency ?? 4;
  if (mobile && cores <= 4) return 'bassa';
  if (mobile || cores <= 4) return 'media';
  return 'alta';
}

export function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

const easeOut = (k: number) => 1 - (1 - k) ** 3;

export class BoardScene {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  container: HTMLElement;
  labelLayer: HTMLDivElement;
  opts: SceneOptions;

  private spec: GameSpec | null = null;
  private boardGroup = new THREE.Group();
  private overlayGroup = new THREE.Group();
  private marksGroup = new THREE.Group();
  private pathGroup = new THREE.Group();
  private diceGroup = new THREE.Group();
  private pieceMeshes = new Map<string, THREE.Object3D>();
  private cellCenters = new Map<string, THREE.Vector3>();
  private pickables: THREE.Object3D[] = [];
  private tweens: Tween[] = [];
  private raf = 0;
  private dirty = true;
  private topY = 0;
  private boardLen = 30;
  private boardWid = 11;
  private orientation: Player = 0;
  private lastPortrait: boolean | null = null;
  private labels = new Map<string, HTMLDivElement>();
  private lastState: GameState | null = null;
  private dice: THREE.Object3D[] = [];
  private keyLight: THREE.DirectionalLight;
  private resizeObs: ResizeObserver;

  hints = true;
  showMarks = true;
  showLabels = true;
  onPick: (target: { pieceId?: string; to?: number }) => void = () => {};

  private selectable = new Map<string, Move[]>();
  private targetMoves: Move[] = [];

  constructor(container: HTMLElement, opts: SceneOptions) {
    this.container = container;
    this.opts = opts;
    const q = QUALITY[opts.quality];
    this.renderer = new THREE.WebGLRenderer({ antialias: q.aa, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatio));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.82;
    this.renderer.shadowMap.enabled = q.shadows;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.setAttribute('aria-label', 'Vista tridimensionale della tavola. Usa l\'elenco delle mosse per giocare da tastiera.');
    this.renderer.domElement.setAttribute('role', 'img');
    container.appendChild(this.renderer.domElement);
    this.labelLayer = document.createElement('div');
    this.labelLayer.className = 'label-layer';
    container.appendChild(this.labelLayer);

    this.camera = new THREE.PerspectiveCamera(32, 1, 0.5, 400);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = !opts.reducedMotion;
    this.controls.dampingFactor = 0.12;
    this.controls.enablePan = false;
    this.controls.minPolarAngle = 0.0;
    this.controls.maxPolarAngle = 1.18; // niente vista da sotto il piano
    this.controls.addEventListener('change', () => (this.dirty = true));

    // Luce morbida da sala espositiva: ambiente PMREM + luce chiave con ombre morbide.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.38;
    this.scene.background = null;
    this.keyLight = new THREE.DirectionalLight(0xfff1dc, 2.6);
    this.keyLight.position.set(-14, 36, 18);
    this.keyLight.castShadow = q.shadows;
    this.keyLight.shadow.mapSize.set(q.shadow, q.shadow);
    this.keyLight.shadow.radius = 5;
    this.keyLight.shadow.bias = -0.0004;
    const sc = this.keyLight.shadow.camera;
    sc.left = -30; sc.right = 30; sc.top = 22; sc.bottom = -22; sc.near = 5; sc.far = 90;
    this.scene.add(this.keyLight);
    const fill = new THREE.DirectionalLight(0xcfd8ff, 0.35);
    fill.position.set(18, 14, -16);
    this.scene.add(fill);

    // Piano di appoggio: panno opaco scuro (ombre di contatto)
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), new THREE.MeshStandardMaterial({ color: 0x1d1b22, roughness: 0.95, metalness: 0 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    this.scene.add(this.boardGroup, this.overlayGroup, this.marksGroup, this.pathGroup, this.diceGroup);

    const el = this.renderer.domElement;
    let down: { x: number; y: number } | null = null;
    el.addEventListener('pointerdown', (e) => (down = { x: e.clientX, y: e.clientY }));
    el.addEventListener('pointerup', (e) => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      down = null;
      if (moved < 8) this.pick(e.clientX, e.clientY);
    });

    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(container);
    this.resize();
    this.loop();
  }

  // ------------------------------------------------------------------ costruzione

  setGame(spec: GameSpec) {
    this.spec = spec;
    for (const g of [this.boardGroup, this.overlayGroup, this.marksGroup, this.pathGroup, this.diceGroup]) g.clear();
    this.pieceMeshes.clear();
    this.cellCenters.clear();
    this.pickables = [];
    for (const l of this.labels.values()) l.remove();
    this.labels.clear();
    if (spec.board.id === 'ur-iii') this.buildUrBoard(spec);
    else this.buildLateBoard(spec);
    this.buildRuleMarks(spec);
    this.buildPieces(spec);
    this.buildDice(spec);
    this.resetView();
    this.dirty = true;
  }

  private cellXZ(spec: GameSpec, row: number, col: number) {
    const px = spec.board.dims.cellPitchX.value, py = spec.board.dims.cellPitchY.value;
    return { x: (col - (spec.board.cols - 1) / 2) * px, z: (row - 1) * py };
  }

  private std(params: THREE.MeshStandardMaterialParameters) {
    return new THREE.MeshStandardMaterial({ metalness: 0, ...params });
  }

  private buildUrBoard(spec: GameSpec) {
    const d = spec.board.dims;
    const px = d.cellPitchX.value, py = d.cellPitchY.value, f = d.frame.value, H = d.height.value;
    const tex = QUALITY[this.opts.quality].tex;
    const aniso = this.renderer.capabilities.getMaxAnisotropy();
    this.boardLen = d.length.value;
    this.boardWid = d.width.value;
    this.topY = H + 0.12;
    const bitumen = this.std({ color: PALETTE.bitumen, roughness: 0.62 });
    const blocks = [
      { c0: 0, c1: 3, rows: 3 },
      { c0: 4, c1: 5, rows: 1 },
      { c0: 6, c1: 7, rows: 3 },
    ];
    const lapis = lapisTexture(tex, aniso);
    for (const b of blocks) {
      const x0 = this.cellXZ(spec, 1, b.c0).x - px / 2, x1 = this.cellXZ(spec, 1, b.c1).x + px / 2;
      const len = x1 - x0 + (b.rows === 1 ? 0 : 2 * f);
      const wid = b.rows * py + 2 * f;
      const cx = (x0 + x1) / 2;
      const sideTex = sidePanelTexture(1024, 64, Math.round(len * 2.2));
      const endTex = sidePanelTexture(512, 64, Math.round(wid * 2.2));
      const side = this.std({ map: sideTex, roughness: 0.6 });
      const end = this.std({ map: endTex, roughness: 0.6 });
      const geo = new THREE.BoxGeometry(len, H, wid);
      const body = new THREE.Mesh(geo, [end, end, bitumen, bitumen, side, side]);
      body.position.set(cx, H / 2, 0);
      body.castShadow = true;
      body.receiveShadow = true;
      this.boardGroup.add(body);
      // letto di lapislazzuli visibile fra le placchette
      const bedTex = lapis.map.clone();
      bedTex.repeat.set((x1 - x0) / 4, (b.rows * py) / 4);
      bedTex.needsUpdate = true;
      const bed = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, b.rows * py), this.std({ map: bedTex, roughness: 0.55 }));
      bed.rotation.x = -Math.PI / 2;
      bed.position.set(cx, H + 0.005, 0);
      bed.receiveShadow = true;
      this.boardGroup.add(bed);
      // fasce di losanghe sui lati lunghi
      for (const sgn of [-1, 1]) {
        const band = new THREE.Mesh(new THREE.PlaneGeometry(len, f * 0.82), this.std({ map: lozengeBand(1024, 48, Math.round(len * 2.4)), roughness: 0.55 }));
        band.rotation.x = -Math.PI / 2;
        band.position.set(cx, H + 0.006, sgn * (wid / 2 - f / 2));
        band.receiveShadow = true;
        this.boardGroup.add(band);
      }
    }
    // placchette in conchiglia, una per casella, con il motivo del reperto
    const deco = DECORATIONS['ur-iii'].cells;
    let seed = 1;
    for (const c of spec.board.cells) {
      const { x, z } = this.cellXZ(spec, c.row, c.col);
      const t = motifTextures(deco[c.id], seed++ * 17, tex, aniso);
      const top = new THREE.MeshPhysicalMaterial({
        map: t.map, bumpMap: t.bumpMap, bumpScale: 2.2, roughnessMap: t.roughnessMap, roughness: 0.62, metalness: 0,
        sheen: 0.25, sheenRoughness: 0.6, sheenColor: new THREE.Color(0xf6efe2),
      });
      const edge = this.std({ color: PALETTE.shellShadow, roughness: 0.7 });
      const w = px - 0.24 - Math.random() * 0.04, dpt = py - 0.24 - Math.random() * 0.04;
      const plaque = new THREE.Mesh(new THREE.BoxGeometry(w, 0.12, dpt), [edge, edge, top, edge, edge, edge]);
      plaque.position.set(x + (Math.random() - 0.5) * 0.03, H + 0.06, z + (Math.random() - 0.5) * 0.03);
      plaque.rotation.y = (Math.random() - 0.5) * 0.012;
      plaque.castShadow = false;
      plaque.receiveShadow = true;
      this.boardGroup.add(plaque);
      this.addCellHit(c.id, x, z, px, py);
    }
  }

  private buildLateBoard(spec: GameSpec) {
    const d = spec.board.dims;
    const px = d.cellPitchX.value, py = d.cellPitchY.value, f = d.frame.value, H = d.height.value;
    const tex = QUALITY[this.opts.quality].tex;
    const aniso = this.renderer.capabilities.getMaxAnisotropy();
    this.boardLen = d.length.value;
    this.boardWid = d.width.value;
    this.topY = H + 0.135;
    const wood = woodTexture(512);
    wood.repeat.set(2, 1);
    const woodMat = this.std({ map: wood, roughness: 0.72 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(d.length.value, H, d.width.value), woodMat);
    body.position.set(0, H / 2, 0);
    body.castShadow = true;
    body.receiveShadow = true;
    this.boardGroup.add(body);
    // cornice e listelli in avorio (piano superiore)
    const ivoryStrip = this.std({ color: PALETTE.ivoryWarm, roughness: 0.6 });
    const bed = new THREE.Mesh(new THREE.BoxGeometry(d.length.value - 0.1, 0.05, d.width.value - 0.1), ivoryStrip);
    bed.position.set(0, H + 0.025, 0);
    bed.receiveShadow = true;
    this.boardGroup.add(bed);
    const deco = DECORATIONS.tarda.cells;
    let seed = 3;
    for (const c of spec.board.cells) {
      const { x, z } = this.cellXZ(spec, c.row, c.col);
      const t = motifTextures(deco[c.id], seed++ * 23, tex >> 1, aniso);
      const top = this.std({ map: t.map, bumpMap: t.bumpMap, bumpScale: 1, roughnessMap: t.roughnessMap, roughness: 0.6 });
      const edge = this.std({ color: PALETTE.ivoryWarm, roughness: 0.65 });
      const plaque = new THREE.Mesh(new THREE.BoxGeometry(px - 0.2 - Math.random() * 0.06, 0.08, py - 0.2 - Math.random() * 0.06), [edge, edge, top, edge, edge, edge]);
      plaque.position.set(x, H + 0.09, z);
      plaque.rotation.y = (Math.random() - 0.5) * 0.02;
      plaque.receiveShadow = true;
      this.boardGroup.add(plaque);
      this.addCellHit(c.id, x, z, px, py);
    }
    // pannelli incisi ai lati del prolungamento (righe 0 e 2, colonne 4–11)
    const x0 = this.cellXZ(spec, 1, 4).x - px / 2, x1 = this.cellXZ(spec, 1, 11).x + px / 2;
    for (const row of [0, 2]) {
      const t = animalFriezeTexture(1024, Math.round(1024 * (py / (x1 - x0))), row * 11 + 5);
      const top = this.std({ map: t.map, bumpMap: t.bumpMap, bumpScale: 1.2, roughness: 0.62 });
      const edge = this.std({ color: PALETTE.ivoryWarm, roughness: 0.65 });
      const panel = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0 - 0.2, 0.08, py - 0.2), [edge, edge, top, edge, edge, edge]);
      const { z } = this.cellXZ(spec, row, 4);
      panel.position.set((x0 + x1) / 2, H + 0.09, z);
      if (row === 0) panel.rotation.y = Math.PI;
      panel.receiveShadow = true;
      this.boardGroup.add(panel);
    }
    // cassetto con anelli in lega di rame all'estremità del prolungamento
    const copper = this.std({ color: 0x6d5a3a, roughness: 0.45, metalness: 0.7 });
    for (const zz of [-0.9, 0.9]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.05, 8, 20), copper);
      ring.position.set(d.length.value / 2 + 0.05, H * 0.55, zz);
      ring.rotation.y = Math.PI / 2;
      this.boardGroup.add(ring);
    }
  }

  private addCellHit(id: string, x: number, z: number, px: number, py: number) {
    const hit = new THREE.Mesh(new THREE.PlaneGeometry(px, py), new THREE.MeshBasicMaterial({ visible: false }));
    hit.rotation.x = -Math.PI / 2;
    hit.position.set(x, this.topY + 0.01, z);
    hit.userData.cell = id;
    this.overlayGroup.add(hit);
    this.pickables.push(hit);
    this.cellCenters.set(id, new THREE.Vector3(x, this.topY, z));
  }

  /** Sovrapposizione delle caselle speciali sulla tavola B (non marcate sul reperto). */
  private buildRuleMarks(spec: GameSpec) {
    const marks = RULE_MARKS[spec.board.id];
    if (marks.display !== 'sovrapposizione') return;
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d')!;
    g.strokeStyle = 'rgba(210,173,99,0.95)';
    g.lineWidth = 7;
    g.setLineDash([16, 10]);
    g.strokeRect(14, 14, 228, 228);
    g.setLineDash([]);
    g.lineWidth = 5;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      g.beginPath();
      g.ellipse(128 + Math.cos(a) * 50, 128 + Math.sin(a) * 50, 42, 14, a, 0, Math.PI * 2);
      g.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.6, depthWrite: false });
    const px = spec.board.dims.cellPitchX.value, py = spec.board.dims.cellPitchY.value;
    for (const id of marks.cells) {
      const p = this.cellCenters.get(id)!;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(px * 0.86, py * 0.86), mat);
      m.rotation.x = -Math.PI / 2;
      m.position.set(p.x, this.topY + 0.015, p.z);
      this.marksGroup.add(m);
    }
    this.marksGroup.visible = this.showMarks;
  }

  private buildPieces(spec: GameSpec) {
    const isUr = spec.board.id === 'ur-iii';
    const shellTop = pieceTopTexture(false, 256);
    const darkTop = pieceTopTexture(true, 256);
    for (const owner of [0, 1] as Player[]) {
      for (let i = 0; i < spec.ruleset.piecesPerPlayer; i++) {
        const id = `p${owner}-${i}`;
        let obj: THREE.Object3D;
        if (isUr) {
          // Pedine di Ur: dischi (diametro stimato 2,3 cm) — chiari con cinque punti di lapislazzuli, scuri con cinque punti di conchiglia.
          const t = owner === 0 ? shellTop : darkTop;
          const side = this.std({ color: owner === 0 ? '#a8936b' : '#2a2622', roughness: owner === 0 ? 0.6 : 0.5 });
          const top = new THREE.MeshPhysicalMaterial({ map: t.map, bumpMap: t.bumpMap, bumpScale: 2, roughnessMap: t.roughnessMap, roughness: 0.55, sheen: owner === 0 ? 0.2 : 0 });
          const disc = new THREE.CylinderGeometry(1.15, 1.12, 0.6, 40);
          disc.translate(0, 0.3, 0);
          obj = new THREE.Mesh(disc, [side, top, side]);
          obj.userData.h = 0.6;
        } else {
          // Pedine della scatola Met: coni (giocatore 0) e rocchetti (giocatore 1) in avorio/osso.
          const mat = this.std({ color: owner === 0 ? '#e8dcc0' : '#bfae8c', roughness: 0.58 });
          if (owner === 0) {
            const pts = [new THREE.Vector2(0, 0), new THREE.Vector2(0.72, 0), new THREE.Vector2(0.7, 0.12), new THREE.Vector2(0.42, 1.0), new THREE.Vector2(0.22, 1.85), new THREE.Vector2(0.2, 2.0), new THREE.Vector2(0, 2.1)];
            obj = new THREE.Mesh(new THREE.LatheGeometry(pts, 28), mat);
            obj.userData.h = 2.1;
          } else {
            const pts = [new THREE.Vector2(0, 0), new THREE.Vector2(0.66, 0), new THREE.Vector2(0.66, 0.18), new THREE.Vector2(0.36, 0.42), new THREE.Vector2(0.32, 0.8), new THREE.Vector2(0.38, 1.0), new THREE.Vector2(0.62, 1.2), new THREE.Vector2(0.6, 1.32), new THREE.Vector2(0, 1.32)];
            obj = new THREE.Mesh(new THREE.LatheGeometry(pts, 28), mat);
            obj.userData.h = 1.32;
          }
        }
        obj.castShadow = true;
        obj.receiveShadow = true;
        obj.userData.pieceId = id;
        this.scene.add(obj);
        this.pieceMeshes.set(id, obj);
        this.pickables.push(obj);
        if (spec.ruleset.advanced) {
          const k = kindOf(spec, spec.ruleset.pieceKinds[i].id);
          const lab = document.createElement('div');
          lab.className = 'piece-label';
          lab.textContent = String(k.entryThrow);
          lab.title = k.name;
          this.labelLayer.appendChild(lab);
          this.labels.set(id, lab);
        }
      }
    }
  }

  private buildDice(spec: GameSpec) {
    this.dice = [];
    if (spec.ruleset.dice === 'binari-4') {
      // Tetraedri (spigolo stimato ~2 cm) con due vertici marcati da punti intarsiati.
      const stone = this.std({ color: '#3a3733', roughness: 0.55, flatShading: true });
      const inlayMat = this.std({ color: PALETTE.shell, roughness: 0.45 });
      for (let i = 0; i < 4; i++) {
        const geo = new THREE.TetrahedronGeometry(1.2);
        const mesh = new THREE.Mesh(geo, stone);
        const verts = this.tetraVertices(geo);
        mesh.userData.verts = verts;
        for (const vi of [0, 1]) {
          const dot = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 8), inlayMat);
          dot.position.copy(verts[vi].clone().multiplyScalar(0.8));
          mesh.add(dot);
        }
        mesh.castShadow = true;
        this.diceGroup.add(mesh);
        this.dice.push(mesh);
      }
    } else {
      // Dadi lunghi a quattro facce: uno numerato 1–4, uno con due facce "sì" e due "no".
      for (let i = 0; i < 2; i++) {
        const faces = i === 0 ? [1, 2, 3, 4].map((n) => this.stickFace(n)) : ['si', 'no', 'si', 'no'].map((n) => this.stickFace(n));
        const endMat = this.std({ color: PALETTE.ivoryWarm, roughness: 0.6 });
        // ordine BoxGeometry: +x, -x, +y, -y, +z, -z ; facce laterali: +y=1, +z=2, -y=3, -z=4
        const mats = [endMat, endMat, faces[0], faces[2], faces[1], faces[3]];
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.8, 0.8), mats);
        mesh.castShadow = true;
        this.diceGroup.add(mesh);
        this.dice.push(mesh);
      }
    }
    this.placeDiceRest();
  }

  private stickFace(v: number | string) {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 64;
    const g = c.getContext('2d')!;
    g.fillStyle = PALETTE.ivory;
    g.fillRect(0, 0, 256, 64);
    g.fillStyle = PALETTE.incision;
    if (typeof v === 'number') {
      for (let k = 0; k < v; k++) {
        g.beginPath();
        g.arc(128 + (k - (v - 1) / 2) * 34, 32, 9, 0, Math.PI * 2);
        g.fill();
      }
    } else if (v === 'si') {
      g.lineWidth = 6;
      g.strokeStyle = PALETTE.incision;
      g.beginPath();
      g.arc(128, 32, 18, 0, Math.PI * 2);
      g.stroke();
      g.beginPath();
      g.arc(128, 32, 6, 0, Math.PI * 2);
      g.fill();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return this.std({ map: t, roughness: 0.6 });
  }

  private tetraVertices(geo: THREE.BufferGeometry): THREE.Vector3[] {
    const pos = geo.getAttribute('position');
    const out: THREE.Vector3[] = [];
    for (let i = 0; i < pos.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(pos, i);
      if (!out.some((o) => o.distanceTo(v) < 1e-4)) out.push(v);
    }
    return out;
  }

  private diceHome(i: number): THREE.Vector3 {
    const n = this.dice.length;
    const x = this.boardLen / 2 + 4.5;
    const spacing = this.spec?.ruleset.dice === 'binari-4' ? 2.6 : 1.6;
    return new THREE.Vector3(x + (this.spec?.ruleset.dice === 'binari-4' ? (i % 2) * 2.6 : 0), 0, (i - (n - 1) / 2) * spacing);
  }

  private placeDiceRest() {
    this.dice.forEach((d, i) => {
      const p = this.diceHome(i);
      d.position.set(p.x, this.spec?.ruleset.dice === 'binari-4' ? 0.4 : 0.4, p.z);
      d.quaternion.copy(this.restQuat(i, 0, i * 1.7));
    });
    this.dirty = true;
  }

  private restQuat(i: number, value: number | string, yaw: number): THREE.Quaternion {
    const d = this.dice[i];
    const up = new THREE.Vector3(0, 1, 0);
    const yawQ = new THREE.Quaternion().setFromAxisAngle(up, yaw);
    if (this.spec?.ruleset.dice === 'binari-4') {
      const verts = d.userData.verts as THREE.Vector3[];
      // 1 = un vertice marcato verso l'alto; 0 = un vertice non marcato
      const v = verts[value ? (yaw > 0.5 ? 0 : 1) : yaw > 0.5 ? 2 : 3].clone().normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(v, up);
      return yawQ.multiply(q);
    }
    // dado lungo: faccia richiesta verso l'alto ruotando attorno all'asse x
    const idx = typeof value === 'number' ? value - 1 : value === 'si' ? 0 : 1;
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -idx * (Math.PI / 2));
    return yawQ.multiply(q);
  }

  // ------------------------------------------------------------------ stato e animazioni

  /** Posiziona le pedine secondo lo stato; anima l'ultima mossa se richiesto. */
  setState(state: GameState, animateMove: Move | null) {
    const spec = this.spec;
    if (!spec) return;
    this.finishTweens();
    const prev = this.lastState;
    this.lastState = state;
    const targets = this.computeTargets(spec, state);
    for (const p of state.pieces) {
      const mesh = this.pieceMeshes.get(p.id)!;
      const target = targets.get(p.id)!;
      if (animateMove && animateMove.pieceId === p.id && prev && !this.opts.reducedMotion) {
        this.animatePieceAlong(spec, p, animateMove, target, mesh);
      } else if (animateMove && animateMove.capture === p.id && prev && !this.opts.reducedMotion) {
        const from = mesh.position.clone();
        this.addTween(420, (k) => {
          const e = easeOut(k);
          mesh.position.lerpVectors(from, target, e);
          mesh.position.y = from.y + Math.sin(Math.PI * k) * 4 + (target.y - from.y) * e;
        }, undefined, 260);
      } else {
        mesh.position.copy(target);
      }
    }
    this.dirty = true;
  }

  private computeTargets(spec: GameSpec, state: GameState): Map<string, THREE.Vector3> {
    const out = new Map<string, THREE.Vector3>();
    const isUr = spec.board.id === 'ur-iii';
    const spacing = isUr ? 2.55 : 1.7;
    for (const owner of [0, 1] as Player[]) {
      const side = owner === 0 ? 1 : -1;
      const zOff = side * (this.boardWid / 2 + (isUr ? 2.1 : 2.6));
      const mine = state.pieces.filter((p) => p.owner === owner);
      const reserve = mine.filter((p) => p.pos === 0);
      const off = mine.filter((p) => p.pos === spec.length + 1);
      reserve.forEach((p, i) => out.set(p.id, new THREE.Vector3(-this.boardLen / 2 + spacing * 0.6 + i * spacing, 0, zOff)));
      off.forEach((p, i) => out.set(p.id, new THREE.Vector3(this.boardLen / 2 - spacing * 0.6 - i * spacing, 0, zOff + side * (isUr ? 0 : 0))));
      for (const p of mine) {
        if (p.pos >= 1 && p.pos <= spec.length) {
          const c = this.cellCenters.get(spec.route.paths[owner][p.pos - 1])!;
          out.set(p.id, new THREE.Vector3(c.x, this.topY, c.z));
        }
      }
    }
    return out;
  }

  private posOnPath(spec: GameSpec, owner: Player, pos: number): THREE.Vector3 | null {
    if (pos < 1 || pos > spec.length) return null;
    const c = this.cellCenters.get(spec.route.paths[owner][pos - 1])!;
    return new THREE.Vector3(c.x, this.topY, c.z);
  }

  private animatePieceAlong(spec: GameSpec, p: PieceState, move: Move, final: THREE.Vector3, mesh: THREE.Object3D) {
    const pts: THREE.Vector3[] = [mesh.position.clone()];
    if (move.enter) {
      const e = this.posOnPath(spec, p.owner, move.to);
      if (e) pts.push(e);
    } else {
      for (let i = move.from + 1; i <= Math.min(move.to, spec.length); i++) pts.push(this.posOnPath(spec, p.owner, i)!);
    }
    if (move.exit || pts.length === 1) pts.push(final);
    const hop = 150;
    const segs = pts.length - 1;
    this.addTween(hop * segs, (k) => {
      const x = k * segs;
      const i = Math.min(segs - 1, Math.floor(x));
      const t = x - i;
      const a = pts[i], b = pts[i + 1];
      mesh.position.lerpVectors(a, b, t);
      mesh.position.y = a.y + (b.y - a.y) * t + Math.sin(Math.PI * t) * 1.1;
    }, () => mesh.position.copy(final));
  }

  /** Visualizza un lancio il cui esito è già noto. Restituisce una promessa risolta a fine animazione. */
  showRoll(roll: RollInfo | null, stage: 'primary' | 'convert' = 'primary'): Promise<void> {
    if (!this.spec || !roll) return Promise.resolve();
    this.finishTweens();
    const binary = this.spec.ruleset.dice === 'binari-4';
    const items: { idx: number; value: number | string }[] = binary
      ? roll.dice.map((v, i) => ({ idx: i, value: v }))
      : stage === 'primary'
        ? [{ idx: 0, value: roll.primary ?? roll.dice[0] }]
        : [{ idx: 1, value: roll.converted ? 'si' : 'no' }];
    return new Promise((resolve) => {
      let pending = items.length;
      for (const it of items) {
        const d = this.dice[it.idx];
        const home = this.diceHome(it.idx);
        const yaw = Math.random() * Math.PI * 2;
        const endQ = this.restQuat(it.idx, it.value, yaw % 1);
        const restY = binary ? 1.2 / 3 : 0.4;
        const end = new THREE.Vector3(home.x + (Math.random() - 0.5) * 1.2, restY, home.z + (Math.random() - 0.5) * 0.8);
        const start = new THREE.Vector3(end.x - 6, 7, end.z + (Math.random() - 0.5) * 3);
        const spinAxis = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
        const startQ = new THREE.Quaternion().setFromAxisAngle(spinAxis, Math.random() * 6);
        const done = () => {
          d.position.copy(end);
          d.quaternion.copy(endQ);
          if (--pending === 0) resolve();
        };
        if (this.opts.reducedMotion) {
          done();
          continue;
        }
        const tmpQ = new THREE.Quaternion();
        this.addTween(650 + it.idx * 60, (k) => {
          const e = easeOut(k);
          d.position.lerpVectors(start, end, e);
          d.position.y = restY + (start.y - restY) * (1 - e) + Math.abs(Math.sin(k * Math.PI * 2.2)) * (1 - k) * 1.6;
          const spin = new THREE.Quaternion().setFromAxisAngle(spinAxis, (1 - e) * 9);
          tmpQ.copy(startQ).slerp(endQ, e).premultiply(spin);
          d.quaternion.copy(tmpQ);
        }, done);
      }
      this.dirty = true;
    });
  }

  private addTween(dur: number, update: (k: number) => void, done?: () => void, delay = 0) {
    this.tweens.push({ t0: performance.now() + delay, dur, update, done });
    this.dirty = true;
  }

  /** Interrompe le animazioni portandole subito allo stato finale. */
  finishTweens() {
    const ts = this.tweens;
    this.tweens = [];
    for (const t of ts) {
      t.update(1);
      t.done?.();
    }
    this.dirty = true;
  }

  get animating() {
    return this.tweens.length > 0;
  }

  // ------------------------------------------------------------------ evidenziazioni

  setInteraction(moves: Move[], selectedPiece: string | null) {
    const spec = this.spec;
    if (!spec) return;
    for (const o of [...this.overlayGroup.children]) if (!o.userData.cell) this.overlayGroup.remove(o);
    this.pickables = this.pickables.filter((o) => o.userData.targetTo === undefined);
    this.selectable.clear();
    for (const m of moves) {
      const arr = this.selectable.get(m.pieceId) ?? [];
      arr.push(m);
      this.selectable.set(m.pieceId, arr);
    }
    // le pedine in riserva sono intercambiabili: selezionabile qualunque pedina in riserva del giocatore
    this.targetMoves = selectedPiece ? (this.selectable.get(selectedPiece) ?? []) : [];
    if (!this.hints) {
      this.dirty = true;
      return;
    }
    const ringGeo = new THREE.RingGeometry(0.95, 1.15, 40);
    const gold = new THREE.MeshBasicMaterial({ color: 0xd2ad63, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide });
    const target = new THREE.MeshBasicMaterial({ color: 0x9fb7ff, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide });
    const scale = spec.board.id === 'ur-iii' ? 1.25 : 0.82;
    const where = this.lastState ? this.computeTargets(spec, this.lastState) : new Map<string, THREE.Vector3>();
    for (const id of this.selectable.keys()) {
      const pos = where.get(id) ?? this.pieceMeshes.get(id)!.position;
      const r = new THREE.Mesh(ringGeo, gold);
      r.rotation.x = -Math.PI / 2;
      r.scale.setScalar(scale * (id === selectedPiece ? 1.15 : 1));
      r.position.set(pos.x, pos.y + 0.03, pos.z);
      this.overlayGroup.add(r);
    }
    for (const m of this.targetMoves) {
      let p = this.posOnPath(spec, m.owner, m.to);
      if (!p) p = this.exitMarker(m.owner);
      const r = new THREE.Mesh(new THREE.CircleGeometry(0.75, 32), target);
      r.rotation.x = -Math.PI / 2;
      r.scale.setScalar(scale);
      r.position.set(p.x, p.y + 0.04, p.z);
      r.userData.targetTo = m.to;
      r.userData.targetPiece = m.pieceId;
      this.overlayGroup.add(r);
      this.pickables.push(r);
    }
    this.dirty = true;
  }

  private exitMarker(owner: Player): THREE.Vector3 {
    const isUr = this.spec!.board.id === 'ur-iii';
    const side = owner === 0 ? 1 : -1;
    return new THREE.Vector3(this.boardLen / 2 - (isUr ? 2.55 : 1.7) * 0.6, 0.02, side * (this.boardWid / 2 + (isUr ? 2.1 : 2.6)));
  }

  showPath(player: Player | null) {
    this.pathGroup.clear();
    if (player === null || !this.spec) return;
    const pts = this.spec.route.paths[player].map((c) => this.cellCenters.get(c)!.clone().setY(this.topY + 0.05));
    const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.1);
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 160, 0.07, 6), new THREE.MeshBasicMaterial({ color: player === 0 ? 0xf0e3c4 : 0x9fb7ff, transparent: true, opacity: 0.75 }));
    this.pathGroup.add(tube);
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.7, 12), tube.material);
    const last = pts[pts.length - 1], prev = pts[pts.length - 2];
    head.position.copy(last);
    head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), last.clone().sub(prev).normalize());
    this.pathGroup.add(head);
    this.dirty = true;
  }

  setMarksVisible(v: boolean) {
    this.showMarks = v;
    this.marksGroup.visible = v;
    this.dirty = true;
  }

  private pick(clientX: number, clientY: number) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hits = ray.intersectObjects(this.pickables.filter((o) => o.parent), true);
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      while (o && o.userData.pieceId === undefined && o.userData.targetTo === undefined && o.userData.cell === undefined) o = o.parent;
      if (!o) continue;
      if (o.userData.targetTo !== undefined) return this.onPick({ pieceId: o.userData.targetPiece, to: o.userData.targetTo });
      if (o.userData.pieceId) return this.onPick({ pieceId: o.userData.pieceId });
      if (o.userData.cell && this.spec && this.lastState) {
        // clic su una casella: se contiene una pedina, equivale a cliccarla; altrimenti destinazione di una mossa selezionata
        const occ = this.lastState.pieces.find((p) => p.pos >= 1 && p.pos <= this.spec!.length && this.spec!.route.paths[p.owner][p.pos - 1] === o!.userData.cell);
        if (occ) return this.onPick({ pieceId: occ.id });
        const m = this.targetMoves.find((mv) => mv.to <= this.spec!.length && this.spec!.route.paths[mv.owner][mv.to - 1] === o!.userData.cell);
        if (m) return this.onPick({ pieceId: m.pieceId, to: m.to });
      }
    }
  }

  // ------------------------------------------------------------------ camera

  setOrientation(p: Player) {
    this.orientation = p;
    this.resetView();
  }

  /** Su schermi verticali la tavola viene mostrata con l'asse lungo in verticale. */
  private get portrait() {
    return (this.camera.aspect || 1.6) < 1.1;
  }

  private fitDistance() {
    const aspect = this.camera.aspect || 1.6;
    const vfov = (this.camera.fov * Math.PI) / 180;
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
    if (this.portrait) return Math.max((this.boardLen + 22) / 2 / Math.tan(vfov / 2), (this.boardWid + 11) / 2 / Math.tan(hfov / 2)) * 0.9;
    const span = this.boardLen + 14;
    return Math.max((span / 2) / Math.tan(hfov / 2), (this.boardWid + 10) / 2 / Math.tan(vfov / 2)) * 0.95;
  }

  resetView() {
    const dist = this.fitDistance();
    const side = this.orientation === 0 ? 1 : -1;
    const target = new THREE.Vector3(2.2, 0, 0);
    this.controls.target.copy(target);
    const tall = this.spec?.board.id === 'tarda';
    if (this.portrait) {
      // vista dall'estremità del blocco piccolo/prolungamento: il lato del giocatore resta a destra/sinistra
      target.set(this.boardLen * 0.22, 0, 0);
      this.controls.target.copy(target);
      this.camera.position.set(target.x + side * 0.001 + dist * 0.42, dist * 0.92, side * 0.001);
    } else {
      this.camera.position.set(target.x, dist * (tall ? 0.9 : 0.8), side * dist * (tall ? 0.44 : 0.6));
    }
    this.controls.minDistance = dist * 0.35;
    this.controls.maxDistance = dist * 1.6;
    this.controls.update();
    this.dirty = true;
  }

  topView() {
    const dist = this.fitDistance() * 0.95;
    const side = this.orientation === 0 ? 1 : -1;
    if (this.portrait) this.camera.position.set(this.controls.target.x + 0.01, dist, side * 0.0001);
    else this.camera.position.set(this.controls.target.x, dist, side * 0.01);
    this.controls.update();
    this.dirty = true;
  }

  zoom(factor: number) {
    const dir = this.camera.position.clone().sub(this.controls.target);
    const len = THREE.MathUtils.clamp(dir.length() * factor, this.controls.minDistance, this.controls.maxDistance);
    this.camera.position.copy(this.controls.target).add(dir.setLength(len));
    this.controls.update();
    this.dirty = true;
  }

  private resize() {
    const w = this.container.clientWidth || 1, hgt = this.container.clientHeight || 1;
    this.renderer.setSize(w, hgt, false);
    this.camera.aspect = w / hgt;
    this.camera.updateProjectionMatrix();
    if (this.spec) {
      const wasPortrait = this.lastPortrait;
      this.lastPortrait = this.portrait;
      if (wasPortrait !== this.lastPortrait) this.resetView();
      const dist = this.fitDistance();
      this.controls.minDistance = dist * 0.35;
      this.controls.maxDistance = dist * 1.6;
    }
    this.dirty = true;
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    if (this.tweens.length) {
      const keep: Tween[] = [];
      for (const t of this.tweens) {
        const k = Math.min(1, Math.max(0, (now - t.t0) / t.dur));
        if (now >= t.t0) t.update(k);
        if (k >= 1) t.done?.();
        else keep.push(t);
      }
      this.tweens = keep;
      this.dirty = true;
    }
    if (this.controls.enableDamping) this.controls.update();
    if (this.dirty) {
      this.dirty = false;
      this.renderer.render(this.scene, this.camera);
      this.updateLabels();
    }
  };

  private updateLabels() {
    const show = this.showLabels && !!this.spec?.ruleset.advanced;
    const w = this.container.clientWidth, hgt = this.container.clientHeight;
    for (const [id, el] of this.labels) {
      const mesh = this.pieceMeshes.get(id);
      if (!mesh || !show) {
        el.style.display = 'none';
        continue;
      }
      const v = mesh.position.clone();
      v.y += (mesh.userData.h ?? 1) + 0.2;
      v.project(this.camera);
      el.style.display = v.z < 1 ? 'block' : 'none';
      el.style.left = `${((v.x + 1) / 2) * w}px`;
      el.style.top = `${((1 - v.y) / 2) * hgt}px`;
    }
  }

  requestRender() {
    this.dirty = true;
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.resizeObs.disconnect();
    this.controls.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose();
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      for (const mt of mats) (mt as THREE.Material).dispose();
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.labelLayer.remove();
  }
}
