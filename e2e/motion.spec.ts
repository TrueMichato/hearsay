import { expect, test } from '@playwright/test';

/**
 * A player who has asked their operating system to reduce motion has usually
 * done so because motion makes them ill. Honouring that is not a nicety.
 *
 * This game leans hard on motion — a drifting dial on the home screen, a
 * carrier that pulses while audio plays, a sweep across the tuner, a needle
 * that swings when a round is scored. Every one of those is a keyframe
 * animation, so the whole set is covered by one rule in src/index.css that
 * collapses `animation-duration` and `transition-duration` to effectively zero.
 *
 * The danger with a single blanket rule is that it is easy to delete, easy to
 * scope too narrowly, and completely invisible in normal development because
 * nobody browses with the flag on. So this walks the real pages with the media
 * feature emulated and asserts that nothing on screen is still animating.
 *
 * Proven to fail: marking `.anim-drift` in src/index.css as
 * `animation: drift 9s ease-in-out infinite !important` — a declaration the
 * blanket rule cannot override, because an !important shorthand wins — made
 * the home-screen test fail with a reported duration of 9000ms. Reverted.
 *
 * That plant also caught a second lesson worth recording: the Playwright config
 * sets `reuseExistingServer`, so a preview server left running from an earlier
 * build will happily serve stale CSS and the gate will pass against a bundle
 * that does not contain your change. Always rebuild before trusting a run.
 */

const MAX_MS = 1; // the blanket rule leaves 0.01ms; anything real is >= 100ms

async function longestAnimation(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    let worst = { selector: '', ms: 0 };
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
      const style = getComputedStyle(el);
      const durations = [style.animationDuration, style.transitionDuration]
        .flatMap((value) => value.split(','))
        .map((value) => {
          const trimmed = value.trim();
          if (trimmed.endsWith('ms')) return Number.parseFloat(trimmed);
          if (trimmed.endsWith('s')) return Number.parseFloat(trimmed) * 1000;
          return 0;
        });
      const ms = Math.max(0, ...durations);
      if (ms > worst.ms) {
        worst = {
          // SVG elements expose className as an SVGAnimatedString, not a
          // string, so read the attribute instead of stringifying the property.
          selector: `${el.tagName.toLowerCase()}.${(el.getAttribute('class') ?? '').split(' ')[0]}`,
          ms,
        };
      }
    }
    return worst;
  });
}

test.use({ reducedMotion: 'reduce' });

test('reduced motion stops every animation on the home screen', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const worst = await longestAnimation(page);
  expect(worst.ms, `still animating: ${worst.selector}`).toBeLessThanOrEqual(MAX_MS);
});

test('reduced motion stops every animation on the band and its results', async ({ page }) => {
  await page.goto('/#/play/easy/motion-seed');
  await expect(page.getByTestId('submit-round')).toBeVisible();

  const board = await longestAnimation(page);
  expect(board.ms, `still animating: ${board.selector}`).toBeLessThanOrEqual(MAX_MS);

  // The results panel is where the loudest motion lives: the needle swing.
  await page.locator('[data-testid^="tile-"]').first().click();
  await page.locator('[data-testid^="bucket-"]').first().click();
  await page.getByTestId('submit-round').click();
  await expect(page.getByTestId('final-score')).toBeVisible();

  const results = await longestAnimation(page);
  expect(results.ms, `still animating: ${results.selector}`).toBeLessThanOrEqual(MAX_MS);
});
