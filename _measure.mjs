import { chromium } from '@playwright/test';
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
const p = await ctx.newPage();
await p.goto('http://localhost:4173/hearsay/#/play/easy/measure', { waitUntil: 'networkidle' });
await p.waitForSelector('[data-testid^="tile-"]');
await p.waitForTimeout(500);
const m = await p.evaluate(() => {
  const q = (s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { h: Math.round(r.height), top: Math.round(r.top), bottom: Math.round(r.bottom) }; };
  return {
    scrollHeight: document.documentElement.scrollHeight,
    header: q('header'), grid: q('[role=grid]'),
    tuner: q('[data-testid="tuner-replay"]')?.bottom,
    bank: q('section[aria-label="Filing bank"]'),
    submit: q('[data-testid="submit-round"]'),
    tile: q('[data-testid^="tile-"]'),
  };
});
console.log(JSON.stringify(m, null, 1));
await b.close();
