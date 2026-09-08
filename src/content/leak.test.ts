import { describe, expect, it } from 'vitest';
import manifest from './manifest.json';
import { findLanguageLeak, languageTokens } from './leak';
import type { ContentManifest } from './types';

const tokens = languageTokens(manifest as ContentManifest);

/**
 * The leak detector is itself a gate, so it needs its own gate. A detector that
 * fires on every Tailwind class gets muted, and a muted detector is exactly as
 * useful as no detector.
 */
describe('findLanguageLeak', () => {
  it('catches a language code standing alone', () => {
    expect(findLanguageLeak('tile-ita-0013', tokens)).toBe('ita');
    expect(findLanguageLeak('/audio/kor/x.opus', tokens)).toBe('kor');
  });

  it('catches English names, endonyms and cluster names', () => {
    expect(findLanguageLeak('This is Portuguese', tokens)).toBe('portuguese');
    expect(findLanguageLeak('Русский', tokens)).toBe('русский');
    expect(findLanguageLeak('cluster: east-asian', tokens)).toBe('east-asian');
  });

  it('does not fire on words that merely contain a code', () => {
    // `cat` inside `duplicate`, `por` inside `important`, `ita` inside
    // `capitalise`, `rus` inside `crust`. Every one of these appears in real
    // class names or ARIA text; a substring search would flag them all.
    for (const innocent of [
      'duplicate-word indicator',
      'important capitalise crusty',
      'animate-pulse-ring rounded-2xl border-slate-700',
      'Tile 3 of 16, not assigned. Activate to play the audio.',
      'data-testid="tile-8f3ad1c05b72"',
    ]) {
      expect(findLanguageLeak(innocent, tokens), innocent).toBeNull();
    }
  });

  it('is case-insensitive, because HTML attributes are not normalised', () => {
    expect(findLanguageLeak('LANG=JPN', tokens)).toBe('jpn');
  });
});
