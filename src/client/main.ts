// Punto d'ingresso: router a hash, intestazione, stato di rete e notifiche.

import { session } from './session.ts';
import { realtime, get } from './net/api.ts';
import { h, clear, toast } from './ui/dom.ts';
import { renderPlay } from './views/play.ts';
import { renderGame, renderLocalGame } from './views/game.ts';
import { renderFriends } from './views/friends.ts';
import { renderLeaderboard } from './views/leaderboard.ts';
import { renderProfile } from './views/profile.ts';
import { renderHistory } from './views/history.ts';
import { renderAuth } from './views/auth.ts';
import { renderJoinRoom } from './views/play.ts';
import { navigate } from './ui/nav.ts';

const main = document.getElementById('main')!;
let cleanup: (() => void) | null = null;


function setNav(name: string) {
  for (const a of document.querySelectorAll<HTMLAnchorElement>('.mainnav a')) {
    if (a.dataset.nav === name) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
}

function renderAccount() {
  const box = document.getElementById('account')!;
  clear(box);
  if (!session.ready) return;
  if (session.user) {
    box.append(
      h('a', { class: 'who', href: '#/profilo', title: 'Il tuo profilo' }, session.user.username),
      h('button', { class: 'btn small ghost', onclick: async () => { await session.logout(); toast('Sessione chiusa.'); navigate('#/gioca'); } }, 'Esci'),
    );
  } else {
    box.append(h('a', { class: 'btn small primary', href: '#/accedi' }, 'Accedi'));
  }
}

async function route() {
  cleanup?.();
  cleanup = null;
  const hash = location.hash || '#/gioca';
  const [, name, arg] = hash.match(/^#\/([^/]*)\/?(.*)$/) ?? [, 'gioca', ''];
  clear(main);
  main.classList.remove('wide');
  setNav(name === 'partita' || name === 'locale' || name === 'stanza' ? 'gioca' : name);
  const requireLogin = (what: string) => {
    if (session.user) return false;
    main.append(h('section', { class: 'card', style: 'max-width:560px;margin:40px auto' },
      h('h1', null, what), h('p', null, 'Questa sezione richiede un account. Le partite locali come ospite restano disponibili senza registrazione.'),
      h('div', { class: 'row' }, h('a', { class: 'btn primary', href: `#/accedi/${encodeURIComponent(hash)}` }, 'Accedi o registrati'), h('a', { class: 'btn', href: '#/gioca' }, 'Torna a Gioca'))));
    return true;
  };
  try {
    switch (name) {
      case '':
      case 'gioca':
        cleanup = await renderPlay(main);
        break;
      case 'partita':
        if (requireLogin('Partita online')) break;
        main.classList.add('wide');
        cleanup = await renderGame(main, decodeURIComponent(arg));
        break;
      case 'locale':
        main.classList.add('wide');
        cleanup = await renderLocalGame(main, decodeURIComponent(arg));
        break;
      case 'stanza':
        if (requireLogin('Entra in una stanza')) break;
        cleanup = await renderJoinRoom(main, decodeURIComponent(arg));
        break;
      case 'amici':
        if (requireLogin('Amici')) break;
        cleanup = await renderFriends(main);
        break;
      case 'classifica':
        if (requireLogin('Classifica')) break;
        cleanup = await renderLeaderboard(main);
        break;
      case 'profilo':
        if (requireLogin('Profilo')) break;
        cleanup = await renderProfile(main, arg ? decodeURIComponent(arg) : session.user!.username);
        break;
      case 'storia':
        cleanup = await renderHistory(main, arg);
        break;
      case 'accedi':
        cleanup = await renderAuth(main, arg ? decodeURIComponent(arg) : '#/gioca');
        break;
      default:
        main.append(h('p', { class: 'empty' }, 'Pagina non trovata. ', h('a', { href: '#/gioca' }, 'Torna a Gioca')));
    }
  } catch (e) {
    main.append(h('div', { class: 'notice warn', role: 'alert' }, h('strong', null, 'Impossibile caricare la pagina. '), (e as Error).message,
      ' ', h('button', { class: 'btn small', onclick: () => route() }, 'Riprova')));
  }
  main.focus({ preventScroll: true });
}

// ---- stato di rete ----
const netbar = document.getElementById('netbar')!;
let hadOutage = false;
realtime.onStatus((s) => {
  if (!session.user) return (netbar.hidden = true);
  if (s === 'connesso') {
    if (hadOutage) {
      netbar.textContent = 'Connessione ripristinata.';
      netbar.className = 'netbar ok';
      netbar.hidden = false;
      setTimeout(() => (netbar.hidden = true), 2500);
    } else netbar.hidden = true;
    hadOutage = false;
  } else if (s === 'disconnesso') {
    hadOutage = true;
    netbar.className = 'netbar';
    netbar.textContent = 'Connessione in tempo reale interrotta: nuovo tentativo in corso… Le azioni restano protette e verranno ripetute senza duplicati.';
    netbar.hidden = false;
  }
});
window.addEventListener('offline', () => { netbar.className = 'netbar'; netbar.textContent = 'Sei offline. Le partite locali restano giocabili.'; netbar.hidden = false; });
window.addEventListener('online', () => {
  if (session.user) realtime.connect();
  netbar.textContent = 'Connessione ripristinata.';
  netbar.className = 'netbar ok';
  netbar.hidden = false;
  setTimeout(() => (netbar.hidden = true), 2500);
});

// ---- notifiche globali ----
async function refreshBadge() {
  const badge = document.getElementById('friends-badge')!;
  if (!session.user) return (badge.hidden = true);
  try {
    const [f, i] = await Promise.all([get('/api/friends'), get('/api/invites')]);
    const n = f.incoming.length + i.incoming.filter((x: any) => x.status === 'pending').length;
    badge.textContent = String(n);
    badge.hidden = n === 0;
    badge.setAttribute('aria-label', `${n} richieste o inviti in sospeso`);
  } catch {
    /* ignorato */
  }
}
realtime.on((m) => {
  if (m.t !== 'notify') return;
  void refreshBadge();
  if (m.kind === 'invites') toast('Aggiornamento sugli inviti.', 'info', 3000, { label: 'Vedi', run: () => navigate('#/amici') });
  if (m.kind === 'invite-accepted' || m.kind === 'match') {
    toast(m.kind === 'match' ? 'Avversario trovato!' : 'Invito accettato: la partita è pronta.', 'ok', 8000, { label: 'Gioca', run: () => navigate(`#/partita/${m.gameId}`) });
  }
  window.dispatchEvent(new CustomEvent('ur:notify', { detail: m }));
});

session.on(() => {
  renderAccount();
  void refreshBadge();
});
window.addEventListener('hashchange', route);
await session.load();
await route();
