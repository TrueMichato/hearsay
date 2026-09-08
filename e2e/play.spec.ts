import { test, expect, type Page } from '@playwright/test';
import manifestJson from '../src/content/manifest.json' with { type: 'json' };
import type { ContentManifest } from '../src/content/types';
import { generateRound } from '../src/game/board';
import { DIFFICULTY_MULTIPLIER, POINTS_CORRECT, POINTS_WRONG } from '../src/game/scoring';
import type { Difficulty } from '../src/game/types';

const manifest = manifestJson as ContentManifest;

/**
 * The board is audio-only, so a test cannot read a tile's language off the
 * screen — which is the whole point of the game. Instead the test asks the same
 * pure function the app uses to deal the board, using the seed pinned in the
 * URL. The test therefore never inspects hidden state the player cannot reach.
 */
function dealt(difficulty: Difficulty, seed: string) {
  return generateRound(manifest, { difficulty, seed });
}

async function openRound(page: Page, difficulty: Difficulty, seed: string) {
  await page.goto(`/#/play/${difficulty}/${seed}`);
  await expect(page.getByRole('grid')).toBeVisible();
  await expect(page.getByTestId('submit-round')).toBeVisible();
}

async function assign(page: Page, tileId: string, bucketId: string) {
  await page.getByTestId(`tile-${tileId}`).click();
  await page.getByTestId(`bucket-${bucketId}`).click();
}

test.describe('a full round can be played at every difficulty', () => {
  test('easy: a perfect board scores every tile at the easy multiplier', async ({ page }) => {
    const seed = 'e2e-easy-perfect';
    const round = dealt('easy', seed);
    await openRound(page, 'easy', seed);

    for (const tile of round.tiles) {
      const bucket = round.buckets.find((b) => b.language === tile.language)!;
      await assign(page, tile.id, bucket.id);
    }

    await page.getByTestId('submit-round').click();

    const expected = Math.round(16 * POINTS_CORRECT * DIFFICULTY_MULTIPLIER.easy);
    await expect(page.getByTestId('final-score')).toHaveText(`+${expected}`);
  });

  test('medium: mixed play matches the arithmetic and skipping is not punished', async ({
    page,
  }) => {
    const seed = 'e2e-medium-mixed';
    const round = dealt('medium', seed);
    await openRound(page, 'medium', seed);

    const wrongTiles = round.tiles.slice(0, 3);
    const skipped = round.tiles.slice(3, 5);

    for (const tile of round.tiles) {
      if (skipped.includes(tile)) continue;
      const own = round.buckets.find((b) => b.language === tile.language)!;
      const other = round.buckets.find((b) => b.language !== tile.language)!;
      await assign(page, tile.id, wrongTiles.includes(tile) ? other.id : own.id);
    }

    await page.getByTestId('submit-round').click();

    const correct = 16 - wrongTiles.length - skipped.length;
    const expected = Math.round(
      (correct * POINTS_CORRECT - wrongTiles.length * POINTS_WRONG) * DIFFICULTY_MULTIPLIER.medium,
    );
    await expect(page.getByTestId('final-score')).toHaveText(`+${expected}`);
    await expect(page.getByText('Skipped')).toBeVisible();
  });

  test('hard: the player builds their own groups and pairwise scoring applies', async ({ page }) => {
    const seed = 'e2e-hard-groups';
    const round = dealt('hard', seed);
    await openRound(page, 'hard', seed);

    const languages = [...new Set(round.tiles.map((t) => t.language))];
    // Hard starts with two groups; add one per additional language.
    for (let i = 2; i < languages.length; i++) {
      await page.getByRole('button', { name: '+ New group' }).click();
    }

    for (const tile of round.tiles) {
      await assign(page, tile.id, `group-${languages.indexOf(tile.language)}`);
    }

    await page.getByTestId('submit-round').click();

    // A perfectly separated board is worth the full base no matter how many
    // languages it held — that is what normalising the pairwise score buys.
    const expected = Math.round(16 * POINTS_CORRECT * DIFFICULTY_MULTIPLIER.hard);
    await expect(page.getByTestId('final-score')).toHaveText(`+${expected}`);
  });
});

test('a bad round scores negative and mints no coins', async ({ page }) => {
  const seed = 'e2e-easy-negative';
  const round = dealt('easy', seed);
  await openRound(page, 'easy', seed);

  for (const tile of round.tiles) {
    const wrong = round.buckets.find((b) => b.language !== tile.language)!;
    await assign(page, tile.id, wrong.id);
  }

  await page.getByTestId('submit-round').click();

  const expected = Math.round(16 * -POINTS_WRONG * DIFFICULTY_MULTIPLIER.easy);
  await expect(page.getByTestId('final-score')).toHaveText(`${expected}`);
  await expect(page.getByText('a negative score earns nothing')).toBeVisible();
});

test('audio genuinely decodes and plays', async ({ page }) => {
  const seed = 'e2e-audio';
  const round = dealt('easy', seed);
  await openRound(page, 'easy', seed);

  const tile = page.getByTestId(`tile-${round.tiles[0].id}`);
  await expect(tile).toHaveAttribute('data-played', 'false');
  await tile.click();

  // `data-played` flips only on a `timeupdate` with currentTime > 0, which the
  // browser fires only when the media clock actually advances. A play() call
  // that silently failed would leave this false.
  await expect(tile).toHaveAttribute('data-played', 'true', { timeout: 15_000 });
});

test('the keyboard alone can play a round', async ({ page }) => {
  const seed = 'e2e-keyboard';
  const round = dealt('easy', seed);
  await openRound(page, 'easy', seed);

  // Tab into the grid; the roving tabindex means the board is a single stop.
  const first = page.getByTestId(`tile-${round.tiles[0].id}`);
  await first.focus();
  await expect(first).toBeFocused();

  await page.keyboard.press('Enter'); // select tile 1
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter'); // select tile 2
  await page.keyboard.press('1'); // assign both to the first group

  await expect(page.getByTestId('submit-round')).toHaveText(/Submit 2 of 16/);
});

test('stats persist across a reload', async ({ page }) => {
  const seed = 'e2e-persist';
  const round = dealt('easy', seed);
  await openRound(page, 'easy', seed);

  for (const tile of round.tiles) {
    const bucket = round.buckets.find((b) => b.language === tile.language)!;
    await assign(page, tile.id, bucket.id);
  }
  await page.getByTestId('submit-round').click();
  await expect(page.getByTestId('final-score')).toBeVisible();

  // A full reload wipes everything in memory, so whatever comes back came out
  // of IndexedDB.
  await page.goto('/#/stats');
  await page.reload();

  await expect(page.getByRole('heading', { name: 'Your stats' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Confusion matrix' })).toBeVisible();

  const rounds = page.getByTestId('stat-rounds');
  await expect(rounds).toBeVisible();
  expect(Number(await rounds.textContent())).toBeGreaterThan(0);
});

test('credits carry per-clip licence and attribution', async ({ page }) => {
  await page.goto('/#/credits');
  await expect(page.getByRole('heading', { name: /Credits/ })).toBeVisible();

  // CC BY and CC BY-SA both require crediting the author and linking the
  // licence, so this is a legal requirement rather than a nicety.
  await page.getByText('Spanish', { exact: false }).first().click();
  await expect(page.locator('a[href*="commons.wikimedia.org/wiki/File:"]').first()).toBeVisible();
  await expect(page.locator('a[href*="creativecommons.org"]').first()).toBeVisible();
});
