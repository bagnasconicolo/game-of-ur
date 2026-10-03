// Gioca: scelta di tavola e regolamento, matrice di compatibilità, modalità di partita, partite aperte.

import { BOARDS, RULESETS, COMPATIBILITY, DICE_SYSTEMS, DECORATIONS, ROUTES, routeFor, rosettePositions, resolveSpec, initialState, type BoardId, type RulesetId, type GameConfig } from '../../engine/index.ts';
import { h, clear, toast, prefs, fmtDate } from '../ui/dom.ts';
import { get, post, del } from '../net/api.ts';
import { session } from '../session.ts';
import { navigate } from '../ui/nav.ts';
import { boardSvg } from '../render/svgboard.ts';
import { compatOf, configLabel, CATEGORY_LABEL } from '../labels.ts';
import { LocalController, loadLocalSaves, deleteLocalSave, type LocalSeatDef } from '../controllers.ts';
import { BoardScene, webglAvailable, autoQuality } from '../render/board3d.ts';
import { prefersReducedMotion } from '../ui/dom.ts';

function tagFor(status: string) {
  if (status === 'convenzione-moderna') return h('span', { class: 'tag convenzione' }, 'Convenzione moderna');
  if (status === 'ricostruzione-sperimentale') return h('span', { class: 'tag interpretazione' }, 'Ricostruzione sperimentale');
  return h('span', { class: 'tag adattamento' }, 'Adattamento moderno');
}

function measure(m: { value: number; status: string }) {
  return `${m.value.toLocaleString('it-IT')} cm${m.status === 'stimata' ? ' (stimata)' : ''}`;
}

export async function renderPlay(main: HTMLElement) {
  let boardId = prefs.get<BoardId>('board', 'ur-iii');
  let rulesetId = prefs.get<RulesetId>('ruleset', 'moderno');
  const cfg = (): GameConfig => ({ boardId, boardVersion: BOARDS[boardId].version, rulesetId, rulesetVersion: RULESETS[rulesetId].version });

  // ---- hero con anteprima 3D ----
  const fig = h('div', { class: 'hero-figure', 'aria-hidden': 'true' });
  let scene: BoardScene | null = null;
  const hero = h('section', { class: 'hero' },
    h('div', null,
      h('h1', null, 'Il Gioco reale di Ur'),
      h('p', { class: 'lead' }, 'Una corsa per due giocatori su venti caselle, giocata in Mesopotamia e nel Vicino Oriente per oltre due millenni. Scegli la tavola e il regolamento: per ciascuno indichiamo che cosa è attestato, che cosa è interpretazione degli studiosi e che cosa è convenzione moderna.'),
      h('div', { class: 'row' },
        h('a', { class: 'btn gold', href: '#modalita' }, 'Inizia una partita'),
        h('a', { class: 'btn', href: '#/storia' }, 'Storia e fonti'))),
    fig);
  main.append(hero);
  const refreshHero = () => {
    if (!webglAvailable()) {
      clear(fig);
      fig.append(boardSvg(boardId, { title: BOARDS[boardId].name }).svg);
      return;
    }
    try {
      if (!scene) scene = new BoardScene(fig, { quality: autoQuality() === 'alta' ? 'media' : autoQuality(), reducedMotion: true });
      const spec = resolveSpec(cfg());
      scene.setGame(spec);
      scene.hints = false;
      scene.setState(initialState(spec, 0), null);
    } catch {
      scene?.dispose();
      scene = null;
      clear(fig);
      fig.append(boardSvg(boardId).svg);
    }
  };

  // ---- 1. tavola ----
  const boardCards = h('div', { class: 'grid2', role: 'radiogroup', 'aria-label': 'Tavola' });
  const rulesetCards = h('div', { class: 'grid2', role: 'radiogroup', 'aria-label': 'Regolamento' });
  const matrixBox = h('div');
  const pathBox = h('div', { class: 'card' });

  const drawBoards = () => {
    clear(boardCards);
    for (const b of Object.values(BOARDS)) {
      const deco = DECORATIONS[b.id];
      const card = h('div', { class: 'card selectable', role: 'radio', tabindex: 0, 'aria-checked': String(b.id === boardId) },
        h('h3', null, b.name),
        h('div', { class: 'preset-meta' },
          h('span', null, h('strong', null, 'Periodo: '), b.period),
          h('span', null, h('strong', null, 'Riferimento: '), b.reference),
          h('span', null, h('strong', null, 'Misure: '), `${measure(b.dims.length)} × ${measure(b.dims.width)} × ${measure(b.dims.height)}`)),
        boardSvg(b.id, { title: `Schema: ${b.name}` }).svg,
        h('p', { class: 'small muted' }, b.id === 'ur-iii'
          ? 'Venti caselle: blocco 3×4, ponte di due caselle, blocco 3×2. Decorazioni riprodotte casella per casella dallo stato museale attuale.'
          : 'Venti caselle: blocco 3×4 e prolungamento di otto (fila centrale di dodici). Le placchette del reperto non sono marcate: le caselle speciali sono una sovrapposizione tratteggiata (Finkel 2007, figg. 3.2b e 3.5).'),
        h('p', { class: 'small' }, deco.notes[deco.notes.length - 1]));
      const choose = () => { boardId = b.id; prefs.set('board', b.id); redraw(); };
      card.addEventListener('click', choose);
      card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(); } });
      boardCards.append(card);
    }
  };

  const drawRulesets = () => {
    clear(rulesetCards);
    for (const r of Object.values(RULESETS)) {
      const c = compatOf(boardId, r.id);
      const dice = DICE_SYSTEMS[r.dice];
      const card = h('div', { class: 'card selectable', role: 'radio', tabindex: 0, 'aria-checked': String(r.id === rulesetId) },
        h('h3', null, r.name, ' ', h('small', { class: 'muted' }, `v${r.version}`)),
        h('div', { class: 'row', style: 'margin:4px 0 8px' }, tagFor(c.status), h('span', { class: 'tag neutral' }, CATEGORY_LABEL[c.category])),
        h('div', { class: 'preset-meta' },
          h('span', null, h('strong', null, 'Riferimento: '), r.author),
          h('span', null, h('strong', null, 'Stato storico: '), r.historicalStatus),
          h('span', null, h('strong', null, 'Dadi: '), dice.name, ' — ', dice.distribution.filter((d) => !d.label.includes('dopo')).map((d) => `${d.value}: ${(d.p * 16).toFixed(0)}/16`).join(', ').replace(/\/16/g, r.dice === 'binari-4' ? '/16' : '/16')),
        ),
        h('ul', { class: 'small', style: 'margin:6px 0 8px;padding-left:18px' }, ...r.components.map((x) => h('li', null, x))),
        h('p', { class: 'small muted' }, c.note),
        h('a', { href: `#/storia/regole-${r.id}`, onclick: (e: Event) => e.stopPropagation() }, 'Leggi il regolamento completo e le fonti'));
      const choose = () => { rulesetId = r.id; prefs.set('ruleset', r.id); redraw(); };
      card.addEventListener('click', choose);
      card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(); } });
      rulesetCards.append(card);
    }
  };

  const drawMatrix = () => {
    clear(matrixBox);
    const t = h('table', { class: 'matrix' },
      h('caption', { class: 'visually-hidden' }, 'Matrice di compatibilità tavola × regolamento'),
      h('thead', null, h('tr', null, h('th', null, 'Tavola \\ Regolamento'), ...Object.values(RULESETS).map((r) => h('th', { scope: 'col' }, r.name)))),
      h('tbody', null, ...Object.values(BOARDS).map((b) => h('tr', null, h('th', { scope: 'row' }, b.shortName),
        ...Object.values(RULESETS).map((r) => {
          const c = COMPATIBILITY.find((x) => x.boardId === b.id && x.rulesetId === r.id)!;
          const sel = b.id === boardId && r.id === rulesetId;
          return h('td', { class: sel ? 'sel' : '' },
            h('button', { class: 'btn small ghost', 'aria-pressed': String(sel), onclick: () => { boardId = b.id; rulesetId = r.id; prefs.set('board', b.id); prefs.set('ruleset', r.id); redraw(); } }, tagFor(c.status)),
            h('div', { class: 'small muted' }, c.note));
        })))));
    matrixBox.append(h('div', { class: 'table-wrap' }, t));
  };

  const drawPath = () => {
    clear(pathBox);
    const route = routeFor(boardId);
    const spec = resolveSpec(cfg());
    const ros = rosettePositions(route, 0);
    pathBox.append(
      h('h3', null, 'Anteprima dei percorsi'),
      h('p', { class: 'small muted' }, `${route.name}. ${route.attribution}`),
      boardSvg(boardId, { paths: [0, 1], numbers: 0, title: 'Percorsi dei due giocatori' }).svg,
      h('div', { class: 'legend' },
        h('span', null, h('span', { style: 'display:inline-block;width:22px;border-top:3px solid #2f4aa0;vertical-align:middle;margin-right:6px' }), 'Giocatore 1 (sud), numeri = case'),
        h('span', null, h('span', { style: 'display:inline-block;width:22px;border-top:3px dashed #b5523b;vertical-align:middle;margin-right:6px' }), 'Giocatore 2 (nord)')),
      h('p', { class: 'small' }, `Percorso individuale di ${spec.length} case (le caselle fisiche sono 20); rosette sulle case ${ros.join(', ')}; uscita con il punteggio esatto alla mossa ${spec.length + 1}. Caselle condivise: ${route.paths[0].filter((c) => route.paths[1].includes(c)).length}.`),
      spec.ruleset.advanced ? h('p', { class: 'small' }, `Ingressi: ${spec.ruleset.pieceKinds.map((k) => `${k.name} con ${k.entryThrow} → casa ${k.entryHouse}`).join('; ')}. Rientro della Rondine sulle case ${ros.map((r) => r - 1).filter((x) => x > 0).join(', ')}.`) : '',
    );
  };

  // ---- 3. modalità ----
  const modeBox = h('div', { class: 'modes', id: 'modalita' });
  const modePanel = h('div', { class: 'card', hidden: true, 'aria-live': 'polite' });

  const lockNote = () => h('p', { class: 'small muted' }, `Configurazione: ${configLabel(resolveSpec(cfg()).key)}. Tavola, regolamento e versione si bloccano quando la sfida viene accettata.`);

  const openPanel = (build: () => Promise<void> | void) => {
    modePanel.hidden = false;
    clear(modePanel);
    void build();
    modePanel.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'nearest' });
  };

  const localSetup = async () => {
    modePanel.append(h('h3', null, 'Partita sullo stesso dispositivo'), lockNote(),
      h('p', { class: 'small' }, 'Le partite locali non sono classificate e vengono salvate come tali. Gli esiti dei dadi sono estratti su questo dispositivo con il generatore crittografico del browser.'));
    const seats: LocalSeatDef[] = [];
    const nameA = h('input', { type: 'text', id: 'loc-a', value: 'Ospite 1', maxlength: 24 });
    const secondKind = h('select', { id: 'loc-kind' },
      h('option', { value: 'guest' }, 'Ospite (nome libero)'),
      session.user ? h('option', { value: 'friend' }, 'Un amico, senza verifica dell\'identità') : null,
      session.user ? h('option', { value: 'verify' }, 'Un altro account, con conferma dell\'identità') : null);
    const nameB = h('input', { type: 'text', id: 'loc-b', value: session.user ? 'Ospite' : 'Ospite 2', maxlength: 24 });
    const friendSel = h('select', { id: 'loc-friend' });
    const vUser = h('input', { type: 'text', id: 'loc-vu', autocomplete: 'off' });
    const vPass = h('input', { type: 'password', id: 'loc-vp', autocomplete: 'off' });
    const vMsg = h('p', { class: 'small', role: 'status' });
    let attestation: { token: string; user: { id: string; username: string } } | null = null;
    const hostFirst = h('select', { id: 'loc-seat' }, h('option', { value: '0' }, 'Lato sud (giocatore 1)'), h('option', { value: '1' }, 'Lato nord (giocatore 2)'));
    const orient = h('select', { id: 'loc-orient' }, h('option', { value: 'turno' }, 'Ruota verso chi è di turno'), h('option', { value: 'sud' }, 'Fissa dal lato sud'), h('option', { value: 'nord' }, 'Fissa dal lato nord'));
    orient.value = prefs.get('localOrient', 'turno');
    const friendRow = h('div', { class: 'field', hidden: true }, h('label', { for: 'loc-friend' }, 'Amico'), friendSel,
      h('p', { class: 'small muted' }, 'Scegliere un nome dalla lista amici non autentica quella persona: la partita lo indicherà come «non verificato».'));
    const verifyRow = h('div', { class: 'stack', hidden: true },
      h('p', { class: 'small' }, 'Il secondo giocatore inserisce le proprie credenziali. La tua sessione resta attiva: la verifica vale solo per questa partita (15 minuti).'),
      h('div', { class: 'grid2' }, h('div', { class: 'field' }, h('label', { for: 'loc-vu' }, 'Username del secondo giocatore'), vUser), h('div', { class: 'field' }, h('label', { for: 'loc-vp' }, 'Password'), vPass)),
      h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: async () => {
        vMsg.textContent = 'Verifica…';
        try {
          const r = await post('/api/local/verify', { username: vUser.value, password: vPass.value });
          attestation = { token: r.attestation, user: r.user };
          vPass.value = '';
          vMsg.textContent = `Identità confermata: ${r.user.username}.`;
        } catch (e) {
          attestation = null;
          vMsg.textContent = (e as Error).message;
        }
      } }, 'Conferma identità'), vMsg));
    const guestRow = h('div', { class: 'field' }, h('label', { for: 'loc-b' }, 'Nome del secondo giocatore'), nameB);
    secondKind.addEventListener('change', async () => {
      guestRow.hidden = secondKind.value !== 'guest';
      friendRow.hidden = secondKind.value !== 'friend';
      verifyRow.hidden = secondKind.value !== 'verify';
      if (secondKind.value === 'friend' && !friendSel.options.length) {
        const f = await get('/api/friends').catch(() => ({ friends: [] }));
        for (const x of f.friends) friendSel.append(h('option', { value: x.id }, x.username));
        if (!f.friends.length) friendSel.append(h('option', { value: '' }, 'Nessun amico: aggiungine dalla pagina Amici'));
      }
    });
    const start = h('button', { class: 'btn gold', type: 'button' }, 'Inizia la partita locale');
    const err = h('p', { class: 'error', role: 'alert' });
    start.addEventListener('click', async () => {
      err.textContent = '';
      seats.length = 0;
      const first: LocalSeatDef = session.user
        ? { type: 'host', name: session.user.username, verified: true, userId: session.user.id }
        : { type: 'guest', name: nameA.value.trim() || 'Ospite 1', verified: false };
      let second: LocalSeatDef;
      let serverSeat: Record<string, unknown>;
      if (secondKind.value === 'friend') {
        const opt = friendSel.selectedOptions[0];
        if (!opt?.value) return (err.textContent = 'Scegli un amico.');
        second = { type: 'friend-unverified', name: opt.textContent!, verified: false };
        serverSeat = { type: 'friend-unverified', userId: opt.value };
      } else if (secondKind.value === 'verify') {
        if (!attestation) return (err.textContent = 'Prima conferma l\'identità del secondo giocatore.');
        second = { type: 'verified', name: attestation.user.username, verified: true, userId: attestation.user.id };
        serverSeat = { type: 'verified', attestation: attestation.token };
      } else {
        second = { type: 'guest', name: nameB.value.trim() || 'Ospite 2', verified: false };
        serverSeat = { type: 'guest', name: second.name };
      }
      const hostSeat = Number(hostFirst.value);
      const ordered = hostSeat === 0 ? [first, second] : [second, first];
      prefs.set('localOrient', orient.value);
      try {
        let ctl: LocalController;
        if (session.user) {
          const firstSrv = { type: 'host' };
          const srv = await post('/api/local/games', { ...cfg(), seats: hostSeat === 0 ? [firstSrv, serverSeat] : [serverSeat, firstSrv] });
          ctl = LocalController.newGame(cfg(), srv.seats.map((s: any) => ({ type: s.type, name: s.name, verified: s.verified, userId: s.userId })), { id: srv.id, state: srv.state });
        } else {
          ctl = LocalController.newGame(cfg(), ordered);
        }
        navigate(`#/locale/${ctl.gameId}`);
      } catch (e) {
        err.textContent = (e as Error).message;
      }
    });
    modePanel.append(h('div', { class: 'grid2' },
      h('div', { class: 'stack' },
        session.user ? h('p', null, h('strong', null, 'Primo giocatore: '), `${session.user.username} (sessione attiva)`) : h('div', { class: 'field' }, h('label', { for: 'loc-a' }, 'Nome del primo giocatore'), nameA),
        h('div', { class: 'field' }, h('label', { for: 'loc-seat' }, session.user ? 'Il tuo lato' : 'Lato del primo giocatore'), hostFirst),
        h('div', { class: 'field' }, h('label', { for: 'loc-orient' }, 'Orientamento della vista'), orient)),
      h('div', { class: 'stack' },
        h('div', { class: 'field' }, h('label', { for: 'loc-kind' }, 'Secondo giocatore'), secondKind),
        guestRow, friendRow, verifyRow)),
      !session.user ? h('p', { class: 'small muted' }, 'Come ospite la partita è salvata solo in questo browser. Accedi per salvarla anche sul server e riprenderla da un altro dispositivo.') : '',
      err, start);
  };

  const needLogin = (what: string) => {
    modePanel.append(h('h3', null, what), h('p', null, 'Serve un account per giocare fra dispositivi.'), h('a', { class: 'btn primary', href: '#/accedi/%23%2Fgioca' }, 'Accedi o registrati'));
  };

  const friendSetup = async () => {
    if (!session.user) return needLogin('Sfida un amico');
    modePanel.append(h('h3', null, 'Sfida un amico'), lockNote());
    const f = await get('/api/friends');
    if (!f.friends.length) return modePanel.append(h('p', { class: 'empty' }, 'Non hai ancora amici. ', h('a', { href: '#/amici' }, 'Cerca e aggiungi qualcuno.')));
    const list = h('ul', { class: 'list' });
    for (const fr of f.friends) {
      list.append(h('li', null, h('span', null, h('span', { class: `dot ${fr.online ? 'on' : ''}`, 'aria-hidden': 'true' }), fr.username, h('span', { class: 'visually-hidden' }, fr.online ? ' (online)' : ' (non collegato)'), !fr.online ? h('small', { class: 'muted' }, ' · non collegato') : null),
        h('button', { class: 'btn small primary', onclick: async (e: Event) => {
          (e.target as HTMLButtonElement).disabled = true;
          try {
            const inv = await post('/api/invites', { toUserId: fr.id, ...cfg() });
            toast(`Invito inviato a ${fr.username}. Scade alle ${new Date(inv.expiresAt).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}.`, 'ok');
          } catch (ex) {
            toast((ex as Error).message, 'error');
            (e.target as HTMLButtonElement).disabled = false;
          }
        } }, 'Invita')));
    }
    modePanel.append(list, h('p', { class: 'small muted' }, 'Quando l\'invito viene accettato ricevi una notifica; trovi la partita anche fra le «Partite aperte».'));
  };

  const roomSetup = async () => {
    if (!session.user) return needLogin('Stanza privata');
    const code = h('input', { type: 'text', id: 'room-code', maxlength: 6, autocomplete: 'off', style: 'text-transform:uppercase;max-width:200px' });
    modePanel.append(h('h3', null, 'Stanza privata'), lockNote(),
      h('div', { class: 'grid2' },
        h('div', { class: 'stack' }, h('p', null, 'Crea una stanza e condividi codice o link. Il codice serve a trovare la partita: chi entra occupa il posto libero con il proprio account, nessuno può prendere un posto già occupato.'),
          h('button', { class: 'btn primary', onclick: async () => {
            try {
              const r = await post('/api/rooms', cfg());
              navigate(`#/partita/${r.gameId}`);
            } catch (e) { toast((e as Error).message, 'error'); }
          } }, 'Crea stanza')),
        h('form', { class: 'stack', onsubmit: async (e: Event) => {
          e.preventDefault();
          try {
            const r = await post('/api/rooms/join', { code: code.value });
            navigate(`#/partita/${r.gameId}`);
          } catch (ex) { toast((ex as Error).message, 'error'); }
        } }, h('div', { class: 'field' }, h('label', { for: 'room-code' }, 'Hai un codice?'), code), h('button', { class: 'btn', type: 'submit' }, 'Entra'))));
  };

  let queueTimer: number | null = null;
  const matchSetup = async () => {
    if (!session.user) return needLogin('Cerca un avversario');
    const status = h('p', { role: 'status' });
    const cancel = h('button', { class: 'btn', hidden: true, onclick: async () => { await del('/api/match'); status.textContent = 'Ricerca annullata.'; cancel.hidden = true; } }, 'Annulla ricerca');
    modePanel.append(h('h3', null, 'Cerca un avversario'), lockNote(),
      h('p', null, 'Vieni abbinato al primo utente in attesa con la stessa tavola, lo stesso regolamento e la stessa versione.'),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: async () => {
        try {
          const r = await post('/api/match', cfg());
          if (r.status === 'trovato') return navigate(`#/partita/${r.gameId}`);
          status.textContent = 'In attesa di un avversario… Puoi restare su questa pagina: riceverai una notifica.';
          cancel.hidden = false;
        } catch (e) { toast((e as Error).message, 'error'); }
      } }, 'Cerca'), cancel), status);
  };
  const onNotify = (e: Event) => {
    const m = (e as CustomEvent).detail;
    if (m.kind === 'match') navigate(`#/partita/${m.gameId}`);
  };
  window.addEventListener('ur:notify', onNotify);

  const modes: [string, string, () => Promise<void> | void][] = [
    ['Stesso dispositivo', 'A turni su questo schermo, con un ospite o un amico.', localSetup],
    ['Sfida un amico', 'Invito diretto, con accettazione e scadenza.', friendSetup],
    ['Stanza privata', 'Codice o link da condividere.', roomSetup],
    ['Cerca un avversario', 'Abbinamento automatico.', matchSetup],
  ];
  for (const [title, desc, fn] of modes) {
    modeBox.append(h('button', { class: 'card selectable', style: 'text-align:left;font:inherit;color:inherit', onclick: () => openPanel(fn) }, h('h3', null, title), h('p', { class: 'small muted', style: 'margin:0' }, desc)));
  }

  // ---- partite aperte e salvataggi ----
  const openBox = h('div', { class: 'stack' });
  const drawOpen = async () => {
    clear(openBox);
    const saves = loadLocalSaves();
    if (session.user) {
      try {
        const [{ games }, local] = await Promise.all([get('/api/games/open'), get('/api/local/games')]);
        if (games.length) {
          openBox.append(h('h3', null, 'Partite online aperte'), h('ul', { class: 'list' }, ...games.map((g: any) => {
            const opp = g.players[g.yourSeat === 0 ? 1 : 0];
            const myTurn = g.status === 'active' && g.state.turn === g.yourSeat;
            return h('li', null, h('span', null, h('strong', null, opp ? `contro ${opp.username}` : 'in attesa di avversario'), ' · ', h('span', { class: 'small muted' }, configLabel(g.configKey)), g.roomCode ? h('span', { class: 'small' }, ` · codice ${g.roomCode}`) : null, myTurn ? h('span', { class: 'tag interpretazione', style: 'margin-left:8px' }, 'Tocca a te') : null),
              h('a', { class: 'btn small primary', href: `#/partita/${g.id}` }, 'Riprendi'));
          })));
        }
        const srvLocal = local.games.filter((g: any) => g.status === 'active');
        if (srvLocal.length) {
          openBox.append(h('h3', null, 'Partite locali salvate sul server'), h('ul', { class: 'list' }, ...srvLocal.map((g: any) => h('li', null,
            h('span', null, g.seats.map((s: any) => `${s.name}${s.verified ? '' : ' (non verificato)'}`).join(' contro '), ' · ', h('span', { class: 'small muted' }, `${configLabel(g.configKey)} · ${fmtDate(g.updatedAt)}`)),
            h('span', { class: 'row' },
              h('button', { class: 'btn small primary', onclick: () => {
                // riprende dal server (anche da un altro dispositivo)
                const existing = saves.find((s) => s.serverId === g.id);
                if (!existing || existing.state.version < g.state.version) {
                  LocalController.newGame(g.state.config, g.seats.map((s: any) => ({ type: s.type, name: s.name, verified: s.verified, userId: s.userId })), { id: g.id, state: g.state });
                }
                navigate(`#/locale/${g.id}`);
              } }, 'Riprendi'),
              h('button', { class: 'btn small danger', onclick: async () => { await del(`/api/local/games/${g.id}`); deleteLocalSave(g.id); void drawOpen(); } }, 'Elimina'))))));
        }
      } catch (e) {
        openBox.append(h('p', { class: 'notice warn' }, `Impossibile caricare le partite dal server: ${(e as Error).message}`));
      }
    }
    const guestSaves = saves.filter((s) => !s.serverId && s.state.phase !== 'finished');
    if (guestSaves.length) {
      openBox.append(h('h3', null, 'Partite locali in questo browser'), h('ul', { class: 'list' }, ...guestSaves.map((s) => h('li', null,
        h('span', null, s.seats.map((x) => x.name).join(' contro '), ' · ', h('span', { class: 'small muted' }, `${configLabel(resolveSpec(s.config).key)} · ${fmtDate(s.updatedAt)}`)),
        h('span', { class: 'row' }, h('a', { class: 'btn small primary', href: `#/locale/${s.id}` }, 'Riprendi'),
          h('button', { class: 'btn small danger', onclick: () => { deleteLocalSave(s.id); void drawOpen(); } }, 'Elimina'))))));
    }
    if (!openBox.childElementCount) openBox.append(h('p', { class: 'empty' }, 'Nessuna partita aperta.'));
  };

  const redraw = () => {
    drawBoards();
    drawRulesets();
    drawMatrix();
    drawPath();
    refreshHero();
    if (!modePanel.hidden) modePanel.querySelector('p.small.muted')?.replaceWith(lockNote());
  };

  main.append(h('div', { class: 'steps' },
    h('section', { class: 'step section' }, h('h2', null, 'Scegli la tavola'), boardCards),
    h('section', { class: 'step section' }, h('h2', null, 'Scegli il regolamento'), rulesetCards,
      h('div', { class: 'grid2', style: 'margin-top:16px' }, pathBox, h('div', { class: 'card' }, h('h3', null, 'Compatibilità tavola × regolamento'),
        h('p', { class: 'small muted' }, 'Gli abbinamenti non attestati sono disponibili solo come «Adattamento moderno», con percorsi completamente definiti.'), matrixBox))),
    h('section', { class: 'step section' }, h('h2', null, 'Scegli come giocare'), modeBox, h('div', { style: 'margin-top:14px' }, modePanel)),
    h('section', { class: 'section' }, h('div', { class: 'section-title' }, h('h2', null, 'Partite da riprendere')), openBox)));
  redraw();
  void drawOpen();
  if (sessionStorage.getItem('ur.challenge')) {
    sessionStorage.removeItem('ur.challenge');
    openPanel(friendSetup);
  }
  return () => {
    window.removeEventListener('ur:notify', onNotify);
    if (queueTimer) clearInterval(queueTimer);
    scene?.dispose();
  };
}

/** Link di invito a una stanza: #/stanza/CODICE */
export async function renderJoinRoom(main: HTMLElement, code: string) {
  main.append(h('section', { class: 'card', style: 'max-width:520px;margin:40px auto' }, h('h1', null, 'Entra nella stanza'), h('p', { class: 'code' }, code.toUpperCase()), h('p', { role: 'status' }, 'Ricerca della stanza…')));
  try {
    const r = await post('/api/rooms/join', { code });
    navigate(`#/partita/${r.gameId}`);
  } catch (e) {
    main.querySelector('[role=status]')!.textContent = (e as Error).message;
  }
  return () => {};
}

export { ROUTES };
