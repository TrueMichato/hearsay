/**
 * THE single source of truth for the product name.
 *
 * Renaming the game must be a one-line change. Nothing else in the codebase —
 * components, page titles, the PWA manifest, the content pipeline's HTTP
 * User-Agent — may hardcode the name. Import from here instead.
 */
export const BRANDING = {
  /** Product name, as displayed to players. */
  name: 'Hearsay',
  /** One-line description used in the PWA manifest and meta tags. */
  tagline: 'Tell languages apart by ear.',
  /** Longer description for the manifest / about page. */
  description:
    'Listen to short words spoken by native speakers and group them by language. No text, no crutches — just your ears.',
  /** Semantic version, surfaced on the about page and in the User-Agent. */
  version: '0.1.0',
  /** Canonical repository URL. Wikimedia requires a contactable UA string. */
  repository: 'https://github.com/TrueMichato/hearsay',
  /** Theme colour for the PWA manifest and the browser chrome. */
  themeColor: '#0f172a',
  backgroundColor: '#0f172a',
} as const;

/** Machine-safe slug derived from the name. Used for cache keys and storage ids. */
export const BRAND_SLUG = BRANDING.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

/**
 * Descriptive User-Agent for Wikimedia API requests.
 *
 * Wikimedia returns empty responses (not errors) for requests without a
 * descriptive UA, which is indistinguishable from "no results". Always send it.
 */
export const USER_AGENT = `${BRANDING.name}/${BRANDING.version} (${BRANDING.repository})`;
