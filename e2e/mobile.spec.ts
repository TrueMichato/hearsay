import { test, expect } from '@playwright/test';
import manifestJson from '../src/content/manifest.json' with { type: 'json' };
import type { ContentManifest } from '../src/content/types';
import { generateRound } from '../src/game/board';

const manifest = manifestJson as ContentManifest;

/**
 * Mobile layout, measured rather than assumed.
 *
 * The brief requires 16 tiles to fit a phone screen with comfortable tap
 * targets. "Comfortable" has a number: the WCAG 2.2 target-size minimum and
 * every platform HIG land around 44 CSS pixels, so that is what is asserted.
 */
test.describe('mobile layout', () => {
  test.use({ viewport: { width: 375, height: 667 }, hasTouch: true, isMobile: true });

  test('all 16 tiles fit a 375px viewport with comfortable tap targets', async ({ page }) => {
    await page.goto('/#/play/easy/e2e-mobile');
    await expect(page.getByRole('grid')).toBeVisible();

    const tiles = page.locator('[data-tile-index]');
    await expect(tiles).toHaveCount(16);

    for (const tile of await tiles.all()) {
      const box = (await tile.boundingBox())!;
      expect(box.width, 'tap target width').toBeGreaterThanOrEqual(44);
      expect(box.height, 'tap target height').toBeGreaterThanOrEqual(44);
      // Nothing may spill off the side of the screen.
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(375);
    }

    // Buckets are tap targets too.
    for (const bucket of await page.locator('[data-testid^="bucket-"]').all()) {
      const box = (await bucket.boundingBox())!;
      expect(box.height, 'bucket tap target height').toBeGreaterThanOrEqual(44);
    }

    // The board itself must not force sideways scrolling.
    const overflowsX = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(overflowsX, 'page scrolls horizontally').toBe(false);

    // The whole board should be reachable without hunting: the grid and the
    // groups must both be on screen at once on a small phone.
    const gridBox = (await page.getByRole('grid').boundingBox())!;
    expect(gridBox.y + gridBox.height).toBeLessThanOrEqual(667);
  });

  test('the submit control stays reachable once tiles are placed', async ({ page }) => {
    const seed = 'e2e-mobile-submit';
    const round = generateRound(manifest, { difficulty: 'easy', seed });
    await page.goto(`/#/play/easy/${seed}`);

    await page.getByTestId(`tile-${round.tiles[0].id}`).tap();
    await page.getByTestId(`bucket-${round.buckets[0].id}`).tap();

    const submit = page.getByTestId('submit-round');
    await expect(submit).toBeVisible();
    const box = (await submit.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
  });
});
