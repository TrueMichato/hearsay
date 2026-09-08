import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import manifest from './manifest.json';
import { findLanguageLeak, languageTokens } from './leak';
import type { ContentManifest } from './types';
import { LANGUAGES, WORDS_PER_LANGUAGE } from '../../scripts/content.config';
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
    expect(content.schemaVersion).toBe(1);
    expect(content.clips.length).toBeGreaterThan(0);
    expect(content.languages.length).toBeGreaterThan(0);
  });

  it('has every configured language populated to target', () => {
    for (const language of LANGUAGES) {
      const clips = content.clips.filter((c) => c.language === language.id);
      expect(clips.length, `${language.name} has too few clips`).toBeGreaterThanOrEqual(
        WORDS_PER_LANGUAGE,
      );
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
    for (const clip of content.clips) {
      expect(clip.duration, `${clip.id} duration`).toBeGreaterThan(0.2);
      expect(clip.duration, `${clip.id} duration`).toBeLessThan(3);
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
    for (const clip of content.clips) {
      const filename = decodeURIComponent(clip.sourceUrl.split('/wiki/File:')[1] ?? '').replace(
        /_/g,
        ' ',
      );
      expect(filename, `${clip.id} has no parseable Commons filename`).not.toBe('');
      const rest = filename.normalize('NFC').replace(/^LL-Q\d+\s+\([a-z]{3}\)-/i, '').replace(/\.\w+$/, '');
      const prefix = `${clip.speaker.normalize('NFC')}-`;
      if (!rest.startsWith(prefix)) continue;
      expect(
        rest.slice(prefix.length),
        `${clip.id}: speaker "${clip.speaker}" is a prefix of "${rest}", so the word is not ambiguous`,
      ).toBe(clip.word.normalize('NFC'));
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
