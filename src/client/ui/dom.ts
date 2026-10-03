// Piccole utilità DOM senza framework.

type Child = Node | string | number | null | undefined | false | Child[];
type Attrs = Record<string, unknown> & { class?: string; style?: string };

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs | null = null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      else if (k === 'class') el.className = String(v);
      else if (k === 'html') el.innerHTML = String(v);
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    }
  }
  append(el, children);
  return el;
}

function append(el: Node, children: Child[]) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
}

export function clear(el: Element) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function toast(message: string, kind: 'info' | 'error' | 'ok' = 'info', ms = 4200, action?: { label: string; run: () => void }) {
  const box = document.getElementById('toasts')!;
  const t = h('div', { class: `toast ${kind}`, role: kind === 'error' ? 'alert' : 'status' }, h('span', null, message),
    action ? h('button', { class: 'btn small', onclick: () => { action.run(); t.remove(); } }, action.label) : null,
    h('button', { class: 'btn small ghost', 'aria-label': 'Chiudi notifica', onclick: () => t.remove() }, '×'));
  box.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

export function fmtPct(x: number | null | undefined) {
  return x === null || x === undefined ? '—' : `${Math.round(x * 100)}%`;
}

export function fmtDate(ms: number) {
  return new Date(ms).toLocaleString('it-IT', { dateStyle: 'medium', timeStyle: 'short' });
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function uid(): string {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  return 'a' + Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

export const prefs = {
  get<T>(key: string, def: T): T {
    try {
      const v = localStorage.getItem('ur.pref.' + key);
      return v === null ? def : (JSON.parse(v) as T);
    } catch {
      return def;
    }
  },
  set(key: string, v: unknown) {
    try {
      localStorage.setItem('ur.pref.' + key, JSON.stringify(v));
    } catch {
      /* archiviazione non disponibile: preferenza solo per la sessione */
    }
  },
};
