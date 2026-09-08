import type { ContentManifest } from './types';

/**
 * Shared "does this string give away the answer?" detector.
 *
 * Hearsay's whole premise is that a tile's language is unknown until the player
 * either works it out by ear or *buys* the reveal clue. That premise is only
 * real if the language is genuinely absent from the client: not in the DOM, not
 * in a URL, not in the network tab. It is easy to reintroduce a leak by
 * accident — a debugging `data-` attribute, a per-language asset directory, a
 * helpful `aria-label` — so the check lives here and is applied by both the
 * manifest gate and the browser gate rather than being written twice.
 *
 * This is **not** an attempt at secrecy. The manifest ships to the browser and
 * maps clip ids to languages; anyone willing to read it can. The bar is that
 * nothing casually spells out the answer to a player who merely opens devtools,
 * which is the difference between a game with a clue economy and a game with a
 * cheat sheet stapled to it.
 */

/**
 * Every string that would betray a language: its app id, its ISO 639-3 code,
 * its English name, its endonym, and its similarity cluster.
 *
 * Cluster ids are included because "east-asian" on a tile narrows sixteen
 * possibilities to two — a partial leak is still a leak.
 */
export function languageTokens(manifest: ContentManifest): string[] {
  const tokens = new Set<string>();
  for (const language of manifest.languages) {
    tokens.add(language.id);
    tokens.add(language.iso639_3);
    tokens.add(language.name);
    tokens.add(language.nativeName);
    tokens.add(language.cluster);
  }
  for (const cluster of manifest.clusters) {
    tokens.add(cluster.id);
    tokens.add(cluster.name);
  }
  return [...tokens].map((t) => t.toLowerCase()).filter(Boolean);
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Find the first language token present in `text` as a whole word.
 *
 * Whole-word matching is essential, not fussiness: a substring search for the
 * Catalan code `cat` matches the Tailwind class `duplicate` and the word
 * `indicator`, and a gate that cries wolf gets deleted. The boundaries are
 * Unicode letter/number classes so they behave for `español` and `русский` too.
 */
export function findLanguageLeak(text: string, tokens: string[]): string | null {
  const haystack = text.toLowerCase();
  for (const token of tokens) {
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(token)}(?![\\p{L}\\p{N}])`, 'u');
    if (re.test(haystack)) return token;
  }
  return null;
}
