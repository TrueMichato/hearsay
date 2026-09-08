import { describe, expect, it } from 'vitest';
import { curateWord, parseFilename, refineWord, selectWithSpeakerDiversity, type RejectionReason } from './curate';

describe('parseFilename', () => {
  it('extracts language, speaker and word from a Lingua Libre filename', () => {
    expect(parseFilename('File:LL-Q5287 (jpn)-CKali-オタマトーン.wav')).toEqual({
      iso: 'jpn',
      speaker: 'CKali',
      word: 'オタマトーン',
      rest: 'CKali-オタマトーン',
    });
  });

  it('keeps hyphens that belong to the word', () => {
    expect(parseFilename('File:LL-Q7737 (rus)-Harulover-кто-то.wav')).toEqual({
      iso: 'rus',
      speaker: 'Harulover',
      word: 'кто-то',
      rest: 'Harulover-кто-то',
    });
  });

  it('returns null for anything that is not a Lingua Libre recording', () => {
    expect(parseFilename('File:Some other upload.ogg')).toBeNull();
    expect(parseFilename('File:LL-Q5287 (jpn)-nodash.wav')).toBeNull();
  });
});

describe('refineWord', () => {
  it('re-splits correctly when the speaker name contains a hyphen', () => {
    // Real file. Splitting at the first hyphen credits speaker "Wikipedian" and
    // publishes the non-word "walker-epíteto" on the credits page.
    const parsed = parseFilename('File:LL-Q1321 (spa)-Wikipedian-walker-epíteto.wav')!;
    expect(parsed.word).toBe('walker-epíteto');
    expect(refineWord(parsed.rest, 'Wikipedian-walker')).toBe('epíteto');
  });

  it('keeps hyphens that belong to the word', () => {
    const parsed = parseFilename('File:LL-Q7737 (rus)-Harulover-кто-то.wav')!;
    expect(refineWord(parsed.rest, 'Harulover')).toBe('кто-то');
  });

  it('falls back to the first-hyphen split when Artist does not match the filename', () => {
    // Commons display names are free text and need not match the filename
    // segment. When they do not, the original guess is the best available.
    const parsed = parseFilename('File:LL-Q1321 (spa)-Precision27-gaveta.wav')!;
    expect(refineWord(parsed.rest, 'Some Unrelated Display Name')).toBe('gaveta');
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

  it('rejects bound morphemes, which are never spoken alone', () => {
    // Real Commons entries: prefixes and suffixes, not words.
    expect(curateWord('секс-', 'cyrillic')).toEqual({ ok: false, reason: 'bound-morpheme' });
    expect(curateWord('dar-', 'latin')).toEqual({ ok: false, reason: 'bound-morpheme' });
    // A hyphen *inside* a word is fine.
    expect(curateWord('кто-то', 'cyrillic').ok).toBe(true);
    expect(curateWord('blu-ray', 'latin').ok).toBe(true);
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
