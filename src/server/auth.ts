// Autenticazione: hash scrypt delle password, sessioni opache con token casuale (solo l'hash è salvato).

import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { one, run, type DB } from './db.ts';

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
export const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;
export const USERNAME_RE = /^[A-Za-z0-9_.-]{3,20}$/;

export interface PublicUser {
  id: string;
  username: string;
}

export function normalizeUsername(u: string): string {
  return u.normalize('NFKC').toLowerCase();
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [alg, n, r, p, saltB64, hashB64] = stored.split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(hashB64, 'base64');
  const got = scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length, { N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024 });
  return got.length === expected.length && timingSafeEqual(got, expected);
}

// Hash fittizio per uniformare i tempi di risposta quando l'utente non esiste.
const DUMMY_HASH = hashPassword('utente-inesistente-' + randomUUID());

export function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

export class AuthError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function validateCredentials(username: unknown, password: unknown): { username: string; password: string } {
  if (typeof username !== 'string' || !USERNAME_RE.test(username)) {
    throw new AuthError(400, 'username', 'Lo username deve avere 3–20 caratteri: lettere, cifre, punto, trattino o trattino basso.');
  }
  if (typeof password !== 'string' || password.length < 8 || password.length > 200) {
    throw new AuthError(400, 'password', 'La password deve avere almeno 8 caratteri.');
  }
  return { username, password };
}

export function register(db: DB, username: unknown, password: unknown): PublicUser {
  const c = validateCredentials(username, password);
  const norm = normalizeUsername(c.username);
  if (one(db, 'SELECT 1 FROM users WHERE username_norm = ?', norm)) throw new AuthError(409, 'username-preso', 'Questo username è già in uso.');
  const id = randomUUID();
  try {
    run(db, 'INSERT INTO users (id, username, username_norm, password_hash, created_at) VALUES (?, ?, ?, ?, ?)', id, c.username, norm, hashPassword(c.password), Date.now());
  } catch {
    throw new AuthError(409, 'username-preso', 'Questo username è già in uso.');
  }
  return { id, username: c.username };
}

/** Verifica le credenziali senza creare sessioni (usato anche per confermare il secondo giocatore in locale). */
export function checkCredentials(db: DB, username: unknown, password: unknown): PublicUser {
  if (typeof username !== 'string' || typeof password !== 'string') throw new AuthError(400, 'credenziali', 'Credenziali mancanti.');
  const row = one<{ id: string; username: string; password_hash: string }>(db, 'SELECT id, username, password_hash FROM users WHERE username_norm = ?', normalizeUsername(username));
  const ok = verifyPassword(password, row ? row.password_hash : DUMMY_HASH);
  if (!row || !ok) throw new AuthError(401, 'credenziali', 'Username o password non corretti.');
  return { id: row.id, username: row.username };
}

export function createSession(db: DB, userId: string): string {
  const token = randomBytes(32).toString('base64url');
  const now = Date.now();
  run(db, 'INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_seen) VALUES (?, ?, ?, ?, ?)', sha256(token), userId, now, now + SESSION_TTL_MS, now);
  return token;
}

export function userFromToken(db: DB, token: string | undefined): PublicUser | null {
  if (!token) return null;
  const row = one<{ id: string; username: string; expires_at: number; last_seen: number }>(
    db,
    'SELECT u.id, u.username, s.expires_at, s.last_seen FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?',
    sha256(token),
  );
  if (!row) return null;
  const now = Date.now();
  if (row.expires_at < now) {
    run(db, 'DELETE FROM sessions WHERE token_hash = ?', sha256(token));
    return null;
  }
  if (now - row.last_seen > 60_000) {
    run(db, 'UPDATE sessions SET last_seen = ?, expires_at = ? WHERE token_hash = ?', now, now + SESSION_TTL_MS, sha256(token));
  }
  return { id: row.id, username: row.username };
}

export function destroySession(db: DB, token: string | undefined): void {
  if (token) run(db, 'DELETE FROM sessions WHERE token_hash = ?', sha256(token));
}

/** Limitatore semplice di tentativi (in memoria) per login e verifiche. */
export class RateLimiter {
  private hits = new Map<string, number[]>();
  private max: number;
  private windowMs: number;
  constructor(max: number, windowMs: number) {
    this.max = max;
    this.windowMs = windowMs;
  }
  check(key: string): boolean {
    const now = Date.now();
    const arr = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (arr.length >= this.max) {
      this.hits.set(key, arr);
      return false;
    }
    arr.push(now);
    this.hits.set(key, arr);
    return true;
  }
}
