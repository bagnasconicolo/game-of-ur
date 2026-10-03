// Client HTTP per le API JSON e canale realtime con riconnessione automatica.

export class ApiError extends Error {
  status: number;
  code: string;
  data: any;
  constructor(status: number, code: string, message: string, data: any) {
    super(message);
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', 'x-ur-client': '1' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'rete', 'Server non raggiungibile: controlla la connessione.', null);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error ?? 'errore', data?.message ?? `Errore ${res.status}`, data);
  return data as T;
}

export const get = <T = any>(p: string) => api<T>('GET', p);
export const post = <T = any>(p: string, b: unknown = {}) => api<T>('POST', p, b);
export const del = <T = any>(p: string) => api<T>('DELETE', p);

type Listener = (msg: any) => void;

/** WebSocket con riconnessione esponenziale; alla riconnessione ripete le iscrizioni alle partite. */
export class Realtime {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private watched = new Set<string>();
  private retry = 0;
  private timer: number | null = null;
  private closedByUser = false;
  status: 'connesso' | 'connessione' | 'disconnesso' = 'disconnesso';
  private statusListeners = new Set<(s: Realtime['status']) => void>();
  onStatus(cb: (s: Realtime['status']) => void): () => void {
    this.statusListeners.add(cb);
    return () => this.statusListeners.delete(cb);
  }

  connect() {
    this.closedByUser = false;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    this.setStatus('connessione');
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.setStatus('connesso');
      for (const g of this.watched) this.send({ t: 'watch', gameId: g });
    };
    ws.onmessage = (ev) => {
      let m: any;
      try {
        m = JSON.parse(ev.data);
      } catch {
        return;
      }
      for (const l of this.listeners) l(m);
    };
    ws.onclose = () => {
      this.ws = null;
      this.setStatus('disconnesso');
      if (!this.closedByUser) this.schedule();
    };
    ws.onerror = () => ws.close();
  }

  private schedule() {
    if (this.timer) return;
    const delay = Math.min(15000, 500 * 2 ** this.retry++) + Math.random() * 300;
    this.timer = window.setTimeout(() => {
      this.timer = null;
      this.connect();
    }, delay);
  }

  private setStatus(s: Realtime['status']) {
    this.status = s;
    for (const l of this.statusListeners) l(s);
  }

  close() {
    this.closedByUser = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.ws?.close();
    this.ws = null;
  }

  send(m: unknown): boolean {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(m));
      return true;
    }
    return false;
  }

  watch(gameId: string) {
    this.watched.add(gameId);
    this.send({ t: 'watch', gameId });
  }

  unwatch(gameId: string) {
    this.watched.delete(gameId);
    this.send({ t: 'unwatch', gameId });
  }

  on(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
}

export const realtime = new Realtime();
