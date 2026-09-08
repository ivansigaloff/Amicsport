require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 430, height: 920 } });
  const page = await ctx.newPage();

  // test edu login
  await page.goto('http://localhost:8081/login', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);
  await page.getByText('Entendido', { exact: false }).click({ timeout: 2000 }).catch(() => {});
  // Test credentials come from .env (never commit them): E2E_TEST_EMAIL / E2E_TEST_PASSWORD
  const email = process.env.E2E_TEST_EMAIL, password = process.env.E2E_TEST_PASSWORD;
  if (!email || !password) { console.error('Set E2E_TEST_EMAIL and E2E_TEST_PASSWORD in .env'); process.exit(1); }
  await page.getByPlaceholder('Email').fill(email);
  await page.getByPlaceholder(/Contrase/i).fill(password);
  // screenshot before click to see button text
  await page.screenshot({ path: '_probe_before_click.png' });
  const btns = await page.getByRole('button').allInnerTexts();
  console.log('BUTTONS:', btns);
  // try to find the login button differently
  await page.locator('button').filter({ hasText: /sesi/i }).click({ timeout: 5000 }).catch(e => console.log('btn click fail:', e.message.slice(0,80)));
  await page.waitForTimeout(5000);
  console.log('URL after click:', page.url());
  await page.screenshot({ path: '_probe_after_click.png' });

  // Test match page
  await page.goto('http://localhost:8081/match/8175b53b-18e9-472f-9cf4-d5f6b5e6a81a', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(4000);
  const body = (await page.evaluate(() => document.body ? document.body.innerText.slice(0, 400) : '')).replace(/\n+/g, ' ');
  console.log('MATCH PAGE TEXT:', body);
  await page.screenshot({ path: '_probe_match.png' });

  await browser.close();
})();
