import { test, expect } from '@playwright/test';
import manifestJson from '../src/content/manifest.json' with { type: 'json' };
import type { ContentManifest } from '../src/content/types';
import { generateRound } from '../src/game/board';

const manifest = manifestJson as ContentManifest;

/**
 * The bug this file exists to prevent.
 *
 * The game shipped with tile taps doing two jobs at once: playing the clip and
 * selecting the tile. Comparing clips is the entire game, so a player naturally
 * tapped all sixteen — and silently selected all sixteen. The next bucket press
 * then filed the whole board under one language.
 *
 * Deliberately broken once to confirm this detects it: restoring
 * `onToggleSelect(tile.id)` alongside `onPlay` in Board's `onActivate` made the
 * first test fail with "16 of 16" against an expected "1 of 16", and the second
 * fail on the very first tile's `aria-pressed`.
 */
test('listening to every clip files nothing', async ({ page }) => {
  const seed = 'e2e-listen-only';
  const round = generateRound(manifest, { difficulty: 'easy', seed });
  await page.goto(`/#/play/easy/${seed}`);
  await expect(page.getByRole('grid')).toBeVisible();

  // Exactly what a player does: listen to the whole board before deciding.
  for (const tile of round.tiles) {
    await page.getByTestId(`tile-${tile.id}`).click();
  }

  // Nothing has been committed, so the round cannot be transmitted yet.
  await expect(page.getByTestId('submit-round')).toHaveText(/File a station/);

  // One bucket press must file the one tuned station — not the whole board.
  await page.getByTestId(`bucket-${round.buckets[0].id}`).click();
  await expect(page.getByTestId('submit-round')).toHaveText(/\b1 of 16\b/);
});

test('replaying a clip never changes what is staged', async ({ page }) => {
  const seed = 'e2e-replay-safe';
  const round = generateRound(manifest, { difficulty: 'easy', seed });
  await page.goto(`/#/play/easy/${seed}`);
  await expect(page.getByRole('grid')).toBeVisible();

  const a = page.getByTestId(`tile-${round.tiles[0].id}`);
  const b = page.getByTestId(`tile-${round.tiles[1].id}`);

  // Playing tunes but never holds.
  await a.click();
  await expect(a).toHaveAttribute('aria-pressed', 'false');

  // Holding is the only thing that stages a station.
  await page.getByTestId('tuner-hold').click();
  await expect(a).toHaveAttribute('aria-pressed', 'true');

  // Listening to something else, and replaying it, leaves the hold alone.
  await b.click();
  await b.click();
  await page.getByTestId('tuner-replay').click();
  await expect(a).toHaveAttribute('aria-pressed', 'true');
  await expect(b).toHaveAttribute('aria-pressed', 'false');
});

test('heard and held are distinguishable in the accessibility layer', async ({ page }) => {
  const seed = 'e2e-states';
  const round = generateRound(manifest, { difficulty: 'easy', seed });
  await page.goto(`/#/play/easy/${seed}`);
  await expect(page.getByRole('grid')).toBeVisible();

  const tile = page.getByTestId(`tile-${round.tiles[0].id}`);
  await expect(tile).toHaveAttribute('aria-label', /not heard yet/);

  // Heard is announced in words, not just as a ring a screen reader cannot see.
  await tile.click();
  await expect(tile).toHaveAttribute('aria-label', /, heard,/);
  await expect(tile).not.toHaveAttribute('aria-label', /held for filing/);

  await page.getByTestId('tuner-hold').click();
  await expect(tile).toHaveAttribute('aria-label', /held for filing/);

  await page.getByTestId(`bucket-${round.buckets[0].id}`).click();
  await expect(tile).toHaveAttribute('aria-label', /filed under/);
});

test('the manual opens on a first run, skips, and reopens', async ({ page }) => {
  await page.goto('/');

  // A brand-new player has never been shown it, so starting a round opens it.
  await page.getByTestId('start-easy').click();
  await expect(page.getByTestId('coach')).toBeVisible();

  await page.getByTestId('skip-manual').click();
  await expect(page.getByTestId('coach')).toBeHidden();

  // Having been seen once, it must not reappear uninvited...
  await page.goto('/');
  await expect(page.getByTestId('open-manual-home')).toHaveText(/Reopen the manual|How to play/);
  await page.getByTestId('start-easy').click();
  await expect(page.getByTestId('coach')).toBeHidden();

  // ...but must always be reachable from the board.
  await page.getByTestId('open-manual').click();
  await expect(page.getByTestId('coach')).toBeVisible();
});

test('the manual advances on what the player actually does', async ({ page }) => {
  const seed = 'e2e-manual-flow';
  const round = generateRound(manifest, { difficulty: 'easy', seed });
  await page.goto(`/#/play/easy/${seed}/manual`);

  const coach = page.getByTestId('coach');
  await expect(coach).toContainText('Press one to hear it');

  await page.getByTestId(`tile-${round.tiles[0].id}`).click();
  await expect(coach).toContainText('Nothing got filed');

  await page.getByTestId(`tile-${round.tiles[1].id}`).click();
  await page.getByTestId(`tile-${round.tiles[2].id}`).click();
  await expect(coach).toContainText('in the bank below');

  await page.getByTestId(`bucket-${round.buckets[0].id}`).click();
  await expect(coach).toContainText('Two at once');
});
