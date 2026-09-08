import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import manifest from './manifest.json';
import type { ContentManifest } from './types';
import { LANGUAGES, WORDS_PER_LANGUAGE } from '../../scripts/content.config';

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

  it('never leaks the answer into the audio path', () => {
    // If the filename contained the word or the language name in a readable
    // form, a player could read it from the browser's network tab.
    for (const clip of content.clips) {
      expect(clip.audio).toMatch(/^audio\/[a-z]{3}\/[a-z]{3}-\d{4}\.opus$/);
      expect(clip.audio).not.toContain(clip.word);
    }
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
});
