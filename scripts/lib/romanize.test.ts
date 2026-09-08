import { describe, expect, it } from 'vitest';
import { romanize } from './romanize';

describe('romanize', () => {
  it('returns null for Latin-script languages, whose spelling is already Latin', () => {
    expect(romanize('casa', 'spa', 'latin')).toBeNull();
    expect(romanize('książka', 'pol', 'latin')).toBeNull();
  });

  it('transliterates Russian Cyrillic', () => {
    expect(romanize('вода', 'rus', 'cyrillic')).toBe('voda');
    expect(romanize('щука', 'rus', 'cyrillic')).toBe('shchuka');
    expect(romanize('ёлка', 'rus', 'cyrillic')).toBe('yolka');
  });

  it('uses a different table for Ukrainian, where shared letters differ in sound', () => {
    // Russian г is /g/; Ukrainian г is /ɦ/, romanised "h". A single "Cyrillic"
    // table would be wrong for one of the two languages.
    expect(romanize('гора', 'rus', 'cyrillic')).toBe('gora');
    expect(romanize('гора', 'ukr', 'cyrillic')).toBe('hora');
    expect(romanize('їжак', 'ukr', 'cyrillic')).toBe('yizhak');
  });

  it('transliterates Japanese kana, including digraphs and the sokuon', () => {
    expect(romanize('あそこ', 'jpn', 'japanese')).toBe('asoko');
    expect(romanize('きゃく', 'jpn', 'japanese')).toBe('kyaku');
    expect(romanize('きって', 'jpn', 'japanese')).toBe('kitte');
  });

  it('refuses to guess kanji readings rather than inventing one', () => {
    // Kanji readings are context-dependent. A confident wrong answer is worse
    // than no answer, especially for a clue the player paid coins for.
    expect(romanize('医者', 'jpn', 'japanese')).toBeNull();
  });

  it('transliterates Hangul via jamo decomposition', () => {
    expect(romanize('한국', 'kor', 'hangul')).toBe('hanguk');
    expect(romanize('물', 'kor', 'hangul')).toBe('mul');
    expect(romanize('사람', 'kor', 'hangul')).toBe('saram');
  });
});
