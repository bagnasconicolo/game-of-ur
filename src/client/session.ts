// Stato della sessione nel client (utente autenticato e notifiche).

import { get, post, realtime } from './net/api.ts';

export interface User {
  id: string;
  username: string;
}

type L = () => void;

class Session {
  user: User | null = null;
  ready = false;
  private listeners = new Set<L>();

  async load() {
    try {
      this.user = (await get<{ user: User | null }>('/api/me')).user;
    } catch {
      this.user = null;
    }
    this.ready = true;
    if (this.user) realtime.connect();
    this.emit();
  }

  async login(username: string, password: string) {
    this.user = (await post<{ user: User }>('/api/auth/login', { username, password })).user;
    realtime.connect();
    this.emit();
  }

  async register(username: string, password: string) {
    this.user = (await post<{ user: User }>('/api/auth/register', { username, password })).user;
    realtime.connect();
    this.emit();
  }

  async logout() {
    await post('/api/auth/logout').catch(() => {});
    realtime.close();
    this.user = null;
    this.emit();
  }

  on(l: L) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  emit() {
    for (const l of this.listeners) l();
  }
}

export const session = new Session();
