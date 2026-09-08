/**
 * Word curation.
 *
 * The premise of the game is that players identify a language by its *sound*.
 * That premise is only fair if the words are representative native vocabulary.
 * Two things break it badly:
 *
 *   1. **Loanwords.** A Japanese clip of オタマトーン ("otamatone") is a word
 *      borrowed into Japanese phonology from an international stock. It sounds
 *      cross-linguistic, so no amount of listening skill helps.
 *   2. **Proper nouns.** Names of people and places travel between languages and
 *      are often pronounced with foreign phonology.
 *
 * So we filter hard and we count what we throw away, because a silent filter is
 * a filter nobody can audit. Every run prints a rejection tally per language.
 */

import type { ScriptFamily } from '../../src/content/types.ts';

export interface ParsedFilename {
  iso: string;
  speaker: string;
  word: string;
  /** The whole `speaker-word` segment, kept so `refineWord` can re-split it. */
  rest: string;
}

/**
 * Lingua Libre filenames follow `LL-<langQid> (<iso>)-<speaker>-<word>.<ext>`,
 * e.g. `LL-Q5287 (jpn)-CKali-オタマトーン.wav`.
 *
 * Both speaker names and words may contain hyphens, so the split is ambiguous
 * in principle. We split on the *first* hyphen after the language prefix:
 * Lingua Libre usernames are far less likely to contain one than words are.
 */
export function parseFilename(title: string): ParsedFilename | null {
  const name = title.replace(/^File:/, '');
  const m = /^LL-Q\d+\s+\(([a-z]{3})\)-(.+)\.(wav|ogg|flac|mp3|opus)$/i.exec(name);
  if (!m) return null;

  const [, iso, rest] = m;
  const dash = rest.indexOf('-');
  if (dash <= 0 || dash === rest.length - 1) return null;

  return {
    iso: iso.toLowerCase(),
    speaker: rest.slice(0, dash).trim(),
    // Normalise to NFC so that, e.g., composed and decomposed "ñ" dedupe together.
    word: rest.slice(dash + 1).normalize('NFC').trim(),
    rest: rest.normalize('NFC').trim(),
  };
}

/**
 * Re-split `speaker-word` once the speaker's real name is known.
 *
 * The filename format `LL-Q1321 (spa)-<speaker>-<word>.wav` is ambiguous when
 * either half contains a hyphen, and `parseFilename` can only guess: it splits
 * at the first one. For the contributor `Wikipedian-walker` that guess is wrong,
 * and the credits page duly published the word "walker-epíteto" — a word that
 * does not exist, credited alongside a real person's name.
 *
 * Commons resolves the ambiguity for us. Each file's `Artist` metadata carries
 * the speaker's actual display name, so once it has been fetched we can strip it
 * as a literal prefix. This only rewrites the word when the authoritative
 * speaker really is a prefix of the filename remainder, so a display name that
 * differs from the filename segment leaves the original guess untouched.
 */
export function refineWord(rest: string, speaker: string): string {
  const prefix = `${speaker}-`;
  if (!rest.startsWith(prefix) || rest.length <= prefix.length) return rest.slice(rest.indexOf('-') + 1);
  return rest.slice(prefix.length).normalize('NFC').trim();
}

/** Every reason a candidate can be rejected. Used to build the audit tally. */
export type RejectionReason =
  | 'unparseable-filename'
  | 'wrong-language'
  | 'multi-word'
  | 'bound-morpheme'
  | 'contains-digits'
  | 'contains-punctuation'
  | 'too-short'
  | 'too-long'
  | 'latin-in-non-latin-script'
  | 'wrong-script'
  | 'proper-noun-capitalised'
  | 'all-caps'
  | 'katakana-loanword'
  | 'duplicate-word'
  | 'speaker-quota'
  | 'speaker-too-few-words'
  | 'tile-too-short'
  | 'bad-duration'
  | 'download-or-transcode-failed';

export interface CurationVerdict {
  ok: boolean;
  reason?: RejectionReason;
}

const ACCEPT: CurationVerdict = { ok: true };
const reject = (reason: RejectionReason): CurationVerdict => ({ ok: false, reason });

// --- Unicode block probes -------------------------------------------------
const RE_LATIN_LETTER = /[A-Za-z]/;
const RE_DIGIT = /[0-9\u0660-\u0669\u06F0-\u06F9\u0966-\u096F]/;
const RE_WHITESPACE = /\s/;
const RE_HIRAGANA = /[\u3041-\u309F]/;
const RE_KATAKANA = /[\u30A0-\u30FF\uFF66-\uFF9F]/;
const RE_KANJI = /[\u4E00-\u9FFF\u3400-\u4DBF]/;
const RE_HANGUL = /[\uAC00-\uD7A3\u1100-\u11FF\u3130-\u318F]/;
const RE_CYRILLIC = /[\u0400-\u04FF]/;
const RE_ARABIC = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF]/;
const RE_HEBREW = /[\u0590-\u05FF\uFB1D-\uFB4F]/;
const RE_DEVANAGARI = /[\u0900-\u097F]/;
/** Combining marks that carry vowels rather than consonants. */
const RE_ARABIC_HARAKAT = /[\u064B-\u0652\u0670]/;
const RE_HEBREW_NIQQUD = /[\u0591-\u05C7]/;
const RE_DEVANAGARI_VIRAMA = /[\u094D]/;

/**
 * Characters allowed *in addition* to the script's own letters.
 * Apostrophes are legitimate inside words (Italian `l'acqua`, Ukrainian `м'яч`),
 * as are internal hyphens (Russian `кто-то`).
 */
const RE_ALLOWED_PUNCT = /['’\u02BC-]/;

/** Per-script character-class validator. */
function matchesScript(word: string, script: ScriptFamily): boolean {
  const chars = [...word].filter((c) => !RE_ALLOWED_PUNCT.test(c));
  if (chars.length === 0) return false;

  switch (script) {
    case 'latin':
      // Latin letters plus the Latin-1/Extended-A diacritic ranges used by
      // Spanish, Portuguese, Italian and Polish.
      return chars.every((c) => /[A-Za-z\u00C0-\u024F]/.test(c));
    case 'cyrillic':
      return chars.every((c) => RE_CYRILLIC.test(c));
    case 'japanese':
      return chars.every((c) => RE_HIRAGANA.test(c) || RE_KATAKANA.test(c) || RE_KANJI.test(c));
    case 'hangul':
      return chars.every((c) => RE_HANGUL.test(c));
    case 'arabic':
      return chars.every((c) => RE_ARABIC.test(c));
    case 'hebrew':
      return chars.every((c) => RE_HEBREW.test(c));
    case 'devanagari':
      return chars.every((c) => RE_DEVANAGARI.test(c));
    case 'han':
      return chars.every((c) => RE_KANJI.test(c));
  }
}

/**
 * Approximate the number of syllables in a word.
 *
 * This is a heuristic, not linguistics, and it only has to be good enough to
 * *rank* candidates. It is used to prefer longer words when assembling tiles:
 * three monosyllables give the ear almost nothing to work with, which is the
 * problem composite tiles exist to solve in the first place, so a tile built
 * from "cat, dog, run" would reintroduce it at a larger scale.
 *
 * Each script needs its own rule because the relationship between characters
 * and syllables differs wildly:
 *  - Alphabetic scripts write vowels, so vowel *groups* approximate syllables.
 *  - Han characters are one syllable each, essentially exactly.
 *  - Japanese kana are one mora each; kanji are 1-3 and cannot be counted.
 *  - Hangul blocks are one syllable each, exactly.
 *  - Arabic and Hebrew usually omit short vowels, so length is the only proxy
 *    available; consonant count divided by two is the standard rough estimate.
 */
export function estimateSyllables(word: string, script: ScriptFamily): number {
  const chars = [...word].filter((c) => !RE_ALLOWED_PUNCT.test(c));
  switch (script) {
    case 'latin':
    case 'cyrillic': {
      const groups = word
        .toLowerCase()
        .match(/[aeiouyàâäáãåæèéêëìíîïòóôöõøùúûüÿœ\u0430\u0435\u0451\u0438\u0456\u043E\u0443\u044B\u044D\u044E\u044F]+/gu);
      return Math.max(1, groups?.length ?? 1);
    }
    case 'han':
      return chars.length;
    case 'hangul':
      return chars.filter((c) => /[\uAC00-\uD7A3]/.test(c)).length || 1;
    case 'japanese':
      // Kana are one mora each; a kanji is worth ~2 on average.
      return chars.reduce((n, c) => n + (RE_KANJI.test(c) ? 2 : 1), 0);
    case 'devanagari': {
      // Every consonant carries an inherent vowel unless a virama kills it.
      const consonants = chars.filter((c) => /[\u0915-\u0939\u0958-\u095F]/.test(c)).length;
      const independentVowels = chars.filter((c) => /[\u0905-\u0914]/.test(c)).length;
      const viramas = chars.filter((c) => RE_DEVANAGARI_VIRAMA.test(c)).length;
      return Math.max(1, consonants + independentVowels - viramas);
    }
    case 'arabic':
    case 'hebrew': {
      const marks = chars.filter((c) =>
        script === 'arabic' ? RE_ARABIC_HARAKAT.test(c) : RE_HEBREW_NIQQUD.test(c),
      ).length;
      // If the text is vocalised, the marks are the best signal we have.
      if (marks > 0) return Math.max(1, marks);
      const consonants = chars.length - marks;
      return Math.max(1, Math.round(consonants / 2));
    }
  }
}

/**
 * Length bounds differ by script: CJK words pack far more meaning per character.
 * A single kanji (木 "tree") or hanja-derived Korean syllable is an ordinary
 * word, whereas a single kana or jamo is just a vowel — so the minimum depends
 * on whether the word uses ideographs.
 */
function lengthBounds(word: string, script: ScriptFamily): [number, number] {
  switch (script) {
    case 'japanese':
      return [RE_KANJI.test(word) ? 1 : 2, 6];
    case 'hangul':
      return [2, 6];
    case 'han':
      // Chinese words are typically one or two characters; beyond four is
      // almost always a phrase or an idiom rather than a word.
      return [1, 4];
    case 'arabic':
    case 'hebrew':
      // Both write short vowels sparsely, so words are consonant-dense and
      // shorter on the page than their pronunciation suggests.
      return [2, 12];
    case 'devanagari':
      return [2, 14];
    default:
      return [3, 14];
  }
}

/**
 * Decide whether a single candidate word is fit for the game.
 * Order matters only for the quality of the rejection tally, not correctness.
 */
export function curateWord(word: string, script: ScriptFamily): CurationVerdict {
  if (RE_WHITESPACE.test(word)) return reject('multi-word');
  if (RE_DIGIT.test(word)) return reject('contains-digits');

  // A leading or trailing hyphen marks a bound morpheme — a prefix or suffix
  // that is never spoken alone. Commons holds plenty of them ("секс-", "dar-").
  // They are not wrong data, but they are not words either: a tile playing a
  // fragment gives the player less signal than a real word, and the credits
  // page would list something no dictionary contains.
  if (/^[-‐‑–—]|[-‐‑–—]$/u.test(word)) return reject('bound-morpheme');

  // Anything that is neither a letter of the target script nor an allowed
  // in-word punctuation mark (commas, dots, middots, brackets, "・", "…").
  for (const c of word) {
    if (RE_ALLOWED_PUNCT.test(c)) continue;
    if (/[\p{L}\p{M}]/u.test(c)) continue;
    return reject('contains-punctuation');
  }

  // A Latin letter inside a Cyrillic/Japanese/Korean entry is a reliable tell
  // for a romanised proper noun or an untranslated import. Commons really does
  // contain e.g. `LL-Q5287 (jpn)-フィリピン人-Shokubutsu.wav`.
  //
  // This runs BEFORE the length check on purpose. Both would reject
  // "Shokubutsu", but only this reason explains *why* — and the rejection tally
  // is only useful if it reports the real cause.
  if (script !== 'latin' && RE_LATIN_LETTER.test(word)) {
    return reject('latin-in-non-latin-script');
  }

  const [min, max] = lengthBounds(word, script);
  const visibleLength = [...word].filter((c) => !RE_ALLOWED_PUNCT.test(c)).length;
  if (visibleLength < min) return reject('too-short');
  if (visibleLength > max) return reject('too-long');

  if (!matchesScript(word, script)) return reject('wrong-script');

  // Case-based proper-noun detection. Common nouns are lowercase in every
  // Latin- and Cyrillic-script language here *except German*, which capitalises
  // all nouns — so for German this rule also throws away every ordinary noun.
  //
  // We keep it anyway, deliberately. Case is the only signal that separates
  // "Berlin" from "Buch" without a dictionary, and a board of proper nouns is
  // far more damaging than a board with no nouns: names travel between
  // languages and are often said with foreign phonology, which is precisely the
  // unfairness this whole module exists to prevent. German's 26,112 recordings
  // leave ample verbs, adjectives and adverbs to fill 40 slots.
  if (script === 'latin' || script === 'cyrillic') {
    const first = word[0];
    if (first !== first.toLowerCase()) return reject('proper-noun-capitalised');
    if (word.length > 1 && word === word.toUpperCase()) return reject('all-caps');
  }

  // Japanese writes essentially all modern loanwords in katakana. Excluding any
  // word containing katakana removes the オタマトーン class of entry wholesale.
  // Japanese retains ample hiragana/kanji native vocabulary, so the cost is low.
  if (script === 'japanese' && RE_KATAKANA.test(word)) {
    return reject('katakana-loanword');
  }

  return ACCEPT;
}

/**
 * Choose the final clip set for one language, maximising speaker diversity.
 *
 * We round-robin across speakers rather than taking the first N candidates. If
 * one prolific contributor recorded half the category, taking the head of the
 * list would teach players that contributor's voice instead of the language.
 */
export function selectWithSpeakerDiversity<T extends { speaker: string; word: string }>(
  candidates: T[],
  target: number,
  maxPerSpeaker: number,
  tally: Map<RejectionReason, number>,
  blockSize = 1,
): T[] {
  const bySpeaker = new Map<string, T[]>();
  const seenWords = new Set<string>();

  for (const c of candidates) {
    const key = c.word.toLowerCase();
    if (seenWords.has(key)) {
      tally.set('duplicate-word', (tally.get('duplicate-word') ?? 0) + 1);
      continue;
    }
    seenWords.add(key);
    const list = bySpeaker.get(c.speaker);
    if (list) list.push(c);
    else bySpeaker.set(c.speaker, [c]);
  }

  // Largest speaker pools first, so a round-robin pass fills evenly.
  const queues = [...bySpeaker.values()].sort((a, b) => b.length - a.length);
  const taken = new Map<string, number>();
  const out: T[] = [];

  let progress = true;
  while (out.length < target && progress) {
    progress = false;
    for (const queue of queues) {
      if (out.length >= target) break;
      // Take a whole block from one speaker at a time.
      //
      // Taking a *single* word per speaker per pass looks like better
      // diversity, and for single-word clips it was. For composite tiles it is
      // actively wrong: a tile needs `blockSize` words from one voice, so
      // spreading 108 words evenly over 40 speakers gives almost everyone two
      // words and almost nobody the three they need. That is precisely how a
      // corpus of 34,000 Russian recordings collapsed to five usable speakers.
      if (queue.length < blockSize) continue;
      const used = taken.get(queue[0].speaker) ?? 0;
      if (used + blockSize > maxPerSpeaker) {
        tally.set('speaker-quota', (tally.get('speaker-quota') ?? 0) + 1);
        continue;
      }
      const block = queue.splice(0, blockSize);
      taken.set(block[0].speaker, used + blockSize);
      out.push(...block);
      progress = true;
    }
  }
  return out;
}
