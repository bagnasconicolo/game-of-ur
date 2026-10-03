// Applicazione HTTP: API JSON, file statici e upgrade WebSocket. Nessun framework: router minimale.

import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { openDb, type DB } from './db.ts';
import { AuthError, RateLimiter, checkCredentials, createSession, destroySession, register, userFromToken, type PublicUser } from './auth.ts';
import { GameService, HttpError, parseConfig } from './games.ts';
import { SocialService } from './social.ts';
import { LocalService } from './local.ts';
import { RealtimeHub } from './realtime.ts';
import { BOARDS, COMPATIBILITY, RULESETS, ROUTES, RULE_MARKS, DECORATIONS, DICE_SYSTEMS } from '../engine/index.ts';

export interface AppOptions {
  dbPath: string;
  port: number;
  host?: string;
  staticDir?: string | null;
  cookieSecure?: boolean;
  allowedOrigins?: string[];
  turnSeconds?: number;
  inviteSeconds?: number;
  sweepMs?: number;
  rand?: (n: number) => number;
}

const COOKIE = 'ur_sess';
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.ico': 'image/x-icon',
};

function parseCookies(h: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (h ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 256 * 1024) throw new HttpError(413, 'troppo-grande', 'Richiesta troppo grande.');
    chunks.push(c as Buffer);
  }
  if (!chunks.length) return {};
  try {
    const v = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return v && typeof v === 'object' ? v : {};
  } catch {
    throw new HttpError(400, 'json', 'JSON non valido.');
  }
}

type Handler = (ctx: Ctx) => unknown | Promise<unknown>;
interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  params: Record<string, string>;
  query: URLSearchParams;
  body: Record<string, unknown>;
  user: PublicUser | null;
  token: string | undefined;
  me(): PublicUser;
  ip: string;
}

export function createApp(opts: AppOptions) {
  const db: DB = openDb(opts.dbPath);
  const hub = new RealtimeHub();
  const games = new GameService(db, hub, { turnMs: (opts.turnSeconds ?? 120) * 1000, rand: opts.rand });
  const social = new SocialService(db, hub, games, { inviteMs: (opts.inviteSeconds ?? 600) * 1000 });
  const local = new LocalService(db);
  const loginLimiter = new RateLimiter(10, 10 * 60 * 1000);
  const verifyLimiter = new RateLimiter(10, 10 * 60 * 1000);
  const registerLimiter = new RateLimiter(20, 60 * 60 * 1000);

  const routes: { method: string; re: RegExp; keys: string[]; h: Handler }[] = [];
  const route = (method: string, path: string, h: Handler) => {
    const keys: string[] = [];
    const re = new RegExp('^' + path.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$');
    routes.push({ method, re, keys, h });
  };

  const setSession = (res: ServerResponse, token: string | null) => {
    const secure = opts.cookieSecure ? '; Secure' : '';
    res.setHeader('Set-Cookie', token
      ? `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${30 * 24 * 3600}${secure}`
      : `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`);
  };

  const originAllowed = (req: IncomingMessage) => {
    const origin = req.headers.origin;
    if (!origin) return true;
    if (opts.allowedOrigins?.includes(origin)) return true;
    try {
      return new URL(origin).host === req.headers.host;
    } catch {
      return false;
    }
  };

  // ---------- Configurazioni statiche ----------
  route('GET', '/api/health', () => ({ ok: true, time: Date.now() }));
  route('GET', '/api/catalog', () => ({ boards: BOARDS, rulesets: RULESETS, compatibility: COMPATIBILITY, routes: ROUTES, ruleMarks: RULE_MARKS, decorations: DECORATIONS, dice: DICE_SYSTEMS }));

  // ---------- Autenticazione ----------
  route('POST', '/api/auth/register', (c) => {
    if (!registerLimiter.check(c.ip)) throw new HttpError(429, 'limite', 'Troppe registrazioni da questo indirizzo: riprova più tardi.');
    const u = register(db, c.body.username, c.body.password);
    setSession(c.res, createSession(db, u.id));
    return { user: u };
  });
  route('POST', '/api/auth/login', (c) => {
    const key = `${c.ip}|${String(c.body.username ?? '').toLowerCase()}`;
    if (!loginLimiter.check(key)) throw new HttpError(429, 'limite', 'Troppi tentativi: riprova fra qualche minuto.');
    const u = checkCredentials(db, c.body.username, c.body.password);
    setSession(c.res, createSession(db, u.id));
    return { user: u };
  });
  route('POST', '/api/auth/logout', (c) => {
    destroySession(db, c.token);
    setSession(c.res, null);
    return { ok: true };
  });
  route('GET', '/api/me', (c) => ({ user: c.user }));

  // ---------- Utenti e amici ----------
  route('GET', '/api/users/search', (c) => ({ users: social.search(c.me().id, c.query.get('q') ?? '') }));
  route('GET', '/api/users/:username', (c) => social.profile(c.me().id, c.params.username));
  route('GET', '/api/friends', (c) => social.friends(c.me().id));
  route('POST', '/api/friends/request', (c) => social.requestFriend(c.me().id, String(c.body.username ?? '')));
  route('POST', '/api/friends/respond', (c) => social.respondFriend(c.me().id, String(c.body.userId ?? ''), c.body.accept === true));
  route('DELETE', '/api/friends/:userId', (c) => social.removeFriend(c.me().id, c.params.userId));

  // ---------- Inviti, stanze, ricerca avversario ----------
  route('GET', '/api/invites', (c) => social.invites(c.me().id));
  route('POST', '/api/invites', (c) => social.invite(c.me().id, String(c.body.toUserId ?? ''), parseConfig(c.body)));
  route('POST', '/api/invites/:id/accept', (c) => social.respondInvite(c.me().id, c.params.id, true));
  route('POST', '/api/invites/:id/decline', (c) => social.respondInvite(c.me().id, c.params.id, false));
  route('POST', '/api/invites/:id/cancel', (c) => social.cancelInvite(c.me().id, c.params.id));
  route('POST', '/api/rooms', (c) => {
    const g = games.createOnlineGame({ source: 'room', config: parseConfig(c.body), player0: c.me().id, player1: null, roomCode: games.newRoomCode() });
    return { gameId: g.id, roomCode: g.room_code };
  });
  route('POST', '/api/rooms/join', (c) => ({ gameId: games.joinRoom(c.me().id, String(c.body.code ?? '')).id }));
  route('GET', '/api/match', (c) => social.queueStatus(c.me().id));
  route('POST', '/api/match', (c) => social.joinQueue(c.me().id, parseConfig(c.body)));
  route('DELETE', '/api/match', (c) => social.leaveQueue(c.me().id));

  // ---------- Partite online ----------
  route('GET', '/api/games/open', (c) => ({ games: games.listOpen(c.me().id) }));
  route('GET', '/api/games/:id', (c) => games.snapshot(games.forParticipant(c.params.id, c.me().id), c.me().id));
  route('GET', '/api/games/:id/events', (c) => ({ events: games.events(c.me().id, c.params.id) }));
  route('POST', '/api/games/:id/action', (c) => games.act(c.me().id, c.params.id, c.body));
  route('POST', '/api/games/:id/resign', (c) => games.resign(c.me().id, c.params.id));
  route('POST', '/api/games/:id/cancel', (c) => (games.cancelWaiting(c.me().id, c.params.id), { ok: true }));
  route('POST', '/api/games/:id/rematch', (c) => social.rematch(c.me().id, c.params.id));

  // ---------- Partite locali (utenti autenticati) ----------
  route('POST', '/api/local/verify', (c) => {
    if (!verifyLimiter.check(`${c.ip}|${c.me().id}`)) throw new HttpError(429, 'limite', 'Troppi tentativi di verifica.');
    return local.verifySecondPlayer(c.me().id, c.body.username, c.body.password);
  });
  route('GET', '/api/local/games', (c) => ({ games: local.list(c.me().id) }));
  route('POST', '/api/local/games', (c) => local.create(c.me().id, c.me().username, parseConfig(c.body), c.body.seats));
  route('GET', '/api/local/games/:id', (c) => local.view(local.get(c.me().id, c.params.id)));
  route('POST', '/api/local/games/:id/sync', (c) => local.sync(c.me().id, c.params.id, c.body.fromVersion, c.body.actions));
  route('DELETE', '/api/local/games/:id', (c) => local.remove(c.me().id, c.params.id));

  // ---------- Leaderboard ----------
  route('GET', '/api/leaderboard', (c) => {
    const scope = c.query.get('scope') === 'amici' ? 'amici' : 'globale';
    return { configKey: c.query.get('config') ?? '', scope, rows: social.leaderboard(c.me().id, c.query.get('config') ?? '', scope) };
  });

  // ---------- Realtime ----------
  hub.onMessage = (userId, msg, reply, conn) => {
    try {
      if (msg.t === 'watch' && typeof msg.gameId === 'string') {
        const g = games.forParticipant(msg.gameId, userId);
        conn.watch(g.id);
        games.onWatch(userId, g.id);
        reply({ t: 'game', game: games.snapshot(games.row(g.id)!, userId), events: [] });
      } else if (msg.t === 'unwatch' && typeof msg.gameId === 'string') {
        conn.unwatch(msg.gameId);
      } else if (msg.t === 'action' && typeof msg.gameId === 'string') {
        const r = games.act(userId, msg.gameId, msg as never);
        reply({ t: 'ack', actionId: msg.actionId, duplicate: r.duplicate, game: r.snapshot, events: r.events });
      } else {
        reply({ t: 'error', code: 'messaggio', message: 'Messaggio sconosciuto.' });
      }
    } catch (e) {
      const he = e instanceof HttpError ? e : null;
      reply({ t: 'error', actionId: msg.actionId, code: he?.code ?? 'errore', message: he?.message ?? 'Errore interno.', ...(he?.extra ?? {}) });
      if (!he) console.error(e);
    }
  };
  hub.onPresence = (userId) => {
    for (const f of social.friends(userId).friends) hub.notifyUser(f.id, { t: 'notify', kind: 'presence' });
  };

  // ---------- Statici ----------
  const staticRoot = opts.staticDir ? resolve(opts.staticDir) : null;
  async function serveStatic(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    if (!staticRoot || (req.method !== 'GET' && req.method !== 'HEAD')) return false;
    const url = new URL(req.url ?? '/', 'http://x');
    let p = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
    let file = join(staticRoot, p);
    if (!file.startsWith(staticRoot)) return false;
    try {
      const st = await stat(file);
      if (st.isDirectory()) file = join(file, 'index.html');
    } catch {
      file = join(staticRoot, 'index.html');
      p = '/index.html';
    }
    try {
      const data = await readFile(file);
      res.writeHead(200, {
        'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
        'Cache-Control': file.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
      });
      res.end(req.method === 'HEAD' ? undefined : data);
      return true;
    } catch {
      return false;
    }
  }

  const securityHeaders = (res: ServerResponse) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self' ws: wss:; script-src 'self'; worker-src 'self' blob:");
  };

  const server: Server = createServer(async (req, res) => {
    securityHeaders(res);
    const url = new URL(req.url ?? '/', 'http://x');
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    if (!url.pathname.startsWith('/api/')) {
      if (await serveStatic(req, res)) return;
      return send(404, { error: 'non-trovato', message: 'Risorsa non trovata.' });
    }
    try {
      const method = req.method ?? 'GET';
      if (method !== 'GET') {
        // Difesa CSRF: richiesta JSON con intestazione dedicata e origine coerente.
        if (req.headers['x-ur-client'] !== '1' || !originAllowed(req)) throw new HttpError(403, 'origine', 'Richiesta non consentita.');
      }
      const r = routes.find((x) => x.method === method && x.re.test(url.pathname));
      if (!r) throw new HttpError(404, 'non-trovato', 'Endpoint inesistente.');
      const m = url.pathname.match(r.re)!;
      const params: Record<string, string> = {};
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
      const token = parseCookies(req.headers.cookie)[COOKIE];
      const user = userFromToken(db, token);
      const body = method === 'GET' ? {} : await readJson(req);
      const ctx: Ctx = {
        req, res, params, query: url.searchParams, body, user, token,
        ip: req.socket.remoteAddress ?? '?',
        me() {
          if (!user) throw new HttpError(401, 'non-autenticato', 'Accedi per continuare.');
          return user;
        },
      };
      const out = await r.h(ctx);
      send(200, out ?? { ok: true });
    } catch (e) {
      if (e instanceof HttpError || e instanceof AuthError) {
        send(e.status, { error: e.code, message: e.message, ...((e as HttpError).extra ?? {}) });
      } else {
        console.error(e);
        send(500, { error: 'interno', message: 'Errore interno del server.' });
      }
    }
  });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname !== '/ws' || !originAllowed(req)) return socket.destroy();
    const user = userFromToken(db, parseCookies(req.headers.cookie)[COOKIE]);
    if (!user) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      return socket.destroy();
    }
    hub.handleUpgrade(req, socket, head, user.id);
  });

  const sweeper = setInterval(() => {
    try {
      games.sweep();
      social.expireInvites();
    } catch (e) {
      console.error('sweep', e);
    }
  }, opts.sweepMs ?? 5000);
  sweeper.unref();

  return {
    server, db, hub, games, social, local,
    listen(): Promise<number> {
      return new Promise((ok) => server.listen(opts.port, opts.host ?? '127.0.0.1', () => ok((server.address() as { port: number }).port)));
    },
    async close() {
      clearInterval(sweeper);
      hub.close();
      await new Promise<void>((ok) => server.close(() => ok()));
      server.closeAllConnections?.();
      db.close();
    },
  };
}
