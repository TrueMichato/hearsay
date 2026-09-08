/**
 * Types shared between the build-time content pipeline (`scripts/fetch-content.ts`)
 * and the runtime app. Keeping them in one file means a pipeline change that
 * breaks the app's expectations fails at `tsc` time rather than in the browser.
 */

/** Writing system, used to drive script-aware word-curation heuristics. */
export type ScriptFamily =
  | 'latin'
  | 'cyrillic'
  | 'japanese'
  | 'hangul'
  | 'arabic'
  | 'hebrew'
  | 'devanagari'
  | 'han';

/**
 * How likely a general player is to be able to *name* the language.
 *
 * Distinct from `LanguageCluster`, which measures how confusable languages are
 * with each other. The two are independent: Basque is acoustically unlike
 * anything else in the corpus (easy by similarity) yet most players have never
 * knowingly heard it (hard by familiarity). Easy difficulty needs both.
 */
export type Familiarity = 'household' | 'known' | 'obscure';

/**
 * A group of languages that sound similar to an untrained ear. Board generation
 * deliberately draws from within a cluster to make rounds genuinely hard.
 */
export interface LanguageCluster {
  id: string;
  name: string;
  /** App-level language ids belonging to this cluster. */
  languages: string[];
}

export interface LanguageMeta {
  /** App-level id. Currently identical to the ISO 639-3 code. */
  id: string;
  /** ISO 639-3 code; also the Lingua Libre Commons category suffix. */
  iso639_3: string;
  /** English display name, shown on Easy-difficulty buckets. */
  name: string;
  /** Endonym, shown alongside the English name. */
  nativeName: string;
  script: ScriptFamily;
  /** Cluster id this language belongs to. */
  cluster: string;
  /** How recognisable this language is to a general player. */
  familiarity: Familiarity;
  /** Stable Tailwind-compatible colour used by the `colorCode` clue. */
  color: string;
}

/**
 * One source recording that contributes to a tile.
 *
 * A tile is assembled from several of these, and because Lingua Libre licences
 * vary *per file* (the corpus mixes CC0, CC BY 4.0 and CC BY-SA 4.0), the
 * attribution for each constituent has to survive assembly individually. It
 * cannot be collapsed to a single licence line without breaking the terms the
 * BY and BY-SA files are supplied under.
 */
export interface ClipSource {
  /** The word as written in its native script. */
  word: string;
  /** Latin transliteration where derivable, else `null`. */
  romanization: string | null;
  /** Speaker's Lingua Libre username. */
  speaker: string;
  /** Short licence name exactly as Commons reports it. */
  license: string;
  /** Canonical URL of the licence deed. */
  licenseUrl: string | null;
  /** Commons file description page — the required attribution link. */
  sourceUrl: string;
  /** Duration of this word within the assembled tile, in seconds. */
  duration: number;
}

/**
 * A single playable tile: a short utterance assembled from several words
 * spoken by one speaker in one language.
 */
export interface ClipMeta {
  /**
   * Opaque, stable id — a truncated hash of language+word+speaker.
   *
   * Deliberately carries no language signal. This id reaches the DOM as a test
   * hook and the network as a filename, so an id like `ita-0013` would hand a
   * devtools user every answer for free and make the reveal clue pointless.
   * See `scripts/lib/clip-id.ts`.
   */
  id: string;
  /** App language id (see `LanguageMeta.id`). */
  language: string;
  /**
   * The utterance as written, constituent words joined by spaces. Revealed only
   * via a clue. Kept as a single string so the reveal clue renders unchanged.
   */
  word: string;
  /**
   * Latin transliteration where algorithmically derivable, else `null`.
   * Never a translation — this game is about sound, not meaning.
   */
  romanization: string | null;
  /** Audio path relative to the site root, opaque and language-free, e.g. `audio/8f3ad1c05b72.opus`. */
  audio: string;
  /** Clip duration in seconds, measured after transcoding. */
  duration: number;
  /** Speaker's Lingua Libre username. Shared by every source in the tile. */
  speaker: string;
  /**
   * Per-word attribution for every source recording in this tile, in order.
   * The credits page must render all of them.
   */
  sources: ClipSource[];
  /**
   * Effective licence of the assembled tile: the most restrictive licence among
   * `sources`. A composite of a CC0 word and a CC BY-SA word is CC BY-SA
   * overall, so this is the licence the tile as a whole is offered under.
   * Per-file detail lives in `sources`.
   */
  license: string;
  /** Canonical URL of the licence deed. */
  licenseUrl: string | null;
  /** Commons file description page — the required attribution link. */
  sourceUrl: string;
}

/** The complete, typed content manifest emitted by the pipeline. */
export interface ContentManifest {
  /** Manifest schema version. Bump on breaking shape changes. */
  schemaVersion: number;
  /** ISO timestamp of the generating run. */
  generatedAt: string;
  languages: LanguageMeta[];
  clusters: LanguageCluster[];
  clips: ClipMeta[];
}
