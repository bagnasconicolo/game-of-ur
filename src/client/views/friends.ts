import { h, clear, toast } from '../ui/dom.ts';
import { get, post, del } from '../net/api.ts';
import { navigate } from '../ui/nav.ts';
import { configLabel } from '../labels.ts';
import { configKey } from '../../engine/index.ts';

export async function renderFriends(main: HTMLElement) {
  const results = h('ul', { class: 'list', 'aria-live': 'polite' });
  const q = h('input', { type: 'search', id: 'friend-q', placeholder: 'Cerca per username…', autocomplete: 'off' });
  const friendsBox = h('div');
  const reqBox = h('div');
  const invBox = h('div');

  const relLabel: Record<string, string> = { amico: 'Già amici', 'richiesta-inviata': 'Richiesta inviata', 'richiesta-ricevuta': 'Ti ha chiesto l\'amicizia', nessuna: '' };

  let tmr: number | undefined;
  const search = async () => {
    clear(results);
    if (q.value.trim().length < 2) return;
    try {
      const r = await get(`/api/users/search?q=${encodeURIComponent(q.value.trim())}`);
      if (!r.users.length) results.append(h('li', null, h('span', { class: 'muted' }, 'Nessun utente trovato.')));
      for (const u of r.users) {
        results.append(h('li', null, h('a', { href: `#/profilo/${encodeURIComponent(u.username)}` }, u.username),
          u.relation === 'nessuna'
            ? h('button', { class: 'btn small primary', onclick: async () => { try { await post('/api/friends/request', { username: u.username }); toast(`Richiesta inviata a ${u.username}.`, 'ok'); void load(); void search(); } catch (e) { toast((e as Error).message, 'error'); } } }, 'Chiedi l\'amicizia')
            : h('span', { class: 'small muted' }, relLabel[u.relation])));
      }
    } catch (e) {
      results.append(h('li', null, (e as Error).message));
    }
  };
  q.addEventListener('input', () => { clearTimeout(tmr); tmr = window.setTimeout(search, 250); });

  const load = async () => {
    const [f, inv] = await Promise.all([get('/api/friends'), get('/api/invites')]);
    clear(friendsBox);
    clear(reqBox);
    clear(invBox);
    if (!f.friends.length) friendsBox.append(h('p', { class: 'empty' }, 'Nessun amico ancora. Cerca qualcuno qui sopra.'));
    else friendsBox.append(h('ul', { class: 'list' }, ...f.friends.map((u: any) => h('li', null,
      h('span', null, h('span', { class: `dot ${u.online ? 'on' : ''}`, 'aria-hidden': 'true' }), h('a', { href: `#/profilo/${encodeURIComponent(u.username)}` }, u.username), h('small', { class: 'muted' }, u.online ? ' · online' : ' · non collegato')),
      h('span', { class: 'row' },
        h('a', { class: 'btn small primary', href: '#/gioca', onclick: () => sessionStorage.setItem('ur.challenge', u.id) }, 'Sfida'),
        h('button', { class: 'btn small danger', onclick: async () => { await del(`/api/friends/${u.id}`); toast(`${u.username} rimosso dagli amici.`); void load(); } }, 'Rimuovi'))))));

    if (f.incoming.length || f.outgoing.length) {
      reqBox.append(h('ul', { class: 'list' },
        ...f.incoming.map((u: any) => h('li', null, h('span', null, h('strong', null, u.username), ' vuole aggiungerti agli amici'),
          h('span', { class: 'row' },
            h('button', { class: 'btn small primary', onclick: async () => { await post('/api/friends/respond', { userId: u.id, accept: true }); toast(`Ora tu e ${u.username} siete amici.`, 'ok'); void load(); } }, 'Accetta'),
            h('button', { class: 'btn small', onclick: async () => { await post('/api/friends/respond', { userId: u.id, accept: false }); void load(); } }, 'Rifiuta')))),
        ...f.outgoing.map((u: any) => h('li', null, h('span', null, 'Richiesta inviata a ', h('strong', null, u.username)),
          h('button', { class: 'btn small', onclick: async () => { await del(`/api/friends/${u.id}`); void load(); } }, 'Ritira')))));
    } else reqBox.append(h('p', { class: 'empty' }, 'Nessuna richiesta in sospeso.'));

    const pend = (x: any) => x.status === 'pending';
    const stLabel: Record<string, string> = { pending: 'in attesa', accepted: 'accettato', declined: 'rifiutato', expired: 'scaduto', cancelled: 'annullato' };
    const exp = (x: any) => `scade alle ${new Date(x.expiresAt).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`;
    const items = [
      ...inv.incoming.map((x: any) => h('li', null,
        h('span', null, h('strong', null, x.from.username), x.rematchOf ? ' propone la rivincita' : ' ti sfida', ' · ', h('span', { class: 'small muted' }, `${configLabel(configKey(x.config))} · ${pend(x) ? exp(x) : stLabel[x.status]}`)),
        pend(x) ? h('span', { class: 'row' },
          h('button', { class: 'btn small gold', onclick: async () => { try { const r = await post(`/api/invites/${x.id}/accept`); navigate(`#/partita/${r.gameId}`); } catch (e) { toast((e as Error).message, 'error'); void load(); } } }, 'Accetta e gioca'),
          h('button', { class: 'btn small', onclick: async () => { await post(`/api/invites/${x.id}/decline`); void load(); } }, 'Rifiuta'))
          : x.gameId ? h('a', { class: 'btn small', href: `#/partita/${x.gameId}` }, 'Apri partita') : '')),
      ...inv.outgoing.map((x: any) => h('li', null,
        h('span', null, 'Sfida a ', h('strong', null, x.to.username), ' · ', h('span', { class: 'small muted' }, `${configLabel(configKey(x.config))} · ${pend(x) ? exp(x) : stLabel[x.status]}`)),
        pend(x) ? h('button', { class: 'btn small', onclick: async () => { await post(`/api/invites/${x.id}/cancel`); void load(); } }, 'Annulla')
          : x.gameId ? h('a', { class: 'btn small primary', href: `#/partita/${x.gameId}` }, 'Apri partita') : '')),
    ];
    if (items.length) invBox.append(h('ul', { class: 'list' }, ...items));
    else invBox.append(h('p', { class: 'empty' }, 'Nessun invito recente.'));
  };

  main.append(
    h('h1', null, 'Amici'),
    h('section', { class: 'section' }, h('div', { class: 'field', style: 'max-width:420px' }, h('label', { for: 'friend-q' }, 'Trova utenti'), q), h('div', { style: 'margin-top:10px' }, results)),
    h('div', { class: 'grid2' },
      h('section', null, h('div', { class: 'section-title' }, h('h2', null, 'Inviti a giocare')), invBox),
      h('section', null, h('div', { class: 'section-title' }, h('h2', null, 'Richieste di amicizia')), reqBox)),
    h('section', { class: 'section' }, h('div', { class: 'section-title' }, h('h2', null, 'I tuoi amici'), h('span', { class: 'small muted' }, 'Il punto verde indica chi è collegato ora.')), friendsBox));
  await load();
  const onNotify = () => void load();
  window.addEventListener('ur:notify', onNotify);
  return () => window.removeEventListener('ur:notify', onNotify);
}
