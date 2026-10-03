import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startApp, Client, aid } from './helpers.ts';
import { DatabaseSync } from 'node:sqlite';

const CFG_A = { boardId: 'ur-iii', boardVersion: 1, rulesetId: 'moderno', rulesetVersion: 1 };
const CFG_B = { boardId: 'tarda', boardVersion: 1, rulesetId: 'finkel-sperimentale', rulesetVersion: 1 };

let ctx: Awaited<ReturnType<typeof startApp>>;
let alice: Client, bob: Client, carol: Client;

beforeAll(async () => {
  ctx = await startApp();
  alice = new Client(ctx.base);
  bob = new Client(ctx.base);
  carol = new Client(ctx.base);
  expect((await alice.post('/api/auth/register', { username: 'Alice', password: 'segreto-alice' })).status).toBe(200);
  expect((await bob.post('/api/auth/register', { username: 'bob_92', password: 'segreto-bob!' })).status).toBe(200);
  expect((await carol.post('/api/auth/register', { username: 'carol', password: 'segreto-carol' })).status).toBe(200);
});
afterAll(async () => ctx.app.close());

/** Gioca con azioni legali fino alla fine, alternando i client in base al turno. */
async function playToEnd(gameId: string, seats: Record<number, Client>, maxSteps = 4000) {
  let snap = (await seats[0].get(`/api/games/${gameId}`)).body;
  for (let i = 0; i < maxSteps && snap.status === 'active'; i++) {
    const who = seats[snap.state.turn];
    const av = snap.available;
    let action: any;
    if (av.roll) action = { type: 'roll' };
    else if (av.moves.length) action = { type: 'move', pieceId: av.moves[0].pieceId, to: av.moves[0].to };
    else if (av.convert) action = { type: 'convert' };
    else action = { type: 'pass' };
    const r = await who.post(`/api/games/${gameId}/action`, { actionId: aid(), expectedVersion: snap.state.version, action });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    snap = r.body.snapshot;
  }
  return snap;
}

describe('autenticazione', () => {
  it('username univoco, senza distinzione di maiuscole', async () => {
    const r = await new Client(ctx.base).post('/api/auth/register', { username: 'alice', password: 'altra-password' });
    expect(r.status).toBe(409);
  });
  it('password errata rifiutata, nessuna sessione', async () => {
    const c = new Client(ctx.base);
    expect((await c.post('/api/auth/login', { username: 'Alice', password: 'sbagliata!!' })).status).toBe(401);
    expect((await c.get('/api/me')).body.user).toBeNull();
  });
  it('login, sessione persistente e logout', async () => {
    const c = new Client(ctx.base);
    expect((await c.post('/api/auth/login', { username: 'ALICE', password: 'segreto-alice' })).status).toBe(200);
    const me = (await c.get('/api/me')).body.user;
    expect(me.username).toBe('Alice');
    expect(me.id).not.toBe('Alice');
    await c.post('/api/auth/logout');
    expect((await c.get('/api/me')).body.user).toBeNull();
  });
  it('le password sono salvate come hash scrypt e le sessioni come hash', async () => {
    const db = ctx.app.db;
    const row = db.prepare("SELECT password_hash FROM users WHERE username_norm = 'alice'").get() as any;
    expect(row.password_hash.startsWith('scrypt$')).toBe(true);
    expect(row.password_hash).not.toContain('segreto');
    const tok = alice.cookie.split('=')[1];
    expect(db.prepare('SELECT 1 FROM sessions WHERE token_hash = ?').get(tok)).toBeUndefined();
  });
  it('richieste senza intestazione anti-CSRF o con origine estranea sono rifiutate', async () => {
    const r1 = await alice.req('POST', '/api/friends/request', { username: 'bob_92' }, { 'x-ur-client': '0' });
    expect(r1.status).toBe(403);
    const r2 = await alice.req('POST', '/api/friends/request', { username: 'bob_92' }, { origin: 'https://evil.example' });
    expect(r2.status).toBe(403);
  });
  it('API protette senza sessione rispondono 401', async () => {
    expect((await new Client(ctx.base).get('/api/friends')).status).toBe(401);
  });
});

describe('amicizie', () => {
  it('ricerca, richiesta, rifiuto, nuova richiesta, accettazione e rimozione', async () => {
    const s = await alice.get('/api/users/search?q=bo');
    expect(s.body.users.map((u: any) => u.username)).toEqual(['bob_92']);
    const bobId = s.body.users[0].id;
    expect((await alice.post('/api/friends/request', { username: 'bob_92' })).body.status).toBe('richiesta-inviata');
    const inc = (await bob.get('/api/friends')).body.incoming;
    expect(inc[0].username).toBe('Alice');
    await bob.post('/api/friends/respond', { userId: inc[0].id, accept: false });
    expect((await alice.get('/api/friends')).body.outgoing).toHaveLength(0);
    await alice.post('/api/friends/request', { username: 'bob_92' });
    await bob.post('/api/friends/respond', { userId: inc[0].id, accept: true });
    expect((await alice.get('/api/friends')).body.friends.map((f: any) => f.username)).toEqual(['bob_92']);
    // rimozione e ripristino
    await alice.del(`/api/friends/${bobId}`);
    expect((await bob.get('/api/friends')).body.friends).toHaveLength(0);
    await alice.post('/api/friends/request', { username: 'bob_92' });
    await bob.post('/api/friends/request', { username: 'Alice' }); // richiesta reciproca = accettazione
    expect((await bob.get('/api/friends')).body.friends).toHaveLength(1);
  });
  it('disponibilità online tramite WebSocket', async () => {
    const ws = await bob.ws();
    await ws.wait((m) => m.t === 'hello');
    const f = (await alice.get('/api/friends')).body.friends[0];
    expect(f.online).toBe(true);
    ws.close();
    await new Promise((r) => setTimeout(r, 150));
    expect((await alice.get('/api/friends')).body.friends[0].online).toBe(false);
  });
  it('non si può invitare chi non è amico', async () => {
    const carolId = (await alice.get('/api/users/search?q=car')).body.users[0].id;
    expect((await alice.post('/api/invites', { toUserId: carolId, ...CFG_A })).status).toBe(403);
  });
});

describe('invito, partita completa, classifica', () => {
  let gameId: string;
  let bobId: string;

  it('invito → rifiuto; invito → accettazione con configurazione bloccata', async () => {
    bobId = (await alice.get('/api/users/search?q=bob')).body.users[0].id;
    const inv1 = (await alice.post('/api/invites', { toUserId: bobId, ...CFG_A })).body;
    expect(inv1.status).toBe('pending');
    expect((await bob.post(`/api/invites/${inv1.id}/decline`)).status).toBe(200);
    expect((await bob.post(`/api/invites/${inv1.id}/accept`)).status).toBe(409);
    const inv2 = (await alice.post('/api/invites', { toUserId: bobId, ...CFG_A })).body;
    // carol non può accettare un invito non suo
    expect((await carol.post(`/api/invites/${inv2.id}/accept`)).status).toBe(404);
    const acc = await bob.post(`/api/invites/${inv2.id}/accept`);
    gameId = acc.body.gameId;
    expect(gameId).toBeTruthy();
    // doppia accettazione: stessa partita, nessun duplicato
    expect((await bob.post(`/api/invites/${inv2.id}/accept`)).body.gameId).toBe(gameId);
    const snap = (await alice.get(`/api/games/${gameId}`)).body;
    expect(snap.config).toEqual(CFG_A);
    expect(snap.status).toBe('active');
    expect(snap.category).toBe('competitiva');
  });

  it('isolamento: un estraneo non vede né gioca la partita', async () => {
    expect((await carol.get(`/api/games/${gameId}`)).status).toBe(404);
    expect((await carol.post(`/api/games/${gameId}/action`, { actionId: aid(), expectedVersion: 0, action: { type: 'roll' } })).status).toBe(404);
    expect((await carol.get(`/api/games/${gameId}/events`)).status).toBe(404);
  });

  it('turni, versioni e azioni duplicate', async () => {
    const snap = (await alice.get(`/api/games/${gameId}`)).body;
    const onTurn = snap.state.turn === snap.yourSeat ? alice : bob;
    const offTurn = onTurn === alice ? bob : alice;
    expect((await offTurn.post(`/api/games/${gameId}/action`, { actionId: aid(), expectedVersion: 0, action: { type: 'roll' } })).status).toBe(403);
    // il client non può imporre l'esito dei dadi
    const id = aid();
    const r1 = await onTurn.post(`/api/games/${gameId}/action`, { actionId: id, expectedVersion: 0, action: { type: 'roll', dice: [1, 1, 1, 1] } });
    expect(r1.status).toBe(200);
    const r2 = await onTurn.post(`/api/games/${gameId}/action`, { actionId: id, expectedVersion: 0, action: { type: 'roll' } });
    expect(r2.body.duplicate).toBe(true);
    expect(r2.body.snapshot.state.version).toBe(1);
    // versione superata
    const r3 = await onTurn.post(`/api/games/${gameId}/action`, { actionId: aid(), expectedVersion: 0, action: { type: 'roll' } });
    expect(r3.status).toBe(409);
    expect(r3.body.error).toBe('versione');
    expect(r3.body.snapshot.state.version).toBe(1);
    const n = ctx.app.db.prepare('SELECT COUNT(*) AS n FROM game_events WHERE game_id = ?').get(gameId) as any;
    expect(n.n).toBe(1);
  });

  it('mosse concorrenti: due richieste con la stessa versione → una sola applicata', async () => {
    const snap = (await alice.get(`/api/games/${gameId}`)).body;
    const onTurn = snap.state.turn === snap.yourSeat ? alice : bob;
    const v = snap.state.version;
    const action = snap.available.roll ? { type: 'roll' } : { type: 'move', pieceId: snap.available.moves[0].pieceId, to: snap.available.moves[0].to };
    const [a, b] = await Promise.all([
      onTurn.post(`/api/games/${gameId}/action`, { actionId: aid(), expectedVersion: v, action }),
      onTurn.post(`/api/games/${gameId}/action`, { actionId: aid(), expectedVersion: v, action }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
  });

  it('mossa illegale spiegata', async () => {
    const snap = (await alice.get(`/api/games/${gameId}`)).body;
    const onTurn = snap.state.turn === snap.yourSeat ? alice : bob;
    if (snap.available.roll) {
      const r = await onTurn.post(`/api/games/${gameId}/action`, { actionId: aid(), expectedVersion: snap.state.version, action: { type: 'move', pieceId: `p${snap.state.turn}-0`, to: 3 } });
      expect(r.status).toBe(422);
      expect(r.body.message).toMatch(/lanciare/);
    }
  });

  it('partita completa fino alla fine e classifica aggiornata una sola volta', async () => {
    const seat = (await alice.get(`/api/games/${gameId}`)).body.yourSeat;
    const seats = seat === 0 ? { 0: alice, 1: bob } : { 0: bob, 1: alice };
    const final = await playToEnd(gameId, seats);
    expect(final.status).toBe('finished');
    expect(final.result).toBeTruthy();
    const winnerName = final.players[final.state.winner].username;
    // un'azione dopo la fine è rifiutata
    expect((await alice.post(`/api/games/${gameId}/action`, { actionId: aid(), expectedVersion: final.state.version, action: { type: 'roll' } })).status).toBe(409);
    // risultato unico e statistiche atomiche
    ctx.app.games.recordResult(ctx.app.games.row(gameId)!, final.state.winner, 'doppio');
    const results = ctx.app.db.prepare('SELECT COUNT(*) AS n FROM game_results WHERE game_id = ?').get(gameId) as any;
    expect(results.n).toBe(1);
    const lb = (await alice.get(`/api/leaderboard?config=${encodeURIComponent(final.configKey)}`)).body.rows;
    expect(lb).toHaveLength(2);
    expect(lb[0].username).toBe(winnerName);
    expect(lb[0].rating).toBe(1216);
    expect(lb[1].rating).toBe(1184);
    expect(lb[0].wins + lb[1].wins).toBe(1);
    const prof = (await carol.get('/api/users/Alice')).body;
    expect(prof.stats.games).toBe(1);
    expect(prof.history[0].ranked).toBe(true);
    // classifica fra amici di carol: solo carol (nessuna partita) → vuota
    expect((await carol.get(`/api/leaderboard?config=${encodeURIComponent(final.configKey)}&scope=amici`)).body.rows).toHaveLength(0);
  });

  it('rivincita con la stessa configurazione', async () => {
    const inv = (await bob.post(`/api/games/${gameId}/rematch`)).body;
    expect(inv.rematchOf).toBe(gameId);
    const g2 = (await alice.post(`/api/invites/${inv.id}/accept`)).body.gameId;
    const s = (await alice.get(`/api/games/${g2}`)).body;
    expect(s.rematchOf).toBe(gameId);
    expect(s.config).toEqual(CFG_A);
    await alice.post(`/api/games/${g2}/resign`);
    const after = (await bob.get(`/api/games/${g2}`)).body;
    expect(after.status).toBe('finished');
    expect(after.players[after.state.winner].username).toBe('bob_92');
    expect(after.result.reason).toBe('resa');
  });
});

describe('stanze private e ricerca avversario', () => {
  it('il codice stanza trova la partita ma non permette di assumere un posto occupato', async () => {
    const room = (await alice.post('/api/rooms', CFG_B)).body;
    expect(room.roomCode).toMatch(/^[A-Z2-9]{6}$/);
    const join = await carol.post('/api/rooms/join', { code: room.roomCode.toLowerCase() });
    expect(join.body.gameId).toBe(room.gameId);
    const third = new Client(ctx.base);
    await third.post('/api/auth/register', { username: 'dario', password: 'segreto-dario' });
    expect((await third.post('/api/rooms/join', { code: room.roomCode })).status).toBe(409);
    expect((await third.get(`/api/games/${room.gameId}`)).status).toBe(404);
    const s = (await carol.get(`/api/games/${room.gameId}`)).body;
    expect(s.category).toBe('sperimentale');
    expect(s.state.startRolls.length).toBeGreaterThan(0);
    // regolamento avanzato: conversione estratta dal server
    const onTurn = s.state.turn === s.yourSeat ? carol : alice;
    let r = await onTurn.post(`/api/games/${room.gameId}/action`, { actionId: aid(), expectedVersion: 0, action: { type: 'roll' } });
    expect(r.body.snapshot.state.phase).toBe('decide');
    r = await onTurn.post(`/api/games/${room.gameId}/action`, { actionId: aid(), expectedVersion: 1, action: { type: 'convert', yes: 1 } });
    expect(r.status).toBe(200);
    expect([0, 1]).toContain(r.body.snapshot.state.roll?.converted ?? r.body.events.find((e: any) => e.type === 'converted')?.yes);
  });
  it('ricerca avversario abbina due utenti con la stessa configurazione', async () => {
    expect((await alice.post('/api/match', CFG_A)).body.status).toBe('in-coda');
    expect((await alice.get('/api/match')).body.status).toBe('in-coda');
    const r = (await carol.post('/api/match', CFG_A)).body;
    expect(r.status).toBe('trovato');
    expect((await alice.get(`/api/games/${r.gameId}`)).body.status).toBe('active');
    expect((await alice.get('/api/match')).body.status).toBe('nessuna');
  });
  it('partita avanzata completa via API con lanci del server', async () => {
    const room = (await bob.post('/api/rooms', CFG_B)).body;
    await carol.post('/api/rooms/join', { code: room.roomCode });
    const s = (await bob.get(`/api/games/${room.gameId}`)).body;
    const seats = s.yourSeat === 0 ? { 0: bob, 1: carol } : { 0: carol, 1: bob };
    const final = await playToEnd(room.gameId, seats, 8000);
    expect(final.status).toBe('finished');
    expect(final.state.counters[0] + final.state.counters[1] + final.state.pool).toBe(50);
  });
});

describe('WebSocket: sincronizzazione, riconnessione, duplicati', () => {
  it('azione via WS, notifica all\'avversario, riconnessione con stato completo', async () => {
    const room = (await alice.post('/api/rooms', CFG_A)).body;
    await bob.post('/api/rooms/join', { code: room.roomCode });
    const wa = await alice.ws();
    const wb = await bob.ws();
    wa.send({ t: 'watch', gameId: room.gameId });
    wb.send({ t: 'watch', gameId: room.gameId });
    const first = await wa.wait((m) => m.t === 'game');
    await wb.wait((m) => m.t === 'game');
    const turnClient = first.game.state.turn === first.game.yourSeat ? wa : wb;
    const other = turnClient === wa ? wb : wa;
    const id = aid();
    turnClient.send({ t: 'action', gameId: room.gameId, actionId: id, expectedVersion: 0, action: { type: 'roll' } });
    const ack = await turnClient.wait((m) => m.t === 'ack' && m.actionId === id);
    expect(ack.duplicate).toBe(false);
    const push = await other.wait((m) => m.t === 'game' && m.game.state.version === 1);
    expect(push.events[0].type).toBe('rolled');
    // duplicato via WS dopo "perdita" della risposta
    turnClient.send({ t: 'action', gameId: room.gameId, actionId: id, expectedVersion: 0, action: { type: 'roll' } });
    const ack2 = await turnClient.wait((m) => m.t === 'ack' && m.actionId === id);
    expect(ack2.duplicate).toBe(true);
    expect(ack2.game.state.version).toBe(1);
    // riconnessione
    other.close();
    const again = await (turnClient === wa ? bob : alice).ws();
    again.send({ t: 'watch', gameId: room.gameId });
    const restored = await again.wait((m) => m.t === 'game');
    expect(restored.game.state.version).toBe(1);
    // un estraneo non può osservare
    const wc = await carol.ws();
    wc.send({ t: 'watch', gameId: room.gameId });
    const err = await wc.wait((m) => m.t === 'error');
    expect(err.code).toBe('non-trovata');
    wa.close(); wb.close(); again.close(); wc.close();
  });
  it('WebSocket senza sessione rifiutato', async () => {
    await expect(new Client(ctx.base).ws()).rejects.toThrow();
  });
});

describe('partite locali (stesso dispositivo)', () => {
  it('verifica del secondo giocatore senza sostituire la sessione del primo', async () => {
    const v = await alice.post('/api/local/verify', { username: 'bob_92', password: 'segreto-bob!' });
    expect(v.status).toBe(200);
    expect((await alice.get('/api/me')).body.user.username).toBe('Alice');
    expect((await alice.post('/api/local/verify', { username: 'bob_92', password: 'sbagliata' })).status).toBe(401);
    const g = await alice.post('/api/local/games', { ...CFG_A, seats: [{ type: 'host' }, { type: 'verified', attestation: v.body.attestation }] });
    expect(g.status).toBe(200);
    expect(g.body.seats[1]).toMatchObject({ name: 'bob_92', verified: true });
    // l'attestazione non è riutilizzabile
    expect((await alice.post('/api/local/games', { ...CFG_A, seats: [{ type: 'host' }, { type: 'verified', attestation: v.body.attestation }] })).status).toBe(403);
    // un amico scelto dalla lista resta non verificato
    const bobId = (await alice.get('/api/users/search?q=bob')).body.users[0].id;
    const g2 = await alice.post('/api/local/games', { ...CFG_A, seats: [{ type: 'friend-unverified', userId: bobId }, { type: 'host' }] });
    expect(g2.body.seats[0]).toMatchObject({ verified: false, userId: null });
  });
  it('salvataggio e ripresa: il server ri-applica le azioni con il motore', async () => {
    const g = (await alice.post('/api/local/games', { ...CFG_A, seats: [{ type: 'host' }, { type: 'guest', name: 'Zia Ada' }] })).body;
    expect(g.category).toBe('locale');
    const s = await alice.post(`/api/local/games/${g.id}/sync`, { fromVersion: 0, actions: [{ type: 'roll', dice: [1, 0, 1, 0] }] });
    expect(s.status).toBe(200);
    expect(s.body.state.version).toBe(1);
    const bad = await alice.post(`/api/local/games/${g.id}/sync`, { fromVersion: 1, actions: [{ type: 'roll', dice: [1, 0, 1, 0] }] });
    expect(bad.status).toBe(422);
    const stale = await alice.post(`/api/local/games/${g.id}/sync`, { fromVersion: 0, actions: [] });
    expect(stale.status).toBe(409);
    const list = (await alice.get('/api/local/games')).body.games;
    expect(list.find((x: any) => x.id === g.id).state.version).toBe(1);
    // isolamento
    expect((await bob.get(`/api/local/games/${g.id}`)).status).toBe(404);
    // le partite locali non entrano nelle classifiche
    const n = ctx.app.db.prepare("SELECT COUNT(*) AS n FROM game_results r JOIN games g ON g.id = r.game_id WHERE g.mode = 'local'").get() as any;
    expect(n.n).toBe(0);
  });
});

describe('esito dei dadi deciso solo dal server', () => {
  it('i dadi inviati dal client sono ignorati', async () => {
    const t = await startApp({ rand: () => 0 });
    const a = new Client(t.base), b = new Client(t.base);
    await a.post('/api/auth/register', { username: 'primo', password: 'password-1' });
    await b.post('/api/auth/register', { username: 'secondo', password: 'password-2' });
    const room = (await a.post('/api/rooms', CFG_A)).body;
    await b.post('/api/rooms/join', { code: room.roomCode });
    const s = (await a.get(`/api/games/${room.gameId}`)).body;
    const onTurn = s.state.turn === s.yourSeat ? a : b;
    const r = await onTurn.post(`/api/games/${room.gameId}/action`, { actionId: aid(), expectedVersion: 0, action: { type: 'roll', dice: [1, 1, 1, 1] } });
    const rolled = r.body.events.find((e: any) => e.type === 'rolled');
    expect(rolled.dice).toEqual([0, 0, 0, 0]);
    expect(rolled.value).toBe(0);
    await t.app.close();
  });
});

describe('politica del tempo', () => {
  it('turno scaduto con avversario collegato = sconfitta per tempo; senza = pausa', async () => {
    const t = await startApp({ turnSeconds: 0.3 });
    const a = new Client(t.base), b = new Client(t.base);
    await a.post('/api/auth/register', { username: 'tizio', password: 'password-1' });
    await b.post('/api/auth/register', { username: 'caio', password: 'password-2' });
    // nessuno collegato: pausa
    const r1 = (await a.post('/api/rooms', CFG_A)).body;
    await b.post('/api/rooms/join', { code: r1.roomCode });
    await new Promise((r) => setTimeout(r, 900));
    const p = (await a.get(`/api/games/${r1.gameId}`)).body;
    expect(p.status).toBe('active');
    expect(p.turnDeadline).toBeNull();
    // entrambi collegati: chi è di turno perde
    const wa = await a.ws(), wb = await b.ws();
    wa.send({ t: 'watch', gameId: r1.gameId });
    wb.send({ t: 'watch', gameId: r1.gameId });
    await new Promise((r) => setTimeout(r, 1200));
    const f = (await a.get(`/api/games/${r1.gameId}`)).body;
    expect(f.status).toBe('finished');
    expect(f.result.reason).toBe('tempo-scaduto');
    wa.close(); wb.close();
    await t.app.close();
  });
});
