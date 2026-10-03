// Avvio del server. Configurazione tramite variabili d'ambiente (vedi .env.example).
import { existsSync, readFileSync } from 'node:fs';
import { createApp } from './app.ts';

// Caricamento minimale di .env (senza dipendenze); le variabili già definite hanno la precedenza.
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const prod = process.env.NODE_ENV === 'production';
const app = createApp({
  dbPath: process.env.DB_PATH ?? 'data/ur.db',
  port: Number(process.env.PORT ?? 8787),
  host: process.env.HOST ?? '127.0.0.1',
  staticDir: prod ? (process.env.STATIC_DIR ?? 'dist') : null,
  cookieSecure: process.env.COOKIE_SECURE === '1',
  allowedOrigins: (process.env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  turnSeconds: Number(process.env.TURN_SECONDS ?? 120),
  inviteSeconds: Number(process.env.INVITE_SECONDS ?? 600),
});
const port = await app.listen();
console.log(`Gioco reale di Ur — server su http://${process.env.HOST ?? '127.0.0.1'}:${port}${prod ? '' : ' (API; client con Vite su :5173)'}`);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { await app.close(); process.exit(0); });
