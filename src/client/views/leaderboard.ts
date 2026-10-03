import { h, clear, fmtPct, prefs } from '../ui/dom.ts';
import { get } from '../net/api.ts';
import { allConfigKeys, CATEGORY_LABEL } from '../labels.ts';
import { ELO_DOC } from './history.ts';

export async function renderLeaderboard(main: HTMLElement) {
  const keys = allConfigKeys();
  let key = prefs.get('lbKey', keys[0].key);
  if (!keys.some((k) => k.key === key)) key = keys[0].key;
  let scope: 'globale' | 'amici' = prefs.get('lbScope', 'globale');
  const sel = h('select', { id: 'lb-key' }, ...keys.map((k) => h('option', { value: k.key, selected: k.key === key }, `${k.label} — ${CATEGORY_LABEL[k.category]}`)));
  const tabs = h('div', { class: 'tabs', role: 'tablist' });
  const box = h('div');

  const drawTabs = () => {
    clear(tabs);
    for (const [v, label] of [['globale', 'Globale'], ['amici', 'Fra amici']] as const) {
      tabs.append(h('button', { role: 'tab', 'aria-selected': String(scope === v), onclick: () => { scope = v; prefs.set('lbScope', v); drawTabs(); void load(); } }, label));
    }
  };

  const load = async () => {
    clear(box);
    const cat = keys.find((k) => k.key === key)!.category;
    try {
      const r = await get(`/api/leaderboard?config=${encodeURIComponent(key)}&scope=${scope}`);
      if (!r.rows.length) return box.append(h('p', { class: 'empty' }, 'Nessuna partita registrata per questa configurazione.'));
      box.append(h('div', { class: 'table-wrap' }, h('table', null,
        h('thead', null, h('tr', null, h('th', null, '#'), h('th', null, 'Giocatore'), cat !== 'personalizzata' ? h('th', { class: 'num' }, 'Elo') : '', h('th', { class: 'num' }, 'Partite'), h('th', { class: 'num' }, 'Vittorie'), h('th', { class: 'num' }, 'Sconfitte'), h('th', { class: 'num' }, '% vittorie'))),
        h('tbody', null, ...r.rows.map((x: any) => h('tr', { class: x.isMe ? 'me' : '' },
          h('td', null, String(x.rank)), h('td', null, h('a', { href: `#/profilo/${encodeURIComponent(x.username)}` }, x.username), x.isMe ? h('span', { class: 'small muted' }, ' (tu)') : ''),
          cat !== 'personalizzata' ? h('td', { class: 'num' }, x.rating.toFixed(1)) : '',
          h('td', { class: 'num' }, String(x.games)), h('td', { class: 'num' }, String(x.wins)), h('td', { class: 'num' }, String(x.losses)), h('td', { class: 'num' }, fmtPct(x.winRate))))))));
    } catch (e) {
      box.append(h('p', { class: 'notice warn' }, (e as Error).message));
    }
  };
  sel.addEventListener('change', () => { key = sel.value; prefs.set('lbKey', key); void load(); });

  main.append(h('h1', null, 'Classifica'),
    h('p', { class: 'muted' }, 'Le classifiche sono separate per configurazione (tavola, regolamento e versione). Contano solo le partite online concluse e registrate dal server; le partite locali non entrano in classifica.'),
    h('div', { class: 'field', style: 'max-width:640px' }, h('label', { for: 'lb-key' }, 'Configurazione'), sel),
    h('div', { style: 'margin-top:16px' }, tabs, box),
    h('details', { style: 'margin-top:20px' }, h('summary', null, 'Come si calcola l\'Elo'), h('p', { class: 'small' }, ELO_DOC)));
  drawTabs();
  await load();
  return () => {};
}
