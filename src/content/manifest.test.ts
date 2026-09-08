import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import manifest from './manifest.json';
import { findLanguageLeak, languageTokens } from './leak';
import type { ContentManifest } from './types';
import {
  LANGUAGES,
  ABSOLUTE_MIN_SPEAKERS,
  MAX_DURATION_S,
  MIN_TILE_DURATION_S,
  TILE_GAP_S,
  SCHEMA_VERSION,
  TILES_PER_LANGUAGE,
  WORDS_PER_TILE,
} from '../../scripts/content.config';
import { CLIP_ID_PATTERN } from '../../scripts/lib/clip-id';

/**
 * Manifest integrity gate.
 *
 * The content pipeline talks to a live third-party API. Any of its steps can
 * half-succeed: a download can 429, a transcode can produce a zero-byte file, a
 * licence field can come back empty. Those failures do not break the build —
 * they break the *game*, silently, days later. This gate turns them into a
 * failing test.
 *
 * It is deliberately paranoid about licensing, because attribution is a legal
 * obligation rather than a nice-to-have.
 */

const content = manifest as ContentManifest;
const PUBLIC_DIR = join(process.cwd(), 'public');

describe('content manifest', () => {
  it('is not empty and matches the expected schema version', () => {
    expect(content.schemaVersion).toBe(SCHEMA_VERSION);
    expect(content.clips.length).toBeGreaterThan(0);
    expect(content.languages.length).toBeGreaterThan(0);
  });

  it('has every configured language populated to target', () => {
    for (const language of LANGUAGES) {
      const clips = content.clips.filter((c) => c.language === language.id);
      expect(clips.length, `${language.name} has too few tiles`).toBeGreaterThanOrEqual(
        TILES_PER_LANGUAGE,
      );
    }
  });

  /**
   * Every language must field enough distinct voices.
   *
   * With too few speakers a player stops learning the language and starts
   * learning the people, which quietly corrupts per-language accuracy into a
   * measure of voice recall. The pipeline enforces this, but the pipeline only
   * runs when someone runs it; this gate fails the build on a stale manifest.
   */
  it('meets the speaker floor for every language', () => {
    for (const language of LANGUAGES) {
      const speakers = new Set(
        content.clips.filter((c) => c.language === language.id).map((c) => c.speaker),
      );
      expect(
        speakers.size,
        `${language.name} is below the absolute minimum and should not ship`,
      ).toBeGreaterThanOrEqual(ABSOLUTE_MIN_SPEAKERS);
    }
  });

  /**
   * Composite tiles must not lose per-word attribution.
   *
   * A tile is assembled from several source recordings whose licences differ
   * per file — the corpus mixes CC0, CC BY 4.0 and CC BY-SA 4.0 — and the
   * repository is public, so BY and BY-SA obligations attach to each source
   * individually. Collapsing them to one credit line would breach the terms
   * the files are supplied under.
   */
  it('carries complete per-word attribution for every composite tile', () => {
    for (const clip of content.clips) {
      expect(clip.sources, `${clip.id} has no sources`).toBeDefined();
      expect(clip.sources.length, `${clip.id} wrong source count`).toBe(WORDS_PER_TILE);

      for (const source of clip.sources) {
        expect(source.word.length, `${clip.id} source has empty word`).toBeGreaterThan(0);
        expect(source.speaker.length, `${clip.id} source has no speaker`).toBeGreaterThan(0);
        expect(source.license.length, `${clip.id} source has no licence`).toBeGreaterThan(0);
        expect(source.sourceUrl, `${clip.id} source has no source URL`).toMatch(
          /^https:\/\/commons\.wikimedia\.org\/wiki\/File:/,
        );
      }

      // One tile is one voice: mixing speakers inside a tile would defeat the
      // point, which is to give the ear a consistent voice to read prosody from.
      const speakers = new Set(clip.sources.map((s) => s.speaker));
      expect(speakers.size, `${clip.id} mixes speakers`).toBe(1);
      expect(clip.sources[0].speaker).toBe(clip.speaker);

      // The displayed utterance must be exactly its constituents, so the
      // reveal clue never shows a word the player did not hear.
      expect(clip.word).toBe(clip.sources.map((s) => s.word).join(' '));
    }
  });

  /**
   * The tile's own licence must be the most restrictive of its sources.
   *
   * A composite is a derivative of every word in it, so offering a tile built
   * partly from CC BY-SA material under plain CC0 would be a licence downgrade.
   */
  it('offers each tile under the most restrictive licence among its sources', () => {
    const rank = (l: string) => ['CC0', 'CC BY 4.0', 'CC BY-SA 4.0'].indexOf(l);
    for (const clip of content.clips) {
      const strictest = clip.sources
        .map((s) => s.license)
        .reduce((a, b) => (rank(b) > rank(a) ? b : a));
      expect(clip.license, `${clip.id} understates its licence`).toBe(strictest);
    }
  });

  /**
   * Tiles must be long enough to carry prosody.
   *
   * The original corpus had a median clip of 0.73s, and 253 of 560 clips ran
   * under 0.7s. A word that short contains no rhythm, no stress pattern and no
   * intonation contour, so the player has nothing to identify a language *by*
   * and the game degenerates into guessing. That is the specific defect
   * composite tiles were introduced to fix, so it gets a gate.
   */
  it('gives every tile enough audio to judge prosody from', () => {
    for (const clip of content.clips) {
      expect(clip.duration, `${clip.id} is too short to identify`).toBeGreaterThanOrEqual(2);
    }
  });

  it('uses unique clip ids', () => {
    const ids = content.clips.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('only references languages that are declared', () => {
    const declared = new Set(content.languages.map((l) => l.id));
    for (const clip of content.clips) {
      expect(declared.has(clip.language), `${clip.id} has undeclared language`).toBe(true);
    }
  });

  it('assigns every language to a declared cluster', () => {
    const clusters = new Set(content.clusters.map((c) => c.id));
    for (const language of content.languages) {
      expect(clusters.has(language.cluster)).toBe(true);
    }
  });

  it('points at an audio file that actually exists and is non-empty', () => {
    for (const clip of content.clips) {
      const path = join(PUBLIC_DIR, clip.audio);
      expect(existsSync(path), `missing audio for ${clip.id}: ${clip.audio}`).toBe(true);
      expect(statSync(path).size, `empty audio for ${clip.id}`).toBeGreaterThan(256);
    }
  });

  it('records a plausible duration for every clip', () => {
    // Bounds derive from the tile format: three words each capped at
    // MAX_DURATION_S, plus the gaps between them. The old upper bound of 3s
    // dated from single-word clips and silently became wrong for every
    // composite tile the moment the format changed.
    const ceiling = MAX_DURATION_S * WORDS_PER_TILE + TILE_GAP_S * (WORDS_PER_TILE - 1);
    for (const clip of content.clips) {
      expect(clip.duration, `${clip.id} duration`).toBeGreaterThanOrEqual(MIN_TILE_DURATION_S);
      expect(clip.duration, `${clip.id} duration`).toBeLessThanOrEqual(ceiling);
    }
  });

  it('carries a licence, a source URL and a speaker for EVERY clip', () => {
    // Missing attribution is a licensing failure, not a cosmetic one.
    for (const clip of content.clips) {
      expect(clip.license, `${clip.id} has no licence`).toBeTruthy();
      expect(clip.license, `${clip.id} has an unknown licence`).not.toBe('unknown');
      expect(clip.sourceUrl, `${clip.id} has no source URL`).toMatch(
        /^https:\/\/commons\.wikimedia\.org\//,
      );
      expect(clip.speaker, `${clip.id} has no speaker`).toBeTruthy();
    }
  });

  it('never leaks the language into the clip id or the audio path', () => {
    // The id reaches the DOM as a test hook and the path reaches the network
    // tab. Either one carrying `ita` hands a devtools user the whole board and
    // makes the reveal clue worthless.
    const tokens = languageTokens(content);
    for (const clip of content.clips) {
      expect(clip.id, `${clip.id} is not an opaque id`).toMatch(CLIP_ID_PATTERN);
      expect(clip.audio).toBe(`audio/${clip.id}.opus`);
      expect(findLanguageLeak(clip.id, tokens), `clip id ${clip.id} leaks its language`).toBeNull();
      expect(findLanguageLeak(clip.audio, tokens), `${clip.audio} leaks its language`).toBeNull();
      expect(clip.audio).not.toContain(clip.word);
    }
  });

  it('does not order clips by language, which would leak the grouping', () => {
    // Manifest order is a channel of its own: clips sorted into per-language
    // runs would spell out the answer to anyone scrolling the bundled JSON.
    // Hash order interleaves languages, so runs should be almost all length 1.
    let runs = 1;
    for (let i = 1; i < content.clips.length; i++) {
      if (content.clips[i].language !== content.clips[i - 1].language) runs += 1;
    }
    expect(runs / content.clips.length).toBeGreaterThan(0.7);
  });

  it('ships no audio the manifest does not reference', () => {
    // Orphans from an earlier run still get precached, costing every player
    // bandwidth for clips the game will never play — and a stale per-language
    // directory would put the language back into the file tree.
    const referenced = new Set(content.clips.map((c) => c.audio.replace(/^audio\//, '')));
    const entries = readdirSync(join(PUBLIC_DIR, 'audio'), { withFileTypes: true });
    for (const entry of entries) {
      expect(entry.isDirectory(), `audio/${entry.name}/ is a stale per-language directory`).toBe(false);
      expect(referenced.has(entry.name), `audio/${entry.name} is unreferenced`).toBe(true);
    }
    expect(entries.length).toBe(referenced.size);
  });

  it('has enough speaker variety that players learn languages, not voices', () => {
    for (const language of content.languages) {
      const clips = content.clips.filter((c) => c.language === language.id);
      if (clips.length === 0) continue;
      const speakers = new Set(clips.map((c) => c.speaker));
      expect(speakers.size, `${language.name} has too few speakers`).toBeGreaterThanOrEqual(3);
      // And no single speaker may dominate a language.
      const counts = new Map<string, number>();
      for (const c of clips) counts.set(c.speaker, (counts.get(c.speaker) ?? 0) + 1);
      const share = Math.max(...counts.values()) / clips.length;
      expect(share, `${language.name} is dominated by one speaker`).toBeLessThanOrEqual(0.5);
    }
  });

  it('has no duplicate words inside a language', () => {
    for (const language of content.languages) {
      const words = content.clips.filter((c) => c.language === language.id).map((c) => c.word);
      expect(new Set(words).size, `${language.name} has duplicate words`).toBe(words.length);
    }
  });

  it('credits the right word when the speaker name contains a hyphen', () => {
    // The Lingua Libre filename is `LL-Q<id> (<iso>)-<speaker>-<word>.wav`, and
    // splitting it is ambiguous when either half contains a hyphen. The speaker
    // comes from the file's `Artist` metadata and is authoritative; the word is
    // guessed from the filename. For the contributor `Wikipedian-walker` the
    // guess was wrong and the credits page published the non-word
    // "walker-epíteto".
    //
    // The check is deliberately conditional. A Commons display name need not
    // match the filename segment — `Кантемир Гонов (Kantikkantemirgonov)` is
    // shortened to `Кантемир Гонов`, so demanding exact recomposition would
    // fail on perfectly good data. But *when* the authoritative speaker is a
    // literal prefix of the filename remainder, the word that follows it is
    // known exactly, and anything else is a mis-split.
    // A tile now derives from several source recordings, so the check runs
    // per source: each source URL must recompose to *its own* word, not to the
    // joined utterance the tile exposes as `clip.word`.
    for (const clip of content.clips) {
      for (const source of clip.sources) {
        const filename = decodeURIComponent(source.sourceUrl.split('/wiki/File:')[1] ?? '').replace(
          /_/g,
          ' ',
        );
        expect(filename, `${clip.id} has no parseable Commons filename`).not.toBe('');
        const rest = filename
          .normalize('NFC')
          .replace(/^LL-Q\d+\s+\([a-z]{3}\)-/i, '')
          .replace(/\.\w+$/, '');
        const prefix = `${source.speaker.normalize('NFC')}-`;
        if (!rest.startsWith(prefix)) continue;
        expect(
          rest.slice(prefix.length),
          `${clip.id}: speaker "${source.speaker}" is a prefix of "${rest}", so the word is not ambiguous`,
        ).toBe(source.word.normalize('NFC'));
      }
    }
  });

  it('has no bound morphemes, which are prefixes rather than words', () => {
    for (const clip of content.clips) {
      expect(
        /^[-‐‑–—]|[-‐‑–—]$/u.test(clip.word),
        `${clip.id} is the bound morpheme "${clip.word}", not a word`,
      ).toBe(false);
    }
  });
});
