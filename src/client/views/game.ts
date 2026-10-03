// Schermata di partita, comune a online e locale.
// Flusso di una mossa: seleziona (anteprima sulla tavola + valutazione) → conferma.

import { availableActions, explainIllegal, kindOf, moveInsight, piecesInReserve, piecesOff, RuleError, type GameEvent, type Move, type Player } from '../../engine/index.ts';
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

// Icone disegnate (tratto 1,8, stesso stile)
const ICON = {
  reset: '<path d="M4 12a8 8 0 1 0 2.3-5.6" /><path d="M4 4v4h4" />',
  top: '<rect x="4" y="4" width="16" height="16" rx="2" /><path d="M4 12h16M12 4v16" />',
  plus: '<path d="M12 5v14M5 12h14" />',
  minus: '<path d="M5 12h14" />',
};
function icon(name: keyof typeof ICON) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('fill', 'none');
  s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '1.8');
  s.setAttribute('stroke-linecap', 'round');
  s.setAttribute('stroke-linejoin', 'round');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = ICON[name];
  return s;
}

const opp = (p: Player) => (1 - p) as Player;
const pct = (x: number) => `${Math.round(x * 100)}%`;

function describeEvent(ctl: Controller, e: GameEvent): string | null {
  const name = (p: Player) => ctl.seats[p].name;
  const spec = ctl.spec;
  const pieceName = (id: string) => {
    const p = ctl.state.pieces.find((x) => x.id === id)!;
    return spec.ruleset.advanced ? kindOf(spec, p.kind).name : 'una pedina';
  };
  switch (e.type) {
    case 'rolled':
      return spec.ruleset.dice === 'binari-4' ? `${name(e.player)} lancia ${e.value}` : `${name(e.player)} lancia il dado 1–4: ${e.value}`;
    case 'converted':
      return e.yes ? `Dado sì/no: «sì», il punteggio diventa ${e.value}` : `Dado sì/no: «no», turno perso`;
    case 'moved': {
      const m = e.move;
      const what = pieceName(m.pieceId);
      if (m.enter) return `${name(e.player)} fa entrare ${what} nella casa ${m.to}`;
      if (m.exit) return `${name(e.player)} porta fuori ${what}`;
      return `${name(e.player)} muove ${what} dalla casa ${m.from} alla ${m.to}${m.landsRosette ? ' (rosetta)' : ''}`;
    }
    case 'captured':
      return `Cattura: la pedina di ${name(opp(e.player))} torna in riserva`;
    case 'counters':
      return e.reason === 'rosetta' ? `${name(e.player)} incassa ${e.delta} gettoni` : e.reason === 'superata' ? `${name(e.player)} supera una rosetta e paga ${-e.delta} gettoni` : `${name(e.player)} paga ${-e.delta} gettoni di penalità`;
    case 'extra-turn':
      return `Rosetta: ${name(e.player)} lancia di nuovo`;
    case 'turn-passed':
      return { zero: `${name(e.player)} ha fatto 0: il turno passa`, 'nessuna-mossa': `${name(e.player)} non ha mosse: il turno passa`, 'conversione-no': null, passa: `${name(e.player)} passa` }[e.reason] ?? null;
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
  let quick = prefs.get('quickMove', false);
  /** Mossa selezionata (in anteprima, non ancora giocata). */
  let selected: Move | null = null;
  /** Pedina con più destinazioni, in attesa della scelta della casa. */
  let pickingPiece: string | null = null;
  let hover: Move | null = null;
  let lastTurnMine: boolean | null = null;
  const baseTitle = document.title;

  const stage = h('div', { class: 'stage' });
  const viewport = h('div', { class: 'viewport' });
  stage.append(viewport);
  const panel = h('aside', { class: 'panel', 'aria-label': 'Partita' });
  main.append(h('div', { class: 'game' }, stage, panel));

  // ---------- elementi della scena ----------
  const tools = h('div', { class: 'stage-tools', role: 'toolbar', 'aria-label': 'Vista' },
    h('button', { class: 'btn', title: 'Ripristina inquadratura (R)', 'aria-label': 'Ripristina inquadratura', onclick: () => scene?.resetView() }, icon('reset')),
    h('button', { class: 'btn', title: 'Vista dall\'alto (T)', 'aria-label': 'Vista dall\'alto', onclick: () => scene?.topView() }, icon('top')),
    h('button', { class: 'btn', title: 'Avvicina', 'aria-label': 'Avvicina', onclick: () => scene?.zoom(0.85) }, icon('plus')),
    h('button', { class: 'btn', title: 'Allontana', 'aria-label': 'Allontana', onclick: () => scene?.zoom(1.18) }, icon('minus')));
  const hudWho = h('div', { class: 'hud-who' });
  const hudMid = h('div', { class: 'hud-mid', 'aria-live': 'polite' });
  const hudAct = h('div', { class: 'hud-act' });
  const hud = h('div', { class: 'hud', role: 'region', 'aria-label': 'Turno e azioni' }, hudWho, hudMid, hudAct);
  const timerEl = h('span', { class: 'timer' });

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
      svgView = new SvgBoardView(viewport, spec);
      svgView.onPick = onPick;
      if (!prefs.get('force2d', false)) renderNotice.append(h('p', { class: 'notice warn small' }, 'WebGL non è disponibile su questo dispositivo: viene usata la vista 2D, pienamente giocabile.'));
    } else {
      try {
        scene = new BoardScene(viewport, { quality: quality === 'auto' ? autoQuality() : quality, reducedMotion: reduced });
        scene.hints = hints;
        scene.setMarksVisible(prefs.get('marks', true));
        scene.showLabels = prefs.get('labels', true);
        scene.setGame(spec);
        scene.onPick = onPick;
        scene.onHover = onHover;
        scene.setOrientation(orientation());
        scene.finishTweens();
        scene.resetView();
        scene.setState(ctl.state, null);
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
        svgView = new SvgBoardView(viewport, spec);
        svgView.onPick = onPick;
        renderNotice.append(h('p', { class: 'notice warn small' }, 'Impossibile avviare il rendering 3D: viene usata la vista 2D.'));
      }
    }
    stage.append(tools, hud);
  };

  function orientation(): Player {
    if (ctl.mode === 'online') return ((ctl as OnlineController).yourSeat ?? 0) as Player;
    const pref = prefs.get<string>('localOrient', 'turno');
    if (pref === 'sud') return 0;
    if (pref === 'nord') return 1;
    return ctl.state.turn;
  }

  // ---------- pannello ----------
  const playersBox = h('div', { class: 'players' });
  const why = h('p', { class: 'why', role: 'alert' });
  const movesHead = h('h3', { class: 'panel-h' });
  const movesBox = h('div', { class: 'moves', role: 'group', 'aria-label': 'Mosse possibili' });
  const confirmBox = h('div');
  const logList = h('ol', { class: 'log', 'aria-label': 'Cronologia della partita' });
  const endBox = h('div');
  const actionsRow = h('div', { class: 'row' });

  const settings = h('details', null, h('summary', null, 'Impostazioni'), h('div', { class: 'settings-grid' },
    h('label', null, h('input', { type: 'checkbox', checked: quick, onchange: (e: Event) => { quick = (e.target as HTMLInputElement).checked; prefs.set('quickMove', quick); refresh([]); } }), 'Gioca la mossa al primo tocco (senza anteprima)'),
    h('label', null, h('input', { type: 'checkbox', checked: hints, onchange: (e: Event) => { hints = (e.target as HTMLInputElement).checked; prefs.set('hints', hints); if (scene) scene.hints = hints; refresh([]); } }), 'Evidenzia le pedine che possono muovere'),
    h('label', null, h('input', { type: 'checkbox', checked: prefs.get('insights', true), onchange: (e: Event) => { prefs.set('insights', (e.target as HTMLInputElement).checked); refresh([]); } }), 'Mostra la valutazione delle mosse (rischio di cattura)'),
    h('label', null, h('input', { type: 'checkbox', checked: prefs.get('showPath', false), onchange: (e: Event) => { const v = (e.target as HTMLInputElement).checked; prefs.set('showPath', v); scene?.showPath(v ? ctl.state.turn : null); } }), 'Mostra il percorso di chi è di turno'),
    spec.board.id === 'tarda' ? h('label', null, h('input', { type: 'checkbox', checked: prefs.get('marks', true), onchange: (e: Event) => { const v = (e.target as HTMLInputElement).checked; prefs.set('marks', v); scene?.setMarksVisible(v); } }), 'Mostra le caselle speciali (sovrapposizione)') : '',
    spec.ruleset.advanced ? h('label', null, h('input', { type: 'checkbox', checked: prefs.get('labels', true), onchange: (e: Event) => { const v = (e.target as HTMLInputElement).checked; prefs.set('labels', v); if (scene) { scene.showLabels = v; scene.requestRender(); } } }), 'Etichette delle pedine') : '',
    ctl.mode === 'local' ? h('label', null, 'Vista ', h('select', { onchange: (e: Event) => { prefs.set('localOrient', (e.target as HTMLSelectElement).value); scene?.setOrientation(orientation()); } },
      h('option', { value: 'turno', selected: prefs.get<string>('localOrient', 'turno') === 'turno' }, 'ruota verso chi è di turno'), h('option', { value: 'sud', selected: prefs.get<string>('localOrient', '') === 'sud' }, 'fissa dal lato sud'), h('option', { value: 'nord', selected: prefs.get<string>('localOrient', '') === 'nord' }, 'fissa dal lato nord'))) : '',
    h('label', null, 'Qualità grafica ', h('select', { onchange: (e: Event) => { quality = (e.target as HTMLSelectElement).value as Quality | 'auto'; prefs.set('quality', quality); startRender(); refresh([]); } },
      ...(['auto', 'alta', 'media', 'bassa'] as const).map((q) => h('option', { value: q, selected: q === quality }, q === 'auto' ? 'automatica' : q)))),
    h('label', null, h('input', { type: 'checkbox', checked: prefs.get('reducedMotion', false), onchange: (e: Event) => { prefs.set('reducedMotion', (e.target as HTMLInputElement).checked); toast('Si applica alla prossima apertura della partita.'); } }), 'Riduci le animazioni'),
    h('label', null, h('input', { type: 'checkbox', checked: prefs.get('force2d', false), onchange: (e: Event) => { prefs.set('force2d', (e.target as HTMLInputElement).checked); startRender(); refresh([]); } }), 'Vista 2D semplificata'),
    h('p', { class: 'mini' }, 'Tasti: ', h('span', { class: 'kbd' }, 'Spazio'), ' lancia · ', h('span', { class: 'kbd' }, '1–9'), ' sceglie una mossa · ', h('span', { class: 'kbd' }, 'Invio'), ' conferma · ', h('span', { class: 'kbd' }, 'Esc'), ' annulla · ', h('span', { class: 'kbd' }, 'R'), ' / ', h('span', { class: 'kbd' }, 'T'), ' vista.'),
    h('p', { class: 'mini' }, 'L\'animazione dei dadi visualizza un esito già estratto ', ctl.mode === 'online' ? 'dal server con casualità crittografica' : 'dal generatore crittografico del browser', '; non è una simulazione fisica dei dadi antichi.'),
    ctl.mode === 'online' ? h('p', { class: 'mini' }, 'Tempo: se scade il turno mentre l\'avversario è collegato, chi è di turno perde; se nessuno è collegato la partita resta in pausa.') : ''));

  panel.append(
    h('div', { class: 'panel-head' }, h('h2', null, spec.board.shortName), h('div', { class: 'mini' }, `${spec.ruleset.name} · ${CATEGORY_LABEL[ctl.category] ?? ctl.category}`)),
    renderNotice, playersBox,
    h('section', null, movesHead, why, confirmBox, movesBox),
    endBox, actionsRow,
    h('details', null, h('summary', null, 'Cronologia'), logList),
    settings,
    h('p', { class: 'mini', style: 'margin:0' }, h('a', { href: `#/storia/regole-${spec.ruleset.id}`, target: '_blank', rel: 'noopener' }, 'Regole complete e fonti'), ' · ', configLabel(spec.key)));

  const pushLog = (text: string, who?: Player) => {
    logList.prepend(h('li', null, who !== undefined ? h('span', { class: `who p${who}`, 'aria-hidden': 'true' }) : '', h('span', null, text)));
    while (logList.childElementCount > 120) logList.lastElementChild?.remove();
  };

  const isMine = () => ctl.status === 'active' && ctl.controls(ctl.state.turn);
  const canAct = () => isMine() && !ctl.busy;
  const currentMoves = (): Move[] => (ctl.status === 'active' ? availableActions(spec, ctl.state).moves : []);
  const sameMove = (a: Move | null, b: Move | null) => !!a && !!b && a.pieceId === b.pieceId && a.to === b.to;

  const doAct = async (a: Parameters<Controller['act']>[0]) => {
    if (!canAct()) return;
    why.textContent = '';
    selected = null;
    pickingPiece = null;
    hover = null;
    scene?.setPreview(null);
    try {
      await ctl.act(a);
    } catch (e) {
      why.textContent = e instanceof RuleError ? e.message : (e as Error).message;
      refresh([]);
    }
  };
  const confirmSelected = () => {
    if (selected) void doAct({ type: 'move', pieceId: selected.pieceId, to: selected.to });
  };

  const select = (m: Move | null) => {
    if (m && (quick || sameMove(m, selected))) return void doAct({ type: 'move', pieceId: m.pieceId, to: m.to }); // secondo tocco = conferma
    selected = m;
    pickingPiece = null;
    why.textContent = '';
    showPreview();
    drawMoves();
    drawHud();
  };

  function showPreview() {
    const m = hover ?? selected;
    scene?.setPreview(m);
    const moves = canAct() && availableActions(spec, ctl.state).roll === false ? currentMoves() : [];
    scene?.setInteraction(moves, pickingPiece ?? selected?.pieceId ?? null);
    svgView?.render(ctl.state, moves, pickingPiece ?? selected?.pieceId ?? null);
  }

  function movesFor(moves: Move[], pieceId: string): Move[] {
    const st = ctl.state;
    let list = moves.filter((m) => m.pieceId === pieceId);
    const piece = st.pieces.find((p) => p.id === pieceId);
    // le pedine in riserva dello stesso tipo sono intercambiabili
    if (!list.length && piece && piece.pos === 0) list = moves.filter((m) => m.enter && m.owner === piece.owner && st.pieces.find((p) => p.id === m.pieceId)!.kind === piece.kind);
    return list;
  }

  function onHover(t: { pieceId?: string; to?: number } | null) {
    if (!canAct()) return;
    let m: Move | null = null;
    if (t?.pieceId) {
      const list = movesFor(currentMoves(), t.pieceId);
      m = t.to !== undefined ? (list.find((x) => x.to === t.to) ?? null) : list.length === 1 ? list[0] : null;
    }
    if (sameMove(m, hover) || (!m && !hover)) return;
    hover = m;
    showPreview();
  }

  function onPick(t: { pieceId?: string; to?: number }) {
    if (!t.pieceId) return;
    const st = ctl.state;
    const piece = st.pieces.find((p) => p.id === t.pieceId)!;
    if (ctl.status !== 'active') return void (why.textContent = 'La partita non è in corso.');
    if (!isMine()) return void (why.textContent = `Non è il tuo turno: aspetta la mossa di ${ctl.seats[st.turn].name}.`);
    if (piece.owner !== st.turn) return void (why.textContent = 'Questa pedina è dell\'avversario.');
    const av = availableActions(spec, st);
    if (av.roll) return void (why.textContent = 'Prima lancia i dadi.');
    const list = movesFor(av.moves, t.pieceId);
    if (t.to !== undefined) {
      const m = list.find((x) => x.to === t.to);
      if (m) return select(m);
    }
    if (!list.length) {
      why.textContent = explainIllegal(spec, st, t.pieceId);
      selected = null;
      showPreview();
      drawMoves();
      drawHud();
      return;
    }
    if (list.length === 1) return select(list[0]);
    // più destinazioni (Rondine): si sceglie la casa
    if (selected && list.some((m) => sameMove(m, selected))) return confirmSelected();
    selected = null;
    pickingPiece = list[0].pieceId;
    why.textContent = '';
    showPreview();
    drawMoves();
    drawHud();
  }

  // ---------- descrizione e valutazione delle mosse ----------
  const moveTitle = (m: Move) => {
    const p = ctl.state.pieces.find((x) => x.id === m.pieceId)!;
    const nm = spec.ruleset.advanced ? kindOf(spec, p.kind).name : 'Pedina';
    if (m.enter) return `${nm}: entra nella casa ${m.to}`;
    if (m.exit) return `${nm}: dalla casa ${m.from} esce`;
    return `${nm}: casa ${m.from} → ${m.to}`;
  };

  const moveTags = (m: Move) => {
    const ins = moveInsight(spec, ctl.state, m);
    const tags: HTMLElement[] = [];
    if (ins.capture) tags.push(h('span', { class: 'mtag good' }, 'Cattura'));
    if (ins.exit) tags.push(h('span', { class: 'mtag good' }, 'Esce'));
    if (ins.rosette) tags.push(h('span', { class: 'mtag good' }, ins.extraTurn ? 'Rosetta · lanci ancora' : 'Rosetta'));
    if (ins.counters) tags.push(h('span', { class: `mtag ${ins.counters > 0 ? 'good' : 'bad'}` }, `${ins.counters > 0 ? '+' : '−'}${Math.abs(ins.counters)} gettoni`));
    if (prefs.get('insights', true) && !ins.exit) {
      if (ins.riskAfter) tags.push(h('span', { class: 'mtag bad', title: 'Probabilità che l\'avversario possa catturarla al suo prossimo lancio' }, `Rischio ${pct(ins.riskAfter)}`));
      else tags.push(h('span', { class: 'mtag info' }, 'Al sicuro'));
      if (ins.riskBefore && !ins.riskAfter) tags.push(h('span', { class: 'mtag info' }, `Ora a rischio ${pct(ins.riskBefore)}`));
    }
    return tags;
  };

  function drawMoves() {
    clear(movesBox);
    clear(confirmBox);
    clear(movesHead);
    const st = ctl.state;
    const av = ctl.status === 'active' ? availableActions(spec, st) : null;
    if (!av) return void movesHead.append('Partita conclusa');
    if (!isMine()) {
      movesHead.append('Mosse', h('small', null, `in attesa di ${ctl.seats[st.turn].name}`));
      return;
    }
    if (av.roll) return void movesHead.append('Mosse', h('small', null, 'lancia per vederle'));
    const moves = av.moves;
    movesHead.append(moves.length ? 'Scegli una mossa' : 'Nessuna mossa con questo punteggio', h('small', null, moves.length ? (quick ? 'si gioca al primo tocco' : 'tocca per l\'anteprima, poi conferma') : ''));
    if (pickingPiece) {
      confirmBox.append(h('p', { class: 'notice lapis small', style: 'margin:0 0 8px' }, 'Questa pedina può entrare in più case: scegline una dall\'elenco o sulla tavola.'));
    }
    moves.forEach((m, i) => {
      const isSel = sameMove(m, selected);
      movesBox.append(h('div', { class: `move-wrap${isSel ? ' sel' : ''}` }, h('button', {
        class: 'move', 'aria-pressed': String(isSel), 'data-move': i,
        onclick: () => select(m),
        onmouseenter: () => { if (!canAct()) return; hover = m; showPreview(); },
        onmouseleave: () => { hover = null; showPreview(); },
      }, h('span', { class: 'kbd k' }, String(i + 1)), h('span', { class: 'title' }, moveTitle(m)), h('span', { class: 'tags' }, ...moveTags(m))),
      isSel ? h('div', { class: 'move-confirm' }, h('span', { class: 'mini' }, 'Anteprima sulla tavola'), h('button', { class: 'btn small ghost', onclick: () => select(null) }, 'Annulla'), h('button', { class: 'btn small primary', onclick: confirmSelected }, 'Conferma')) : ''));
    });
  }

  // ---------- HUD ----------
  const chipCls = (p: Player) => `chip p${p}${spec.board.id === 'tarda' ? ' cone' : ''}`;
  function drawHud() {
    const st = ctl.state;
    clear(hudWho);
    clear(hudMid);
    clear(hudAct);
    hud.classList.remove('mine', 'theirs', 'over');
    if (ctl.status === 'finished') {
      hud.classList.add('over');
      const iWon = ctl.mode === 'online' && st.winner === (ctl as OnlineController).yourSeat;
      hudWho.append(h('span', { class: chipCls(st.winner!), 'aria-hidden': 'true' }), h('div', null, h('div', { class: 't1' }, iWon ? 'Hai vinto!' : `Vince ${ctl.seats[st.winner!].name}`), h('div', { class: 't2' }, REASON_LABEL[st.finishReason ?? ''] ?? '')));
      return;
    }
    if (ctl.status === 'waiting') {
      hudWho.append(h('div', null, h('div', { class: 't1' }, 'In attesa dell\'avversario'), h('div', { class: 't2' }, 'Condividi il codice della stanza dal pannello')));
      return;
    }
    const mine = isMine();
    hud.classList.add(mine ? 'mine' : 'theirs');
    const turnName = ctl.seats[st.turn].name;
    const title = ctl.mode === 'online' ? (mine ? 'Tocca a te' : `Turno di ${turnName}`) : `Tocca a ${turnName}`;
    hudWho.append(h('span', { class: chipCls(st.turn), 'aria-hidden': 'true' }), h('div', null, h('div', { class: 't1' }, title), h('div', { class: 't2' }, playerSideLabel(st.turn, spec.board.id), timerEl)));

    const roll = st.roll;
    if (roll && st.phase !== 'roll') {
      if (spec.ruleset.dice === 'binari-4') {
        hudMid.append(h('span', { class: 'value', 'aria-label': `Lancio: ${roll.value}` }, String(roll.value)),
          h('span', { class: 'pips', title: 'Vertici marcati rivolti in alto', 'aria-hidden': 'true' }, ...roll.dice.map((d) => h('span', { class: `pip ${d ? 'on' : ''}` }))));
      } else {
        hudMid.append(h('span', { class: 'value' }, String(roll.value)), h('span', { class: 'mini' }, roll.converted === 1 ? `dado ${roll.primary}, «sì» → ${roll.value}` : 'dado 1–4'));
      }
    } else if (st.lastMove) {
      const lm = st.lastMove;
      hudMid.append(h('span', { class: 'mini' }, `Ultima mossa di ${ctl.seats[lm.owner].name}: ${lm.enter ? `entra in ${lm.to}` : lm.exit ? `esce da ${lm.from}` : `${lm.from} → ${lm.to}`}${lm.capture ? ', cattura' : ''}`));
    }

    if (!mine) {
      hudAct.append(h('span', { class: 'mini' }, 'Attendi…'));
      return;
    }
    const av = availableActions(spec, st);
    if (av.roll) hudAct.append(h('button', { class: 'btn gold big', disabled: ctl.busy, onclick: () => doAct({ type: 'roll' }) }, spec.ruleset.dice === 'binari-4' ? 'Lancia i dadi' : 'Lancia il dado'));
    else if (selected) hudAct.append(h('button', { class: 'btn ghost', onclick: () => select(null) }, 'Annulla'), h('button', { class: 'btn primary big', onclick: confirmSelected }, 'Conferma mossa'));
    else if (av.moves.length) hudAct.append(h('span', { class: 'mini' }, pickingPiece ? 'Scegli la casa d\'arrivo' : 'Tocca una pedina evidenziata'));
    if (av.convert) hudAct.append(h('button', { class: 'btn', title: 'Con «sì» il punteggio diventa 5, 6, 7 o 10; con «no» perdi il turno', onclick: () => doAct({ type: 'convert' }) }, `Converti ${roll?.primary} → ${{ 1: 5, 2: 6, 3: 7, 4: 10 }[roll?.primary ?? 1]}`));
    if (av.pass) hudAct.append(h('button', { class: 'btn ghost', onclick: () => doAct({ type: 'pass' }) }, 'Passa'));
  }

  // ---------- giocatori, fine partita, azioni ----------
  function refresh(events: GameEvent[]) {
    const st = ctl.state;
    const moves = currentMoves();
    if (selected && !moves.some((m) => sameMove(m, selected))) selected = null;
    if (pickingPiece && !moves.some((m) => m.pieceId === pickingPiece)) pickingPiece = null;
    if (hover && !moves.some((m) => sameMove(m, hover))) hover = null;

    clear(playersBox);
    for (const p of [0, 1] as Player[]) {
      const s = ctl.seats[p];
      const active = st.turn === p && ctl.status === 'active';
      playersBox.append(h('div', { class: `player ${active ? 'active' : 'idle'}` },
        h('span', { class: chipCls(p), 'aria-hidden': 'true' }),
        h('div', null, h('div', { class: 'name' }, s.name, active ? h('span', { class: 'now' }, 'di turno') : ''),
          h('div', { class: 'meta' }, `${playerSideLabel(p, spec.board.id)} · ${s.detail}`)),
        h('div', { class: 'counts' }, `Riserva ${piecesInReserve(st, p)}`, h('br'), `Uscite ${piecesOff(spec, st, p)}/${spec.ruleset.piecesPerPlayer}`,
          st.counters ? h('span', null, h('br'), `Gettoni ${st.counters[p]}`) : '')));
    }
    if (st.pool !== null) playersBox.append(h('p', { class: 'mini', style: 'margin:0' }, `Cassa comune: ${st.pool} gettoni (punti virtuali). Etichette: `, spec.ruleset.pieceKinds.map((k) => `${k.entryThrow} ${k.name}`).join(' · '), '.'));

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
      } }, 'Rivincita a lati invertiti'));
      actionsRow.append(h('a', { class: 'btn', href: '#/gioca' }, 'Torna a Gioca'));
    } else if (ctl.status === 'waiting') {
      const snap = (ctl as OnlineController).snapshot;
      const link = `${location.origin}/#/stanza/${snap.roomCode}`;
      endBox.append(h('div', { class: 'notice lapis' }, h('p', null, 'Condividi il codice della stanza:'), h('p', { class: 'code' }, snap.roomCode ?? '—'),
        h('div', { class: 'row' }, h('button', { class: 'btn small', onclick: async () => { try { await navigator.clipboard.writeText(link); toast('Link copiato.', 'ok'); } catch { toast(link); } } }, 'Copia link'),
          h('button', { class: 'btn small danger', onclick: async () => { const { post } = await import('../net/api.ts'); await post(`/api/games/${ctl.gameId}/cancel`); navigate('#/gioca'); } }, 'Annulla stanza'))));
    } else {
      if (ctl.resign) actionsRow.append(h('button', { class: 'btn danger small', onclick: () => confirmInline(actionsRow, 'Confermi la resa? La partita sarà registrata come persa.', async () => { await ctl.resign!(); }) }, 'Abbandona (resa)'));
      if (ctl.mode === 'local') actionsRow.append(h('span', { class: 'mini' }, (ctl as LocalController).save.serverId ? `Salvataggio: ${({ locale: 'in questo browser', sincronizzato: 'sincronizzato con il server', 'in-attesa': 'sincronizzazione…', errore: 'server non raggiungibile, salvato in questo browser' })[(ctl as LocalController).syncState]}` : 'Salvataggio automatico in questo browser.'));
    }

    for (const e of [...events].reverse()) {
      const t = describeEvent(ctl, e);
      if (t) pushLog(t, 'player' in e ? e.player : 'winner' in e ? e.winner : undefined);
    }

    // segnali di turno: fascia sul lato attivo, titolo della scheda, impulso dell'HUD quando torna il proprio turno
    const mine = isMine();
    scene?.setActiveSide(ctl.status === 'active' ? st.turn : null);
    if (scene && prefs.get('showPath', false)) scene.showPath(st.turn);
    document.title = ctl.status === 'active' && mine && ctl.mode === 'online' ? `● Tocca a te — ${baseTitle}` : baseTitle;
    if (ctl.mode === 'online' && lastTurnMine === false && mine && !reduced) {
      hud.animate?.([{ transform: 'translateX(-50%) scale(1)' }, { transform: 'translateX(-50%) scale(1.035)' }, { transform: 'translateX(-50%) scale(1)' }], { duration: 420, easing: 'cubic-bezier(.2,.8,.2,1)' });
    }
    lastTurnMine = ctl.status === 'active' ? mine : null;

    drawMoves();
    drawHud();
    showPreview();
  }

  function confirmInline(where: HTMLElement, msg: string, run: () => Promise<void>) {
    const box = h('div', { class: 'notice warn', role: 'alertdialog', 'aria-label': 'Conferma' }, h('p', null, msg),
      h('div', { class: 'row' }, h('button', { class: 'btn danger small', onclick: async () => { box.remove(); try { await run(); } catch (e) { toast((e as Error).message, 'error'); } } }, 'Conferma'),
        h('button', { class: 'btn small', onclick: () => box.remove() }, 'Annulla')));
    where.after(box);
    (box.querySelector('button') as HTMLButtonElement).focus();
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
        const rolled = events.find((e) => e.type === 'rolled') as Extract<GameEvent, { type: 'rolled' }> | undefined;
        const conv = events.find((e) => e.type === 'converted') as Extract<GameEvent, { type: 'converted' }> | undefined;
        if (rolled) await scene.showRoll({ dice: rolled.dice, value: rolled.value, primary: rolled.primary }, 'primary');
        if (conv) await scene.showRoll({ dice: [], value: conv.value, converted: conv.yes }, 'convert');
      }
      const mv = events.find((e) => e.type === 'moved') as { move: Move } | undefined;
      scene?.setState(state, mv ? mv.move : null);
      if (ctl.mode === 'local' && prefs.get<string>('localOrient', 'turno') === 'turno' && scene && scene.currentOrientation !== orientation()) {
        const o = orientation();
        setTimeout(() => scene?.setOrientation(o), reduced ? 0 : 450);
      }
      refresh(events);
    });
  });

  // ---------- tastiera ----------
  const onKey = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement).closest('input,select,textarea')) return;
    if (e.key === 'Escape') {
      scene?.finishTweens();
      if (selected || pickingPiece) select(null);
    } else if (e.key === 'Enter' && selected && !(e.target as HTMLElement).closest('button,a')) {
      e.preventDefault();
      confirmSelected();
    } else if (e.key === ' ') {
      if ((e.target as HTMLElement).closest('button,a')) return;
      if (availableActions(spec, ctl.state).roll && canAct()) { e.preventDefault(); void doAct({ type: 'roll' }); }
    } else if (/^[1-9]$/.test(e.key)) {
      const m = currentMoves()[Number(e.key) - 1];
      if (m && canAct()) { e.preventDefault(); select(m); }
    } else if (e.key === 'r' || e.key === 'R') scene?.resetView();
    else if (e.key === 't' || e.key === 'T') scene?.topView();
  };
  window.addEventListener('keydown', onKey);

  startRender();
  if (ctl.state.startRolls?.length) pushLog(`Sorteggio con il dado 1–4: ${ctl.state.startRolls.map(([a, b]) => `${a}–${b}`).join(', ')}; inizia ${ctl.seats[ctl.state.firstPlayer].name}.`);
  else pushLog(`Inizia ${ctl.seats[ctl.state.firstPlayer].name} (sorteggio).`);
  if (ctl.mode === 'local') pushLog(`Salvata il ${fmtDate((ctl as LocalController).save.updatedAt)}.`);
  refresh([]);

  return () => {
    clearInterval(tick);
    unsub();
    window.removeEventListener('keydown', onKey);
    document.title = baseTitle;
    scene?.dispose();
    svgView?.dispose();
    ctl.dispose();
  };
}
