import { expect, test, type Page } from '@playwright/test';
import manifestJson from '../src/content/manifest.json' with { type: 'json' };
import { findLanguageLeak, languageTokens } from '../src/content/leak';
import { generateRound } from '../src/game/board';
import type { ContentManifest } from '../src/content/types';

/**
 * The answer must not be readable from the client during an unscored round.
 *
 * This is the gate for the leak that shipped in the first prototype: clip ids
 * were `ita-0013` and audio lived at `/audio/ita/`, so the language announced
 * itself in the DOM, in the URL, and in the network tab before a single note
 * played. That does not merely spoil the game — it devalues the entire clue
 * economy, because the reveal clue sells information devtools gives away.
 *
 * Scope is deliberate:
 *  - **Tiles only.** Easy-difficulty buckets are *supposed* to be labelled with
 *    language names, so scanning the whole page would be a false positive
 *    factory. The tile is the thing whose language is secret.
 *  - **Before scoring, and before clues.** After the round is scored the
 *    answers are public by design, and a purchased reveal is the player
 *    spending coins for exactly this information.
 */

const content = manifestJson as ContentManifest;
const TOKENS = languageTokens(content);

/** Every attribute value on every tile, as one string per tile. */
async function tileAttributeText(page: Page): Promise<{ testid: string; text: string }[]> {
  return page.$$eval('[data-testid^="tile-"]', (nodes) =>
    nodes.map((node) => ({
      testid: node.getAttribute('data-testid') ?? '',
      text: [
        ...[...node.attributes].map((a) => `${a.name}=${a.value}`),
        node.textContent ?? '',
        node.innerHTML,
      ].join(' '),
    })),
  );
}

for (const difficulty of ['easy', 'medium', 'hard'] as const) {
  test(`${difficulty}: no tile attribute names its language before scoring`, async ({ page }) => {
    await page.goto(`/#/play/${difficulty}/leak-${difficulty}`);
    await expect(page.locator('[data-testid^="tile-"]')).toHaveCount(16);

    for (const tile of await tileAttributeText(page)) {
      const leak = findLanguageLeak(tile.text, TOKENS);
      expect(leak, `${tile.testid} leaks "${leak}" via:\n${tile.text}`).toBeNull();
    }
  });
}

test('no audio request URL names its language', async ({ page }) => {
  const audioUrls: string[] = [];
  page.on('request', (req) => {
    if (/\.(opus|ogg|mp3|wav|aac|m4a)(\?|$)/.test(req.url())) audioUrls.push(req.url());
  });

  await page.goto('/#/play/medium/leak-network');
  await expect(page.locator('[data-testid^="tile-"]')).toHaveCount(16);

  // Play a few tiles so the browser genuinely fetches their audio, rather than
  // asserting about requests that were never made.
  for (let i = 0; i < 4; i++) {
    await page.locator(`[data-tile-index="${i}"]`).click();
    await page.waitForTimeout(120);
  }
  await expect.poll(() => audioUrls.length).toBeGreaterThanOrEqual(4);

  for (const url of audioUrls) {
    const path = new URL(url).pathname;
    const leak = findLanguageLeak(path, TOKENS);
    expect(leak, `audio URL leaks "${leak}": ${path}`).toBeNull();
  }
});

test('the reveal clue is the only way the language appears on a tile', async ({ page }) => {
  // The mirror image of the tests above: proves they would notice, and proves
  // the clue the player pays for actually delivers what devtools no longer does.
  const round = generateRound(content, { difficulty: 'medium', seed: 'leak-clue' });
  await page.goto('/#/play/medium/leak-clue');
  await expect(page.locator('[data-testid^="tile-"]')).toHaveCount(16);

  await page.getByTestId(`tile-${round.tiles[0].id}`).click();
  await page.getByTestId('open-shop').click();
  await page.getByTestId('clue-revealTileLanguage').click();
  await expect(page.getByTestId('clue-revealTileLanguage')).toBeHidden();

  const tiles = await tileAttributeText(page);
  const leaking = tiles.filter((t) => findLanguageLeak(t.text, TOKENS) !== null);
  expect(
    leaking.map((t) => t.testid),
    'exactly the one purchased tile should name its language',
  ).toEqual([`tile-${round.tiles[0].id}`]);
});
