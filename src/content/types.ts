/**
 * Types shared between the build-time content pipeline (`scripts/fetch-content.ts`)
 * and the runtime app. Keeping them in one file means a pipeline change that
 * breaks the app's expectations fails at `tsc` time rather than in the browser.
 */

/** Writing system, used to drive script-aware word-curation heuristics. */
export type ScriptFamily = 'latin' | 'cyrillic' | 'japanese' | 'hangul';

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
  /** Stable Tailwind-compatible colour used by the `colorCode` clue. */
  color: string;
}

/** A single playable recording: one word, one speaker, one audio file. */
export interface ClipMeta {
  /** Stable id, safe for filenames and IndexedDB keys. */
  id: string;
  /** App language id (see `LanguageMeta.id`). */
  language: string;
  /** The word as written in its native script. Revealed only via a clue. */
  word: string;
  /**
   * Latin transliteration where algorithmically derivable, else `null`.
   * Never a translation — this game is about sound, not meaning.
   */
  romanization: string | null;
  /** Audio path relative to the site root, e.g. `/audio/spa/spa-0001.opus`. */
  audio: string;
  /** Clip duration in seconds, measured after transcoding. */
  duration: number;
  /** Speaker's Lingua Libre username. Drives per-language speaker diversity. */
  speaker: string;
  /** Short licence name exactly as Commons reports it, e.g. `CC0`, `CC BY-SA 4.0`. */
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
