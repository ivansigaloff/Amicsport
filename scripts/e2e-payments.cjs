/**
 * e2e-payments.cjs — reference implementation for automating MONEI payments in e2e.
 *
 * Demonstrates a full, self-cleaning automated payment for each supported method:
 *   • CARD  — fully automatable (reliable).
 *   • BIZUM — automatable in test mode (see constraints below).
 *   • GOOGLE PAY — NOT automatable (opens a Google account sign-in popup).
 *
 * Full guide: docs/PAYMENTS_AUTOMATION.md
 *
 *   node scripts/e2e-payments.cjs           # card + bizum
 *   node scripts/e2e-payments.cjs --card
 *   node scripts/e2e-payments.cjs --bizum
 *   E2E_BASE_URL=http://localhost:8081 node scripts/e2e-payments.cjs   # against dev
 */
const { chromium } = require('playwright');
require('dotenv').config();

const U = process.env.EXPO_PUBLIC_SUPABASE_URL, K = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const BASE = process.env.E2E_BASE_URL || 'https://multigraf.info/Kickerzbcn';
const PASSWORD = 'TestKKZ1!';

// MONEI sandbox test values (see docs.monei.com/testing).
// 4444444444444414 = "direct approval WITHOUT challenge" (no 3DS step) → most
// reliable for headless automation. (4444444444444422 is "3DS frictionless": it
// still shows a "Validating payment" 3DS step that hangs/fails intermittently headless.)
const CARD = { number: '4444444444444414', expiry: '12/34', cvc: '123', name: 'TEST USER' };
const BIZUM_TEST_PHONE = '500000000';   // +34 500000000 — the only "registered" sandbox Bizum number

// Bizum in sandbox ONLY approves for amounts < 5€ (5-10€ → auth error E506). Use a <5€ paid match.
const MATCH_CARD = '475bf27a-4de4-4817-9c3a-c0457e91b174';   // 6€ paid match (amount irrelevant for card)
const MATCH_BIZUM = 'cb5bf3a5-204b-49d2-a60f-3e182d735578';  // 4€ paid match — MUST be < 5€ for Bizum

const log = (m) => console.log('[' + new Date().toLocaleTimeString() + '] ' + m);
const results = [];
const check = (s, ok, d) => { results.push({ s, ok }); log((ok ? '✅' : '❌') + ' ' + s + (d ? ' — ' + d : '')); };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const auth = (email) => fetch(U + '/auth/v1/token?grant_type=password', { method: 'POST', headers: { apikey: K, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) }).then(r => r.json());

// create-payment edge function → { order_id, redirectUrl }
const createSession = async (token, matchId) => {
  const r = await fetch(U + '/functions/v1/create-payment', { method: 'POST', headers: { apikey: K, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ match_id: matchId, env: 'prod' }) });
  return { status: r.status, body: await r.json() };
};
const paymentStatus = async (token, orderId) => {
  const r = await fetch(U + '/rest/v1/payments?order_id=eq.' + orderId + '&select=status,payment_method', { headers: { apikey: K, Authorization: 'Bearer ' + token } });
  const j = await r.json().catch(() => []); return j[0] || {};
};
// Poll until the payment leaves PENDING (webhook / verify-payment updates it server-side).
const waitPaid = async (token, orderId, ms) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const s = await paymentStatus(token, orderId); if (s.status && s.status !== 'PENDING') return s; await sleep(5000); }
  return paymentStatus(token, orderId);
};

// ── MONEI hosted-page payers ────────────────────────────────────────────────
async function payCard(page) {
  const frames = () => [page, ...page.frames()];
  // Retry per field: the card fields render in the inner-card-input iframe, which
  // loads slightly AFTER the page. A single fast isVisible() check can miss it and
  // leave the card blank → the payment then FAILS. Poll up to ~6s per field.
  const fill = async (sels, val) => {
    for (let i = 0; i < 12; i++) { for (const f of frames()) for (const s of sels) { try { const l = f.locator(s).first(); if (await l.isVisible({ timeout: 300 })) { await l.fill(val); return true; } } catch {} } await sleep(500); }
    return false;
  };
  await page.waitForSelector('input[name="billingName"]', { timeout: 15000 }).catch(() => {});
  const okNum = await fill(['input[autocomplete="cc-number"]', 'input[name="cardNumber"]'], CARD.number);   // card fields live in the inner-card-input iframe
  await fill(['input[autocomplete="cc-exp"]', 'input[name="cc-exp"]'], CARD.expiry);
  await fill(['input[autocomplete="cc-csc"]', 'input[name="cvc"]'], CARD.cvc);
  await fill(['input[name="billingName"]'], CARD.name);  // REQUIRED on the main page, else submit is blocked
  if (!okNum) log('  (warning: card-number field never became visible)');
  await sleep(700);
  for (const f of frames()) { try { const b = f.locator('button:has-text("Pagar")').first(); if (await b.isVisible({ timeout: 400 })) { await b.click(); break; } } catch {} }
  await page.waitForURL(x => /payment\/return/.test(String(x)) || String(x).startsWith(BASE), { timeout: 40000 }).catch(() => {});
  await sleep(4000);
}
async function payBizum(page) {
  await page.mouse.click(215, 395);          // the Bizum button is an iframe-rendered logo → click by coordinate
  await sleep(4000);
  const bz = page.frames().find(f => /inner-bizum\//.test(f.url()) && !/-button/.test(f.url()));  // phone form is in the inner-bizum frame
  if (!bz) { log('  (bizum frame not found)'); return; }
  await bz.locator('input[type="tel"]').first().fill(BIZUM_TEST_PHONE).catch(() => {});
  await sleep(400);
  await bz.locator('button:has-text("Pagar")').first().click().catch(() => {});
  // RTP flow shows a "complete in your bank app" page; <5€ auto-approves async → caller polls waitPaid.
}

// ── App cancel (refunds a paid spot) so the test leaves state clean ─────────
async function appCancel(browser, email, matchId) {
  const ctx = await browser.newContext({ viewport: { width: 430, height: 920 } });
  const page = await ctx.newPage();
  page.on('dialog', d => d.accept().catch(() => {}));   // accept the refund confirm
  try {
    await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(2500);
    await page.getByText('Entendido', { exact: false }).click({ timeout: 2000 }).catch(() => {});
    await page.getByPlaceholder('Email').fill(email);
    await page.getByPlaceholder(/Contrase/i).fill(PASSWORD);
    await page.getByText(/INICIAR\s+SESI/i, { exact: false }).click();
    await page.waitForURL(x => !String(x).includes('/login'), { timeout: 20000 }).catch(() => {});
    await sleep(2500);
    await page.goto(BASE + '/match/' + matchId, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.locator('text=/\\d+\\.\\d+/').first().waitFor({ state: 'attached', timeout: 25000 }).catch(() => {});
    await sleep(1500);
    for (let i = 0; i < 5; i++) {
      if (!(await page.getByText(/Cancelar Plaza/i).first().isVisible({ timeout: 2500 }).catch(() => false))) break;
      await page.getByText(/Cancelar Plaza/i).first().click({ timeout: 6000 }).catch(() => {});
      await sleep(6000);   // paid cancel = refund round-trip
    }
    return !(await page.getByText(/Cancelar Plaza/i).first().isVisible({ timeout: 2000 }).catch(() => false));
  } finally { await ctx.close().catch(() => {}); }
}

async function runMethod(browser, label, email, matchId, payer, pollMs) {
  const a = await auth(email);
  if (!a.access_token) return check(`${label} auth`, false, 'login failed');
  const s = await createSession(a.access_token, matchId);
  if (!s.body.redirectUrl) return check(`${label} create-payment`, false, `HTTP ${s.status} ${JSON.stringify(s.body).slice(0, 50)}`);
  const ctx = await browser.newContext({ viewport: { width: 430, height: 920 } });
  const page = await ctx.newPage();
  await page.goto(s.body.redirectUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await sleep(label === 'BIZUM' ? 5000 : 4000);
  await payer(page);
  const st = await waitPaid(a.access_token, s.body.order_id, pollMs);
  check(`${label} payment SUCCEEDED`, st.status === 'SUCCEEDED', `status=${st.status} method=${st.payment_method}`);
  await ctx.close().catch(() => {});
  const clean = await appCancel(browser, email, matchId);
  check(`${label} cleanup (cancel+refund)`, clean, 'spot released');
}

(async () => {
  const only = process.argv.slice(2);
  log('e2e-payments  base=' + BASE);
  const browser = await chromium.launch({ headless: true });
  try {
    if (!only.length || only.includes('--card')) await runMethod(browser, 'CARD', 'moha@testusers.com', MATCH_CARD, payCard, 60000);
    if (!only.length || only.includes('--bizum')) await runMethod(browser, 'BIZUM', 'luisjr@testusers.com', MATCH_BIZUM, payBizum, 90000);
  } finally { await browser.close(); }
  const pass = results.filter(r => r.ok).length, fail = results.length - pass;
  console.log(`\nDONE  PASS:${pass}  FAIL:${fail}`);
  if (fail) process.exit(1);
})();
