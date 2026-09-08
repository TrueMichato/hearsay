import { describe, expect, it } from 'vitest';
import { curateWord, parseFilename, selectWithSpeakerDiversity, type RejectionReason } from './curate';

describe('parseFilename', () => {
  it('extracts language, speaker and word from a Lingua Libre filename', () => {
    expect(parseFilename('File:LL-Q5287 (jpn)-CKali-オタマトーン.wav')).toEqual({
      iso: 'jpn',
      speaker: 'CKali',
      word: 'オタマトーン',
    });
  });

  it('keeps hyphens that belong to the word', () => {
    expect(parseFilename('File:LL-Q7737 (rus)-Harulover-кто-то.wav')).toEqual({
      iso: 'rus',
      speaker: 'Harulover',
      word: 'кто-то',
    });
  });

  it('returns null for anything that is not a Lingua Libre recording', () => {
    expect(parseFilename('File:Some other upload.ogg')).toBeNull();
    expect(parseFilename('File:LL-Q5287 (jpn)-nodash.wav')).toBeNull();
  });
});

describe('curateWord', () => {
  it('rejects the katakana loanword that motivated the filter', () => {
    // オタマトーン ("otamatone") is a loanword. It sounds cross-linguistic, so a
    // player cannot identify Japanese from it however carefully they listen.
    expect(curateWord('オタマトーン', 'japanese')).toEqual({
      ok: false,
      reason: 'katakana-loanword',
    });
  });

  it('accepts native Japanese vocabulary in hiragana and kanji', () => {
    expect(curateWord('あそこ', 'japanese').ok).toBe(true);
    expect(curateWord('医者', 'japanese').ok).toBe(true);
    // A single kanji is a perfectly ordinary word and must not be "too short".
    expect(curateWord('木', 'japanese').ok).toBe(true);
  });

  it('rejects romanised entries inside non-Latin languages', () => {
    // Commons really contains `LL-Q5287 (jpn)-フィリピン人-Shokubutsu.wav`.
    expect(curateWord('Shokubutsu', 'japanese')).toEqual({
      ok: false,
      reason: 'latin-in-non-latin-script',
    });
  });

  it('rejects capitalised proper nouns in cased scripts', () => {
    expect(curateWord('Madrid', 'latin')).toEqual({ ok: false, reason: 'proper-noun-capitalised' });
    expect(curateWord('Москва', 'cyrillic')).toEqual({ ok: false, reason: 'proper-noun-capitalised' });
    expect(curateWord('casa', 'latin').ok).toBe(true);
    expect(curateWord('вода', 'cyrillic').ok).toBe(true);
  });

  it('rejects multi-word entries, which are phrases rather than words', () => {
    expect(curateWord('buenos dias', 'latin')).toEqual({ ok: false, reason: 'multi-word' });
  });

  it('allows apostrophes and hyphens inside a word', () => {
    expect(curateWord("l'acqua", 'latin').ok).toBe(true);
    expect(curateWord('кто-то', 'cyrillic').ok).toBe(true);
  });

  it('rejects words written in the wrong script for their language', () => {
    expect(curateWord('привет', 'latin').reason).toBe('wrong-script');
    expect(curateWord('안녕하세', 'cyrillic').reason).toBe('wrong-script');
  });

  it('rejects digits and stray punctuation', () => {
    expect(curateWord('casa2', 'latin')).toEqual({ ok: false, reason: 'contains-digits' });
    expect(curateWord('casa,', 'latin')).toEqual({ ok: false, reason: 'contains-punctuation' });
  });
});

describe('selectWithSpeakerDiversity', () => {
  const tally = () => new Map<RejectionReason, number>();

  it('spreads picks across speakers instead of draining the largest', () => {
    const candidates = [
      ...Array.from({ length: 20 }, (_, i) => ({ speaker: 'prolific', word: `p${i}` })),
      ...Array.from({ length: 5 }, (_, i) => ({ speaker: 'occasional', word: `o${i}` })),
      ...Array.from({ length: 5 }, (_, i) => ({ speaker: 'rare', word: `r${i}` })),
    ];

    const picked = selectWithSpeakerDiversity(candidates, 9, 3, tally());

    expect(picked).toHaveLength(9);
    const counts = new Map<string, number>();
    for (const p of picked) counts.set(p.speaker, (counts.get(p.speaker) ?? 0) + 1);
    // Nobody exceeds the quota, and all three voices are represented.
    expect(Math.max(...counts.values())).toBeLessThanOrEqual(3);
    expect(counts.size).toBe(3);
  });

  it('drops duplicate words so the same word cannot appear twice on a board', () => {
    const t = tally();
    const picked = selectWithSpeakerDiversity(
      [
        { speaker: 'a', word: 'casa' },
        { speaker: 'b', word: 'Casa' },
        { speaker: 'c', word: 'perro' },
      ],
      5,
      5,
      t,
    );
    expect(picked.map((p) => p.word)).toEqual(['casa', 'perro']);
    expect(t.get('duplicate-word')).toBe(1);
  });
});
