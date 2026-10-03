import { h, fmtPct, fmtDate, toast } from '../ui/dom.ts';
import { get, post, del } from '../net/api.ts';
import { configLabel, CATEGORY_LABEL, REASON_LABEL } from '../labels.ts';

export async function renderProfile(main: HTMLElement, username: string) {
  const p = await get(`/api/users/${encodeURIComponent(username)}`);
  const s = p.stats;
  const rel = p.relation;
  const relBtn = p.isMe ? '' : rel === 'nessuna'
    ? h('button', { class: 'btn primary', onclick: async () => { await post('/api/friends/request', { username: p.user.username }); toast('Richiesta inviata.', 'ok'); } }, 'Chiedi l\'amicizia')
    : rel === 'amico' ? h('span', { class: 'tag attestato' }, 'Amico') : h('span', { class: 'tag neutral' }, rel === 'richiesta-inviata' ? 'Richiesta inviata' : 'Ti ha chiesto l\'amicizia');
  main.append(
    h('div', { class: 'row', style: 'justify-content:space-between' }, h('h1', { style: 'margin:0' }, p.user.username,
      h('span', { class: 'small muted', style: 'font-family:var(--font-body);margin-left:10px' }, h('span', { class: `dot ${p.online ? 'on' : ''}` }), p.online ? 'online' : 'non collegato')), relBtn),
    h('div', { class: 'grid3 section' },
      ...[['Partite online', s.games], ['Vittorie', s.wins], ['Sconfitte', s.losses], ['% vittorie', fmtPct(s.winRate)], ...(p.isMe ? [['Partite locali (non classificate)', s.localGames]] : [])]
        .map(([k, v]) => h('div', { class: 'card' }, h('div', { class: 'small muted' }, String(k)), h('div', { style: 'font:600 2rem var(--font-display)' }, String(v))))),
    h('section', { class: 'section' }, h('div', { class: 'section-title' }, h('h2', null, 'Per configurazione')),
      p.ratings.length ? h('div', { class: 'table-wrap' }, h('table', null,
        h('thead', null, h('tr', null, h('th', null, 'Configurazione'), h('th', null, 'Categoria'), h('th', { class: 'num' }, 'Elo'), h('th', { class: 'num' }, 'Partite'), h('th', { class: 'num' }, 'V'), h('th', { class: 'num' }, 'S'))),
        h('tbody', null, ...p.ratings.map((r: any) => h('tr', null, h('td', null, configLabel(r.config_key)), h('td', null, CATEGORY_LABEL[r.category] ?? r.category),
          h('td', { class: 'num' }, r.category === 'personalizzata' ? '—' : r.rating.toFixed(1)), h('td', { class: 'num' }, String(r.games)), h('td', { class: 'num' }, String(r.wins)), h('td', { class: 'num' }, String(r.losses))))))) : h('p', { class: 'empty' }, 'Nessuna partita online conclusa.')),
    h('section', { class: 'section' }, h('div', { class: 'section-title' }, h('h2', null, 'Storico delle partite')),
      p.history.length ? h('ul', { class: 'list' }, ...p.history.map((x: any) => h('li', null,
        h('span', null, h('span', { class: `tag ${x.won ? 'attestato' : 'adattamento'}` }, x.won ? 'Vittoria' : 'Sconfitta'), ' contro ', h('strong', null, x.opponent ?? '—'),
          h('span', { class: 'small muted' }, ` · ${configLabel(x.configKey)} · ${REASON_LABEL[x.reason] ?? x.reason} · ${fmtDate(x.at)}`)),
        h('span', { class: 'small' }, x.ranked ? `Elo ${x.ratingBefore} → ${x.ratingAfter}` : 'non classificata')))) : h('p', { class: 'empty' }, 'Nessuna partita.')),
    p.isMe ? h('section', { class: 'section' }, h('div', { class: 'section-title' }, h('h2', null, 'Partite locali salvate')), await localList()) : '',
  );
  return () => {};
}

async function localList() {
  const r = await get('/api/local/games').catch(() => ({ games: [] }));
  if (!r.games.length) return h('p', { class: 'empty' }, 'Nessuna partita locale salvata sul server.');
  const ul = h('ul', { class: 'list' });
  for (const g of r.games) {
    ul.append(h('li', null, h('span', null, g.seats.map((s: any) => `${s.name}${s.verified ? ' ✓' : ' (non verificato)'}`).join(' contro '),
      h('span', { class: 'small muted' }, ` · ${configLabel(g.configKey)} · ${g.status === 'finished' ? `vince ${g.seats[g.state.winner]?.name}` : 'in corso'} · ${fmtDate(g.updatedAt)}`)),
      h('button', { class: 'btn small danger', onclick: async (e: Event) => { await del(`/api/local/games/${g.id}`); (e.target as HTMLElement).closest('li')?.remove(); } }, 'Elimina')));
  }
  return ul;
}
