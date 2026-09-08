/**
 * Opaque clip identifiers.
 *
 * The whole game rests on the language being hidden until the player pays to
 * reveal it. An id like `ita-0013` defeats that before a note is played: it
 * lands in the DOM as a test hook, in the audio URL, and in the network tab.
 * Anyone with devtools open reads every answer for free, and the clue economy
 * becomes decorative.
 *
 * So ids are a truncated SHA-256 of the clip's identity. Two properties matter:
 *
 *  - **Opaque.** Hex digits carry no signal. There is no ordering, no prefix
 *    and no length difference that separates Italian from Portuguese.
 *  - **Stable.** The hash is derived from content (language, word, speaker),
 *    not from position in a list. Re-running the pipeline reproduces the same
 *    ids, so audio filenames do not churn in git and IndexedDB rows keyed by
 *    clip id survive a corpus rebuild.
 *
 * This is deliberately *not* cryptographic secrecy. The manifest ships to the
 * browser and maps ids to languages, so a determined player can always read the
 * answers — as they could by decompiling any client-side game. The goal is that
 * nothing casually spells out the answer to someone who merely opens devtools.
 */

import { createHash } from 'node:crypto';

/** Length in hex characters. 12 hex = 48 bits; see the collision note below. */
export const CLIP_ID_LENGTH = 12;

export const CLIP_ID_PATTERN = /^[0-9a-f]{12}$/;

/**
 * Derive a clip's opaque id.
 *
 * Inputs are joined with NUL, which cannot occur in any of them, so
 * `("spa", "ab", "c")` and `("spa", "a", "bc")` cannot collide by concatenation.
 *
 * 48 bits gives a birthday-collision probability of roughly 1 in 500 million at
 * 1,000 clips and 1 in 5 million at 10,000 — far below the rate at which
 * Wikimedia itself changes underneath us. The pipeline still asserts uniqueness
 * rather than trusting the arithmetic.
 */
export function clipId(language: string, word: string, speaker: string): string {
  return createHash('sha256')
    .update(`${language}\u0000${word.normalize('NFC')}\u0000${speaker}`)
    .digest('hex')
    .slice(0, CLIP_ID_LENGTH);
}

/**
 * Audio path for a clip, relative to the site root.
 *
 * Flat, not bucketed by language — a `/audio/ita/` directory would leak exactly
 * what the opaque id was introduced to hide. Flat also means one directory, and
 * at a few thousand files that is comfortable for both git and every filesystem
 * we care about. Past roughly 10,000 clips, switch to bucketing on the first
 * two hex characters (`/audio/8f/8f3a….opus`); the prefix is uniform noise, so
 * it stays leak-free.
 */
export function clipAudioPath(id: string): string {
  return `audio/${id}.opus`;
}
