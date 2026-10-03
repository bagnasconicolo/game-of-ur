// Amicizie, inviti, ricerca utenti, profili, classifiche e ricerca avversario.

import { randomUUID } from 'node:crypto';
import { configKey, type GameConfig } from '../engine/index.ts';
import { all, one, run, tx, type DB } from './db.ts';
import { normalizeUsername } from './auth.ts';
import { HttpError, type GameService, type Hub } from './games.ts';

function pair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

interface FriendRow {
  user_low: string;
  user_high: string;
  requester_id: string;
  status: 'pending' | 'accepted';
}

export class SocialService {
  private db: DB;
  private hub: Hub;
  private games: GameService;
  private opts: { inviteMs: number };
  constructor(db: DB, hub: Hub, games: GameService, opts: { inviteMs: number }) {
    this.db = db;
    this.hub = hub;
    this.games = games;
    this.opts = opts;
  }

  userByName(username: string) {
    const u = one<{ id: string; username: string }>(this.db, 'SELECT id, username FROM users WHERE username_norm = ?', normalizeUsername(String(username ?? '')));
    if (!u) throw new HttpError(404, 'utente', 'Utente non trovato.');
    return u;
  }

  search(meId: string, q: string) {
    const term = normalizeUsername(String(q ?? '').trim());
    if (term.length < 2) return [];
    const like = term.replace(/[\\%_]/g, (m) => '\\' + m) + '%';
    const rows = all<{ id: string; username: string }>(this.db, `SELECT id, username FROM users WHERE username_norm LIKE ? ESCAPE '\\' AND id != ? ORDER BY username_norm LIMIT 20`, like, meId);
    return rows.map((u) => ({ ...u, relation: this.relation(meId, u.id) }));
  }

  relation(meId: string, otherId: string): 'amico' | 'richiesta-inviata' | 'richiesta-ricevuta' | 'nessuna' {
    const [lo, hi] = pair(meId, otherId);
    const f = one<FriendRow>(this.db, 'SELECT * FROM friendships WHERE user_low = ? AND user_high = ?', lo, hi);
    if (!f) return 'nessuna';
    if (f.status === 'accepted') return 'amico';
    return f.requester_id === meId ? 'richiesta-inviata' : 'richiesta-ricevuta';
  }

  areFriends(a: string, b: string): boolean {
    return this.relation(a, b) === 'amico';
  }

  requestFriend(meId: string, username: string) {
    const other = this.userByName(username);
    if (other.id === meId) throw new HttpError(400, 'se-stesso', 'Non puoi aggiungere te stesso.');
    const [lo, hi] = pair(meId, other.id);
    return tx(this.db, () => {
      const f = one<FriendRow>(this.db, 'SELECT * FROM friendships WHERE user_low = ? AND user_high = ?', lo, hi);
      const now = Date.now();
      if (f?.status === 'accepted') throw new HttpError(409, 'gia-amici', 'Siete già amici.');
      if (f && f.requester_id === meId) throw new HttpError(409, 'gia-inviata', 'Richiesta già inviata.');
      if (f) {
        // L'altro aveva già chiesto: la richiesta reciproca vale come accettazione.
        run(this.db, `UPDATE friendships SET status = 'accepted', updated_at = ? WHERE user_low = ? AND user_high = ?`, now, lo, hi);
        this.hub.notifyUser(other.id, { t: 'notify', kind: 'friends' });
        return { status: 'amico' };
      }
      run(this.db, `INSERT INTO friendships (user_low, user_high, requester_id, status, created_at, updated_at) VALUES (?, ?, ?, 'pending', ?, ?)`, lo, hi, meId, now, now);
      this.hub.notifyUser(other.id, { t: 'notify', kind: 'friends' });
      return { status: 'richiesta-inviata' };
    });
  }

  respondFriend(meId: string, otherId: string, accept: boolean) {
    const [lo, hi] = pair(meId, String(otherId));
    const f = one<FriendRow>(this.db, 'SELECT * FROM friendships WHERE user_low = ? AND user_high = ?', lo, hi);
    if (!f || f.status !== 'pending' || f.requester_id === meId) throw new HttpError(404, 'richiesta', 'Richiesta non trovata.');
    if (accept) run(this.db, `UPDATE friendships SET status = 'accepted', updated_at = ? WHERE user_low = ? AND user_high = ?`, Date.now(), lo, hi);
    else run(this.db, 'DELETE FROM friendships WHERE user_low = ? AND user_high = ?', lo, hi);
    this.hub.notifyUser(String(otherId), { t: 'notify', kind: 'friends' });
    return { ok: true };
  }

  removeFriend(meId: string, otherId: string) {
    const [lo, hi] = pair(meId, String(otherId));
    const r = run(this.db, 'DELETE FROM friendships WHERE user_low = ? AND user_high = ?', lo, hi);
    if (r.changes === 0) throw new HttpError(404, 'amicizia', 'Amicizia non trovata.');
    this.hub.notifyUser(String(otherId), { t: 'notify', kind: 'friends' });
    return { ok: true };
  }

  friends(meId: string) {
    const rows = all<FriendRow & { other_id: string; other_name: string }>(
      this.db,
      `SELECT f.*, u.id AS other_id, u.username AS other_name FROM friendships f
       JOIN users u ON u.id = CASE WHEN f.user_low = ? THEN f.user_high ELSE f.user_low END
       WHERE f.user_low = ? OR f.user_high = ? ORDER BY u.username_norm`,
      meId, meId, meId,
    );
    const map = (r: (typeof rows)[number]) => ({ id: r.other_id, username: r.other_name, online: this.hub.isOnline(r.other_id) });
    return {
      friends: rows.filter((r) => r.status === 'accepted').map(map),
      incoming: rows.filter((r) => r.status === 'pending' && r.requester_id !== meId).map(map),
      outgoing: rows.filter((r) => r.status === 'pending' && r.requester_id === meId).map(map),
    };
  }

  // ---- Inviti diretti ----

  expireInvites(now = Date.now()) {
    const exp = all<{ id: string; from_user: string; to_user: string }>(this.db, `SELECT id, from_user, to_user FROM invites WHERE status = 'pending' AND expires_at < ?`, now);
    for (const i of exp) {
      run(this.db, `UPDATE invites SET status = 'expired', responded_at = ? WHERE id = ? AND status = 'pending'`, now, i.id);
      this.hub.notifyUser(i.from_user, { t: 'notify', kind: 'invites' });
      this.hub.notifyUser(i.to_user, { t: 'notify', kind: 'invites' });
    }
  }

  invite(meId: string, toUserId: string, config: GameConfig, rematchOf: string | null = null) {
    if (toUserId === meId) throw new HttpError(400, 'se-stesso', 'Non puoi sfidare te stesso.');
    if (!rematchOf && !this.areFriends(meId, toUserId)) throw new HttpError(403, 'non-amici', 'Puoi invitare direttamente solo i tuoi amici.');
    this.expireInvites();
    const existing = one(this.db, `SELECT 1 FROM invites WHERE from_user = ? AND to_user = ? AND status = 'pending'`, meId, toUserId);
    if (existing) throw new HttpError(409, 'invito-esistente', 'Hai già un invito in sospeso per questa persona.');
    const id = randomUUID();
    const now = Date.now();
    run(this.db, `INSERT INTO invites (id, from_user, to_user, board_id, board_version, ruleset_id, ruleset_version, status, rematch_of, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`, id, meId, toUserId, config.boardId, config.boardVersion, config.rulesetId, config.rulesetVersion, rematchOf, now, now + this.opts.inviteMs);
    this.hub.notifyUser(toUserId, { t: 'notify', kind: 'invites' });
    return this.inviteView(id, meId);
  }

  rematch(meId: string, gameId: string) {
    const g = this.games.forParticipant(gameId, meId);
    if (g.status !== 'finished') throw new HttpError(409, 'stato', 'La rivincita è possibile a partita conclusa.');
    const other = g.player0 === meId ? g.player1 : g.player0;
    if (!other) throw new HttpError(409, 'stato', 'Avversario assente.');
    return this.invite(meId, other, { boardId: g.board_id, boardVersion: g.board_version, rulesetId: g.ruleset_id, rulesetVersion: g.ruleset_version } as GameConfig, g.id);
  }

  inviteView(id: string, meId: string) {
    const i = one<Record<string, unknown>>(this.db, `SELECT i.*, a.username AS from_name, b.username AS to_name FROM invites i JOIN users a ON a.id = i.from_user JOIN users b ON b.id = i.to_user WHERE i.id = ?`, id);
    if (!i || (i.from_user !== meId && i.to_user !== meId)) throw new HttpError(404, 'invito', 'Invito non trovato.');
    return {
      id: i.id, status: i.status, from: { id: i.from_user, username: i.from_name }, to: { id: i.to_user, username: i.to_name },
      config: { boardId: i.board_id, boardVersion: i.board_version, rulesetId: i.ruleset_id, rulesetVersion: i.ruleset_version },
      expiresAt: i.expires_at, gameId: i.game_id, rematchOf: i.rematch_of,
    };
  }

  invites(meId: string) {
    this.expireInvites();
    const rows = all<{ id: string }>(this.db, `SELECT id FROM invites WHERE (to_user = ? OR from_user = ?) AND (status = 'pending' OR responded_at > ?) ORDER BY created_at DESC LIMIT 50`, meId, meId, Date.now() - 3600_000);
    const list = rows.map((r) => this.inviteView(r.id, meId));
    return { incoming: list.filter((i) => i.to.id === meId), outgoing: list.filter((i) => i.from.id === meId) };
  }

  respondInvite(meId: string, id: string, accept: boolean) {
    this.expireInvites();
    return tx(this.db, () => {
      const i = one<Record<string, unknown>>(this.db, 'SELECT * FROM invites WHERE id = ?', id);
      if (!i || i.to_user !== meId) throw new HttpError(404, 'invito', 'Invito non trovato.');
      if (i.status === 'accepted' && accept && i.game_id) return { gameId: i.game_id as string };
      if (i.status !== 'pending') throw new HttpError(409, 'invito-' + i.status, i.status === 'expired' ? 'L\'invito è scaduto.' : 'L\'invito non è più valido.');
      const now = Date.now();
      if (!accept) {
        run(this.db, `UPDATE invites SET status = 'declined', responded_at = ? WHERE id = ? AND status = 'pending'`, now, id);
        this.hub.notifyUser(i.from_user as string, { t: 'notify', kind: 'invites' });
        return { gameId: null };
      }
      // Configurazione e versione si bloccano qui: la partita nasce con la configurazione dell'invito.
      const config = { boardId: i.board_id, boardVersion: i.board_version, rulesetId: i.ruleset_id, rulesetVersion: i.ruleset_version } as GameConfig;
      const g = this.games.createOnlineGame({ source: i.rematch_of ? 'rematch' : 'invite', config, player0: i.from_user as string, player1: meId, rematchOf: (i.rematch_of as string) ?? null });
      const r = run(this.db, `UPDATE invites SET status = 'accepted', responded_at = ?, game_id = ? WHERE id = ? AND status = 'pending'`, now, g.id, id);
      if (r.changes !== 1) throw new HttpError(409, 'invito', 'Invito già gestito.');
      this.hub.notifyUser(i.from_user as string, { t: 'notify', kind: 'invite-accepted', gameId: g.id });
      return { gameId: g.id };
    });
  }

  cancelInvite(meId: string, id: string) {
    const r = run(this.db, `UPDATE invites SET status = 'cancelled', responded_at = ? WHERE id = ? AND from_user = ? AND status = 'pending'`, Date.now(), id, meId);
    if (r.changes !== 1) throw new HttpError(404, 'invito', 'Invito non trovato.');
    const i = one<{ to_user: string }>(this.db, 'SELECT to_user FROM invites WHERE id = ?', id)!;
    this.hub.notifyUser(i.to_user, { t: 'notify', kind: 'invites' });
    return { ok: true };
  }

  // ---- Ricerca avversario ----

  joinQueue(meId: string, config: GameConfig) {
    const key = configKey(config);
    return tx(this.db, () => {
      const other = one<{ user_id: string }>(this.db, 'SELECT user_id FROM match_queue WHERE config_key = ? AND user_id != ? ORDER BY created_at LIMIT 1', key, meId);
      if (other) {
        run(this.db, 'DELETE FROM match_queue WHERE user_id IN (?, ?)', other.user_id, meId);
        const g = this.games.createOnlineGame({ source: 'match', config, player0: other.user_id, player1: meId });
        this.hub.notifyUser(other.user_id, { t: 'notify', kind: 'match', gameId: g.id });
        return { status: 'trovato', gameId: g.id };
      }
      run(this.db, `INSERT OR REPLACE INTO match_queue (user_id, config_key, board_id, board_version, ruleset_id, ruleset_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        meId, key, config.boardId, config.boardVersion, config.rulesetId, config.rulesetVersion, Date.now());
      return { status: 'in-coda', gameId: null };
    });
  }

  leaveQueue(meId: string) {
    run(this.db, 'DELETE FROM match_queue WHERE user_id = ?', meId);
    return { ok: true };
  }

  queueStatus(meId: string) {
    const q = one<{ config_key: string; created_at: number }>(this.db, 'SELECT config_key, created_at FROM match_queue WHERE user_id = ?', meId);
    return q ? { status: 'in-coda', configKey: q.config_key, since: q.created_at } : { status: 'nessuna' };
  }

  // ---- Profili e classifiche ----

  profile(meId: string, username: string) {
    const u = this.userByName(username);
    const ratings = all<Record<string, unknown>>(this.db, 'SELECT config_key, category, rating, games, wins, losses FROM ratings WHERE user_id = ? ORDER BY games DESC', u.id);
    const totals = one<{ games: number; wins: number }>(this.db, `SELECT COUNT(*) AS games, SUM(CASE WHEN winner_user = ? THEN 1 ELSE 0 END) AS wins FROM game_results WHERE winner_user = ? OR loser_user = ?`, u.id, u.id, u.id)!;
    const localCount = one<{ n: number }>(this.db, `SELECT COUNT(*) AS n FROM games WHERE mode = 'local' AND created_by = ?`, u.id)!.n;
    const history = all<Record<string, unknown>>(
      this.db,
      `SELECT r.game_id, r.config_key, r.category, r.ranked, r.reason, r.created_at, r.winner_user,
              r.rating_winner_before, r.rating_winner_after, r.rating_loser_before, r.rating_loser_after,
              w.username AS winner_name, l.username AS loser_name
       FROM game_results r LEFT JOIN users w ON w.id = r.winner_user LEFT JOIN users l ON l.id = r.loser_user
       WHERE r.winner_user = ? OR r.loser_user = ? ORDER BY r.created_at DESC LIMIT 30`, u.id, u.id,
    ).map((h) => ({
      gameId: h.game_id, configKey: h.config_key, category: h.category, ranked: !!h.ranked, reason: h.reason, at: h.created_at,
      won: h.winner_user === u.id, opponent: h.winner_user === u.id ? h.loser_name : h.winner_name,
      ratingBefore: h.winner_user === u.id ? h.rating_winner_before : h.rating_loser_before,
      ratingAfter: h.winner_user === u.id ? h.rating_winner_after : h.rating_loser_after,
    }));
    const wins = totals.wins ?? 0;
    return {
      user: { id: u.id, username: u.username },
      isMe: u.id === meId,
      relation: u.id === meId ? null : this.relation(meId, u.id),
      online: this.hub.isOnline(u.id),
      stats: { games: totals.games, wins, losses: totals.games - wins, winRate: totals.games ? wins / totals.games : null, localGames: u.id === meId ? localCount : null },
      ratings,
      history,
    };
  }

  leaderboard(meId: string, key: string, scope: 'globale' | 'amici') {
    const params: unknown[] = [key];
    let filter = '';
    if (scope === 'amici') {
      const ids = [meId, ...this.friends(meId).friends.map((f) => f.id)];
      filter = ` AND r.user_id IN (${ids.map(() => '?').join(',')})`;
      params.push(...ids);
    }
    const rows = all<Record<string, unknown>>(
      this.db,
      `SELECT u.username, r.user_id, r.rating, r.games, r.wins, r.losses, r.category FROM ratings r JOIN users u ON u.id = r.user_id
       WHERE r.config_key = ?${filter} ORDER BY CASE WHEN r.category = 'personalizzata' THEN r.wins ELSE r.rating END DESC, r.wins DESC, u.username_norm LIMIT 100`, ...params,
    );
    return rows.map((r, i) => ({
      rank: i + 1, username: r.username, isMe: r.user_id === meId, rating: r.category === 'personalizzata' ? null : r.rating,
      games: r.games, wins: r.wins, losses: r.losses, winRate: (r.games as number) ? (r.wins as number) / (r.games as number) : 0,
    }));
  }
}
