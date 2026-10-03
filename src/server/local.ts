// Partite sullo stesso dispositivo per utenti autenticati: non classificate, salvate come "locale".
// Il motore gira nel browser; il server riceve la sequenza di azioni (con gli esiti dei lanci locali)
// e la ri-applica con lo stesso motore, così lo stato salvato è sempre coerente con le regole.

import { randomBytes, randomUUID, randomInt } from 'node:crypto';
import { applyAction, drawFirstPlayer, initialState, resolveSpec, RuleError, type Action, type GameConfig, type GameState } from '../engine/index.ts';
import { all, one, run, tx, type DB } from './db.ts';
import { checkCredentials, sha256 } from './auth.ts';
import { HttpError, type GameRow } from './games.ts';

const ATTESTATION_MS = 15 * 60 * 1000;

export interface LocalSeat {
  type: 'host' | 'verified' | 'friend-unverified' | 'guest';
  name: string;
  userId: string | null;
  verified: boolean;
}

export class LocalService {
  private db: DB;
  constructor(db: DB) {
    this.db = db;
  }

  /** Conferma l'identità del secondo giocatore senza toccare la sessione del primo. */
  verifySecondPlayer(hostId: string, username: unknown, password: unknown) {
    const u = checkCredentials(this.db, username, password);
    if (u.id === hostId) throw new HttpError(400, 'stesso-utente', 'Il secondo giocatore deve essere un altro account.');
    const token = randomBytes(24).toString('base64url');
    const now = Date.now();
    run(this.db, 'INSERT INTO local_attestations (token_hash, host_user, verified_user, created_at, expires_at) VALUES (?, ?, ?, ?, ?)', sha256(token), hostId, u.id, now, now + ATTESTATION_MS);
    return { attestation: token, user: u };
  }

  create(hostId: string, hostName: string, config: GameConfig, seatsIn: unknown) {
    const spec = resolveSpec(config);
    if (!Array.isArray(seatsIn) || seatsIn.length !== 2) throw new HttpError(400, 'giocatori', 'Servono due giocatori.');
    return tx(this.db, () => {
      const seats: LocalSeat[] = seatsIn.map((raw: Record<string, unknown>) => {
        const type = String(raw?.type);
        if (type === 'host') return { type: 'host', name: hostName, userId: hostId, verified: true };
        if (type === 'verified') {
          const a = one<{ verified_user: string; expires_at: number; used_game_id: string | null; host_user: string }>(this.db, 'SELECT * FROM local_attestations WHERE token_hash = ?', sha256(String(raw.attestation ?? '')));
          if (!a || a.host_user !== hostId || a.expires_at < Date.now() || a.used_game_id) throw new HttpError(403, 'verifica', 'Verifica dell\'identità scaduta o non valida: ripeti l\'accesso del secondo giocatore.');
          const u = one<{ id: string; username: string }>(this.db, 'SELECT id, username FROM users WHERE id = ?', a.verified_user)!;
          return { type: 'verified', name: u.username, userId: u.id, verified: true, _att: String(raw.attestation) } as LocalSeat;
        }
        if (type === 'friend-unverified') {
          const u = one<{ id: string; username: string }>(this.db, 'SELECT id, username FROM users WHERE id = ?', String(raw.userId ?? ''));
          if (!u) throw new HttpError(400, 'giocatori', 'Amico non trovato.');
          // Scegliere un nome dalla lista amici non autentica la persona: resta "non verificato".
          return { type: 'friend-unverified', name: u.username, userId: null, verified: false };
        }
        const name = String(raw?.name ?? 'Ospite').trim().slice(0, 24) || 'Ospite';
        return { type: 'guest', name, userId: null, verified: false };
      });
      if (seats.filter((s) => s.type === 'host').length !== 1) throw new HttpError(400, 'giocatori', 'Chi ha aperto la sessione deve occupare esattamente un posto.');
      const id = randomUUID();
      const atts: string[] = [];
      for (const s of seats as (LocalSeat & { _att?: string })[]) {
        if (s._att) atts.push(s._att);
        delete s._att;
      }
      const { firstPlayer, startRolls } = drawFirstPlayer(spec, (n) => randomInt(n));
      const state = initialState(spec, firstPlayer, startRolls);
      const now = Date.now();
      run(this.db, `INSERT INTO games (id, mode, source, board_id, board_version, ruleset_id, ruleset_version, config_key, category, status, local_players,
          state_json, state_version, initial_state_json, created_by, created_at, updated_at) VALUES (?, 'local', 'local', ?, ?, ?, ?, ?, 'locale', 'active', ?, ?, 0, ?, ?, ?, ?)`,
        id, config.boardId, config.boardVersion, config.rulesetId, config.rulesetVersion, spec.key, JSON.stringify(seats), JSON.stringify(state), JSON.stringify(state), hostId, now, now);
      for (const t of atts) {
        const r = run(this.db, 'UPDATE local_attestations SET used_game_id = ? WHERE token_hash = ? AND used_game_id IS NULL', id, sha256(t));
        if (r.changes !== 1) throw new HttpError(403, 'verifica', 'Verifica dell\'identità già utilizzata.');
      }
      return this.view(this.get(hostId, id));
    });
  }

  get(hostId: string, id: string): GameRow {
    const g = one<GameRow>(this.db, `SELECT * FROM games WHERE id = ? AND mode = 'local'`, id);
    if (!g || g.created_by !== hostId) throw new HttpError(404, 'non-trovata', 'Partita locale non trovata.');
    return g;
  }

  view(g: GameRow) {
    return {
      id: g.id, mode: 'local', status: g.status, category: 'locale', configKey: g.config_key,
      seats: JSON.parse(g.local_players ?? '[]') as LocalSeat[],
      state: JSON.parse(g.state_json) as GameState, updatedAt: g.updated_at,
    };
  }

  list(hostId: string) {
    return all<GameRow>(this.db, `SELECT * FROM games WHERE mode = 'local' AND created_by = ? ORDER BY updated_at DESC LIMIT 30`, hostId).map((g) => this.view(g));
  }

  /** Salvataggio: le azioni vengono ri-applicate dal motore a partire dalla versione indicata. */
  sync(hostId: string, id: string, fromVersion: unknown, actions: unknown) {
    if (!Array.isArray(actions) || actions.length > 500) throw new HttpError(400, 'azioni', 'Elenco di azioni non valido.');
    return tx(this.db, () => {
      const g = this.get(hostId, id);
      if (Number(fromVersion) !== g.state_version) throw new HttpError(409, 'versione', 'Il salvataggio sul server è più recente.', { game: this.view(g) });
      let state = JSON.parse(g.state_json) as GameState;
      const spec = resolveSpec(state.config);
      for (const a of actions as Action[]) {
        try {
          state = applyAction(spec, state, a).state;
        } catch (e) {
          if (e instanceof RuleError) throw new HttpError(422, e.code, `Azione non valida nel salvataggio: ${e.message}`);
          throw e;
        }
      }
      const now = Date.now();
      run(this.db, `UPDATE games SET state_json = ?, state_version = ?, status = ?, updated_at = ?, finished_at = ? WHERE id = ? AND state_version = ?`,
        JSON.stringify(state), state.version, state.phase === 'finished' ? 'finished' : 'active', now, state.phase === 'finished' ? now : null, g.id, g.state_version);
      return this.view(this.get(hostId, id));
    });
  }

  remove(hostId: string, id: string) {
    const g = this.get(hostId, id);
    run(this.db, 'DELETE FROM game_events WHERE game_id = ?', g.id);
    run(this.db, 'DELETE FROM local_attestations WHERE used_game_id = ?', g.id);
    run(this.db, 'DELETE FROM games WHERE id = ?', g.id);
    return { ok: true };
  }
}
