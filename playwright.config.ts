import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end verification.
 *
 * These tests exist because "it compiles" is not evidence that a game works.
 * They drive a real browser: audio actually decodes, rounds are actually
 * completed at every difficulty, scores are checked against arithmetic computed
 * independently in the test, IndexedDB survives a reload, and the service
 * worker is exercised with the network genuinely switched off.
 *
 * The mobile project is not decoration — the brief requires 16 tiles to fit a
 * phone screen with comfortable tap targets, so that is asserted on a 375px
 * viewport rather than assumed.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? 'list' : [['list']],
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
    // Chromium refuses to play media until the user interacts with the page,
    // which would make every audio assertion a false negative.
    launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
  },
  // One project. The mobile checks set their own viewport via `test.use`, so a
  // second project would only re-run every desktop test at phone size and make
  // the service-worker test race itself.
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // Preview serves the production build, which is the only way to exercise
    // the real service worker and the precached audio.
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
