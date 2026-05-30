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

// ── Browser primitives ─────────────────────────────────────────────────────
async function login(browser, user) {
  const ctx = await browser.newContext({ viewport: { width: 430, height: 920 } });
  const page = await ctx.newPage();
  const dialogs = [];
  page.on('dialog', d => { dialogs.push(d.message()); d.accept().catch(() => {}); });
  page._dialogs = dialogs;
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2500);
  await page.getByText('Entendido', { exact: false }).click({ timeout: 2000 }).catch(() => {});
  await page.getByPlaceholder('Email').fill(user.email);
  await page.getByPlaceholder(/Contrase/i).fill(PASSWORD);
  await page.getByText(/INICIAR\s+SESI/i, { exact: false }).click();
  await page.waitForURL(x => !String(x).includes('/login'), { timeout: 20000 });
  await page.waitForTimeout(2500);
  return { ctx, page };
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
async function payMonei(page, redirectUrl) {
  await page.waitForTimeout(2000);
  // initiatePayment/addGuest redirect via window.location; if we captured the URL
  // and the page hasn't navigated to MONEI yet, go there explicitly.
  if (redirectUrl && !/monei|checkout|secure\./.test(page.url())) {
    await page.goto(redirectUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  }
  // Wait until the MONEI checkout has actually loaded before filling — the guest
  // flow (confirm → createPayment → redirect) can take >2.5s, so a fixed wait
  // raced ahead and filled nothing. billingName lives on the main MONEI page.
  await page.waitForURL(/monei|secure\./, { timeout: 15000 }).catch(() => {});
  await page.waitForSelector('input[name="billingName"]', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(800);
  const frames = [page, ...page.frames()];
  const fill = async (sels, val) => {
    for (const f of frames) for (const s of sels) {
      try { const l = f.locator(s).first(); if (await l.isVisible({ timeout: 500 })) { await l.fill(val); return; } } catch {}
    }
  };
  await fill(['input[name="cardNumber"]', 'input[autocomplete="cc-number"]', 'input[placeholder*="0000"]', 'input[id*="card"]'], CARD.number);
  await fill(['input[name*="expir" i]', 'input[autocomplete="cc-exp"]', 'input[placeholder*="MM"]'], CARD.expiry);
  await fill(['input[name*="cvc" i]', 'input[name*="cvv" i]', 'input[autocomplete="cc-csc"]', 'input[placeholder*="CVC"]'], CARD.cvc);
  // Cardholder name is REQUIRED by MONEI (name="billingName", placeholder
  // "Nombre en la tarjeta"); without it the submit is blocked by validation.
  await fill(['input[name="billingName"]', 'input[name*="holder" i]', 'input[autocomplete="cc-name"]', 'input[placeholder*="ombre" i]', 'input[placeholder*="name" i]'], CARD.name);
  await page.waitForTimeout(700);
  for (const f of frames) for (const s of ['button[type="submit"]', 'button:has-text("Pagar")', 'button:has-text("Pay")', 'button:has-text("Confirmar")']) {
    try { const b = f.locator(s).first(); if (await b.isVisible({ timeout: 500 })) { await b.click(); break; } } catch {}
  }
  await page.waitForURL(x => String(x).includes('payment/return') || String(x).startsWith(BASE), { timeout: 40000 }).catch(() => {});
  await page.waitForTimeout(5000);
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

// ── Main ────────────────────────────────────────────────────────────────────
(async () => {
  log('AmicSport E2E SCENARIOS  base=' + BASE + (RUN_PAID ? '  (+paid)' : ''));
  const browser = await chromium.launch({ headless: true });
  try {
    if (!PAID_ONLY) {
      await scGuests(browser);
      await scFillMulti(browser);
      await scMultiUser(browser);
    }
    if (RUN_PAID) await scPaid(browser);
  } finally { await browser.close(); }
  const pass = results.filter(r => r.ok).length, fail = results.length - pass;
  console.log(`\nDONE  PASS:${pass}  FAIL:${fail}  (${results.length} checks)`);
  results.filter(r => !r.ok).forEach(r => console.log(`  FAIL [${r.scenario}] ${r.step} — ${r.detail}`));
  if (fail) process.exit(1);
})();
