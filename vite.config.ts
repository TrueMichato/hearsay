import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { BRANDING } from './src/config/branding.ts';

/**
 * Where the app is served from.
 *
 * A GitHub *project* page lives at `https://<user>.github.io/<repo>/`, not at
 * the domain root, so every absolute URL the app emits has to be prefixed with
 * `/hearsay/`. Getting this wrong fails in a particularly unhelpful way: the
 * HTML still loads, so the deploy looks fine, but every asset 404s and the
 * player gets a blank board or silent tiles.
 *
 * It stays an environment variable rather than a hardcoded string so `npm run
 * dev` and `npm run preview` keep working at the root, and so a deploy to any
 * other host is a one-line change. Vite requires the trailing slash.
 */
const base = process.env.BASE_PATH ?? '/';

export default defineConfig({
  base,
  plugins: [
    react(),
    tailwindcss(),
    // Substitutes branding placeholders in index.html, so the product name
    // lives in exactly one file even in static markup.
    {
      name: 'hearsay-branding-html',
      transformIndexHtml(html: string) {
        return html
          .replaceAll('%APP_NAME%', BRANDING.name)
          .replaceAll('%APP_DESCRIPTION%', BRANDING.description)
          .replaceAll('%APP_THEME_COLOR%', BRANDING.themeColor);
      },
    },
    VitePWA({
      // `autoUpdate` installs a new service worker as soon as one is available.
      // For a game with no unsaved server state this is the right trade-off:
      // the player never gets stuck on a stale build.
      registerType: 'autoUpdate',
      workbox: {
        // Precache the app shell *and* every audio clip, so a player who has
        // opened the app once can play a full round with no network at all.
        // The whole Opus corpus is ~2.6 MB, which makes this affordable.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest,opus,woff2}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        // Must carry the base. Workbox matches this against a real URL, so a
        // bare `index.html` would look for the file at the domain root and the
        // offline navigation fallback would silently never fire.
        navigateFallback: `${base}index.html`,
      },
      includeAssets: ['favicon.svg'],
      manifest: {
        name: BRANDING.name,
        short_name: BRANDING.name,
        description: BRANDING.description,
        theme_color: BRANDING.themeColor,
        background_color: BRANDING.backgroundColor,
        display: 'standalone',
        orientation: 'portrait',
        // `scope` tells the browser which URLs belong to the installed app and
        // `start_url` is what launching the icon opens. Both must sit under the
        // base: a scope of `/` on a project page covers the whole github.io
        // domain, which the browser rejects, so the app becomes uninstallable.
        scope: base,
        start_url: base,
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      devOptions: {
        // Serve a real service worker under `npm run dev`, so offline behaviour
        // can be tested without a production build.
        enabled: true,
        type: 'module',
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
  },
});
