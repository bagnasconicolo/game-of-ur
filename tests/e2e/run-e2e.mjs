// Test end-to-end: due utenti reali in due contesti browser separati (Chrome via playwright-core).
// Avvia il server di produzione su un database temporaneo. Uso: npm run build && npm run test:e2e
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const out = join(root, 'tests', 'e2e', 'out');
mkdirSync(out, { recursive: true });
const PORT = 8790 + Math.floor(Math.random() * 100);
const BASE = `http://127.0.0.1:${PORT}`;
const db = join(mkdtempSync(join(tmpdir(), 'ur-e2e-')), 'e2e.db');

function startServer() {
  const s = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/server/index.ts'], {
    cwd: root, env: { ...process.env, NODE_ENV: 'production', PORT: String(PORT), DB_PATH: db, TURN_SECONDS: '600' }, stdio: ['ignore', 'pipe', 'inherit'],
  });
  return new Promise((ok) => s.stdout.on('data', (d) => String(d).includes('server su') && ok(s)));
}
let server = await startServer();

const results = [];
async function step(name, fn) {
  const t = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - t });
    console.log(`  ✓ ${name} (${Date.now() - t} ms)`);
  } catch (e) {
    results.push({ name, ok: false, error: e.message });
    console.log(`  ✗ ${name}: ${e.message}`);
    throw e;
  }
}
function assert(c, msg) { if (!c) throw new Error(msg); }

const browser = await chromium.launch({ channel: process.env.E2E_CHANNEL ?? 'chrome', headless: true });
const ctxOpts = { viewport: { width: 1366, height: 860 }, reducedMotion: 'reduce' };
const ctxA = await browser.newContext(ctxOpts);
const ctxB = await browser.newContext(ctxOpts);
const A = await ctxA.newPage();
const B = await ctxB.newPage();
const errors = [];
for (const [n, p] of [['A', A], ['B', B]]) p.on('pageerror', (e) => errors.push(`${n}: ${e.message}`));

const userA = `ada_${Date.now() % 100000}`;
const userB = `bruno_${Date.now() % 100000}`;

async function register(p, u) {
  await p.goto(`${BASE}/#/accedi`);
  await p.getByRole('button', { name: /Registrati/ }).click();
  await p.fill('#auth-user', u);
  await p.fill('#auth-pass', 'password-sicura-1');
  await p.locator('form button[type=submit]').click();
  await p.waitForURL(/#\/gioca/);
  await p.locator('.account .who', { hasText: u }).waitFor();
}

/** Gioca dal pannello finché è il proprio turno; restituisce true se la partita è finita. */
async function playMyTurns(p, maxActions = 400) {
  for (let i = 0; i < maxActions; i++) {
    if (await p.locator('.notice', { hasText: 'Vince' }).count()) return true;
    const roll = p.locator('.dice-panel button.gold:not([disabled])');
    const move = p.locator('[data-move="0"]');
    const conv = p.locator('.dice-panel button', { hasText: 'conversione' });
    if (await roll.count()) { await roll.click(); }
    else if (await move.count()) { await move.click(); }
    else if (await conv.count() && !(await conv.isDisabled())) { await conv.click(); }
    else return false;
    await p.waitForTimeout(60);
  }
  return false;
}

try {
  console.log('E2E — due sessioni browser separate');
  await step('registrazione di due utenti in contesti separati', async () => {
    await register(A, userA);
    await register(B, userB);
    const meA = await A.evaluate(() => fetch('/api/me').then((r) => r.json()));
    const meB = await B.evaluate(() => fetch('/api/me').then((r) => r.json()));
    assert(meA.user.username === userA && meB.user.username === userB, 'sessioni non isolate');
  });

  await step('ricerca utente e richiesta di amicizia', async () => {
    await A.goto(`${BASE}/#/amici`);
    await A.fill('#friend-q', userB.slice(0, 6));
    await A.getByRole('button', { name: 'Chiedi l\'amicizia' }).click();
    await A.locator('text=Richiesta inviata').first().waitFor();
  });

  await step('accettazione dell\'amicizia e presenza online', async () => {
    await B.goto(`${BASE}/#/amici`);
    await B.getByRole('button', { name: 'Accetta' }).click();
    await B.locator('.list li', { hasText: userA }).locator('.dot.on').waitFor({ timeout: 8000 });
  });

  let gameUrl = '';
  await step('invito diretto, accettazione, partita bloccata sulla configurazione', async () => {
    await A.goto(`${BASE}/#/gioca`);
    await A.getByRole('button', { name: /Sfida un amico/ }).click();
    await A.locator('.list li', { hasText: userB }).getByRole('button', { name: 'Invita' }).click();
    await A.locator('.toast', { hasText: 'Invito inviato' }).waitFor();
    await B.goto(`${BASE}/#/amici`);
    await B.getByRole('button', { name: 'Accetta e gioca' }).click();
    await B.waitForURL(/#\/partita\//);
    gameUrl = B.url();
    await A.locator('.toast', { hasText: 'Invito accettato' }).getByRole('button', { name: 'Gioca' }).click();
    await A.waitForURL(/#\/partita\//);
    assert(A.url() === gameUrl, 'i due giocatori sono in partite diverse');
    await A.locator('.panel', { hasText: 'Regolamento moderno adottato v1' }).waitFor();
    await A.screenshot({ path: join(out, 'online-desktop-A.png') });
  });

  await step('sincronizzazione in tempo reale delle prime mosse', async () => {
    for (let k = 0; k < 6; k++) {
      await playMyTurns(A, 6);
      await playMyTurns(B, 6);
    }
    const vA = await A.evaluate(() => document.querySelector('.log')?.children.length ?? 0);
    const vB = await B.evaluate(() => document.querySelector('.log')?.children.length ?? 0);
    assert(vA > 3 && vB > 3, 'cronologia non aggiornata');
  });

  await step('refresh della pagina: stato ripristinato dal server', async () => {
    const before = await B.evaluate(async (u) => (await fetch(`/api/games/${u.split('/').pop()}`).then((r) => r.json())).state.version, gameUrl);
    await B.reload();
    await B.locator('.panel h2').waitFor();
    const after = await B.evaluate(async (u) => (await fetch(`/api/games/${u.split('/').pop()}`).then((r) => r.json())).state.version, gameUrl);
    assert(after === before, `versione cambiata dopo il refresh: ${before} → ${after}`);
    await B.locator('.player .counts').first().waitFor();
  });

  await step('rete del client assente e poi ripristinata', async () => {
    await ctxA.setOffline(true);
    await A.locator('#netbar:not([hidden])').waitFor({ timeout: 8000 });
    await ctxA.setOffline(false);
    await A.locator('#netbar', { hasText: 'ripristinata' }).waitFor({ timeout: 20000 });
  });

  await step('riavvio del server: riconnessione automatica e stato persistito', async () => {
    const gid = gameUrl.split('/').pop();
    const before = await A.evaluate((g) => fetch(`/api/games/${g}`).then((r) => r.json()), gid);
    server.kill();
    await A.locator('#netbar', { hasText: 'interrotta' }).waitFor({ timeout: 10000 });
    server = await startServer();
    await A.locator('#netbar', { hasText: 'ripristinata' }).waitFor({ timeout: 30000 });
    await B.locator('#netbar', { hasText: 'ripristinata' }).waitFor({ timeout: 30000 }).catch(() => {});
    const after = await A.evaluate((g) => fetch(`/api/games/${g}`).then((r) => r.json()), gid);
    assert(after.state.version === before.state.version && after.status === 'active', 'stato non persistito dopo il riavvio');
  });

  await step('azione duplicata (stessa actionId) applicata una sola volta', async () => {
    const id = gameUrl.split('/').pop();
    const r = await A.evaluate(async (gid) => {
      const snap = await fetch(`/api/games/${gid}`).then((x) => x.json());
      if (snap.state.turn !== snap.yourSeat || !snap.available.roll) return { skipped: true };
      const body = JSON.stringify({ actionId: 'dup-e2e-0001', expectedVersion: snap.state.version, action: { type: 'roll' } });
      const h = { 'content-type': 'application/json', 'x-ur-client': '1' };
      const [a, b] = await Promise.all([fetch(`/api/games/${gid}/action`, { method: 'POST', headers: h, body }), fetch(`/api/games/${gid}/action`, { method: 'POST', headers: h, body })]);
      const ja = await a.json(), jb = await b.json();
      return { v0: snap.state.version, va: ja.snapshot?.state.version, vb: jb.snapshot?.state.version, dup: [ja.duplicate, jb.duplicate] };
    }, id);
    if (!r.skipped) assert(r.va === r.v0 + 1 && r.vb === r.v0 + 1 && r.dup.includes(true), `duplicato applicato due volte: ${JSON.stringify(r)}`);
    await A.reload();
    await A.locator('.panel h2').waitFor();
  });

  await step('partita completa fino alla vittoria registrata dal server', async () => {
    let done = false;
    for (let i = 0; i < 400 && !done; i++) {
      done = (await playMyTurns(A, 20)) || (await playMyTurns(B, 20));
      if (!done) await A.waitForTimeout(40);
    }
    assert(done, 'la partita non si è conclusa');
    await A.locator('.notice', { hasText: 'Vince' }).waitFor();
    await B.locator('.notice', { hasText: 'Vince' }).waitFor();
    await A.screenshot({ path: join(out, 'online-finished-A.png') });
  });

  await step('classifica e profilo aggiornati una sola volta', async () => {
    await A.goto(`${BASE}/#/classifica`);
    await A.locator('table tbody tr').nth(1).waitFor();
    const rows = await A.locator('table tbody tr').allInnerTexts();
    assert(rows.length === 2, `righe classifica: ${rows.length}`);
    const games = rows.map((r) => Number(r.split('\t')[3]));
    assert(games.every((g) => g === 1), `partite contate: ${games}`);
    const elos = rows.map((r) => Number(r.split('\t')[2].replace(',', '.')));
    assert(elos.includes(1216) && elos.includes(1184), `Elo inatteso: ${elos}`);
    await A.getByRole('tab', { name: 'Fra amici' }).click();
    await A.locator('table tbody tr').nth(1).waitFor();
    await B.goto(`${BASE}/#/profilo`);
    await B.locator('.list li', { hasText: userA }).waitFor();
    await A.screenshot({ path: join(out, 'leaderboard.png') });
  });

  await step('rivincita con la stessa configurazione', async () => {
    await A.goto(gameUrl.replace(BASE, BASE));
    await A.getByRole('button', { name: 'Proponi la rivincita' }).click();
    await B.goto(`${BASE}/#/amici`);
    await B.locator('.list li', { hasText: 'rivincita' }).getByRole('button', { name: 'Accetta e gioca' }).click();
    await B.waitForURL(/#\/partita\//);
    assert(B.url() !== gameUrl, 'la rivincita deve essere una nuova partita');
    await B.getByRole('button', { name: 'Abbandona (resa)' }).click();
    await B.getByRole('button', { name: 'Conferma' }).click();
    await B.locator('.notice', { hasText: 'resa' }).waitFor();
  });

  await step('stanza privata: il codice non permette di occupare un posto preso', async () => {
    await A.goto(`${BASE}/#/gioca`);
    await A.getByRole('button', { name: /Stanza privata/ }).click();
    await A.getByRole('button', { name: 'Crea stanza' }).click();
    await A.locator('.code').waitFor();
    const code = (await A.locator('.code').innerText()).trim();
    await B.goto(`${BASE}/#/stanza/${code}`);
    await B.waitForURL(/#\/partita\//);
    const ctxC = await browser.newContext(ctxOpts);
    const C = await ctxC.newPage();
    await register(C, `carla_${Date.now() % 100000}`);
    await C.goto(`${BASE}/#/stanza/${code}`);
    await C.locator('text=già completa').waitFor();
    await ctxC.close();
  });

  await step('partita locale con verifica del secondo giocatore, salvataggio e ripresa', async () => {
    await A.goto(`${BASE}/#/gioca`);
    await A.getByRole('button', { name: /Stesso dispositivo/ }).click();
    await A.selectOption('#loc-kind', 'verify');
    await A.fill('#loc-vu', userB);
    await A.fill('#loc-vp', 'password-sicura-1');
    await A.getByRole('button', { name: 'Conferma identità' }).click();
    await A.locator('text=Identità confermata').waitFor();
    await A.getByRole('button', { name: 'Inizia la partita locale' }).click();
    await A.waitForURL(/#\/locale\//);
    const me = await A.evaluate(() => fetch('/api/me').then((r) => r.json()));
    assert(me.user.username === userA, 'la sessione del primo giocatore è stata sostituita');
    for (let i = 0; i < 12; i++) await playMyTurns(A, 3);
    await A.waitForTimeout(600);
    const localUrl = A.url();
    const id = localUrl.split('/').pop();
    const srv = await A.evaluate((gid) => fetch(`/api/local/games/${gid}`).then((r) => r.json()), id);
    assert(srv.state.version > 3, `salvataggio sul server non aggiornato (v${srv.state.version})`);
    assert(srv.seats.some((s) => s.name === userB && s.verified), 'secondo giocatore non verificato');
    // ripresa da un altro contesto dello stesso account
    const ctxA2 = await browser.newContext(ctxOpts);
    const A2 = await ctxA2.newPage();
    await A2.goto(`${BASE}/#/accedi`);
    await A2.fill('#auth-user', userA);
    await A2.fill('#auth-pass', 'password-sicura-1');
    await A2.locator('form button[type=submit]').click();
    await A2.waitForURL(/#\/gioca/);
    await A2.locator('.list li', { hasText: 'contro' }).filter({ hasText: userB }).getByRole('button', { name: 'Riprendi' }).first().click();
    await A2.waitForURL(/#\/locale\//);
    await A2.locator('.panel .player').first().waitFor();
    const v2 = await A2.evaluate((gid) => JSON.parse(localStorage.getItem('ur.local.saves')).find((s) => s.id === gid).state.version, id);
    assert(v2 === srv.state.version, `ripresa con versione ${v2}, attesa ${srv.state.version}`);
    await ctxA2.close();
  });

  await step('partita locale come ospite (senza account), salvata nel browser', async () => {
    const ctxG = await browser.newContext(ctxOpts);
    const G = await ctxG.newPage();
    G.on('pageerror', (e) => errors.push(`G: ${e.message}`));
    await G.goto(`${BASE}/#/gioca`);
    await G.getByRole('button', { name: /Stesso dispositivo/ }).click();
    await G.getByRole('button', { name: 'Inizia la partita locale' }).click();
    await G.waitForURL(/#\/locale\//);
    for (let i = 0; i < 6; i++) await playMyTurns(G, 3);
    await G.reload();
    await G.locator('.panel .player').first().waitFor();
    const logs = await G.locator('.log li').count();
    assert(logs >= 1, 'partita ospite non ripresa');
    await ctxG.close();
  });

  await step('resa visiva mobile (390×844, touch) e tavola tarda', async () => {
    const ctxM = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const M = await ctxM.newPage();
    M.on('pageerror', (e) => errors.push(`M: ${e.message}`));
    await M.goto(`${BASE}/#/gioca`);
    await M.waitForTimeout(800);
    await M.screenshot({ path: join(out, 'mobile-home.png') });
    const overflow = await M.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert(overflow <= 1, `scroll orizzontale su mobile: ${overflow}px`);
    await M.evaluate(() => { localStorage.setItem('ur.pref.board', '"tarda"'); localStorage.setItem('ur.pref.ruleset', '"finkel-sperimentale"'); });
    await M.reload();
    await M.getByRole('button', { name: /Stesso dispositivo/ }).click();
    await M.getByRole('button', { name: 'Inizia la partita locale' }).click();
    await M.waitForURL(/#\/locale\//);
    await M.waitForTimeout(1500);
    await M.locator('.stage canvas').tap({ position: { x: 150, y: 200 } });
    await M.screenshot({ path: join(out, 'mobile-game-tarda.png') });
    await ctxM.close();
  });

  assert(errors.length === 0, `errori JavaScript nelle pagine: ${errors.join(' | ')}`);
} catch {
  /* il dettaglio è già stampato */
} finally {
  await browser.close();
  server.kill();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passi superati.${errors.length ? ' Errori pagina: ' + errors.join(' | ') : ''}`);
process.exit(failed.length || errors.length ? 1 : 0);
