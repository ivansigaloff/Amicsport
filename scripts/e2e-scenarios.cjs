/**
 * e2e-scenarios.cjs — richer multi-user Playwright scenarios for AmicSport.
 *
 * Complements e2e-suite.cjs (which does the simple per-user join/cancel + pay).
 * Here we exercise: entering matches, adding guests, FILLING a match to capacity
 * (and verifying the server rejects overbooking), switching between users and
 * coming back to cancel, and the paid + paid-guest payment types via MONEI test.
 *
 * Target the LIVE site by default (fast, reliable); same Supabase backend as dev.
 *   node scripts/e2e-scenarios.cjs               # free scenarios (guests, fill, multi-user)
 *   node scripts/e2e-scenarios.cjs --paid        # + paid + paid-guest (MONEI test)
 *   E2E_BASE_URL=http://localhost:8081 node scripts/e2e-scenarios.cjs   # against dev
 *
 * Read-mostly: every scenario cleans up after itself (cancels all spots/guests).
 */
const { chromium } = require('playwright');

const BASE = process.env.E2E_BASE_URL || 'https://multigraf.info/Kickerzbcn';
const PASSWORD = 'TestKKZ1!';
const PAID_ONLY = process.argv.includes('--paid-only');
const RUN_PAID = process.argv.includes('--paid') || PAID_ONLY;
const MATCH_FREE = '8175b53b-18e9-472f-9cf4-d5f6b5e6a81a'; // F7 La Satalia, 14 spots, free
const MATCH_PAID = '475bf27a-4de4-4817-9c3a-c0457e91b174'; // F8 La Satalia, 16 spots, 6€
const CARD = { number: '4444444444444422', expiry: '12/34', cvc: '123', name: 'TEST USER' };

const FILL_USERS = ['edu', 'paisa', 'felix', 'nico', 'ogdier', 'delvis', 'oussama', 'adam', 'alex', 'cristian', 'bony', 'bob'];
const u = (name) => ({ name, email: name + '@testusers.com' });
const log = (m) => console.log('[' + new Date().toLocaleTimeString() + '] ' + m);
const results = [];
const check = (scenario, step, ok, detail) => {
  results.push({ scenario, step, ok, detail: detail || '' });
  log(`  ${ok ? '✅' : '❌'} [${scenario}] ${step}${detail ? ' — ' + detail : ''}`);
};

// ── Chaos/soak helpers (REST for state + cleanup, randomness) ───────────────
require('dotenv').config();
const SB_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const sbH = { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY };
const ALL_USERS = ['edu', 'paisa', 'felix', 'nico', 'ogdier', 'delvis', 'oussama', 'adam', 'alex', 'cristian', 'bony', 'bob', 'luisjr', 'moha', 'luis', 'elkin', 'andres', 'cali', 'johnatan', 'david', 'paul', 'percy'];
const arg = (k, d) => { const a = process.argv.find(x => x.startsWith(k + '=')); return a ? a.slice(k.length + 1) : d; };
const randInt = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function authUser(email) {
  try {
    const r = await fetch(SB_URL + '/auth/v1/token?grant_type=password', {
      method: 'POST', headers: { apikey: SB_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD }),
    });
    const j = await r.json();
    return j.access_token ? { token: j.access_token, uid: j.user.id } : null;
  } catch { return null; }
}
async function participantCount(matchId) {
  const r = await fetch(SB_URL + '/rest/v1/match_participants?match_id=eq.' + matchId + '&select=id', { headers: sbH });
  const j = await r.json().catch(() => []);
  return Array.isArray(j) ? j.length : 0;
}
async function fetchMatchPool() {
  const today = new Date().toISOString().split('T')[0];
  const r = await fetch(SB_URL + '/rest/v1/matches?match_date=gte.' + today + '&select=id,requires_payment,max_players,joined_players,price&order=match_date.asc&limit=20', { headers: sbH });
  const j = await r.json().catch(() => []);
  return Array.isArray(j) ? j.map(m => ({ id: m.id, paid: !!m.requires_payment, max: m.max_players - (m.joined_players || 0), price: m.price })) : [];
}

// ── Browser primitives ─────────────────────────────────────────────────────
async function login(browser, user) {
  const ctx = await browser.newContext({ viewport: { width: 430, height: 920 } });
  const page = await ctx.newPage();
  const dialogs = [];
  page.on('dialog', d => { dialogs.push(d.message()); d.accept().catch(() => {}); });
  page._dialogs = dialogs;
  // Retry: browser login is intermittently flaky (waitForURL can time out even
  // though the account is fine). 3 tries so a transient hiccup doesn't leave state.
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(attempt === 1 ? 2500 : 1200);
      await page.getByText('Entendido', { exact: false }).click({ timeout: 2000 }).catch(() => {});
      await page.getByPlaceholder('Email').fill(user.email);
      await page.getByPlaceholder(/Contrase/i).fill(PASSWORD);
      await page.getByText(/INICIAR\s+SESI/i, { exact: false }).click();
      await page.waitForURL(x => !String(x).includes('/login'), { timeout: 20000 });
      await page.waitForTimeout(2500);
      return { ctx, page };
    } catch (e) {
      if (!page.url().includes('/login')) { await page.waitForTimeout(1500); return { ctx, page }; }
      lastErr = e;
      if (attempt < 3) await page.waitForTimeout(2500 * attempt);
    }
  }
  await ctx.close().catch(() => {});
  throw new Error('login failed: ' + (lastErr ? String(lastErr.message).split('\n')[0] : '?'));
}

async function openMatch(page, matchId) {
  await page.goto(BASE + '/match/' + matchId, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.locator('text=/\\d+\\.\\d+/').first().waitFor({ state: 'attached', timeout: 25000 });
  await page.waitForTimeout(1800);
}

const isJoined = (page) => page.getByText(/Cancelar Plaza/i).first().isVisible({ timeout: 3000 }).catch(() => false);

// "Jugadores Apuntados N/M" — returns [N, M].
async function joinedCount(page) {
  const txt = await page.evaluate(() => document.body.innerText).catch(() => '');
  const m = txt.match(/Apuntados\s+(\d+)\s*\/\s*(\d+)/i);
  return m ? [parseInt(m[1]), parseInt(m[2])] : [null, null];
}

// The add-guest icon button has no text — it is the tabindex=0 sibling right
// before the "Cancelar Plaza" button in the action row.
const addGuestBtn = (page) =>
  page.locator('xpath=//div[@tabindex="0"][.//text()[contains(.,"Cancelar Plaza")]]/preceding-sibling::div[@tabindex="0"][1]').first();

async function reserveFree(page) {
  await page.getByText(/RESERVAR PLAZA/i).first().click({ timeout: 8000 });
  await page.waitForTimeout(3500);
}
async function cancelOnce(page) {
  await page.getByText(/Cancelar Plaza/i).first().click({ timeout: 8000 });
  // Paid cancels do a refund round-trip (refund-payment edge fn → MONEI), which
  // is slower than a free leave; give it room so the row is gone before re-check.
  await page.waitForTimeout(5000);
}
// Cancel repeatedly until no longer joined (removes guests one-by-one, then self).
async function cancelAll(page, max = 20) {
  for (let i = 0; i < max; i++) {
    if (!(await isJoined(page))) return true;
    await cancelOnce(page).catch(() => {});
  }
  return !(await isJoined(page));
}

// ── MONEI test form ────────────────────────────────────────────────────────
async function payMonei(page, redirectUrl, method = 'card') {
  await page.waitForTimeout(2000);
  if (redirectUrl && !/monei|checkout|secure\./.test(page.url())) {
    await page.goto(redirectUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  }
  await page.waitForURL(/monei|secure\./, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1000);
  const frames = () => [page, ...page.frames()];
  const fill = async (sels, val) => {
    for (const f of frames()) for (const s of sels) {
      try { const l = f.locator(s).first(); if (await l.isVisible({ timeout: 400 })) { await l.fill(val); return true; } } catch {}
    }
    return false;
  };
  const clickAny = async (sels) => {
    for (const f of frames()) for (const s of sels) {
      try { const b = f.locator(s).first(); if (await b.isVisible({ timeout: 400 })) { await b.click(); return true; } } catch {}
    }
    return false;
  };
  const reachedReturn = () => /payment\/return/.test(page.url()) || (page.url().startsWith(BASE) && !/monei|secure\./.test(page.url()));
  const fillCard = async () => {
    await page.waitForSelector('input[name="billingName"]', { timeout: 15000 }).catch(() => {});
    await fill(['input[name="cardNumber"]', 'input[autocomplete="cc-number"]', 'input[placeholder*="0000"]', 'input[id*="card"]'], CARD.number);
    await fill(['input[name*="expir" i]', 'input[autocomplete="cc-exp"]', 'input[placeholder*="MM"]'], CARD.expiry);
    await fill(['input[name*="cvc" i]', 'input[name*="cvv" i]', 'input[autocomplete="cc-csc"]', 'input[placeholder*="CVC"]'], CARD.cvc);
    await fill(['input[name="billingName"]', 'input[name*="holder" i]', 'input[autocomplete="cc-name"]', 'input[placeholder*="ombre" i]', 'input[placeholder*="name" i]'], CARD.name);
    await page.waitForTimeout(700);
    await clickAny(['button[type="submit"]', 'button:has-text("Pagar")', 'button:has-text("Pay")', 'button:has-text("Confirmar")']);
  };

  let used = 'card';
  if (method === 'bizum') {
    // Best-effort Bizum: select it + enter a test phone + submit. If it doesn't
    // complete, fall back to card on the same page (avoids PENDING leftovers).
    const sel = await clickAny(['button:has-text("Bizum")', 'div[role="button"]:has-text("Bizum")', '[data-method*="bizum" i]', '[aria-label*="bizum" i]']);
    if (sel) {
      await page.waitForTimeout(1500);
      await fill(['input[type="tel"]', 'input[name*="phone" i]', 'input[autocomplete="tel"]', 'input[placeholder*="vil" i]', 'input[placeholder*="fono" i]'], '600000000');
      await page.waitForTimeout(400);
      await clickAny(['button[type="submit"]', 'button:has-text("Pagar")', 'button:has-text("Continuar")', 'button:has-text("Bizum")']);
      await page.waitForTimeout(3500);
    }
    if (reachedReturn()) used = 'bizum';
    else { await fillCard(); used = sel ? 'bizum→card' : 'card(no-bizum-ui)'; }
  } else {
    await fillCard();
  }

  await page.waitForURL(x => String(x).includes('payment/return') || (String(x).startsWith(BASE) && !/monei|secure\./.test(String(x))), { timeout: 40000 }).catch(() => {});
  await page.waitForTimeout(5000);
  return { ok: reachedReturn(), method: used };
}

// ── Scenario 1: enter + add guests (free) ───────────────────────────────────
async function scGuests(browser) {
  const S = 'GUESTS(free)';
  log('> ' + S);
  const { ctx, page } = await login(browser, u('edu'));
  try {
    await openMatch(page, MATCH_FREE);
    await cancelAll(page);                          // start clean
    const [base] = await joinedCount(page);
    await reserveFree(page);
    check(S, 'enter+reserve', await isJoined(page));
    await addGuestBtn(page).click({ timeout: 8000 }); await page.waitForTimeout(3000);
    await addGuestBtn(page).click({ timeout: 8000 }); await page.waitForTimeout(3000);
    const [after] = await joinedCount(page);
    check(S, 'add 2 guests', after === base + 3, `count ${base} -> ${after} (expected +3 = self+2 guests)`);
    const cleaned = await cancelAll(page);
    const [end] = await joinedCount(page);
    check(S, 'cancel all (guests+self)', cleaned && end === base, `count back to ${end} (base ${base})`);
  } catch (e) { check(S, 'error', false, e.message.slice(0, 90)); await cancelAll(page).catch(() => {}); }
  finally { await ctx.close().catch(() => {}); }
}

// ── Scenario 2: fill a match to capacity (free) ─────────────────────────────
async function scFill(browser) {
  const S = 'FILL(free)';
  log('> ' + S);
  const { ctx, page } = await login(browser, u('paisa'));
  try {
    await openMatch(page, MATCH_FREE);
    await cancelAll(page);
    let [n, max] = await joinedCount(page);
    if (n !== 0) { check(S, 'precondition empty', false, `match not empty (${n}/${max})`); return; }
    await reserveFree(page);                         // self = 1
    // Add guests until full.
    let guard = 0;
    while (guard++ < max + 2) {
      [n, max] = await joinedCount(page);
      if (n >= max) break;
      const before = page._dialogs.length;
      await addGuestBtn(page).click({ timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(2200);
      const [nn] = await joinedCount(page);
      if (nn === n && page._dialogs.length > before) break; // rejected with a dialog
    }
    [n, max] = await joinedCount(page);
    check(S, 'filled to capacity', n === max, `reached ${n}/${max}`);
    // Try to overbook one more — must be rejected (count stays, or "completo").
    const dlgBefore = page._dialogs.length;
    await addGuestBtn(page).click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(2500);
    const [nAfter] = await joinedCount(page);
    const rejected = nAfter === max;
    check(S, 'overbooking rejected', rejected, `count stayed ${nAfter}/${max}; dialogs: ${page._dialogs.slice(dlgBefore).join(' | ').slice(0, 80)}`);
    const cleaned = await cancelAll(page, max + 3);
    const [end] = await joinedCount(page);
    check(S, 'cleanup (empty again)', cleaned && end === 0, `back to ${end}/${max}`);
  } catch (e) { check(S, 'error', false, e.message.slice(0, 90)); await cancelAll(page, max + 3).catch(() => {}); }
  finally { await ctx.close().catch(() => {}); }
}

// ── Scenario 2b: fill a match with MANY real users + guests to top up ───────
async function scFillMulti(browser) {
  const S = 'FILL-MULTI(free)';
  log('> ' + S);
  const sessions = [];
  let max = null;
  try {
    // Each listed user logs in and reserves a spot until the match is full.
    for (const name of FILL_USERS) {
      let s;
      try { s = await login(browser, u(name)); } catch { check(S, 'login ' + name, false, 'login failed'); continue; }
      s.name = name;
      await openMatch(s.page, MATCH_FREE);
      await cancelAll(s.page);                       // clear any stale join by this user
      sessions.push(s);
      let [n, m] = await joinedCount(s.page); max = m;
      if (n >= m) break;                             // already full
      await reserveFree(s.page).catch(() => {});
      const [n2] = await joinedCount(s.page);
      if (n2 >= max) break;
    }
    const joinedUsers = sessions.length;
    check(S, 'real users reserved', joinedUsers > 0, `${joinedUsers} users in (cap ${max})`);
    // Top up the remaining spots with guests from the last user.
    const last = sessions[sessions.length - 1];
    let [n] = await joinedCount(last.page); let guard = 0;
    while (n < max && guard++ < max + 3) {
      const before = last.page._dialogs.length;
      await addGuestBtn(last.page).click({ timeout: 8000 }).catch(() => {});
      await last.page.waitForTimeout(2200);
      const [nn] = await joinedCount(last.page);
      if (nn === n && last.page._dialogs.length > before) break;
      n = nn;
    }
    [n] = await joinedCount(last.page);
    check(S, 'filled to capacity (users + guests)', n === max, `reached ${n}/${max}`);
    // Overbooking: one more guest on a full match must be rejected.
    const dlgBefore = last.page._dialogs.length;
    await addGuestBtn(last.page).click({ timeout: 5000 }).catch(() => {});
    await last.page.waitForTimeout(2500);
    const [nAfter] = await joinedCount(last.page);
    check(S, 'overbooking rejected', nAfter === max, `stayed ${nAfter}/${max}`);
  } catch (e) { check(S, 'error', false, e.message.slice(0, 90)); }
  finally {
    // Cleanup: every session cancels its spot(s); last one also removes its guests.
    for (const s of sessions) {
      try { await openMatch(s.page, MATCH_FREE); await cancelAll(s.page, (max || 16) + 3); } catch {}
      await s.ctx.close().catch(() => {});
    }
    // Verify the match is empty again.
    const probe = await login(browser, u('edu')).catch(() => null);
    if (probe) { await openMatch(probe.page, MATCH_FREE); const [n] = await joinedCount(probe.page); check(S, 'cleanup (empty again)', n === 0, `back to ${n}/${max}`); await probe.ctx.close().catch(() => {}); }
  }
}

// ── Scenario 3: two users, switch back, cancel ──────────────────────────────
async function scMultiUser(browser) {
  const S = 'MULTIUSER(free)';
  log('> ' + S);
  const A = await login(browser, u('felix'));
  const B = await login(browser, u('nico'));
  try {
    await openMatch(A.page, MATCH_FREE); await cancelAll(A.page);
    await openMatch(B.page, MATCH_FREE); await cancelAll(B.page);
    await reserveFree(A.page); check(S, 'user A reserves', await isJoined(A.page));
    await reserveFree(B.page); check(S, 'user B reserves', await isJoined(B.page));
    // Switch back to A and cancel.
    await A.page.bringToFront();
    await cancelOnce(A.page);
    check(S, 'A cancels', !(await isJoined(A.page)));
    // B should still be joined (independent session).
    await openMatch(B.page, MATCH_FREE);
    check(S, 'B still joined after A cancels', await isJoined(B.page));
    await cancelAll(B.page);
    check(S, 'B cancels (cleanup)', !(await isJoined(B.page)));
  } catch (e) { check(S, 'error', false, e.message.slice(0, 90)); await cancelAll(A.page).catch(() => {}); await cancelAll(B.page).catch(() => {}); }
  finally { await A.ctx.close().catch(() => {}); await B.ctx.close().catch(() => {}); }
}

// ── Scenario 4: payment types — paid join + paid guest (MONEI test) ─────────
async function scPaid(browser) {
  const S = 'PAID(monei)';
  log('> ' + S);
  const { ctx, page } = await login(browser, u('ogdier'));
  try {
    await openMatch(page, MATCH_PAID);
    if (await isJoined(page)) { await cancelAll(page); await openMatch(page, MATCH_PAID); }
    const [base] = await joinedCount(page);
    // Paid join — capture the create-payment redirectUrl (suite pattern).
    let payResp = page.waitForResponse(r => r.url().includes('create-payment'), { timeout: 30000 }).catch(() => null);
    await page.getByText(/PAGAR PLAZA/i).first().click({ timeout: 8000 });
    let r = await payResp; let redirectUrl = null;
    if (r) { try { redirectUrl = (await r.json()).redirectUrl; } catch {} }
    await payMonei(page, redirectUrl);
    await openMatch(page, MATCH_PAID);
    check(S, 'paid join (MONEI test)', await isJoined(page));
    // Paid guest: add-guest -> confirm -> MONEI.
    payResp = page.waitForResponse(r2 => r2.url().includes('create-payment'), { timeout: 30000 }).catch(() => null);
    await addGuestBtn(page).click({ timeout: 8000 });
    r = await payResp; redirectUrl = null;
    if (r) { try { redirectUrl = (await r.json()).redirectUrl; } catch {} }
    await payMonei(page, redirectUrl);
    await openMatch(page, MATCH_PAID);
    const [after] = await joinedCount(page);
    check(S, 'paid guest added', after >= base + 2, `count ${base} -> ${after} (expected +2)`);
    const cleaned = await cancelAll(page);
    check(S, 'cancel + refund (cleanup)', cleaned, 'all spots cancelled');
  } catch (e) { check(S, 'error', false, e.message.slice(0, 90)); await cancelAll(page).catch(() => {}); }
  finally { await ctx.close().catch(() => {}); }
}

// ── Scenario 5: CHAOS / SOAK — realistic random actions over many sessions ──
// Per user: ~8 sessions (logins). Each session does 2-3 random actions on
// random matches (reserve free/paid, add guest(s), leave one, cancel all, or
// just browse); waits a random time between sessions. Joins accumulate across
// users (sequential, no per-user reset) so popular matches fill up. Paid actions
// pay via MONEI test (card + best-effort Bizum). At the end EVERY test user
// cancels everything (UI cancel refunds paid; REST sweep mops up free) so the
// matches are left exactly as they started.
//   node scripts/e2e-scenarios.cjs --chaos                       # free only, fast waits
//   node scripts/e2e-scenarios.cjs --chaos --paid                # + paid (card/bizum)
//   node scripts/e2e-scenarios.cjs --chaos --paid --soak         # real 5-15min waits
//   node scripts/e2e-scenarios.cjs --chaos --users=edu,paisa --sessions=2   # quick
async function scChaos(browser) {
  const S = 'CHAOS';
  const SESSIONS = parseInt(arg('--sessions', '8'), 10) || 8;
  const soak = process.argv.includes('--soak');
  const usersArg = arg('--users', '');
  const users = (usersArg ? usersArg.split(',').filter(Boolean) : ALL_USERS).map(u);
  const waitMs = () => soak ? randInt(300000, 900000) : randInt(5000, 15000);

  let pool = await fetchMatchPool();
  if (!RUN_PAID) pool = pool.filter(m => !m.paid);
  if (!pool.length) { check(S, 'match pool', false, 'no upcoming matches'); return; }
  const initial = {}, initialIds = {};
  for (const m of pool) {
    const r = await fetch(SB_URL + '/rest/v1/match_participants?match_id=eq.' + m.id + '&select=id', { headers: sbH });
    const j = await r.json().catch(() => []);
    initialIds[m.id] = new Set(Array.isArray(j) ? j.map(x => x.id) : []); // protect pre-existing rows
    initial[m.id] = initialIds[m.id].size;
  }
  log(`> CHAOS users=${users.length} sessions=${SESSIONS} ${soak ? 'SOAK(5-15min)' : 'fast(5-15s)'} paid=${RUN_PAID} pool=${pool.length}`);

  const joinedSet = {}; users.forEach(usr => joinedSet[usr.name] = new Set());
  let payN = 0, bizumN = 0; const filled = new Set();

  const captureRedirect = async (page, clickFn) => {
    const respP = page.waitForResponse(r => r.url().includes('create-payment'), { timeout: 30000 }).catch(() => null);
    await clickFn().catch(() => {});
    const r = await respP; if (!r) return null;
    try { return (await r.json()).redirectUrl; } catch { return null; }
  };

  for (const usr of users) {
    for (let s = 0; s < SESSIONS; s++) {
      const winding = s >= Math.ceil(SESSIONS * 0.7); // last ~30%: wind down toward leaving
      let sess; try { sess = await login(browser, usr); } catch { check(S, `${usr.name} login s${s + 1}`, false, 'login failed'); continue; }
      const { ctx, page } = sess;
      try {
        const nActions = randInt(2, 3);
        for (let a = 0; a < nActions; a++) {
          const m = pick(pool);
          await openMatch(page, m.id);
          const joined = await isJoined(page);
          let [n, max] = await joinedCount(page);
          if (n != null && max != null && n >= max) filled.add(m.id);

          let act;
          if (winding && joined) act = 'cancel_all';
          else if (joined) act = pick(['guest', 'leave', 'guest']);
          else act = pick(['reserve', 'reserve', 'browse']);

          if (act === 'reserve' && (n == null || n < max)) {
            if (m.paid) {
              const url = await captureRedirect(page, () => page.getByText(/PAGAR PLAZA/i).first().click({ timeout: 8000 }));
              const method = (m.price > 0 && m.price < 5) ? pick(['card', 'bizum']) : 'card'; // Bizum test only approves <5€
              const r = await payMonei(page, url, method); payN++; if (r.method.startsWith('bizum')) bizumN++;
              await openMatch(page, m.id);
            } else {
              await reserveFree(page).catch(() => {});
            }
            if (await isJoined(page)) joinedSet[usr.name].add(m.id);
          } else if (act === 'guest' && joined && (n == null || n < max)) {
            for (let g = 0, gn = randInt(1, 2); g < gn; g++) {
              if (m.paid) {
                const url = await captureRedirect(page, () => addGuestBtn(page).click({ timeout: 8000 }));
                const method = (m.price > 0 && m.price < 5) ? pick(['card', 'bizum']) : 'card'; // Bizum test only approves <5€
                const r = await payMonei(page, url, method); payN++; if (r.method.startsWith('bizum')) bizumN++;
                await openMatch(page, m.id);
              } else {
                await addGuestBtn(page).click({ timeout: 8000 }).catch(() => {});
                await page.waitForTimeout(2500);
              }
              [n, max] = await joinedCount(page); if (n != null && n >= max) { filled.add(m.id); break; }
            }
          } else if (act === 'leave' && joined) {
            await cancelOnce(page);
            if (!(await isJoined(page))) joinedSet[usr.name].delete(m.id);
          } else if (act === 'cancel_all' && joined) {
            await cancelAll(page);
            joinedSet[usr.name].delete(m.id);
          }
          // browse: no-op
        }
        check(S, `${usr.name} session ${s + 1}/${SESSIONS}`, true, `on=[${[...joinedSet[usr.name]].map(x => x.slice(0, 6)).join(',') || '-'}]`);
      } catch (e) { check(S, `${usr.name} session ${s + 1} error`, false, e.message.slice(0, 70)); }
      finally { await ctx.close().catch(() => {}); }
      if (s < SESSIONS - 1) await sleep(waitMs());
    }
  }

  for (const m of pool) { if (await participantCount(m.id) >= m.max) filled.add(m.id); }
  // "si hace falta añade invitados hasta llenar": if nothing filled naturally,
  // top up the least-occupied FREE match with guests until it reaches capacity.
  const fm = pool.filter(m => !m.paid).sort((a, b) => initial[a.id] - initial[b.id])[0];
  if (filled.size === 0 && fm) {
    let sess; try { sess = await login(browser, users[0]); } catch { sess = null; }
    if (sess) {
      try {
        await openMatch(sess.page, fm.id);
        if (!(await isJoined(sess.page))) await reserveFree(sess.page).catch(() => {});
        if (await isJoined(sess.page)) joinedSet[users[0].name].add(fm.id);
        let [n, max] = await joinedCount(sess.page), guard = 0;
        while ((n == null || n < max) && guard++ < (max || 16) + 3) {
          await addGuestBtn(sess.page).click({ timeout: 8000 }).catch(() => {});
          await sess.page.waitForTimeout(2300);
          [n, max] = await joinedCount(sess.page);
        }
        if (n != null && n >= max) filled.add(fm.id);
        log(`  topped up ${fm.id.slice(0, 6)} with guests -> ${n}/${max}`);
      } catch (e) { log('  guest-fill error: ' + e.message.slice(0, 60)); }
      await sess.ctx.close().catch(() => {});
    }
  }
  check(S, 'some matches filled', filled.size > 0, `${filled.size} match(es) reached capacity`);
  check(S, 'payments executed', !RUN_PAID || payN > 0, `${payN} payments (${bizumN} Bizum best-effort)`);

  // ── RESTORE: cancel every test-user spot (UI cancel refunds paid), then REST sweep for free ──
  log('  CHAOS restore — leaving it as it was...');
  const myRows = async (mid, uid) => {
    const r = await fetch(SB_URL + '/rest/v1/match_participants?match_id=eq.' + mid + '&or=(user_id.eq.' + uid + ',created_by.eq.' + uid + ')&select=id', { headers: sbH });
    const j = await r.json().catch(() => []); return Array.isArray(j) ? j.length : 0;
  };
  for (const usr of users) {
    const mids = [...joinedSet[usr.name]];
    if (!mids.length) continue;
    const auth = await authUser(usr.email);
    let sess; try { sess = await login(browser, usr); } catch { continue; }
    for (const mid of mids) {
      // Retry: paid cancels are slow refund round-trips and can leave a row on
      // the first pass. Re-cancel until this user's rows on the match are gone.
      for (let r = 0; r < 3; r++) {
        try { await openMatch(sess.page, mid); await cancelAll(sess.page, 25); } catch {}
        if (!auth || (await myRows(mid, auth.uid)) === 0) break;
      }
    }
    await sess.ctx.close().catch(() => {});
  }
  // REST safety sweep — remove any remaining test-user rows (own + created guests)
  // on ALL pool matches so the participant state is left exactly as it started.
  // NOTE: deleting a PAID row this way does NOT refund the payment — the app's
  // paid-cancel is buggy when a user has several SUCCEEDED payments (self + paid
  // guests); see the bug report. reconcile is off so the row won't reappear.
  for (const usr of users) {
    const auth = await authUser(usr.email); if (!auth) continue;
    for (const m of pool) {
      const keep = [...(initialIds[m.id] || [])];
      const notIn = keep.length ? '&id=not.in.(' + keep.join(',') + ')' : ''; // never delete pre-existing rows (real data)
      await fetch(SB_URL + '/rest/v1/match_participants?match_id=eq.' + m.id + '&or=(user_id.eq.' + auth.uid + ',created_by.eq.' + auth.uid + ')' + notIn, { method: 'DELETE', headers: { apikey: SB_KEY, Authorization: 'Bearer ' + auth.token } }).catch(() => {});
    }
  }
  let extra = 0; for (const m of pool) extra += Math.max(0, (await participantCount(m.id)) - initial[m.id]);
  check(S, 'restored to initial state', extra === 0, `${extra} extra participant(s) vs start`);
}

// ── Main ────────────────────────────────────────────────────────────────────
(async () => {
  log('AmicSport E2E SCENARIOS  base=' + BASE + (RUN_PAID ? '  (+paid)' : ''));
  const browser = await chromium.launch({ headless: true });
  try {
    if (process.argv.includes('--chaos')) {
      await scChaos(browser);
    } else {
      if (!PAID_ONLY) {
        await scGuests(browser);
        await scFillMulti(browser);
        await scMultiUser(browser);
      }
      if (RUN_PAID) await scPaid(browser);
    }
  } finally { await browser.close(); }
  const pass = results.filter(r => r.ok).length, fail = results.length - pass;
  console.log(`\nDONE  PASS:${pass}  FAIL:${fail}  (${results.length} checks)`);
  results.filter(r => !r.ok).forEach(r => console.log(`  FAIL [${r.scenario}] ${r.step} — ${r.detail}`));
  if (fail) process.exit(1);
})();
