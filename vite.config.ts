import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { BRANDING } from './src/config/branding.ts';

export default defineConfig({
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
        // The whole Opus corpus is ~1.5 MB, which makes this affordable.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest,opus}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        navigateFallback: 'index.html',
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
        start_url: '/',
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
