/**
 * e2e-suite.cjs — Multi-user end-to-end test for AmicSport
 *
 * Flows:
 *   FREE  — all 22 users: login → view match → RESERVAR PLAZA → verify → Cancelar Plaza → verify removed
 *   PAID  — first 5 users: login → PAGAR PLAZA → MONEI frictionless → verify → Cancelar (refund) → verify
 *
 * Cleanup: any rows NOT cleaned during the run are deleted via each user's own
 *          session (RLS: user_id = auth.uid() allows self-delete).
 *
 * Usage:
 *   node scripts/e2e-suite.cjs                  # full suite
 *   node scripts/e2e-suite.cjs --free-only       # skip payment
 *   node scripts/e2e-suite.cjs --paid-only       # skip free
 *   node scripts/e2e-suite.cjs --users=edu,felix # subset
 */

require('dotenv').config();
const { chromium } = require('playwright');
const fs   = require('fs');
const path = require('path');

// ── Config ────────────────────────────────────────────────────────────────────

const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:8081';
const PASSWORD = 'TestKKZ1!';

const ALL_USERS = [
  'edu','paisa','felix','nico','ogdier','delvis','oussama','adam','alex',
  'cristian','bony','bob','luisjr','moha','luis','elkin','andres','cali',
  'johnatan','david','paul','percy',
].map(u => ({ name: u, email: u + '@testusers.com' }));

// Match IDs from DB probe
const MATCH_FREE_ID = '8175b53b-18e9-472f-9cf4-d5f6b5e6a81a'; // F7 Satalia (Contra Replayers) free 14 spots
const MATCH_PAID_ID = '475bf27a-4de4-4817-9c3a-c0457e91b174'; // F8 Satalia Sab30 req_pay 16 spots 6e

// MONEI frictionless card — auto-approves, no 3DS challenge needed
const CARD = { number: '4444444444444422', expiry: '12/34', cvc: '123', name: 'TEST USER' };

// Only first 5 users run the payment flow
const PAID_USER_NAMES = new Set(['edu', 'paisa', 'felix', 'nico', 'ogdier']);

// ── CLI args ──────────────────────────────────────────────────────────────────

const ARGS      = process.argv.slice(2);
const FREE_ONLY = ARGS.includes('--free-only');
const PAID_ONLY = ARGS.includes('--paid-only');
const userArg   = (ARGS.find(a => a.startsWith('--users=')) || '').replace('--users=', '').split(',').filter(Boolean);
const USERS     = userArg.length ? ALL_USERS.filter(u => userArg.includes(u.name)) : ALL_USERS;
const FILL        = ARGS.includes('--fill');        // fill a match to capacity with REAL users
const FILL_GUESTS = ARGS.includes('--fill-guests'); // one organizer fills a match with GUESTS

// Read-only REST helpers to assert capacity integrity directly against the DB.
const SB_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SB_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const sbHeaders = { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY };
async function countParticipants(matchId) {
  const r = await fetch(SB_URL + '/rest/v1/match_participants?match_id=eq.' + matchId + '&select=id', { headers: sbHeaders });
  const j = await r.json().catch(() => []);
  return Array.isArray(j) ? j.length : -1;
}
async function matchAbsoluteMax(matchId) {
  const r = await fetch(SB_URL + '/rest/v1/matches?id=eq.' + matchId + '&select=max_players,joined_players', { headers: sbHeaders });
  const j = await r.json().catch(() => []);
  const m = Array.isArray(j) ? j[0] : null;
  return m ? (m.max_players - (m.joined_players || 0)) : null;
}

// ── Output dirs ───────────────────────────────────────────────────────────────

const OUT_DIR   = path.join(__dirname, '..', 'e2e-report');
const SHOTS_DIR = path.join(OUT_DIR, 'screenshots');
fs.mkdirSync(SHOTS_DIR, { recursive: true });

// ── Shared state ──────────────────────────────────────────────────────────────

const results      = []; // { user, flow, step, ok, error, shotPath, ms }
const needsCleanup = []; // emergency cleanup if user crashes mid-run

// ── Helpers ───────────────────────────────────────────────────────────────────

const log = msg => console.log('[' + new Date().toLocaleTimeString() + '] ' + msg);

async function screenshot(page, label) {
  const p = path.join(SHOTS_DIR, label + '_' + Date.now() + '.png');
  await page.screenshot({ path: p, fullPage: false }).catch(() => {});
  return p;
}

function addResult(user, flow, step, ok, error, shotPath, ms) {
  results.push({ user: user.name, flow, step, ok, error: error || '', shotPath: shotPath || '', ms: ms || 0 });
  log('  ' + (ok ? 'OK' : 'FAIL') + ' [' + user.name + '] ' + flow + '/' + step + (error ? ' -- ' + String(error).slice(0, 100) : ''));
}

// ── Browser primitives ────────────────────────────────────────────────────────

async function loginUser(browser, user) {
  const ctx  = await browser.newContext({ viewport: { width: 430, height: 920 } });
  const page = await ctx.newPage();

  // Browser login is intermittently flaky (waitForURL can time out even though
  // the account is fine — confirmed by direct REST auth succeeding). Retry a few
  // times so a transient hiccup doesn't fail the user AND leave dangling state
  // (e.g. a join that never gets cleaned up). Re-navigating to /login each
  // attempt clears any leftover error modal.
  const MAX_ATTEMPTS = 3;
  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await page.goto(BASE_URL + '/login', { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(attempt === 1 ? 3000 : 1500);
      await page.getByText('Entendido', { exact: false }).click({ timeout: 2000 }).catch(() => {});

      await page.getByPlaceholder('Email').fill(user.email);
      await page.getByPlaceholder(/Contrase/i).fill(PASSWORD);
      await page.getByText(/INICIAR\s+SESI/i, { exact: false }).click();
      await page.waitForURL(u => !String(u).includes('/login'), { timeout: 20000 });
      await page.waitForTimeout(3500);
      return { ctx, page };
    } catch (e) {
      // The redirect may have fired just after the timeout window — accept it.
      if (!page.url().includes('/login')) { await page.waitForTimeout(2000); return { ctx, page }; }
      lastErr = e;
      log('    [' + user.name + '] login attempt ' + attempt + '/' + MAX_ATTEMPTS + ' failed: ' + String(e.message).split('\n')[0].slice(0, 50));
      if (attempt < MAX_ATTEMPTS) await page.waitForTimeout(2500 * attempt); // backoff (eases transient auth rate limits)
    }
  }
  await ctx.close().catch(() => {});
  throw new Error('login failed after ' + MAX_ATTEMPTS + ' attempts: ' + (lastErr ? String(lastErr.message).split('\n')[0] : 'unknown'));
}

async function openMatch(page, matchId) {
  await page.goto(BASE_URL + '/match/' + matchId, { waitUntil: 'domcontentloaded', timeout: 30000 });
  // Wait for the price to be in the DOM. NOTE: use state:'attached', not the
  // default 'visible' — react-native-web wraps the price in zero-box nodes that
  // Playwright's visibility check rejects (so waitForSelector('visible') times
  // out even though the price is on screen). 'attached' is the reliable signal.
  await page.locator('text=/\\d+\\.\\d+/').first().waitFor({ state: 'attached', timeout: 25000 });
  await page.waitForTimeout(2000);
}

async function isJoined(page) {
  return page.getByText(/Cancelar Plaza/i).first().isVisible({ timeout: 3000 }).catch(() => false);
}

// The "add guest" button is an icon-only 48x48 button left of "Cancelar Plaza"
// (no text/role/aria), so target it by its box. Returns false if it's gone or
// disabled (i.e. the match is full) — useful as a full-state signal.
async function clickGuestButton(page) {
  const box = await page.evaluate(() => {
    const els = [...document.querySelectorAll('div')].filter(el => {
      const r = el.getBoundingClientRect();
      return Math.round(r.width) === 48 && Math.round(r.height) === 48 && r.y > 680 &&
             getComputedStyle(el).cursor === 'pointer';
    });
    if (!els.length) return null;
    const r = els[0].getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (!box) return false;
  await page.mouse.click(box.x, box.y);
  return true;
}

// Get a user's access token (for direct REST integrity checks / cleanup).
async function authToken(email) {
  try {
    const r = await fetch(SB_URL + '/auth/v1/token?grant_type=password', {
      method: 'POST', headers: { apikey: SB_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: PASSWORD }),
    });
    const j = await r.json();
    return j.access_token || null;
  } catch { return null; }
}

// ── MONEI payment form ────────────────────────────────────────────────────────

async function fillMoneiForm(page, redirectUrl) {
  log('    MONEI redirect: ' + redirectUrl.slice(0, 70));

  if (!page.url().includes('monei') && !page.url().includes('checkout') && !page.url().includes('pay')) {
    await page.goto(redirectUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  }
  await page.waitForTimeout(3000);
  await screenshot(page, '_monei_form');

  const allFrames = [page, ...page.frames()];

  async function tryFill(selectors, value) {
    for (const frame of allFrames) {
      for (const sel of selectors) {
        try {
          const loc = frame.locator(sel).first();
          if (await loc.isVisible({ timeout: 600 })) { await loc.fill(value); return true; }
        } catch (_) {}
      }
    }
    return false;
  }

  await tryFill(['input[name="cardNumber"]','input[autocomplete="cc-number"]','input[placeholder*="0000"]','[data-testid*="card-number"]','input[id*="card"]'], CARD.number);
  await tryFill(['input[name*="expir" i]','input[autocomplete="cc-exp"]','input[placeholder*="MM"]','[data-testid*="expiry"]'], CARD.expiry);
  await tryFill(['input[name*="cvc" i]','input[name*="cvv" i]','input[autocomplete="cc-csc"]','input[placeholder*="CVC"]','input[placeholder*="CVV"]','[data-testid*="cvc"]'], CARD.cvc);
  await tryFill(['input[name*="holder" i]','input[autocomplete="cc-name"]','input[placeholder*="nombre" i]','input[placeholder*="name" i]','[data-testid*="holder"]'], CARD.name);

  await page.waitForTimeout(800);
  await screenshot(page, '_monei_filled');

  const submitSels = ['button[type="submit"]','button:has-text("Pagar")','button:has-text("Pay")','button:has-text("Confirmar")','input[type="submit"]'];
  for (const frame of allFrames) {
    for (const sel of submitSels) {
      try {
        const btn = frame.locator(sel).first();
        if (await btn.isVisible({ timeout: 600 })) { await btn.click(); break; }
      } catch (_) {}
    }
  }

  // Poll the URL instead of waitForURL: MONEI does several redirects and
  // waitForURL throws "net::ERR_ABORTED / frame detached" mid-redirect. Polling
  // page.url() tolerates the navigations.
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    const u = page.url();
    if (u.includes('payment/return') || (u.startsWith(BASE_URL) && !/monei/.test(u))) break;
    await page.waitForTimeout(1000).catch(() => {});
  }
  await page.waitForTimeout(4000);
  return page.url();
}

// ── FREE flow ─────────────────────────────────────────────────────────────────

async function runFreeFlow(browser, user) {
  const t0 = Date.now();
  let ctx, page, sp;
  try {
    log('> [' + user.name + '] FREE');
    ({ ctx, page } = await loginUser(browser, user));
    addResult(user, 'FREE', 'login', true, null, null, Date.now() - t0);

    await openMatch(page, MATCH_FREE_ID);
    sp = await screenshot(page, user.name + '_free_01');

    if (await isJoined(page)) {
      await page.getByText(/Cancelar Plaza/i).first().click({ timeout: 5000 });
      await page.waitForTimeout(3000);
    }

    const joinBtn = page.getByText(/RESERVAR PLAZA/i).first();
    await joinBtn.waitFor({ state: 'visible', timeout: 8000 });
    await joinBtn.click();
    await page.waitForTimeout(4000);
    sp = await screenshot(page, user.name + '_free_02_joined');

    const joined = await isJoined(page);
    addResult(user, 'FREE', 'join', joined, joined ? null : 'cancel btn not visible', sp, Date.now() - t0);
    if (!joined) { await ctx.close(); return; }

    needsCleanup.push({ user, matchId: MATCH_FREE_ID, paid: false });

    await page.getByText(/Cancelar Plaza/i).first().click({ timeout: 8000 });
    await page.waitForTimeout(4000);
    sp = await screenshot(page, user.name + '_free_03_left');

    const stillJoined = await isJoined(page);
    addResult(user, 'FREE', 'leave', !stillJoined, stillJoined ? 'still joined' : null, sp, Date.now() - t0);

    const idx = needsCleanup.findIndex(c => c.user === user && c.matchId === MATCH_FREE_ID);
    if (idx !== -1) needsCleanup.splice(idx, 1);

  } catch (e) {
    sp = page ? await screenshot(page, user.name + '_free_ERR') : null;
    addResult(user, 'FREE', 'error', false, e.message, sp, Date.now() - t0);
  } finally {
    if (ctx) await ctx.close().catch(() => {});
  }
}

// ── PAID flow ─────────────────────────────────────────────────────────────────

async function runPaidFlow(browser, user) {
  const t0 = Date.now();
  let ctx, page, sp;
  try {
    log('> [' + user.name + '] PAID');
    ({ ctx, page } = await loginUser(browser, user));
    addResult(user, 'PAID', 'login', true, null, null, Date.now() - t0);

    await openMatch(page, MATCH_PAID_ID);
    sp = await screenshot(page, user.name + '_paid_01');

    if (await isJoined(page)) {
      page.on('dialog', d => d.accept().catch(() => {}));
      await page.getByText(/Cancelar Plaza/i).first().click({ timeout: 5000 });
      await page.waitForTimeout(6000);
    }

    let redirectUrl = null;
    page.on('response', async res => {
      if (res.url().includes('create-payment') && !redirectUrl) {
        try { const b = await res.json(); if (b.redirectUrl) redirectUrl = b.redirectUrl; } catch (_) {}
      }
    });

    const payBtn = page.getByText(/PAGAR PLAZA/i).first();
    await payBtn.waitFor({ state: 'visible', timeout: 8000 });
    await payBtn.click();
    await page.waitForTimeout(4000);

    if (!redirectUrl && !page.url().startsWith(BASE_URL)) redirectUrl = page.url();

    sp = await screenshot(page, user.name + '_paid_02_pay');
    const gotRedirect = !!redirectUrl;
    addResult(user, 'PAID', 'create_payment', gotRedirect, gotRedirect ? null : 'no MONEI URL', sp, Date.now() - t0);
    if (!gotRedirect) { await ctx.close(); return; }

    const returnUrl = await fillMoneiForm(page, redirectUrl);
    sp = await screenshot(page, user.name + '_paid_03_return');

    const onReturn  = returnUrl.includes('payment/return');
    const succeeded = onReturn && await page.getByText(/Plaza Reservada|confirmado/i).first().isVisible({ timeout: 6000 }).catch(() => false);
    addResult(user, 'PAID', 'payment', succeeded, succeeded ? null : 'return: ' + returnUrl, sp, Date.now() - t0);

    if (!succeeded) { await ctx.close(); return; }

    await openMatch(page, MATCH_PAID_ID);
    sp = await screenshot(page, user.name + '_paid_04_joined');
    const joined = await isJoined(page);
    addResult(user, 'PAID', 'verify_joined', joined, joined ? null : 'cancel btn not visible', sp, Date.now() - t0);
    needsCleanup.push({ user, matchId: MATCH_PAID_ID, paid: true });

    // Verify the deployed fix: the paid participant row must have created_by set
    // (was NULL before the fix → only an admin could remove it).
    if (joined) {
      const pr = await fetch(SB_URL + '/rest/v1/match_participants?match_id=eq.' + MATCH_PAID_ID + '&select=user_name,user_id,created_by', { headers: sbHeaders }).catch(() => null);
      const rows = pr ? await pr.json().catch(() => []) : [];
      const mine = Array.isArray(rows) ? rows.find(p => p.user_id) : null;
      addResult(user, 'PAID', 'created_by_set', !!(mine && mine.created_by), 'created_by=' + (mine ? String(mine.created_by).slice(0, 8) : 'no row'), null, Date.now() - t0);
    }

    page.on('dialog', d => d.accept().catch(() => {}));
    await page.getByText(/Cancelar Plaza/i).first().click({ timeout: 8000 });
    await page.waitForTimeout(7000);
    sp = await screenshot(page, user.name + '_paid_05_cancelled');

    const stillJoined = await isJoined(page);
    addResult(user, 'PAID', 'cancel_refund', !stillJoined, stillJoined ? 'still joined' : null, sp, Date.now() - t0);

    const idx = needsCleanup.findIndex(c => c.user === user && c.matchId === MATCH_PAID_ID);
    if (idx !== -1) needsCleanup.splice(idx, 1);

  } catch (e) {
    sp = page ? await screenshot(page, user.name + '_paid_ERR') : null;
    addResult(user, 'PAID', 'error', false, e.message, sp, Date.now() - t0);
  } finally {
    if (ctx) await ctx.close().catch(() => {});
  }
}

// ── FILL flow (capacity / no-overbooking) ──────────────────────────────────────

async function runFillFlow(browser, matchId, absMax, existing) {
  log('\n-- FILL FLOW (' + USERS.length + ' users) -> match ' + matchId + ' --');
  if (absMax == null) { log('  Could not read match capacity; aborting fill.'); return; }
  let joinedNew = 0;
  const total = () => existing + joinedNew;

  for (const user of USERS) {
    const t0 = Date.now();
    let ctx, page, sp;
    try {
      ({ ctx, page } = await loginUser(browser, user));
      await openMatch(page, matchId);

      // Leftover join from a prior run — count it and schedule cleanup.
      if (await isJoined(page)) {
        joinedNew++; needsCleanup.push({ user, matchId, paid: false });
        addResult(user, 'FILL', 'join(already)', true, 'slot ' + total() + '/' + absMax, null, Date.now() - t0);
        await ctx.close(); continue;
      }

      const joinBtn      = page.getByText(/RESERVAR PLAZA/i).first();
      const canJoin      = await joinBtn.isVisible({ timeout: 3000 }).catch(() => false);
      const shouldBeFull = total() >= absMax;

      if (canJoin) {
        await joinBtn.click();
        await page.waitForTimeout(3500);
        if (await isJoined(page)) {
          joinedNew++; needsCleanup.push({ user, matchId, paid: false });
          addResult(user, 'FILL', 'join', true, 'slot ' + total() + '/' + absMax, null, Date.now() - t0);
        } else {
          // Join didn't register — acceptable ONLY if the match was already full.
          sp = await screenshot(page, user.name + '_fill_rej');
          addResult(user, 'FILL', shouldBeFull ? 'rejected_full' : 'join', shouldBeFull,
            shouldBeFull ? null : 'join did not register while slots remained', sp, Date.now() - t0);
        }
      } else {
        // No reserve button => UI shows "Cupo Lleno". OK only if actually full.
        sp = await screenshot(page, user.name + '_fill_full');
        addResult(user, 'FILL', shouldBeFull ? 'blocked_full' : 'no_join_btn', shouldBeFull,
          shouldBeFull ? null : 'reserve btn missing while slots remained', sp, Date.now() - t0);
      }
      await ctx.close();
    } catch (e) {
      sp = page ? await screenshot(page, user.name + '_fill_ERR') : null;
      addResult(user, 'FILL', 'error', false, e.message, sp, Date.now() - t0);
      if (ctx) await ctx.close().catch(() => {});
    }
  }

  // Integrity check: the DB must hold EXACTLY absoluteMax participants — never more.
  const dbCount = await countParticipants(matchId);
  const ok = dbCount === absMax;
  addResult({ name: 'CAPACITY' }, 'FILL', 'no_overbooking', ok,
    'dbCount=' + dbCount + ' absoluteMax=' + absMax + ' newJoins=' + joinedNew, null, 0);
  log('  CAPACITY: dbCount=' + dbCount + ' / max=' + absMax + ' (newJoins=' + joinedNew + ') -> ' +
    (dbCount > absMax ? 'OVERBOOKED!' : ok ? 'OK (filled, no overbooking)' : 'under-filled, check'));
}

// ── GUEST FILL flow (fill a match with guests + assert no overbooking) ──────────

async function runGuestFillFlow(browser, matchId) {
  const absMax = await matchAbsoluteMax(matchId);
  const organizer = USERS[0];
  log('\n-- GUEST FILL (' + organizer.name + ') -> match ' + matchId + ' (cap ' + absMax + ') --');
  if (absMax == null) { log('  Could not read match capacity; aborting.'); return; }

  let ctx, page;
  try {
    ({ ctx, page } = await loginUser(browser, organizer));
    page.on('dialog', d => d.accept().catch(() => {})); // auto-OK the success/info alerts
    await openMatch(page, matchId);

    // Organizer must be a participant before adding guests (RPC enforces this).
    if (!(await isJoined(page))) {
      await page.getByText(/RESERVAR PLAZA/i).first().click().catch(() => {});
      await page.waitForTimeout(3500);
    }
    let count = await countParticipants(matchId);
    addResult(organizer, 'GUEST_FILL', 'organizer_join', count >= 1, 'count=' + count + '/' + absMax, null, 0);

    // Add guests via the UI button until the match is full.
    let added = 0, guard = absMax + 3;
    while (count < absMax && guard-- > 0) {
      if (!(await clickGuestButton(page))) break; // button gone/disabled => full
      await page.waitForTimeout(2500);
      const n = await countParticipants(matchId);
      if (n > count) { added++; count = n; } else break;
    }
    addResult(organizer, 'GUEST_FILL', 'fill_with_guests', count === absMax,
      'added ' + added + ' guest(s), count=' + count + '/' + absMax, await screenshot(page, organizer.name + '_guestfill'), 0);

    // UI must block adding past capacity.
    const uiClicked = await clickGuestButton(page);
    await page.waitForTimeout(2000);
    const afterUi = await countParticipants(matchId);
    addResult({ name: 'CAPACITY' }, 'GUEST_FILL', 'ui_blocks_overbook', afterUi === absMax,
      'guestBtnClickable=' + uiClicked + ' count=' + afterUi + '/' + absMax, null, 0);

    await ctx.close();
  } catch (e) {
    if (page) await screenshot(page, organizer.name + '_guestfill_ERR');
    addResult(organizer, 'GUEST_FILL', 'error', false, e.message, null, 0);
    if (ctx) await ctx.close().catch(() => {});
  }

  // Backend integrity: a direct over-capacity guest RPC must be rejected, and
  // then clean up all of the organizer's rows (real + guests).
  const tok = await authToken(organizer.name + '@testusers.com');
  if (tok) {
    const rr = await fetch(SB_URL + '/rest/v1/rpc/join_match', {
      method: 'POST',
      headers: { apikey: SB_KEY, Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_match_id: matchId, p_user_name: organizer.name + ' (invitado overflow)', p_is_guest: true }),
    }).catch(() => null);
    const cnt = await countParticipants(matchId);
    addResult({ name: 'CAPACITY' }, 'GUEST_FILL', 'rpc_rejects_overbook', !!rr && rr.status >= 400 && cnt === absMax,
      'rpcStatus=' + (rr ? rr.status : 'n/a') + ' count=' + cnt + '/' + absMax, null, 0);

    await fetch(SB_URL + '/rest/v1/match_participants?match_id=eq.' + matchId, {
      method: 'DELETE', headers: { apikey: SB_KEY, Authorization: 'Bearer ' + tok },
    }).catch(() => {});
  }
  const left = await countParticipants(matchId);
  log('  GUEST_FILL cleanup -> ' + left + ' participant(s) remaining' + (left > 0 ? ' (WARN: needs manual cleanup)' : ''));
}

// ── Emergency cleanup ──────────────────────────────────────────────────────────

async function emergencyCleanup(browser) {
  if (!needsCleanup.length) { log('No cleanup needed.'); return; }
  log('\nCleaning up ' + needsCleanup.length + ' leftover participant(s)...');
  for (const { user, matchId, paid } of needsCleanup.slice()) {
    let ctx, page;
    try {
      ({ ctx, page } = await loginUser(browser, user));
      await openMatch(page, matchId);
      if (await isJoined(page)) {
        page.on('dialog', d => d.accept().catch(() => {}));
        await page.getByText(/Cancelar Plaza/i).first().click({ timeout: 8000 });
        await page.waitForTimeout(paid ? 7000 : 3000);
        const still = await isJoined(page);
        log('  ' + (still ? 'FAIL' : 'OK') + ' [' + user.name + '] cleanup');
      } else {
        log('  OK [' + user.name + '] already not joined');
      }
    } catch (e) {
      log('  FAIL [' + user.name + '] cleanup error: ' + e.message.slice(0, 80));
    } finally {
      if (ctx) await ctx.close().catch(() => {});
    }
  }
}

// ── HTML report ───────────────────────────────────────────────────────────────

function generateReport() {
  const pass = results.filter(r => r.ok).length;
  const fail = results.filter(r => !r.ok).length;

  const byUser = {};
  for (const r of results) {
    if (!byUser[r.user]) byUser[r.user] = { pass: 0, fail: 0, flows: new Set() };
    byUser[r.user][r.ok ? 'pass' : 'fail']++;
    byUser[r.user].flows.add(r.flow);
  }

  const css = '<style>\n' +
    'body{font-family:system-ui;padding:24px;background:#f8fafc;color:#0f172a}\n' +
    '.badges{display:flex;gap:12px;margin:12px 0}\n' +
    '.badge{padding:6px 16px;border-radius:8px;font-weight:700;font-size:15px}\n' +
    '.p{background:#d1fae5;color:#059669}.f{background:#fee2e2;color:#dc2626}.t{background:#e0f2fe;color:#0369a1}\n' +
    'table{border-collapse:collapse;background:#fff;border-radius:8px;width:100%;margin-bottom:24px;box-shadow:0 1px 3px rgba(0,0,0,.1)}\n' +
    'th{background:#0f172a;color:#fff;padding:9px 12px;text-align:left;font-size:13px}\n' +
    'td{padding:7px 12px;font-size:12px;border-bottom:1px solid #f1f5f9}\n' +
    'tr.ok td{background:#f0fdf4}tr.fail td{background:#fff1f2}\n' +
    '</style>\n';

  const summaryRows = Object.entries(byUser).map(([u, s]) =>
    '<tr class="' + (s.fail ? 'fail' : 'ok') + '"><td>' + u + '</td>' +
    '<td>' + Array.from(s.flows).join(', ') + '</td>' +
    '<td>' + (s.fail ? 'FAIL' : 'PASS') + '</td>' +
    '<td>' + s.pass + ' / ' + (s.pass + s.fail) + '</td></tr>'
  ).join('');

  const detailRows = results.map(r =>
    '<tr class="' + (r.ok ? 'ok' : 'fail') + '"><td>' + r.user + '</td><td>' + r.flow + '</td><td>' + r.step + '</td>' +
    '<td>' + (r.ok ? 'PASS' : 'FAIL') + '</td>' +
    '<td>' + r.error.slice(0, 70) + '</td>' +
    '<td>' + r.ms + 'ms</td>' +
    '<td>' + (r.shotPath ? '<a href="file://' + r.shotPath + '" target="_blank">shot</a>' : '') + '</td></tr>'
  ).join('');

  const html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>E2E</title>' + css + '</head><body>' +
    '<h1>AmicSport E2E Report</h1>' +
    '<p>' + new Date().toLocaleString() + ' - ' + USERS.length + ' users</p>' +
    '<div class="badges">' +
    '<span class="badge t">Steps: ' + (pass + fail) + '</span>' +
    '<span class="badge p">PASS: ' + pass + '</span>' +
    '<span class="badge f">FAIL: ' + fail + '</span></div>' +
    '<h2>Summary per user</h2>' +
    '<table><tr><th>User</th><th>Flows</th><th>Result</th><th>Steps</th></tr>' + summaryRows + '</table>' +
    '<h2>All steps</h2>' +
    '<table><tr><th>User</th><th>Flow</th><th>Step</th><th>Result</th><th>Error</th><th>Time</th><th>Screenshot</th></tr>' +
    detailRows + '</table></body></html>';

  const p = path.join(OUT_DIR, 'report.html');
  fs.writeFileSync(p, html);
  return p;
}

// ── Main ──────────────────────────────────────────────────────────────────────

(async () => {
  log('AmicSport E2E - ' + USERS.length + ' users - ' + new Date().toLocaleString());
  log('FREE match: ' + MATCH_FREE_ID);
  log('PAID match: ' + MATCH_PAID_ID);

  const browser = await chromium.launch({ headless: true });

  try {
    if (FILL_GUESTS) {
      await runGuestFillFlow(browser, MATCH_FREE_ID);
    } else if (FILL) {
      const absMax   = await matchAbsoluteMax(MATCH_FREE_ID);
      const existing = await countParticipants(MATCH_FREE_ID);
      log('Fill target (FREE) ' + MATCH_FREE_ID + ': absoluteMax=' + absMax + ' existing=' + existing);
      await runFillFlow(browser, MATCH_FREE_ID, absMax, existing);
    } else {
      if (!PAID_ONLY) {
        log('\n-- FREE FLOW (' + USERS.length + ' users) --');
        for (const user of USERS) await runFreeFlow(browser, user);
      }

      if (!FREE_ONLY) {
        const paidUsers = USERS.filter(u => PAID_USER_NAMES.has(u.name));
        if (paidUsers.length) {
          log('\n-- PAID FLOW (' + paidUsers.length + ' users) --');
          for (const user of paidUsers) await runPaidFlow(browser, user);
        }
      }
    }

    await emergencyCleanup(browser);

  } finally {
    await browser.close();
  }

  const reportPath = generateReport();
  const pass = results.filter(r => r.ok).length;
  const fail = results.filter(r => !r.ok).length;
  log('DONE  PASS:' + pass + '  FAIL:' + fail + '  (' + results.length + ' steps)');
  log('Report: ' + reportPath);
  if (fail > 0) process.exit(1);
})();
