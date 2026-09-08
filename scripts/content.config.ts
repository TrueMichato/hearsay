import type { LanguageCluster, LanguageMeta } from '../src/content/types.ts';

/**
 * Content pipeline configuration.
 *
 * Scaling the prototype to more languages is a change to `LANGUAGES` and
 * `CLUSTERS` only — no pipeline code changes required. Every language listed
 * here must have a `Category:Lingua Libre pronunciation-<iso639_3>` category on
 * Wikimedia Commons with enough recordings to survive curation.
 */

/** Manifest schema version. Bump when `ContentManifest`'s shape changes. */
export const SCHEMA_VERSION = 1;

/**
 * Target number of curated clips per language.
 *
 * A 4x4 board with up to 5 languages needs only a handful per round, but a
 * larger pool keeps rounds from repeating and lets us prefer speaker variety.
 */
export const WORDS_PER_LANGUAGE = 40;

/**
 * Maximum clips accepted from any single speaker, as a fraction of
 * `WORDS_PER_LANGUAGE`. Prevents a language becoming "that one voice" — players
 * must learn the language, not memorise a timbre.
 */
export const MAX_SPEAKER_SHARE = 0.34;

/** Minimum distinct speakers required before a language is considered usable. */
export const MIN_SPEAKERS_PER_LANGUAGE = 3;

/**
 * How many category members to enumerate per language before curating.
 *
 * Curation is aggressive — Russian rejected 85% of one sample as multi-word
 * phrases — so we over-fetch heavily. Enumeration is 500 files per request and
 * every response is cached on disk, so a large pool costs a handful of requests
 * once and nothing on reruns.
 */
export const CANDIDATE_POOL_SIZE = 4000;

/** Acceptable clip duration in seconds, measured after silence trimming. */
export const MIN_DURATION_S = 0.25;
export const MAX_DURATION_S = 2.5;

/** Politeness delay between Wikimedia API requests, in milliseconds. */
export const REQUEST_DELAY_MS = 150;

/**
 * Politeness delay between media downloads, in milliseconds.
 *
 * `upload.wikimedia.org` is stricter than the API and returns HTTP 429 at the
 * API's pace — measured empirically during development, where ~150 ms between
 * downloads lost 54 of 64 clips to rate limiting.
 */
export const DOWNLOAD_DELAY_MS = 600;

/**
 * The ten prototype languages, arranged into three deliberately confusable
 * clusters. Recording counts (verified against the live Commons API) are noted
 * so it is obvious which languages have headroom to scale.
 *
 * Cluster *size* matters as much as membership: Easy and Medium boards draw
 * 3-4 languages, so a cluster of only three can never fill a four-language
 * board on its own and would silently force every such board to mix unrelated
 * languages — making it far easier than intended. Romance and Slavic therefore
 * carry four members each.
 */
export const LANGUAGES: LanguageMeta[] = [
  // --- Romance: the classic "is that Spanish or Portuguese?" trap ---
  { id: 'spa', iso639_3: 'spa', name: 'Spanish', nativeName: 'Español', script: 'latin', cluster: 'romance', color: '#f59e0b' }, // 19127
  { id: 'por', iso639_3: 'por', name: 'Portuguese', nativeName: 'Português', script: 'latin', cluster: 'romance', color: '#10b981' }, // 9356
  { id: 'ita', iso639_3: 'ita', name: 'Italian', nativeName: 'Italiano', script: 'latin', cluster: 'romance', color: '#ef4444' }, // 12629
  { id: 'cat', iso639_3: 'cat', name: 'Catalan', nativeName: 'Català', script: 'latin', cluster: 'romance', color: '#f97316' }, // 22918

  // --- Slavic: close relatives split across two alphabets ---
  { id: 'rus', iso639_3: 'rus', name: 'Russian', nativeName: 'Русский', script: 'cyrillic', cluster: 'slavic', color: '#3b82f6' }, // 34359
  { id: 'pol', iso639_3: 'pol', name: 'Polish', nativeName: 'Polski', script: 'latin', cluster: 'slavic', color: '#a855f7' }, // 97544
  { id: 'ukr', iso639_3: 'ukr', name: 'Ukrainian', nativeName: 'Українська', script: 'cyrillic', cluster: 'slavic', color: '#06b6d4' }, // 27397
  { id: 'ces', iso639_3: 'ces', name: 'Czech', nativeName: 'Čeština', script: 'latin', cluster: 'slavic', color: '#8b5cf6' }, // 6527

  // --- East Asian: unrelated languages that untrained ears routinely swap ---
  { id: 'jpn', iso639_3: 'jpn', name: 'Japanese', nativeName: '日本語', script: 'japanese', cluster: 'east-asian', color: '#ec4899' }, // 1043
  { id: 'kor', iso639_3: 'kor', name: 'Korean', nativeName: '한국어', script: 'hangul', cluster: 'east-asian', color: '#84cc16' }, // 1024
];

export const CLUSTERS: LanguageCluster[] = [
  { id: 'romance', name: 'Romance', languages: ['spa', 'por', 'ita', 'cat'] },
  { id: 'slavic', name: 'Slavic', languages: ['rus', 'pol', 'ukr', 'ces'] },
  { id: 'east-asian', name: 'East Asian', languages: ['jpn', 'kor'] },
];

/**
 * Languages verified to exist on Commons but excluded from the prototype.
 * Kept here so the reasoning is not lost, and so scaling up is a copy-paste.
 *
 *   fra 433889 · deu 26112 · ron 24088 · eus 20686 · ara 13749 · swe 9729
 *   tur 6645 · cmn 4122 · heb 3615 · hin 3431 · vie 3100 · nld 1825
 *
 * Genuinely unusable: Greek (0 recordings). Too thin to curate 40 clean words:
 * Danish (147), Finnish (219), Hungarian (259).
 */
export const DEFERRED_LANGUAGES = [
  'fra', 'deu', 'ron', 'eus', 'ara', 'swe', 'tur', 'cmn', 'heb', 'hin', 'vie', 'nld',
] as const;
