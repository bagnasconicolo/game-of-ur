// Canale realtime (WebSocket): presenza, notifiche e sincronizzazione delle partite.
// L'autenticazione avviene con lo stesso cookie di sessione HTTP; l'origine viene verificata.

import { WebSocketServer, type WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type { Hub } from './games.ts';

interface Conn {
  ws: WebSocket;
  userId: string;
  watching: Set<string>;
  alive: boolean;
}

export class RealtimeHub implements Hub {
  wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  private byUser = new Map<string, Set<Conn>>();
  private heartbeat: NodeJS.Timeout;
  onMessage: (userId: string, msg: Record<string, unknown>, reply: (m: unknown) => void, conn: { watch(gameId: string): void; unwatch(gameId: string): void }) => void = () => {};
  onPresence: (userId: string, online: boolean) => void = () => {};

  constructor() {
    this.heartbeat = setInterval(() => {
      for (const set of this.byUser.values()) {
        for (const c of set) {
          if (!c.alive) c.ws.terminate();
          else {
            c.alive = false;
            c.ws.ping();
          }
        }
      }
    }, 25_000);
    this.heartbeat.unref();
  }

  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer, userId: string) {
    this.wss.handleUpgrade(req, socket, head, (ws) => this.attach(ws, userId));
  }

  private attach(ws: WebSocket, userId: string) {
    const conn: Conn = { ws, userId, watching: new Set(), alive: true };
    let set = this.byUser.get(userId);
    const wasOnline = !!set && set.size > 0;
    if (!set) this.byUser.set(userId, (set = new Set()));
    set.add(conn);
    if (!wasOnline) this.onPresence(userId, true);
    ws.on('pong', () => (conn.alive = true));
    ws.on('message', (data) => {
      conn.alive = true;
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(String(data));
      } catch {
        return ws.send(JSON.stringify({ t: 'error', code: 'json', message: 'Messaggio non valido.' }));
      }
      if (msg.t === 'ping') return ws.send(JSON.stringify({ t: 'pong', serverTime: Date.now() }));
      this.onMessage(userId, msg, (m) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(m)), {
        watch: (gameId: string) => conn.watching.add(gameId),
        unwatch: (gameId: string) => conn.watching.delete(gameId),
      });
    });
    ws.on('close', () => {
      set!.delete(conn);
      if (set!.size === 0) {
        this.byUser.delete(userId);
        this.onPresence(userId, false);
      }
    });
    ws.send(JSON.stringify({ t: 'hello', userId, serverTime: Date.now() }));
  }

  notifyUser(userId: string, msg: unknown) {
    const s = JSON.stringify(msg);
    for (const c of this.byUser.get(userId) ?? []) if (c.ws.readyState === c.ws.OPEN) c.ws.send(s);
  }

  broadcastGame(gameId: string, msg: unknown) {
    const s = JSON.stringify(msg);
    for (const set of this.byUser.values()) for (const c of set) if (c.watching.has(gameId) && c.ws.readyState === c.ws.OPEN) c.ws.send(s);
  }

  isOnline(userId: string) {
    return (this.byUser.get(userId)?.size ?? 0) > 0;
  }

  isWatching(userId: string, gameId: string) {
    for (const c of this.byUser.get(userId) ?? []) if (c.watching.has(gameId)) return true;
    return false;
  }

  disconnectUser(userId: string) {
    for (const c of this.byUser.get(userId) ?? []) c.ws.close(4001, 'logout');
  }

  close() {
    clearInterval(this.heartbeat);
    this.onPresence = () => {};
    this.onMessage = () => {};
    for (const set of this.byUser.values()) for (const c of set) c.ws.terminate();
    this.wss.close();
  }
}
