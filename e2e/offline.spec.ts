import { test, expect } from '@playwright/test';
import manifestJson from '../src/content/manifest.json' with { type: 'json' };
import type { ContentManifest } from '../src/content/types';
import { generateRound } from '../src/game/board';

const manifest = manifestJson as ContentManifest;

/**
 * Offline behaviour, tested by actually going offline.
 *
 * A service worker is a script the browser keeps running beside the page; it
 * can intercept network requests and answer them from a local cache. Assuming
 * one works is a classic way to ship a broken "offline" app, so this test cuts
 * the network at the browser level and then demands a complete, playable round
 * with audio.
 *
 * Only run on desktop: the two projects share a server, and racing two service
 * worker registrations makes the result meaningless.
 */
test.describe('offline', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'service worker test');

  test('a full round is playable with the network switched off', async ({ page, context }) => {
    await page.goto('/');

    // Wait for the worker to take control AND for Workbox to finish filling the
    // precache. Reloading before that would test the HTTP cache, not the worker.
    await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) {
        await new Promise<void>((resolve) =>
          navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), {
            once: true,
          }),
        );
      }
      return reg.active?.state;
    });

    await expect
      .poll(
        async () =>
          page.evaluate(async () => {
            const names = await caches.keys();
            let total = 0;
            for (const name of names) {
              total += (await (await caches.open(name)).keys()).length;
            }
            return total;
          }),
        { timeout: 60_000, message: 'waiting for the precache to fill' },
      )
      .toBeGreaterThan(400);

    // Cut the network for real.
    await context.setOffline(true);

    const seed = 'e2e-offline';
    const round = generateRound(manifest, { difficulty: 'easy', seed });

    await page.goto(`/#/play/easy/${seed}`);
    await expect(page.getByRole('grid')).toBeVisible();

    // Audio must come out of the cache, not the network.
    const tile = page.getByTestId(`tile-${round.tiles[0].id}`);
    await tile.click();
    await expect(tile).toHaveAttribute('data-played', 'true', { timeout: 15_000 });

    // Listening is not a commitment: playing a tile tunes it but must never
    // hold it, so the scripted play-through below needs no undo step.
    await expect(tile).toHaveAttribute('aria-pressed', 'false');

    for (const t of round.tiles) {
      const bucket = round.buckets.find((b) => b.language === t.language)!;
      await page.getByTestId(`tile-${t.id}`).click();
      await page.getByTestId(`bucket-${bucket.id}`).click();
    }
    await page.getByTestId('submit-round').click();
    await expect(page.getByTestId('final-score')).toHaveText('+1600');

    // And the result must survive offline too, since IndexedDB is local.
    await page.goto('/#/stats');
    await expect(page.getByTestId('stat-rounds')).toBeVisible();

    await context.setOffline(false);
  });
});
