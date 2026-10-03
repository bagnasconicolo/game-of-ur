// Servizio partite: stato autorevole sul server, azioni idempotenti, risultati registrati una sola volta.

import { randomUUID, randomInt } from 'node:crypto';
import {
  applyAction, availableActions, drawFirstPlayer, finishExternally, initialState, randomnessFor, resolveSpec, RuleError,
  configKey, type Action, type GameConfig, type GameEvent, type GameState, type Player,
} from '../engine/index.ts';
import { all, one, run, tx, type DB } from './db.ts';

export const cryptoRand = (n: number): number => randomInt(n);

export class HttpError extends Error {
  status: number;
  code: string;
  extra?: Record<string, unknown>;
  constructor(status: number, code: string, message: string, extra?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export interface Hub {
  notifyUser(userId: string, msg: unknown): void;
  broadcastGame(gameId: string, msg: unknown): void;
  isOnline(userId: string): boolean;
  isWatching(userId: string, gameId: string): boolean;
}

export interface GameRow {
  id: string;
  mode: 'online' | 'local';
  source: string;
  room_code: string | null;
  board_id: string;
  board_version: number;
  ruleset_id: string;
  ruleset_version: number;
  config_key: string;
  category: string;
  status: 'waiting' | 'active' | 'finished' | 'aborted';
  player0: string | null;
  player1: string | null;
  local_players: string | null;
  state_json: string;
  state_version: number;
  initial_state_json: string;
  turn_deadline: number | null;
  rematch_of: string | null;
  created_by: string;
  created_at: number;
  updated_at: number;
  finished_at: number | null;
}

export const ELO_K = 32;
export const ELO_START = 1200;

export function parseConfig(body: Record<string, unknown>): GameConfig {
  const boardId = String(body.boardId ?? '');
  const rulesetId = String(body.rulesetId ?? '');
  const cfg = {
    boardId,
    boardVersion: Number(body.boardVersion ?? 1),
    rulesetId,
    rulesetVersion: Number(body.rulesetVersion ?? 1),
  } as GameConfig;
  try {
    resolveSpec(cfg);
  } catch (e) {
    throw new HttpError(400, 'configurazione', `Configurazione non valida: ${(e as Error).message}`);
  }
  return cfg;
}

const ACTION_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export class GameService {
  private db: DB;
  private hub: Hub;
  private opts: { turnMs: number; rand?: (n: number) => number };
  constructor(db: DB, hub: Hub, opts: { turnMs: number; rand?: (n: number) => number }) {
    this.db = db;
    this.hub = hub;
    this.opts = opts;
  }

  private get rand() {
    return this.opts.rand ?? cryptoRand;
  }

  newRoomCode(): string {
    for (let i = 0; i < 20; i++) {
      let c = '';
      for (let j = 0; j < 6; j++) c += ROOM_ALPHABET[randomInt(ROOM_ALPHABET.length)];
      if (!one(this.db, 'SELECT 1 FROM games WHERE room_code = ?', c)) return c;
    }
    throw new Error('Impossibile generare un codice stanza');
  }

  createOnlineGame(p: { source: 'invite' | 'room' | 'match' | 'rematch'; config: GameConfig; player0: string; player1: string | null; roomCode?: string | null; rematchOf?: string | null }): GameRow {
    const spec = resolveSpec(p.config);
    const { firstPlayer, startRolls } = drawFirstPlayer(spec, this.rand);
    const state = initialState(spec, firstPlayer, startRolls);
    const now = Date.now();
    const id = randomUUID();
    const status = p.player1 ? 'active' : 'waiting';
    run(
      this.db,
      `INSERT INTO games (id, mode, source, room_code, board_id, board_version, ruleset_id, ruleset_version, config_key, category, status,
        player0, player1, state_json, state_version, initial_state_json, turn_deadline, rematch_of, created_by, created_at, updated_at)
       VALUES (?, 'online', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`,
      id, p.source, p.roomCode ?? null, p.config.boardId, p.config.boardVersion, p.config.rulesetId, p.config.rulesetVersion,
      spec.key, spec.compat.category, status, p.player0, p.player1, JSON.stringify(state), JSON.stringify(state),
      status === 'active' ? now + this.opts.turnMs : null, p.rematchOf ?? null, p.player0, now, now,
    );
    return this.row(id)!;
  }

  row(id: string): GameRow | undefined {
    return one<GameRow>(this.db, 'SELECT * FROM games WHERE id = ?', id);
  }

  /** Restituisce la partita solo ai partecipanti; per tutti gli altri risponde 404 (non rivela l'esistenza). */
  forParticipant(id: string, userId: string): GameRow {
    const g = this.row(id);
    if (!g || g.mode !== 'online' || (g.player0 !== userId && g.player1 !== userId)) throw new HttpError(404, 'non-trovata', 'Partita non trovata.');
    return g;
  }

  seatOf(g: GameRow, userId: string): Player | null {
    if (g.player0 === userId) return 0;
    if (g.player1 === userId) return 1;
    return null;
  }

  snapshot(g: GameRow, viewerId: string | null) {
    const state = JSON.parse(g.state_json) as GameState;
    const spec = resolveSpec(state.config);
    const users = [g.player0, g.player1].map((uid) => (uid ? one<{ id: string; username: string }>(this.db, 'SELECT id, username FROM users WHERE id = ?', uid) ?? null : null));
    const result = one<Record<string, unknown>>(this.db, 'SELECT * FROM game_results WHERE game_id = ?', g.id) ?? null;
    return {
      id: g.id,
      mode: g.mode,
      source: g.source,
      status: g.status,
      category: g.category,
      configKey: g.config_key,
      config: state.config,
      roomCode: viewerId && (g.player0 === viewerId || g.player1 === viewerId) ? g.room_code : null,
      players: users.map((u) => (u ? { id: u.id, username: u.username, online: this.hub.isOnline(u.id) } : null)),
      yourSeat: viewerId ? this.seatOf(g, viewerId) : null,
      state,
      available: g.status === 'active' ? availableActions(spec, state) : null,
      turnDeadline: g.turn_deadline,
      serverTime: Date.now(),
      result,
      rematchOf: g.rematch_of,
    };
  }

  listOpen(userId: string) {
    const rows = all<GameRow>(
      this.db,
      `SELECT * FROM games WHERE mode = 'online' AND status IN ('waiting', 'active') AND (player0 = ? OR player1 = ?) ORDER BY updated_at DESC`,
      userId, userId,
    );
    return rows.map((g) => this.snapshot(g, userId));
  }

  joinRoom(userId: string, code: string) {
    const norm = String(code ?? '').trim().toUpperCase();
    return tx(this.db, () => {
      const g = one<GameRow>(this.db, 'SELECT * FROM games WHERE room_code = ?', norm);
      if (!g || g.status === 'aborted') throw new HttpError(404, 'stanza', 'Nessuna stanza con questo codice.');
      if (g.player0 === userId || g.player1 === userId) return g; // già partecipante: ritrova la partita
      if (g.status !== 'waiting' || g.player1) throw new HttpError(409, 'stanza-piena', 'La stanza è già completa.');
      const now = Date.now();
      const r = run(this.db, `UPDATE games SET player1 = ?, status = 'active', turn_deadline = ?, updated_at = ? WHERE id = ? AND status = 'waiting' AND player1 IS NULL`, userId, now + this.opts.turnMs, now, g.id);
      if (r.changes !== 1) throw new HttpError(409, 'stanza-piena', 'La stanza è già completa.');
      const updated = this.row(g.id)!;
      this.broadcast(updated);
      return updated;
    });
  }

  cancelWaiting(userId: string, gameId: string) {
    const g = this.forParticipant(gameId, userId);
    if (g.status !== 'waiting') throw new HttpError(409, 'stato', 'La partita è già iniziata.');
    run(this.db, `UPDATE games SET status = 'aborted', updated_at = ? WHERE id = ? AND status = 'waiting'`, Date.now(), g.id);
  }

  /** Applica un'azione di gioco. Idempotente per actionId; protetta dalla versione attesa dello stato. */
  act(userId: string, gameId: string, body: { actionId?: unknown; expectedVersion?: unknown; action?: unknown }) {
    const actionId = String(body.actionId ?? '');
    if (!ACTION_ID_RE.test(actionId)) throw new HttpError(400, 'action-id', 'Identificativo azione non valido.');
    const raw = (body.action ?? {}) as Record<string, unknown>;

    return tx(this.db, () => {
      const g = this.forParticipant(gameId, userId);
      const dup = one(this.db, 'SELECT seq FROM game_events WHERE game_id = ? AND action_id = ?', g.id, actionId);
      if (dup) return { duplicate: true, events: [] as GameEvent[], snapshot: this.snapshot(g, userId) };
      if (g.status !== 'active') throw new HttpError(409, 'stato', g.status === 'waiting' ? 'In attesa dell\'avversario.' : 'La partita è terminata.', { snapshot: this.snapshot(g, userId) });
      const seat = this.seatOf(g, userId)!;
      const state = JSON.parse(g.state_json) as GameState;
      if (Number(body.expectedVersion) !== g.state_version) {
        throw new HttpError(409, 'versione', 'Lo stato della partita è cambiato: aggiornato all\'ultima versione.', { snapshot: this.snapshot(g, userId) });
      }
      if (state.turn !== seat) throw new HttpError(403, 'turno', 'Non è il tuo turno.', { snapshot: this.snapshot(g, userId) });

      // Il client non fornisce mai l'esito dei dadi: lo estrae il server.
      let action: Action;
      switch (raw.type) {
        case 'roll':
          action = { type: 'roll', dice: randomnessFor(resolveSpec(state.config), 'roll', this.rand).dice! };
          break;
        case 'convert':
          action = { type: 'convert', yes: randomnessFor(resolveSpec(state.config), 'convert', this.rand).yes! };
          break;
        case 'pass':
          action = { type: 'pass' };
          break;
        case 'move':
          action = { type: 'move', pieceId: String(raw.pieceId ?? ''), to: Number(raw.to) };
          break;
        default:
          throw new HttpError(400, 'azione', 'Azione sconosciuta.');
      }
      const spec = resolveSpec(state.config);
      let result;
      try {
        result = applyAction(spec, state, action);
      } catch (e) {
        if (e instanceof RuleError) throw new HttpError(422, e.code, e.message, { snapshot: this.snapshot(g, userId) });
        throw e;
      }
      const now = Date.now();
      const upd = run(
        this.db,
        `UPDATE games SET state_json = ?, state_version = ?, turn_deadline = ?, updated_at = ? WHERE id = ? AND state_version = ? AND status = 'active'`,
        JSON.stringify(result.state), result.state.version, result.state.phase === 'finished' ? null : now + this.opts.turnMs, now, g.id, g.state_version,
      );
      if (upd.changes !== 1) throw new HttpError(409, 'versione', 'Azione concorrente: riprova.');
      run(this.db, 'INSERT INTO game_events (game_id, seq, action_id, actor_user_id, action_json, events_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        g.id, result.state.version, actionId, userId, JSON.stringify(action), JSON.stringify(result.events), now);
      if (result.state.phase === 'finished') this.recordResult(this.row(g.id)!, result.state.winner!, result.state.finishReason ?? 'percorso-completato');
      const after = this.row(g.id)!;
      this.broadcast(after, result.events, actionId);
      return { duplicate: false, events: result.events, snapshot: this.snapshot(after, userId) };
    });
  }

  resign(userId: string, gameId: string) {
    return tx(this.db, () => {
      const g = this.forParticipant(gameId, userId);
      if (g.status !== 'active') throw new HttpError(409, 'stato', 'La partita non è in corso.');
      const seat = this.seatOf(g, userId)!;
      this.finishExternal(g, (1 - seat) as Player, 'resa');
      return this.snapshot(this.row(g.id)!, userId);
    });
  }

  private finishExternal(g: GameRow, winner: Player, reason: string) {
    const state = JSON.parse(g.state_json) as GameState;
    const s = finishExternally(state, winner, reason);
    const now = Date.now();
    const r = run(this.db, `UPDATE games SET state_json = ?, state_version = ?, turn_deadline = NULL, updated_at = ? WHERE id = ? AND status = 'active' AND state_version = ?`,
      JSON.stringify(s), s.version, now, g.id, g.state_version);
    if (r.changes !== 1) return;
    run(this.db, 'INSERT INTO game_events (game_id, seq, action_id, actor_user_id, action_json, events_json, created_at) VALUES (?, ?, ?, NULL, ?, ?, ?)',
      g.id, s.version, `sys-${reason}-${s.version}`, JSON.stringify({ type: 'system', reason }), JSON.stringify([{ type: 'finished', winner, reason }]), now);
    this.recordResult(this.row(g.id)!, winner, reason);
    this.broadcast(this.row(g.id)!, [{ type: 'finished', winner, reason }]);
  }

  /** Registra il risultato una sola volta (vincolo di unicità + transizione di stato condizionata) e aggiorna statistiche ed Elo. */
  recordResult(g: GameRow, winnerSeat: Player, reason: string) {
    tx(this.db, () => {
      const now = Date.now();
      const r = run(this.db, `UPDATE games SET status = 'finished', finished_at = ?, turn_deadline = NULL WHERE id = ? AND status = 'active'`, now, g.id);
      if (r.changes !== 1) return;
      const winner = winnerSeat === 0 ? g.player0 : g.player1;
      const loser = winnerSeat === 0 ? g.player1 : g.player0;
      const ranked = (g.category === 'competitiva' || g.category === 'sperimentale') && !!winner && !!loser ? 1 : 0;
      let wb: number | null = null, wa: number | null = null, lb: number | null = null, la: number | null = null;
      if (winner && loser) {
        const get = (uid: string) => {
          let row = one<{ rating: number }>(this.db, 'SELECT rating FROM ratings WHERE user_id = ? AND config_key = ?', uid, g.config_key);
          if (!row) {
            run(this.db, 'INSERT INTO ratings (user_id, config_key, category, rating, games, wins, losses, updated_at) VALUES (?, ?, ?, ?, 0, 0, 0, ?)', uid, g.config_key, g.category, ELO_START, now);
            row = { rating: ELO_START };
          }
          return row.rating;
        };
        wb = get(winner);
        lb = get(loser);
        if (ranked) {
          const ew = 1 / (1 + 10 ** ((lb - wb) / 400));
          wa = Math.round((wb + ELO_K * (1 - ew)) * 10) / 10;
          la = Math.round((lb - ELO_K * (1 - ew)) * 10) / 10;
        } else {
          wa = wb;
          la = lb;
        }
        run(this.db, 'UPDATE ratings SET rating = ?, games = games + 1, wins = wins + 1, updated_at = ? WHERE user_id = ? AND config_key = ?', wa, now, winner, g.config_key);
        run(this.db, 'UPDATE ratings SET rating = ?, games = games + 1, losses = losses + 1, updated_at = ? WHERE user_id = ? AND config_key = ?', la, now, loser, g.config_key);
      }
      run(this.db, `INSERT INTO game_results (game_id, config_key, category, ranked, winner_user, loser_user, winner_seat, reason,
          rating_winner_before, rating_winner_after, rating_loser_before, rating_loser_after, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        g.id, g.config_key, g.category, ranked, winner, loser, winnerSeat, reason, wb, wa, lb, la, now);
    });
  }

  /** Quando un partecipante si collega a una partita in pausa, il cronometro riparte. */
  onWatch(userId: string, gameId: string) {
    const g = this.row(gameId);
    if (!g || g.status !== 'active' || g.turn_deadline !== null) return;
    if (g.player0 !== userId && g.player1 !== userId) return;
    run(this.db, 'UPDATE games SET turn_deadline = ? WHERE id = ? AND turn_deadline IS NULL AND status = \'active\'', Date.now() + this.opts.turnMs, g.id);
    this.broadcast(this.row(g.id)!);
  }

  /**
   * Politica del tempo: alla scadenza del turno, se l'avversario è collegato alla partita, chi è di turno perde per tempo scaduto;
   * se l'avversario non è collegato, la partita va in pausa (nessun vincitore) e riprende quando un partecipante torna.
   */
  sweep(now = Date.now()) {
    const expired = all<GameRow>(this.db, `SELECT * FROM games WHERE status = 'active' AND turn_deadline IS NOT NULL AND turn_deadline < ?`, now);
    for (const g of expired) {
      const state = JSON.parse(g.state_json) as GameState;
      const onTurn = state.turn === 0 ? g.player0 : g.player1;
      const other = state.turn === 0 ? g.player1 : g.player0;
      tx(this.db, () => {
        if (other && this.hub.isWatching(other, g.id)) {
          this.finishExternal(g, (1 - state.turn) as Player, onTurn && this.hub.isOnline(onTurn) ? 'tempo-scaduto' : 'abbandono');
        } else {
          run(this.db, 'UPDATE games SET turn_deadline = NULL WHERE id = ? AND state_version = ?', g.id, g.state_version);
          this.broadcast(this.row(g.id)!);
        }
      });
    }
  }

  private broadcast(g: GameRow, events: GameEvent[] = [], actionId?: string) {
    for (const uid of [g.player0, g.player1]) {
      if (uid) this.hub.notifyUser(uid, { t: 'game', game: this.snapshot(g, uid), events, actionId });
    }
  }

  events(userId: string, gameId: string) {
    const g = this.forParticipant(gameId, userId);
    return all<{ seq: number; action_json: string; events_json: string; created_at: number }>(this.db, 'SELECT seq, action_json, events_json, created_at FROM game_events WHERE game_id = ? ORDER BY seq', g.id)
      .map((e) => ({ seq: e.seq, action: JSON.parse(e.action_json), events: JSON.parse(e.events_json), at: e.created_at }));
  }

  configKeyOf(c: GameConfig) {
    return configKey(c);
  }
}
