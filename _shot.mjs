import { chromium } from '@playwright/test';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));

await page.goto('http://localhost:4173/hearsay/', { waitUntil: 'networkidle' });
await page.waitForTimeout(900);
await page.screenshot({ path: '/tmp/shots/01-home.png' });

await page.getByTestId('start-easy').click();
await page.waitForSelector('[data-testid^="tile-"]');
await page.waitForTimeout(1400);
await page.screenshot({ path: '/tmp/shots/02-first-run-manual.png' });

// hear four stations
const ids = await page.$$eval('[data-testid^="tile-"]', ns => ns.map(n => n.dataset.testid));
for (const t of ids.slice(0, 4)) { await page.click(`[data-testid="${t}"]`); await page.waitForTimeout(450); }
await page.waitForTimeout(600);
await page.screenshot({ path: '/tmp/shots/03-heard-four.png' });

await page.getByTestId('tuner-hold').click();
await page.click(`[data-testid="${ids[5]}"]`);
await page.waitForTimeout(400);
await page.getByTestId('tuner-hold').click();
await page.waitForTimeout(300);
await page.screenshot({ path: '/tmp/shots/04-two-held.png' });

const buckets = await page.$$eval('[data-testid^="bucket-"]', ns => ns.map(n => n.dataset.testid));
await page.click(`[data-testid="${buckets[0]}"]`);
await page.waitForTimeout(500);
await page.screenshot({ path: '/tmp/shots/05-filed.png' });

console.log('CONSOLE:', errs.length ? errs : 'clean');
await browser.close();
