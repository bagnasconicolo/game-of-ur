// Controller di partita: online (stato autorevole sul server) e locale (motore nel browser).
// La vista di gioco usa la stessa interfaccia per entrambi.

import {
  applyAction, availableActions, drawFirstPlayer, initialState, randomnessFor, resolveSpec,
  type Action, type GameConfig, type GameEvent, type GameSpec, type GameState, type Player,
} from '../engine/index.ts';
import { ApiError, get, post, realtime } from './net/api.ts';
import { uid } from './ui/dom.ts';

export type UiAction = { type: 'roll' } | { type: 'convert' } | { type: 'pass' } | { type: 'move'; pieceId: string; to: number };

export interface SeatInfo {
  name: string;
  detail: string;
  verified: boolean;
  online?: boolean;
}

export interface UpdateMeta {
  initial?: boolean;
  error?: string;
}

export interface Controller {
  mode: 'online' | 'local';
  spec: GameSpec;
  state: GameState;
  seats: [SeatInfo, SeatInfo];
  category: string;
  /** Posti controllabili da questo dispositivo. */
  controls(seat: Player): boolean;
  act(a: UiAction): Promise<void>;
  busy: boolean;
  deadline: number | null;
  clockOffset: number;
  status: string;
  result: any;
  gameId: string;
  subscribe(cb: (state: GameState, events: GameEvent[], meta: UpdateMeta) => void): () => void;
  resign?(): Promise<void>;
  rematch?(): Promise<void>;
  dispose(): void;
}

/** Intero uniforme in [0, n) con crypto.getRandomValues (campionamento con rifiuto, niente bias da modulo). */
export function cryptoRand(n: number): number {
  const lim = Math.floor(0x100000000 / n) * n;
  const a = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(a);
    if (a[0] < lim) return a[0] % n;
  }
}

// ------------------------------------------------------------------ online

export class OnlineController implements Controller {
  mode = 'online' as const;
  spec!: GameSpec;
  state!: GameState;
  seats!: [SeatInfo, SeatInfo];
  category = '';
  yourSeat: Player | null = null;
  busy = false;
  deadline: number | null = null;
  clockOffset = 0;
  status = 'active';
  result: any = null;
  gameId: string;
  snapshot: any;
  private listeners = new Set<(s: GameState, e: GameEvent[], m: UpdateMeta) => void>();
  private off: () => void;
  private pending: { actionId: string; expectedVersion: number; action: UiAction; resolve: () => void; reject: (e: Error) => void } | null = null;
  private offStatus: () => void;

  constructor(gameId: string) {
    this.gameId = gameId;
    this.off = realtime.on((m) => this.onMessage(m));
    this.offStatus = realtime.onStatus((s) => {
      if (s === 'connesso' && this.pending) this.sendPending();
    });
  }

  async load() {
    const snap = await get(`/api/games/${this.gameId}`);
    this.apply(snap, [], { initial: true });
    realtime.watch(this.gameId);
  }

  private apply(snap: any, events: GameEvent[], meta: UpdateMeta = {}) {
    if (this.state && snap.state.version < this.state.version) return; // aggiornamento vecchio o duplicato
    const same = this.state && snap.state.version === this.state.version && snap.status === this.status;
    this.snapshot = snap;
    this.spec = this.spec ?? resolveSpec(snap.config);
    this.state = snap.state;
    this.status = snap.status;
    this.category = snap.category;
    this.yourSeat = snap.yourSeat;
    this.deadline = snap.turnDeadline;
    this.clockOffset = snap.serverTime - Date.now();
    this.result = snap.result;
    this.seats = snap.players.map((p: any, i: number) => ({
      name: p?.username ?? 'In attesa…',
      detail: p ? (i === snap.yourSeat ? 'Tu' : 'Avversario') + (p.online ? ' · online' : ' · non collegato') : 'Posto libero',
      verified: !!p,
      online: p?.online,
    })) as [SeatInfo, SeatInfo];
    if (same && !meta.initial && !events.length) {
      for (const l of this.listeners) l(this.state, [], { ...meta, initial: false });
      return;
    }
    for (const l of this.listeners) l(this.state, events, meta);
  }

  private onMessage(m: any) {
    if (m.t === 'game' && m.game?.id === this.gameId) {
      if (this.pending && m.actionId === this.pending.actionId) return; // gestito dall'ack
      this.apply(m.game, m.events ?? []);
    } else if (m.t === 'ack' && this.pending && m.actionId === this.pending.actionId) {
      const p = this.pending;
      this.pending = null;
      this.busy = false;
      this.apply(m.game, m.duplicate ? [] : m.events);
      p.resolve();
    } else if (m.t === 'error' && this.pending && m.actionId === this.pending.actionId) {
      const p = this.pending;
      this.pending = null;
      this.busy = false;
      if (m.snapshot) this.apply(m.snapshot, [], { error: m.message });
      p.reject(new Error(m.message));
    }
  }

  controls(seat: Player) {
    return this.yourSeat === seat && this.status === 'active';
  }

  private sendPending() {
    const p = this.pending!;
    const sent = realtime.send({ t: 'action', gameId: this.gameId, actionId: p.actionId, expectedVersion: p.expectedVersion, action: p.action });
    if (!sent) {
      // ripiego HTTP: stessa actionId, quindi nessun doppio effetto
      post(`/api/games/${this.gameId}/action`, { actionId: p.actionId, expectedVersion: p.expectedVersion, action: p.action })
        .then((r) => this.onMessage({ t: 'ack', actionId: p.actionId, duplicate: r.duplicate, game: r.snapshot, events: r.events }))
        .catch((e: ApiError) => {
          if (e.status === 0) return; // offline: si ritenta alla riconnessione
          this.onMessage({ t: 'error', actionId: p.actionId, message: e.message, snapshot: e.data?.snapshot });
        });
    }
  }

  act(a: UiAction): Promise<void> {
    if (this.pending) return Promise.reject(new Error('Azione già in corso: attendi la conferma del server.'));
    this.busy = true;
    return new Promise((resolve, reject) => {
      this.pending = { actionId: uid(), expectedVersion: this.state.version, action: a, resolve, reject };
      this.sendPending();
      // se non arriva risposta, si ritenta con la stessa actionId
      const id = this.pending.actionId;
      setTimeout(() => {
        if (this.pending?.actionId === id) this.sendPending();
      }, 6000);
    });
  }

  async resign() {
    const snap = await post(`/api/games/${this.gameId}/resign`);
    this.apply(snap, []);
  }

  async rematch() {
    await post(`/api/games/${this.gameId}/rematch`);
  }

  subscribe(cb: (s: GameState, e: GameEvent[], m: UpdateMeta) => void) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  dispose() {
    this.off();
    this.offStatus();
    realtime.unwatch(this.gameId);
  }
}

// ------------------------------------------------------------------ locale

export interface LocalSeatDef {
  type: 'host' | 'verified' | 'friend-unverified' | 'guest';
  name: string;
  verified: boolean;
  userId?: string | null;
}

interface LocalSave {
  id: string;
  serverId: string | null;
  config: GameConfig;
  seats: LocalSeatDef[];
  state: GameState;
  /** Azioni non ancora sincronizzate con il server (solo utenti autenticati). */
  unsynced: Action[];
  syncedVersion: number;
  updatedAt: number;
}

const LS_KEY = 'ur.local.saves';

export function loadLocalSaves(): LocalSave[] {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) ?? '[]');
  } catch {
    return [];
  }
}

function storeLocalSaves(list: LocalSave[]) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(list.slice(0, 20)));
  } catch {
    /* archiviazione piena o non disponibile */
  }
}

export function deleteLocalSave(id: string) {
  storeLocalSaves(loadLocalSaves().filter((s) => s.id !== id));
}

export class LocalController implements Controller {
  mode = 'local' as const;
  spec: GameSpec;
  state: GameState;
  seats: [SeatInfo, SeatInfo];
  category = 'locale';
  busy = false;
  deadline = null;
  clockOffset = 0;
  status = 'active';
  result = null;
  gameId: string;
  save: LocalSave;
  private listeners = new Set<(s: GameState, e: GameEvent[], m: UpdateMeta) => void>();
  syncState: 'locale' | 'sincronizzato' | 'in-attesa' | 'errore' = 'locale';

  constructor(save: LocalSave) {
    this.save = save;
    this.gameId = save.id;
    this.spec = resolveSpec(save.config);
    this.state = save.state;
    this.status = save.state.phase === 'finished' ? 'finished' : 'active';
    this.seats = save.seats.map((s) => ({
      name: s.name,
      detail: s.type === 'host' ? 'Account di questo dispositivo' : s.type === 'verified' ? 'Identità verificata' : s.type === 'friend-unverified' ? 'Amico (identità non verificata)' : 'Ospite',
      verified: s.verified,
    })) as [SeatInfo, SeatInfo];
    if (save.serverId) this.syncState = save.unsynced.length ? 'in-attesa' : 'sincronizzato';
  }

  static newGame(config: GameConfig, seats: LocalSeatDef[], serverGame?: { id: string; state: GameState }): LocalController {
    const spec = resolveSpec(config);
    let state: GameState;
    if (serverGame) state = serverGame.state;
    else {
      const { firstPlayer, startRolls } = drawFirstPlayer(spec, cryptoRand);
      state = initialState(spec, firstPlayer, startRolls);
    }
    const save: LocalSave = { id: serverGame?.id ?? uid(), serverId: serverGame?.id ?? null, config, seats, state, unsynced: [], syncedVersion: state.version, updatedAt: Date.now() };
    const c = new LocalController(save);
    c.persist();
    return c;
  }

  static resume(id: string): LocalController | null {
    const s = loadLocalSaves().find((x) => x.id === id);
    return s ? new LocalController(s) : null;
  }

  controls() {
    return this.status === 'active';
  }

  private persist() {
    this.save.state = this.state;
    this.save.updatedAt = Date.now();
    const list = loadLocalSaves().filter((s) => s.id !== this.save.id);
    list.unshift(this.save);
    storeLocalSaves(list);
  }

  async act(a: UiAction) {
    let action: Action;
    if (a.type === 'roll') action = { type: 'roll', dice: randomnessFor(this.spec, 'roll', cryptoRand).dice! };
    else if (a.type === 'convert') action = { type: 'convert', yes: randomnessFor(this.spec, 'convert', cryptoRand).yes! };
    else action = a as Action;
    const r = applyAction(this.spec, this.state, action); // lancia RuleError con spiegazione
    this.state = r.state;
    this.status = r.state.phase === 'finished' ? 'finished' : 'active';
    if (this.save.serverId) this.save.unsynced.push(action);
    this.persist();
    for (const l of this.listeners) l(this.state, r.events, {});
    void this.sync();
  }

  /** Salvataggio sul server (se la partita appartiene a un account): ri-applicazione delle azioni lato server. */
  async sync() {
    if (!this.save.serverId || !this.save.unsynced.length) return;
    const actions = [...this.save.unsynced];
    try {
      this.syncState = 'in-attesa';
      const r = await post(`/api/local/games/${this.save.serverId}/sync`, { fromVersion: this.save.syncedVersion, actions });
      this.save.unsynced = this.save.unsynced.slice(actions.length);
      this.save.syncedVersion = r.state.version;
      this.syncState = this.save.unsynced.length ? 'in-attesa' : 'sincronizzato';
      this.persist();
    } catch (e) {
      this.syncState = 'errore';
      if (e instanceof ApiError && e.status === 409 && e.data?.game) {
        // il server ha una versione più recente (ripresa da un altro dispositivo): si adotta quella
        this.state = e.data.game.state;
        this.save.unsynced = [];
        this.save.syncedVersion = this.state.version;
        this.persist();
        for (const l of this.listeners) l(this.state, [], { initial: true, error: 'Ripristinato il salvataggio più recente dal server.' });
      }
    }
  }

  get available() {
    return availableActions(this.spec, this.state);
  }

  subscribe(cb: (s: GameState, e: GameEvent[], m: UpdateMeta) => void) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  dispose() {
    this.listeners.clear();
  }
}
