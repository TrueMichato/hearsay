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
  };
}

/** Every reason a candidate can be rejected. Used to build the audit tally. */
export type RejectionReason =
  | 'unparseable-filename'
  | 'wrong-language'
  | 'multi-word'
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
const RE_DIGIT = /[0-9\u0660-\u0669]/;
const RE_WHITESPACE = /\s/;
const RE_HIRAGANA = /[\u3041-\u309F]/;
const RE_KATAKANA = /[\u30A0-\u30FF\uFF66-\uFF9F]/;
const RE_KANJI = /[\u4E00-\u9FFF\u3400-\u4DBF]/;
const RE_HANGUL = /[\uAC00-\uD7A3\u1100-\u11FF\u3130-\u318F]/;
const RE_CYRILLIC = /[\u0400-\u04FF]/;

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

  // Case-based proper-noun detection. Valid for our Latin- and Cyrillic-script
  // languages, where common nouns are lowercase. It would be WRONG for German,
  // which capitalises all nouns — hence keying off `script`, not a global rule,
  // and why adding German later needs a per-language override.
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
      const next = queue.shift();
      if (!next) continue;
      const used = taken.get(next.speaker) ?? 0;
      if (used >= maxPerSpeaker) {
        tally.set('speaker-quota', (tally.get('speaker-quota') ?? 0) + 1);
        continue;
      }
      taken.set(next.speaker, used + 1);
      out.push(next);
      progress = true;
    }
  }
  return out;
}
