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
export const SCHEMA_VERSION = 2;

/**
 * How many source words make up one tile.
 *
 * A single word is the wrong unit of audio for this game. Telling languages
 * apart by ear relies on *prosody* — the rhythm of syllables, where stress
 * lands, the melody of the intonation contour, which sound sequences the
 * language even permits. A 0.4-second word contains none of that, so the player
 * hears a fragment and guesses. Measured across the previous corpus the median
 * clip was 0.73s and 253 of 560 were under 0.7s, which is the real cause of the
 * "sound is bad" complaint: not encoding, but too little signal to judge.
 *
 * Three words from the same speaker, separated by a natural pause, lands around
 * 2.5-4s — enough for the ear to lock on to rhythm and melody, while remaining
 * genuine speech from a real native speaker rather than synthesis.
 */
export const WORDS_PER_TILE = 3;

/** Silence inserted between words within a tile, in seconds. */
export const TILE_GAP_S = 0.25;

/**
 * Target number of assembled tiles per language.
 *
 * A 4x4 board with up to 5 languages needs only a handful per round, but a
 * larger pool keeps rounds from repeating and lets us prefer speaker variety.
 */
export const TILES_PER_LANGUAGE = 20;

/** Source words needed per language, derived from the two constants above. */
export const WORDS_PER_LANGUAGE = TILES_PER_LANGUAGE * WORDS_PER_TILE;

/**
 * Opus bitrate for assembled tiles.
 *
 * Chosen by measurement, not by argument. Encoding the same assembled tile at
 * several settings and comparing energy against the uncompressed reference in
 * the bands where fricative and formant detail live:
 *
 *              loss >6kHz   loss >10kHz   size
 *   32k audio     0.7 dB       0.3 dB     11.4 KiB
 *   24k audio     0.9 dB       0.7 dB      8.7 KiB
 *   32k voip      0.7 dB       0.3 dB     11.4 KiB
 *
 * 24k gives up 0.2-0.4 dB against 32k in exactly the band this game depends on,
 * which is far below audibility, and saves a quarter of the payload. Tiles are
 * now four times longer than before, so that saving is what keeps the offline
 * precache reasonable. `voip` and `audio` measured identically here; `audio` is
 * kept because discriminating fine phonetic detail is the whole task, and VoIP
 * mode is tuned to discard exactly that in favour of telephone intelligibility.
 */
export const OPUS_BITRATE = '24k';


/**
 * Maximum tiles accepted from any single speaker, as a fraction of
 * `TILES_PER_LANGUAGE`. Prevents a language becoming "that one voice" — players
 * must learn the language, not memorise a timbre.
 *
 * 0.15 of 20 tiles is 3 tiles per speaker, so filling a language needs at least
 * seven voices and in practice draws many more. The previous 0.34 was set when
 * a clip was one word; with three-word tiles it let a single speaker supply a
 * third of the board.
 */
export const MAX_SPEAKER_SHARE = 0.15;

/**
 * Minimum distinct speakers required before a language is considered usable.
 *
 * With too few voices a player stops learning the language and starts learning
 * the people — "that's the gravelly one, so it's Czech". That is a different
 * skill from the one the game claims to teach, and it silently corrupts the
 * stats, because per-language accuracy then measures voice recall.
 *
 * The previous corpus was badly lopsided (Czech 6, Russian 7, Korean 8 against
 * Basque 30 and Polish 28). The floor is deliberately enforced as a hard
 * failure rather than a warning: a language that cannot field enough voices
 * should stop the build, not quietly ship a degraded round.
 */
export const MIN_SPEAKERS_PER_LANGUAGE = 10;

/**
 * Absolute floor, below which a language is not shipped at all.
 *
 * The target floor above is what we want; this is what we refuse to go under.
 * A language whose corpus cannot field even this many voices makes a round in
 * which the player is effectively identifying individuals, so it is dropped
 * rather than shipped degraded.
 *
 * Vietnamese was requested for the roster but fails here: its category yields
 * only four speakers with enough usable words after curation. Including it
 * would have satisfied the roster request while defeating the speaker-diversity
 * requirement made in the same breath, so it is deliberately absent from
 * LANGUAGES and this constant is what would have caught it.
 */
export const ABSOLUTE_MIN_SPEAKERS = 5;

/**
 * Minimum words one speaker must contribute to be usable at all.
 *
 * A tile is assembled from words by a *single* speaker, so a speaker with fewer
 * than `WORDS_PER_TILE` usable words cannot form even one tile.
 */
export const MIN_WORDS_PER_SPEAKER = WORDS_PER_TILE;


/**
 * How many category members to enumerate per language before curating.
 *
 * Curation is aggressive — Russian rejects ~85% of a sample as multi-word
 * phrases — so we over-fetch heavily. Enumeration is 500 files per request and
 * every response is cached on disk, so a large pool costs a handful of requests
 * once and nothing on reruns.
 *
 * This number is far more important than it looks, and it was badly wrong.
 *
 * Commons returns category members sorted by **file title**, and a Lingua Libre
 * title embeds the speaker before the word:
 *
 *     LL-Q7737 (rus)-Tatiana Kerbush-словарь.wav
 *                    ^^^^^^^^^^^^^^
 *
 * So members arrive grouped by speaker, in alphabetical blocks. Truncating the
 * enumeration therefore truncates the **contributor roster**, not a random
 * sample of the language. Measured directly: a 6,000-member Russian pool
 * contained exactly *10 distinct speakers*, all in contiguous runs — out of a
 * category holding 34,359 recordings. The pipeline was never sampling Russian;
 * it was sampling the first ten Russians in alphabetical order.
 *
 * That silently defeats the whole speaker-diversity mechanism, and it does so
 * without any error: every count in the summary looked healthy. The floor check
 * in `fetch-content.ts` is what finally surfaced it.
 *
 * 40,000 covers entire categories for most languages here, and for the few
 * larger ones leaves a slice wide enough to span many contributors.
 */
export const CANDIDATE_POOL_SIZE = 40000;

/**
 * Acceptable duration of a single *source word*, in seconds, measured after
 * silence trimming. Three of these plus two gaps make a tile, so the upper
 * bound also caps tile length: 3 x 1.7 + 0.5 = 5.6s worst case.
 */
export const MIN_DURATION_S = 0.25;
export const MAX_DURATION_S = 1.7;

/**
 * Acceptable duration of a finished *tile*, in seconds.
 *
 * The per-word bounds above do not guarantee this: three unusually short words
 * still assemble into a tile too brief to judge. Since the whole point of
 * composite tiles is giving the ear enough prosody to work with, a tile that
 * lands under two seconds has failed at its one job and is rejected outright
 * rather than shipped. The round-robin simply forms another from the remaining
 * words, so rejecting is nearly free.
 */
export const MIN_TILE_DURATION_S = 2.0;

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
 * The playable languages.
 *
 * Every language carries two independent axes, and both are load-bearing.
 *
 * ## `cluster` — how confusable it sounds
 *
 * A cluster groups languages an untrained ear mixes up. It is *perceptual*, not
 * genealogical: Vietnamese sits in `east-asian` beside Japanese and Korean
 * because naive listeners lump them together, even though they are unrelated.
 * The label is geographically sloppy on purpose.
 *
 * Clusters pull in two opposite directions:
 *  - **Hard** draws from *inside* one cluster, so a cluster smaller than the
 *    board's language count cannot fill a board alone.
 *  - **Easy** draws at most one language per cluster, so the *number* of
 *    clusters caps how many buckets Easy can offer.
 *
 * ## `familiarity` — whether a player can name it
 *
 * Acoustic distance is not the same as recognisability, and conflating them
 * produced a real failure: an Easy board of Polish / Basque / Swedish is three
 * unrelated families and therefore "correct" by similarity, yet most players
 * cannot name Basque at all. Being unable to identify a language you have never
 * heard of is not a fair Easy question.
 *
 *  - `household` — a general player can name it unprompted.
 *  - `known`     — recognised when named, rarely identified cold.
 *  - `obscure`   — most players have never knowingly heard it. This is not a
 *                  criticism of the language; it is a statement about the
 *                  median player, and "what even *is* that?" is precisely the
 *                  intended feeling in Hard.
 *
 * Recording counts are verified against the live Commons API.
 */
export const LANGUAGES: LanguageMeta[] = [
  // --- Romance: the classic "is that Spanish or Portuguese?" trap ---
  { id: 'fra', iso639_3: 'fra', name: 'French', nativeName: 'Français', script: 'latin', cluster: 'romance', familiarity: 'household', color: '#6366f1' }, // 434491
  { id: 'spa', iso639_3: 'spa', name: 'Spanish', nativeName: 'Español', script: 'latin', cluster: 'romance', familiarity: 'household', color: '#f59e0b' }, // 19127
  { id: 'ita', iso639_3: 'ita', name: 'Italian', nativeName: 'Italiano', script: 'latin', cluster: 'romance', familiarity: 'household', color: '#ef4444' }, // 12629
  { id: 'por', iso639_3: 'por', name: 'Portuguese', nativeName: 'Português', script: 'latin', cluster: 'romance', familiarity: 'known', color: '#10b981' }, // 9356
  { id: 'ron', iso639_3: 'ron', name: 'Romanian', nativeName: 'Română', script: 'latin', cluster: 'romance', familiarity: 'obscure', color: '#fb7185' }, // 24088
  { id: 'cat', iso639_3: 'cat', name: 'Catalan', nativeName: 'Català', script: 'latin', cluster: 'romance', familiarity: 'obscure', color: '#f97316' }, // 22918

  // --- Slavic: close relatives split across two alphabets ---
  { id: 'rus', iso639_3: 'rus', name: 'Russian', nativeName: 'Русский', script: 'cyrillic', cluster: 'slavic', familiarity: 'household', color: '#3b82f6' }, // 34359
  { id: 'pol', iso639_3: 'pol', name: 'Polish', nativeName: 'Polski', script: 'latin', cluster: 'slavic', familiarity: 'known', color: '#a855f7' }, // 97544
  { id: 'ukr', iso639_3: 'ukr', name: 'Ukrainian', nativeName: 'Українська', script: 'cyrillic', cluster: 'slavic', familiarity: 'known', color: '#06b6d4' }, // 27397
  { id: 'ces', iso639_3: 'ces', name: 'Czech', nativeName: 'Čeština', script: 'latin', cluster: 'slavic', familiarity: 'obscure', color: '#8b5cf6' }, // 6527

  // --- East Asian: perceptual, not genealogical. Untrained ears swap these. ---
  { id: 'jpn', iso639_3: 'jpn', name: 'Japanese', nativeName: '日本語', script: 'japanese', cluster: 'east-asian', familiarity: 'household', color: '#ec4899' }, // 1043
  { id: 'cmn', iso639_3: 'cmn', name: 'Mandarin', nativeName: '普通话', script: 'han', cluster: 'east-asian', familiarity: 'household', color: '#dc2626' }, // 4122
  { id: 'kor', iso639_3: 'kor', name: 'Korean', nativeName: '한국어', script: 'hangul', cluster: 'east-asian', familiarity: 'known', color: '#84cc16' }, // 1024

  // --- Germanic ---
  { id: 'deu', iso639_3: 'deu', name: 'German', nativeName: 'Deutsch', script: 'latin', cluster: 'germanic', familiarity: 'household', color: '#eab308' }, // 26112
  { id: 'nld', iso639_3: 'nld', name: 'Dutch', nativeName: 'Nederlands', script: 'latin', cluster: 'germanic', familiarity: 'known', color: '#f472b6' }, // 1825
  { id: 'swe', iso639_3: 'swe', name: 'Swedish', nativeName: 'Svenska', script: 'latin', cluster: 'germanic', familiarity: 'known', color: '#14b8a6' }, // 9729

  // --- Semitic: two consonant-heavy languages routinely mistaken for each other ---
  { id: 'ara', iso639_3: 'ara', name: 'Arabic', nativeName: 'العربية', script: 'arabic', cluster: 'semitic', familiarity: 'household', color: '#059669' }, // 13749
  { id: 'heb', iso639_3: 'heb', name: 'Hebrew', nativeName: 'עברית', script: 'hebrew', cluster: 'semitic', familiarity: 'known', color: '#7c3aed' }, // 3615

  // --- Singletons: no close relative in this corpus, so ideal Easy material ---
  { id: 'hin', iso639_3: 'hin', name: 'Hindi', nativeName: 'हिन्दी', script: 'devanagari', cluster: 'indic', familiarity: 'known', color: '#d97706' }, // 3431
  { id: 'tur', iso639_3: 'tur', name: 'Turkish', nativeName: 'Türkçe', script: 'latin', cluster: 'turkic', familiarity: 'known', color: '#e11d48' }, // 6645
  { id: 'ind', iso639_3: 'ind', name: 'Indonesian', nativeName: 'Bahasa Indonesia', script: 'latin', cluster: 'austronesian', familiarity: 'known', color: '#65a30d' }, // 7104
  { id: 'eus', iso639_3: 'eus', name: 'Basque', nativeName: 'Euskara', script: 'latin', cluster: 'basque', familiarity: 'obscure', color: '#22c55e' }, // 20686
];

export const CLUSTERS: LanguageCluster[] = [
  { id: 'romance', name: 'Romance', languages: ['fra', 'spa', 'ita', 'por', 'ron', 'cat'] },
  { id: 'slavic', name: 'Slavic', languages: ['rus', 'pol', 'ukr', 'ces'] },
  { id: 'east-asian', name: 'East Asian', languages: ['jpn', 'cmn', 'kor'] },
  { id: 'germanic', name: 'Germanic', languages: ['deu', 'nld', 'swe'] },
  { id: 'semitic', name: 'Semitic', languages: ['ara', 'heb'] },
  { id: 'indic', name: 'Indic', languages: ['hin'] },
  { id: 'turkic', name: 'Turkic', languages: ['tur'] },
  { id: 'austronesian', name: 'Austronesian', languages: ['ind'] },
  { id: 'basque', name: 'Basque', languages: ['eus'] },
];

/**
 * Languages checked against the live Commons API and deliberately excluded.
 * Kept so the reasoning is not lost and re-derived by the next person.
 *
 *   Greek (ell)      0 recordings — genuinely unavailable, not an oversight.
 *   Chinese (zho)    4 — the real Mandarin corpus is under `cmn`.
 *   Arabic (arb)     category does not exist; `ara` is the live one.
 *   Thai (tha)     289 · Swahili (swa) 102 — too thin to curate cleanly.
 *   Danish 147 · Finnish 219 · Hungarian 259 — likewise too thin.
 */
export const DEFERRED_LANGUAGES = ['ell', 'zho', 'arb', 'tha', 'swa'] as const;
