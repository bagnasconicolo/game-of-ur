// Schermata di partita, comune a online e locale.

import { availableActions, explainIllegal, kindOf, piecesInReserve, piecesOff, RuleError, DICE_SYSTEMS, type GameEvent, type GameState, type Move, type Player } from '../../engine/index.ts';
import { h, clear, toast, prefs, prefersReducedMotion, fmtDate } from '../ui/dom.ts';
import { BoardScene, autoQuality, webglAvailable, type Quality } from '../render/board3d.ts';
import { SvgBoardView } from '../render/svgboard.ts';
import { LocalController, OnlineController, type Controller } from '../controllers.ts';
import { CATEGORY_LABEL, REASON_LABEL, configLabel, playerSideLabel } from '../labels.ts';
import { navigate } from '../ui/nav.ts';
import { session } from '../session.ts';

export async function renderGame(main: HTMLElement, gameId: string) {
  const ctl = new OnlineController(gameId);
  try {
    await ctl.load();
  } catch (e) {
    main.classList.remove('wide');
    main.append(h('div', { class: 'notice warn', role: 'alert' }, (e as Error).message, ' ', h('a', { href: '#/gioca' }, 'Torna a Gioca')));
    return () => ctl.dispose();
  }
  return mountGame(main, ctl);
}

export async function renderLocalGame(main: HTMLElement, id: string) {
  const ctl = LocalController.resume(id);
  if (!ctl) {
    main.classList.remove('wide');
    main.append(h('div', { class: 'notice warn', role: 'alert' }, 'Salvataggio non trovato in questo browser. ', session.user ? 'Le partite locali salvate sul server si riprendono da «Gioca».' : '', ' ', h('a', { href: '#/gioca' }, 'Torna a Gioca')));
    return () => {};
  }
  void ctl.sync();
  return mountGame(main, ctl);
}

function describeEvent(ctl: Controller, e: GameEvent): string | null {
  const name = (p: Player) => ctl.seats[p].name;
  const spec = ctl.spec;
  const pieceName = (id: string) => {
    const p = ctl.state.pieces.find((x) => x.id === id)!;
    return spec.ruleset.advanced ? kindOf(spec, p.kind).name : 'una pedina';
  };
  switch (e.type) {
    case 'rolled':
      return spec.ruleset.dice === 'binari-4' ? `${name(e.player)} lancia: ${e.value} (vertici marcati: ${e.dice.join(' ')})` : `${name(e.player)} lancia il dado 1–4: ${e.value}`;
    case 'converted':
      return e.yes ? `${name(e.player)} lancia il dado sì/no: «sì», il punteggio diventa ${e.value}` : `${name(e.player)} lancia il dado sì/no: «no», turno perso`;
    case 'moved': {
      const m = e.move;
      const what = pieceName(m.pieceId);
      if (m.enter) return `${name(e.player)} fa entrare ${what} nella casa ${m.to}`;
      if (m.exit) return `${name(e.player)} porta fuori ${what}`;
      return `${name(e.player)} muove ${what} dalla casa ${m.from} alla ${m.to}${m.landsRosette ? ' (rosetta)' : ''}`;
    }
    case 'captured':
      return `${name(e.player)} cattura: la pedina torna in riserva`;
    case 'counters':
      return e.reason === 'rosetta' ? `${name(e.player)} incassa ${e.delta} gettoni dalla cassa` : e.reason === 'superata' ? `${name(e.player)} supera una rosetta e paga ${-e.delta} gettoni` : `${name(e.player)} paga ${-e.delta} gettoni di penalità`;
    case 'extra-turn':
      return `${name(e.player)} è su una rosetta: lancia di nuovo`;
    case 'turn-passed':
      return { zero: `${name(e.player)} ha fatto 0: il turno passa`, 'nessuna-mossa': `${name(e.player)} non ha mosse legali: il turno passa`, 'conversione-no': null, passa: `${name(e.player)} passa` }[e.reason] ?? null;
    case 'finished':
      return `Vince ${name(e.winner)} (${REASON_LABEL[e.reason] ?? e.reason})`;
  }
  return null;
}

function mountGame(main: HTMLElement, ctl: Controller) {
  const spec = ctl.spec;
  const reduced = prefersReducedMotion() || prefs.get('reducedMotion', false);
  let quality = prefs.get<Quality | 'auto'>('quality', 'auto');
  let hints = prefs.get('hints', true);
  let selected: string | null = null;

  const stage = h('div', { class: 'stage' });
  const panel = h('aside', { class: 'panel', 'aria-label': 'Partita' });
  main.append(h('div', { class: 'game' }, stage, panel));

  // ---------- rendering: 3D se possibile, altrimenti 2D ----------
  let scene: BoardScene | null = null;
  let svgView: SvgBoardView | null = null;
  const renderNotice = h('div');
  const startRender = () => {
    scene?.dispose();
    svgView?.dispose();
    scene = null;
    svgView = null;
    clear(renderNotice);
    if (prefs.get('force2d', false) || !webglAvailable()) {
      svgView = new SvgBoardView(stage, spec);
      svgView.onPick = onPick;
      if (!prefs.get('force2d', false)) renderNotice.append(h('p', { class: 'notice warn small' }, 'WebGL non è disponibile su questo dispositivo: viene usata la vista 2D, pienamente giocabile.'));
      return;
    }
    try {
      scene = new BoardScene(stage, { quality: quality === 'auto' ? autoQuality() : quality, reducedMotion: reduced });
      scene.hints = hints;
      scene.setMarksVisible(prefs.get('marks', true));
      scene.showLabels = prefs.get('labels', true);
      scene.setGame(spec);
      scene.onPick = onPick;
      const o = orientation();
      scene.setOrientation(o);
      if (prefs.get('showPath', false)) scene.showPath(o);
      scene.renderer.domElement.addEventListener('webglcontextlost', (e) => {
        e.preventDefault();
        toast('Il contesto grafico è stato perso: passo alla vista 2D.', 'error');
        prefs.set('force2d', true);
        startRender();
        refresh([]);
      });
    } catch (e) {
      console.error(e);
      scene = null;
      svgView = new SvgBoardView(stage, spec);
      svgView.onPick = onPick;
      renderNotice.append(h('p', { class: 'notice warn small' }, 'Impossibile avviare il rendering 3D: viene usata la vista 2D.'));
    }
  };

  function orientation(): Player {
    if (ctl.mode === 'online') return ((ctl as OnlineController).yourSeat ?? 0) as Player;
    const pref = prefs.get<string>('localOrient', 'turno');
    if (pref === 'sud') return 0;
    if (pref === 'nord') return 1;
    return ctl.state.turn;
  }

  // ---------- pannello ----------
  const turnBanner = h('div', { class: 'turn-banner', role: 'status', 'aria-live': 'polite' });
  const tools = h('div', { class: 'stage-tools' },
    h('button', { class: 'btn small', title: 'Ripristina inquadratura (R)', onclick: () => scene?.resetView() }, 'Ripristina vista'),
    h('button', { class: 'btn small', title: 'Vista dall\'alto (T)', onclick: () => scene?.topView() }, 'Dall\'alto'),
    h('button', { class: 'btn small', 'aria-label': 'Avvicina', onclick: () => scene?.zoom(0.85) }, '+'),
    h('button', { class: 'btn small', 'aria-label': 'Allontana', onclick: () => scene?.zoom(1.18) }, '−'));
  stage.append(tools, turnBanner);

  const playersBox = h('div', { class: 'players' });
  const diceBox = h('div', { class: 'dice-panel' });
  const why = h('p', { class: 'why', role: 'alert', 'aria-live': 'assertive' });
  const movesBox = h('div', { class: 'moves', role: 'group', 'aria-label': 'Mosse possibili' });
  const logList = h('ol', { class: 'log', 'aria-label': 'Cronologia della partita' });
  const endBox = h('div');
  const metaBox = h('div', { class: 'small muted' });
  const timerEl = h('span', { class: 'timer' });

  const settings = h('details', null, h('summary', null, 'Impostazioni di visualizzazione'), h('div', { class: 'settings-grid' },
    h('label', null, h('input', { type: 'checkbox', checked: hints, onchange: (e: Event) => { hints = (e.target as HTMLInputElement).checked; prefs.set('hints', hints); if (scene) scene.hints = hints; refresh([]); } }), 'Evidenzia mosse possibili'),
    h('label', null, h('input', { type: 'checkbox', checked: prefs.get('showPath', false), onchange: (e: Event) => { const v = (e.target as HTMLInputElement).checked; prefs.set('showPath', v); scene?.showPath(v ? ctl.state.turn : null); } }), 'Mostra il percorso di chi è di turno'),
    spec.board.id === 'tarda' ? h('label', null, h('input', { type: 'checkbox', checked: prefs.get('marks', true), onchange: (e: Event) => { const v = (e.target as HTMLInputElement).checked; prefs.set('marks', v); scene?.setMarksVisible(v); } }), 'Mostra le caselle speciali (sovrapposizione)') : '',
    spec.ruleset.advanced ? h('label', null, h('input', { type: 'checkbox', checked: prefs.get('labels', true), onchange: (e: Event) => { const v = (e.target as HTMLInputElement).checked; prefs.set('labels', v); if (scene) { scene.showLabels = v; scene.requestRender(); } } }), 'Etichette delle pedine') : '',
    h('label', null, 'Qualità grafica ', h('select', { onchange: (e: Event) => { quality = (e.target as HTMLSelectElement).value as Quality | 'auto'; prefs.set('quality', quality); startRender(); refresh([]); } },
      ...(['auto', 'alta', 'media', 'bassa'] as const).map((q) => h('option', { value: q, selected: q === quality }, q === 'auto' ? 'automatica' : q)))),
    h('label', null, h('input', { type: 'checkbox', checked: prefs.get('reducedMotion', false), onchange: (e: Event) => { prefs.set('reducedMotion', (e.target as HTMLInputElement).checked); toast('Preferenza salvata: si applica alla prossima apertura della partita.'); } }), 'Riduci le animazioni'),
    h('label', null, h('input', { type: 'checkbox', checked: prefs.get('force2d', false), onchange: (e: Event) => { prefs.set('force2d', (e.target as HTMLInputElement).checked); startRender(); refresh([]); } }), 'Vista 2D semplificata'),
    ctl.mode === 'local' ? h('label', null, 'Orientamento ', h('select', { onchange: (e: Event) => { prefs.set('localOrient', (e.target as HTMLSelectElement).value); scene?.setOrientation(orientation()); } },
      h('option', { value: 'turno', selected: prefs.get<string>('localOrient', 'turno') === 'turno' }, 'segue il turno'), h('option', { value: 'sud', selected: prefs.get<string>('localOrient', '') === 'sud' }, 'lato sud'), h('option', { value: 'nord', selected: prefs.get<string>('localOrient', '') === 'nord' }, 'lato nord'))) : '',
    h('p', { class: 'small muted' }, 'Tasti: ', h('span', { class: 'kbd' }, 'Spazio'), ' lancia · ', h('span', { class: 'kbd' }, '1–9'), ' sceglie una mossa · ', h('span', { class: 'kbd' }, 'R'), ' ripristina · ', h('span', { class: 'kbd' }, 'T'), ' dall\'alto · ', h('span', { class: 'kbd' }, 'Esc'), ' salta l\'animazione.'),
    h('p', { class: 'small muted' }, 'L\'animazione dei dadi è una visualizzazione del lancio, non una simulazione fisica dei dadi antichi: l\'esito è estratto prima, ', ctl.mode === 'online' ? 'dal server con casualità crittografica.' : 'dal generatore crittografico del browser.')));

  const actionsRow = h('div', { class: 'row' });
  panel.append(
    h('div', null, h('h2', { style: 'margin:0' }, spec.board.shortName), metaBox),
    renderNotice, playersBox, diceBox, why,
    h('div', null, h('h3', { style: 'font-size:1.05rem;margin-bottom:6px' }, 'Mosse possibili'), movesBox),
    endBox, actionsRow,
    h('details', { open: true }, h('summary', null, 'Cronologia'), logList),
    settings,
    h('p', { class: 'small' }, h('a', { href: `#/storia/regole-${spec.ruleset.id}`, target: '_blank', rel: 'noopener' }, 'Regole complete e fonti ↗')));

  const pushLog = (text: string) => {
    logList.prepend(h('li', null, text));
    while (logList.childElementCount > 80) logList.lastElementChild?.remove();
  };

  const myTurn = () => ctl.status === 'active' && ctl.controls(ctl.state.turn) && !ctl.busy;

  const doAct = async (a: Parameters<Controller['act']>[0]) => {
    if (!myTurn()) return;
    why.textContent = '';
    selected = null;
    try {
      await ctl.act(a);
    } catch (e) {
      why.textContent = e instanceof RuleError ? e.message : (e as Error).message;
      refresh([]);
    }
  };

  function onPick(t: { pieceId?: string; to?: number }) {
    if (!t.pieceId) return;
    const st = ctl.state;
    const av = availableActions(spec, st);
    if (t.to !== undefined) {
      const m = av.moves.find((x) => x.pieceId === t.pieceId && x.to === t.to);
      if (m) return void doAct({ type: 'move', pieceId: m.pieceId, to: m.to });
    }
    const piece = st.pieces.find((p) => p.id === t.pieceId)!;
    if (!ctl.controls(piece.owner) && piece.owner !== st.turn) {
      why.textContent = 'Questa pedina appartiene all\'avversario.';
      return;
    }
    if (!myTurn()) {
      why.textContent = ctl.status !== 'active' ? 'La partita non è in corso.' : 'Non è il tuo turno.';
      return;
    }
    // pedine in riserva intercambiabili (regolamento moderno)
    let moves = av.moves.filter((m) => m.pieceId === t.pieceId);
    if (!moves.length && piece.pos === 0) moves = av.moves.filter((m) => m.enter && st.pieces.find((p) => p.id === m.pieceId)!.kind === piece.kind);
    if (!moves.length) {
      why.textContent = explainIllegal(spec, st, t.pieceId);
      selected = null;
      refreshInteraction(av.moves);
      return;
    }
    why.textContent = '';
    if (moves.length === 1) return void doAct({ type: 'move', pieceId: moves[0].pieceId, to: moves[0].to });
    selected = moves[0].pieceId;
    refreshInteraction(av.moves);
    why.textContent = 'Scegli la casa d\'arrivo evidenziata.';
  }

  const refreshInteraction = (moves: Move[]) => {
    const usable = myTurn() ? moves : [];
    scene?.setInteraction(usable, selected);
    svgView?.render(ctl.state, usable, selected);
  };

  const moveLabel = (m: Move) => {
    const p = ctl.state.pieces.find((x) => x.id === m.pieceId)!;
    const nm = spec.ruleset.advanced ? kindOf(spec, p.kind).name : 'Pedina';
    const dest = m.exit ? 'esce dalla tavola' : `casa ${m.to}`;
    const from = m.enter ? 'dalla riserva' : `dalla casa ${m.from}`;
    const extras = [m.capture ? 'cattura' : '', m.landsRosette ? 'rosetta' : '', m.passedRosettes.length ? `supera ${m.passedRosettes.length} rosetta/e` : ''].filter(Boolean);
    return `${nm} ${from} → ${dest}${extras.length ? ` (${extras.join(', ')})` : ''}`;
  };

  function refresh(events: GameEvent[]) {
    const st = ctl.state;
    const av = ctl.status === 'active' ? availableActions(spec, st) : { roll: false, convert: false, pass: false, moves: [] as Move[] };
    const turnName = ctl.seats[st.turn].name;
    metaBox.textContent = `${configLabel(spec.key)} · ${CATEGORY_LABEL[ctl.category] ?? ctl.category}`;
    clear(turnBanner);
    if (ctl.status === 'finished') {
      turnBanner.append(h('span', { class: `chip p${st.winner}` }), `Vince ${ctl.seats[st.winner!].name}`);
    } else if (ctl.status === 'waiting') {
      turnBanner.append('In attesa del secondo giocatore');
    } else {
      const mine = ctl.controls(st.turn);
      turnBanner.append(h('span', { class: `chip p${st.turn}`, 'aria-hidden': 'true' }),
        ctl.mode === 'online' ? (mine ? 'È il tuo turno' : `Turno di ${turnName}`) : `Turno di ${turnName}`,
        h('span', { class: 'small muted' }, ` · ${playerSideLabel(st.turn, spec.board.id)}`), timerEl);
    }

    clear(playersBox);
    for (const p of [0, 1] as Player[]) {
      const s = ctl.seats[p];
      playersBox.append(h('div', { class: `player ${st.turn === p && ctl.status === 'active' ? 'active' : ''}` },
        h('span', { class: `chip p${p}`, 'aria-hidden': 'true' }),
        h('div', null, h('div', { class: 'name' }, s.name, st.turn === p && ctl.status === 'active' ? h('span', { class: 'visually-hidden' }, ' (di turno)') : ''),
          h('div', { class: 'meta' }, `${playerSideLabel(p, spec.board.id)} · ${s.detail}${!s.verified && ctl.mode === 'local' ? '' : ''}`)),
        h('div', { class: 'counts' }, `In riserva: ${piecesInReserve(st, p)}`, h('br'), `Uscite: ${piecesOff(spec, st, p)}/${spec.ruleset.piecesPerPlayer}`,
          st.counters ? h('span', null, h('br'), `Gettoni: ${st.counters[p]}`) : '')));
    }
    if (st.pool !== null) playersBox.append(h('p', { class: 'small muted', style: 'margin:0' }, `Cassa comune: ${st.pool} gettoni (punti virtuali interni alla partita).`));
    if (spec.ruleset.advanced) playersBox.append(h('p', { class: 'small muted', style: 'margin:0' }, 'Etichette sulle pedine (lancio d\'ingresso): ', spec.ruleset.pieceKinds.map((k) => `${k.entryThrow} ${k.name}`).join(' · '), '. Le etichette sono un ausilio moderno.'));

    clear(diceBox);
    const roll = st.roll;
    const dsys = DICE_SYSTEMS[spec.ruleset.dice];
    if (roll && st.phase !== 'roll') {
      if (spec.ruleset.dice === 'binari-4') diceBox.append(h('div', { class: 'dice-result' }, h('strong', null, String(roll.value)), `vertici marcati in alto: ${roll.dice.map((d) => (d ? '●' : '○')).join(' ')}`));
      else diceBox.append(h('div', { class: 'dice-result' }, h('strong', null, String(roll.value)), roll.converted === 1 ? `(dado 1–4: ${roll.primary}, «sì» → ${roll.value})` : `(dado 1–4: ${roll.primary})`));
    } else if (roll && events.length === 0 && st.lastMove === null) {
      diceBox.append(h('div', { class: 'small muted' }, dsys.name));
    } else {
      diceBox.append(h('div', { class: 'small muted' }, dsys.name, roll ? ` · ultimo lancio: ${roll.value}` : ''));
    }
    const btnRow = h('div', { class: 'row' });
    if (av.roll) btnRow.append(h('button', { class: 'btn gold', disabled: !myTurn(), onclick: () => doAct({ type: 'roll' }) }, spec.ruleset.dice === 'binari-4' ? 'Lancia i dadi' : 'Lancia il dado 1–4'));
    if (av.convert) btnRow.append(h('button', { class: 'btn', disabled: !myTurn(), title: 'Con «sì» il punteggio diventa 5, 6, 7 o 10; con «no» perdi il turno', onclick: () => doAct({ type: 'convert' }) }, `Tenta la conversione (${roll?.primary} → ${{ 1: 5, 2: 6, 3: 7, 4: 10 }[roll?.primary ?? 1]})`));
    if (av.pass) btnRow.append(h('button', { class: 'btn ghost', disabled: !myTurn(), onclick: () => doAct({ type: 'pass' }) }, 'Passa'));
    if (btnRow.childElementCount) diceBox.append(btnRow);
    if (st.phase === 'decide' && myTurn()) diceBox.append(h('p', { class: 'small muted', style: 'margin:0' }, av.moves.length ? 'Puoi giocare il punteggio del dado 1–4 oppure tentare la conversione.' : 'Nessuna mossa con questo punteggio: tenta la conversione oppure passa.'));

    clear(movesBox);
    if (av.moves.length && myTurn()) {
      av.moves.forEach((m, i) => movesBox.append(h('button', { class: 'btn small', 'data-move': i, onclick: () => doAct({ type: 'move', pieceId: m.pieceId, to: m.to }) }, h('span', { class: 'kbd' }, String(i + 1)), moveLabel(m))));
    } else {
      movesBox.append(h('p', { class: 'small muted', style: 'margin:0' }, ctl.status !== 'active' ? 'Partita conclusa.' : !ctl.controls(st.turn) ? `In attesa di ${turnName}.` : av.roll ? 'Lancia per vedere le mosse.' : '—'));
    }

    clear(endBox);
    clear(actionsRow);
    if (ctl.status === 'finished') {
      const res = ctl.result;
      endBox.append(h('div', { class: 'notice' }, h('strong', null, `Vince ${ctl.seats[st.winner!].name}`), ` — ${REASON_LABEL[st.finishReason ?? ''] ?? st.finishReason}.`,
        st.counters ? h('div', { class: 'small' }, `Gettoni finali: ${ctl.seats[0].name} ${st.counters[0]}, ${ctl.seats[1].name} ${st.counters[1]}.`) : '',
        res?.ranked ? h('div', { class: 'small' }, `Elo: vincitore ${res.rating_winner_before} → ${res.rating_winner_after}; sconfitto ${res.rating_loser_before} → ${res.rating_loser_after}.`) : '',
        ctl.mode === 'local' ? h('div', { class: 'small' }, 'Partita locale: non classificata.') : res && !res.ranked ? h('div', { class: 'small' }, 'Partita non classificata (adattamento).') : ''));
      if (ctl.rematch) actionsRow.append(h('button', { class: 'btn primary', onclick: async () => { try { await ctl.rematch!(); toast('Rivincita proposta: l\'avversario riceve un invito.', 'ok'); } catch (e) { toast((e as Error).message, 'error'); } } }, 'Proponi la rivincita'));
      if (ctl.mode === 'local') actionsRow.append(h('button', { class: 'btn primary', onclick: () => {
        const l = ctl as LocalController;
        const n = LocalController.newGame(l.save.config, [...l.save.seats].reverse());
        navigate(`#/locale/${n.gameId}`);
      } }, 'Rivincita (lati invertiti, solo in questo browser)'));
      actionsRow.append(h('a', { class: 'btn', href: '#/gioca' }, 'Torna a Gioca'));
    } else if (ctl.status === 'waiting') {
      const snap = (ctl as OnlineController).snapshot;
      const link = `${location.origin}/#/stanza/${snap.roomCode}`;
      endBox.append(h('div', { class: 'notice lapis' }, h('p', null, 'Condividi il codice della stanza:'), h('p', { class: 'code' }, snap.roomCode ?? '—'),
        h('div', { class: 'row' }, h('button', { class: 'btn small', onclick: async () => { try { await navigator.clipboard.writeText(link); toast('Link copiato.', 'ok'); } catch { toast(link); } } }, 'Copia link'),
          h('button', { class: 'btn small danger', onclick: async () => { const { post } = await import('../net/api.ts'); await post(`/api/games/${ctl.gameId}/cancel`); navigate('#/gioca'); } }, 'Annulla stanza'))));
    } else {
      if (ctl.resign) actionsRow.append(h('button', { class: 'btn danger small', onclick: async () => {
        if (!confirmInline(actionsRow, 'Confermi la resa? La partita sarà registrata come persa.', async () => { await ctl.resign!(); })) return;
      } }, 'Abbandona (resa)'));
      if (ctl.mode === 'local') actionsRow.append(h('span', { class: 'small muted' }, (ctl as LocalController).save.serverId ? `Salvataggio: ${({ locale: 'in questo browser', sincronizzato: 'sincronizzato con il server', 'in-attesa': 'sincronizzazione in corso…', errore: 'server non raggiungibile, salvato in questo browser' })[(ctl as LocalController).syncState]}` : 'Salvataggio automatico in questo browser.'));
      if (ctl.mode === 'online') actionsRow.append(h('span', { class: 'small muted' }, 'Politica del tempo: se scade il turno mentre l\'avversario è collegato, chi è di turno perde; se nessun avversario è collegato, la partita va in pausa e riprende al ritorno.'));
    }

    for (const e of [...events].reverse()) {
      const t = describeEvent(ctl, e);
      if (t) pushLog(t);
    }
    if (scene && prefs.get('showPath', false)) scene.showPath(st.turn);
    refreshInteraction(av.moves);
  }

  function confirmInline(where: HTMLElement, msg: string, run: () => Promise<void>) {
    const box = h('div', { class: 'notice warn', role: 'alertdialog', 'aria-label': 'Conferma' }, h('p', null, msg),
      h('div', { class: 'row' }, h('button', { class: 'btn danger small', onclick: async () => { box.remove(); try { await run(); } catch (e) { toast((e as Error).message, 'error'); } } }, 'Conferma'),
        h('button', { class: 'btn small', onclick: () => box.remove() }, 'Annulla')));
    where.after(box);
    (box.querySelector('button') as HTMLButtonElement).focus();
    return false;
  }

  // ---------- timer ----------
  const tick = setInterval(() => {
    if (!ctl.deadline || ctl.status !== 'active') return (timerEl.textContent = ctl.mode === 'online' && ctl.status === 'active' ? ' · in pausa' : '');
    const left = Math.max(0, Math.round((ctl.deadline - (Date.now() + ctl.clockOffset)) / 1000));
    timerEl.textContent = ` · ${left}s`;
    timerEl.className = `timer ${left <= 15 ? 'low' : ''}`;
  }, 500);

  // ---------- aggiornamenti ----------
  let queue: Promise<void> = Promise.resolve();
  const unsub = ctl.subscribe((state, events, meta) => {
    if (meta.error) toast(meta.error, 'error');
    queue = queue.then(async () => {
      if (scene && events.length) {
        const rolled = events.find((e) => e.type === 'rolled');
        const conv = events.find((e) => e.type === 'converted');
        if (rolled && state.roll) await scene.showRoll(state.roll.converted === null || state.roll.converted === undefined ? state.roll : { ...state.roll }, 'primary');
        else if (rolled) await scene.showRoll({ dice: (rolled as any).dice, value: (rolled as any).value, primary: (rolled as any).primary }, 'primary');
        if (conv) await scene.showRoll({ dice: [], value: (conv as any).value, converted: (conv as any).yes }, 'convert');
      }
      const mv = events.find((e) => e.type === 'moved') as { move: Move } | undefined;
      scene?.setState(state, mv ? mv.move : null);
      if (ctl.mode === 'local' && prefs.get('localOrient', 'turno') === 'turno' && scene) {
        const o = orientation();
        if ((scene as any).orientation !== o) setTimeout(() => scene?.setOrientation(o), reduced ? 0 : 700);
      }
      refresh(events);
    });
  });

  // ---------- tastiera ----------
  const onKey = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement).closest('input,select,textarea')) return;
    if (e.key === 'Escape') scene?.finishTweens();
    else if (e.key === ' ' || e.key === 'Enter') {
      if ((e.target as HTMLElement).closest('button,a')) return;
      const av = availableActions(spec, ctl.state);
      if (av.roll && myTurn()) { e.preventDefault(); void doAct({ type: 'roll' }); }
    } else if (/^[1-9]$/.test(e.key)) {
      const b = movesBox.querySelector<HTMLButtonElement>(`[data-move="${Number(e.key) - 1}"]`);
      if (b) { e.preventDefault(); b.click(); }
    } else if (e.key === 'r' || e.key === 'R') scene?.resetView();
    else if (e.key === 't' || e.key === 'T') scene?.topView();
  };
  window.addEventListener('keydown', onKey);

  startRender();
  (scene as BoardScene | null)?.setState(ctl.state, null);
  if (ctl.state.startRolls?.length) pushLog(`Sorteggio iniziale con il dado 1–4: ${ctl.state.startRolls.map(([a, b]) => `${a}–${b}`).join(', ')}; inizia ${ctl.seats[ctl.state.firstPlayer].name}.`);
  else pushLog(`Inizia ${ctl.seats[ctl.state.firstPlayer].name} (sorteggio).`);
  if (ctl.mode === 'local') pushLog(`Partita locale salvata il ${fmtDate((ctl as LocalController).save.updatedAt)}.`);
  refresh([]);

  return () => {
    clearInterval(tick);
    unsub();
    window.removeEventListener('keydown', onKey);
    scene?.dispose();
    svgView?.dispose();
    ctl.dispose();
  };
}
