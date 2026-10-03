import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { createApp } from '../src/server/app.ts';

export async function startApp(extra: Partial<Parameters<typeof createApp>[0]> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ur-test-'));
  const app = createApp({ dbPath: join(dir, 'test.db'), port: 0, sweepMs: 200, ...extra });
  const port = await app.listen();
  return { app, base: `http://127.0.0.1:${port}`, port };
}

export class Client {
  cookie = '';
  base: string;
  constructor(base: string) {
    this.base = base;
  }
  async req(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await fetch(this.base + path, {
      method,
      headers: { 'content-type': 'application/json', 'x-ur-client': '1', ...(this.cookie ? { cookie: this.cookie } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const sc = res.headers.get('set-cookie');
    if (sc) this.cookie = sc.split(';')[0].endsWith('=') ? '' : sc.split(';')[0];
    const json = await res.json().catch(() => null);
    return { status: res.status, body: json as any };
  }
  get(p: string) { return this.req('GET', p); }
  post(p: string, b: unknown = {}) { return this.req('POST', p, b); }
  del(p: string) { return this.req('DELETE', p); }

  ws(): Promise<WsClient> {
    return new Promise((ok, ko) => {
      const ws = new WebSocket(this.base.replace('http', 'ws') + '/ws', { headers: { cookie: this.cookie } });
      const c = new WsClient(ws);
      ws.once('open', () => ok(c));
      ws.once('error', ko);
      ws.once('unexpected-response', (_r, res) => ko(new Error('HTTP ' + res.statusCode)));
    });
  }
}

export class WsClient {
  msgs: any[] = [];
  private waiters: { pred: (m: any) => boolean; ok: (m: any) => void }[] = [];
  ws: WebSocket;
  constructor(ws: WebSocket) {
    this.ws = ws;
    ws.on('message', (d) => {
      const m = JSON.parse(String(d));
      this.msgs.push(m);
      this.waiters = this.waiters.filter((w) => (w.pred(m) ? (w.ok(m), false) : true));
    });
  }
  send(m: unknown) { this.ws.send(JSON.stringify(m)); }
  wait(pred: (m: any) => boolean, ms = 5000): Promise<any> {
    const found = this.msgs.find(pred);
    if (found) { this.msgs.splice(this.msgs.indexOf(found), 1); return Promise.resolve(found); }
    return new Promise((ok, ko) => {
      const t = setTimeout(() => ko(new Error('timeout ws')), ms);
      this.waiters.push({ pred, ok: (m) => { clearTimeout(t); this.msgs.splice(this.msgs.indexOf(m), 1); ok(m); } });
    });
  }
  close() { this.ws.close(); }
}

let n = 0;
export function aid() {
  return `act-${Date.now().toString(36)}-${(n++).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
