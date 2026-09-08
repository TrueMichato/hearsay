/**
 * End-to-end check of a *deployed* build, run against a real URL.
 *
 * A green CI checkmark is not evidence the game works. The failure this exists
 * to catch is specific to a GitHub project page: the site is served from
 * `/hearsay/`, not the domain root, so if the build's `base` is wrong the HTML
 * still loads and the deploy looks successful while every audio clip 404s. The
 * board renders, the score still computes, and the player hears nothing.
 *
 * Deliberately broken once to confirm it detects that: removing `BASE_URL` from
 * `useBoardAudio` produced `16 requests 404d` and `only 0/16 tiles played`
 * while the score was still a correct +1280 — which is exactly why "the page
 * rendered" cannot be the test.
 *
 *   SITE=https://truemichato.github.io/hearsay/ node scripts/verify-deploy.mjs
 */
import { chromium } from '@playwright/test';
import manifest from '../src/content/manifest.json' with { type: 'json' };

const BASE = process.env.SITE ?? 'http://localhost:4180/hearsay/';
const langOf = new Map(manifest.clips.map((c) => [c.id, c.language]));
const clusterOf = (l) => manifest.clusters.find((c) => c.languages.includes(l))?.id ?? l;
const nameOf = new Map(manifest.languages.map((l) => [l.name, l.id]));
const CODES = manifest.languages.map((l) => l.id).join('|');

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const reqs = [];
page.on('response', (r) => reqs.push({ url: r.url(), status: r.status() }));
const fail = [];

// cold deep link, exactly what a shared URL looks like
await page.goto(`${BASE}#/play/easy/deploycheck`, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-testid^="tile-"]');
const ids = await page.$$eval('[data-testid^="tile-"]', (ns) => ns.map((n) => n.dataset.testid.replace('tile-', '')));
const langs = [...new Set(ids.map((i) => langOf.get(i)))];
const clusters = langs.map(clusterOf);
console.log('easy languages:', langs.join(', '), '| clusters:', clusters.join(', '));
if (new Set(clusters).size !== clusters.length) fail.push('easy served same-cluster languages');

// leak gate against the live site
const attrs = await page.$$eval('[data-testid^="tile-"]', (ns) =>
  ns.map((n) => [...n.attributes].map((a) => `${a.name}=${a.value}`).join(' ') + ' ' + n.innerHTML));
const re = new RegExp(`(?<![\\p{L}\\p{N}])(${CODES})(?![\\p{L}\\p{N}])`, 'u');
const domLeak = attrs.find((a) => re.test(a));
console.log('DOM leak:', domLeak ? domLeak.slice(0, 90) : 'none');
if (domLeak) fail.push('language leaked in tile DOM');

const audio = reqs.filter((r) => r.url.includes('.opus'));
const bad = audio.filter((r) => r.status !== 200 && r.status !== 206 && r.status !== 304);
console.log(`audio requests: ${audio.length} | non-200/206: ${bad.length}`, bad.slice(0, 3));
console.log('sample audio URL:', audio[0]?.url);
if (audio.length === 0) fail.push('no audio was requested at all');
if (bad.length) fail.push(`${bad.length} audio requests failed`);
if (audio.some((r) => re.test(new URL(r.url).pathname))) fail.push('language leaked in an audio URL');

const other404 = reqs.filter((r) => r.status === 404);
console.log('404s:', other404.length, other404.slice(0, 5).map((r) => r.url));
if (other404.length) fail.push(`${other404.length} requests 404d`);

// Playback, sampled the way a player listens.
//
// `progressed` flips on a tile's first `timeupdate`, which is genuine evidence
// that audio decoded and the media clock moved. It is not evidence a tap alone
// can produce. An earlier version of this check clicked all sixteen tiles in a
// tight loop and demanded eight had progressed: each click interrupted the one
// before it, so the number it reported was a measure of how fast Playwright
// clicks, not of whether sound came out. It failed at 4/16 on a deploy where
// audio was perfectly fine.
//
// So dwell on a sample instead, and require every sampled tile to sound.
const SAMPLE = 5;
for (const id of ids.slice(0, SAMPLE)) {
  await page.click(`[data-testid="tile-${id}"]`);
  await page.waitForTimeout(700);
}
const sampled = await page.$$eval('[data-testid^="tile-"]', (ns) =>
  ns.filter((n) => n.dataset.played === 'true').map((n) => n.dataset.testid));
console.log(`tiles that actually decoded and played: ${sampled.length} / ${SAMPLE} sampled`);
if (sampled.length < SAMPLE) fail.push(`only ${sampled.length}/${SAMPLE} sampled tiles played`);

// A tile is an assembled utterance of three words, and the whole reason for
// that is that a fragment under a couple of seconds carries no prosody to judge
// a language by. `progressed` says sound came out; it says nothing about how
// much. So decode the bytes the deployed site actually served and read their
// duration — the manifest test cannot do this, because it checks what the
// pipeline wrote, not what the CDN handed the player.
const served = [...new Set(audio.map((r) => r.url))].slice(0, 6);
const durations = await page.evaluate(
  (urls) =>
    Promise.all(
      urls.map(
        (url) =>
          new Promise((resolve) => {
            const el = new Audio();
            el.preload = 'metadata';
            el.addEventListener('loadedmetadata', () => resolve(el.duration));
            el.addEventListener('error', () => resolve(0));
            el.src = url;
          }),
      ),
    ),
  served,
);
const min = Math.min(...durations);
console.log(
  `decoded ${durations.length} served clips: min ${min.toFixed(2)}s, max ${Math.max(...durations).toFixed(2)}s`,
);
if (!durations.length) fail.push('could not decode any served clip');
if (min < 2) fail.push(`a served clip is ${min.toFixed(2)}s, too short to judge a language by`);

// full round with two planted mistakes
const buckets = await page.$$eval('[data-testid^="bucket-"]', (ns) =>
  ns.map((n) => ({ testid: n.dataset.testid, label: n.textContent.trim() })));
const bucketFor = new Map(buckets
  .map((b) => [[...nameOf.keys()].find((n) => b.label.startsWith(n)), b.testid])
  .map(([n, t]) => [nameOf.get(n), t]));
let planted = 0;
for (const [n, id] of ids.entries()) {
  await page.click(`[data-testid="tile-${id}"]`);
  const correct = bucketFor.get(langOf.get(id));
  const target = n < 2 ? buckets.find((b) => b.testid !== correct).testid : correct;
  if (n < 2) planted += 1;
  await page.click(`[data-testid="${target}"]`);
}
await page.click('[data-testid="submit-round"]');
await page.waitForSelector('[data-testid="final-score"]');
const score = (await page.textContent('[data-testid="final-score"]')).trim();
const expected = `+${(16 - planted) * 100 - planted * 60}`;
console.log(`score: ${score} (expected ${expected})`);
if (score !== expected) fail.push(`score ${score} != ${expected}`);

// service worker + offline
// `registerSW.js` registers asynchronously, so sampling once races it.
const sw = await page.evaluate(async () => {
  const r = await navigator.serviceWorker.ready.catch(() => null);
  return r ? { scope: r.scope, active: !!r.active } : null;
});
console.log('service worker:', sw);
if (!sw?.active) fail.push('service worker did not register');

await page.goto(`${BASE}#/stats`);
await page.waitForTimeout(600);
await page.reload();
await page.waitForTimeout(1200);
const rounds = (await page.textContent('body')).match(/Rounds(\d+)/)?.[1];
console.log('rounds after reload:', rounds ?? '(not found)');
if (rounds !== '1') fail.push(`stats did not persist (rounds=${rounds})`);

await ctx.setOffline(true);
await page.goto(`${BASE}#/play/easy/offlinecheck`);
await page.waitForSelector('[data-testid^="tile-"]', { timeout: 15000 });
await page.click('[data-testid^="tile-"]');
await page.waitForTimeout(2000);
const offPlayed = await page.$$eval('[data-testid^="tile-"]', (ns) => ns.filter((n) => n.dataset.played === 'true').length);
console.log('OFFLINE: board rendered, tiles played:', offPlayed);
if (offPlayed < 1) fail.push('offline audio did not play');

// mobile tap targets
const box = await page.$$eval('[data-testid^="tile-"]', (ns) => {
  const r = ns[0].getBoundingClientRect();
  return { w: Math.round(r.width), h: Math.round(r.height) };
});
console.log('tile tap target:', box);
if (box.w < 44 || box.h < 44) fail.push(`tap target ${box.w}x${box.h} below 44px`);

await browser.close();
console.log(fail.length ? `\nFAILED:\n - ${fail.join('\n - ')}` : '\nALL CHECKS PASSED');
process.exit(fail.length ? 1 : 0);
