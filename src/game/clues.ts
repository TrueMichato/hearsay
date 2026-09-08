import type { Round } from './types';

/**
 * The clue shop.
 *
 * Tiles are audio-only on purpose. Showing the written word would let a player
 * identify a language by its orthography — "shch means Russian", "ç means
 * Portuguese" — without ever listening, which defeats the whole premise. So
 * text is not free: it is a purchase, paid for with coins earned by playing.
 *
 * Clues are defined declaratively in `CLUES` below. Adding a new one means
 * adding an entry and a branch in `applyClue` — no changes to the shop UI, the
 * economy, or persistence.
 */

export type ClueScope =
  /** Applies to one chosen tile; the player picks which. */
  | 'tile'
  /** Applies to the whole board at once. */
  | 'board';

export type ClueId =
  | 'revealWord'
  | 'revealRomanization'
  | 'revealTileLanguage'
  | 'colorCode'
  | 'revealLanguageCount';

export interface ClueDefinition {
  id: ClueId;
  name: string;
  description: string;
  /** Cost in coins. */
  cost: number;
  scope: ClueScope;
  /** Difficulties where this clue makes sense. */
  availableIn: Round['difficulty'][];
  /** Emoji used as the shop icon; keeps the prototype asset-free. */
  icon: string;
}

export const CLUES: ClueDefinition[] = [
  {
    id: 'revealWord',
    name: 'Show the writing',
    description: 'Reveal one tile’s word in its own script.',
    cost: 12,
    scope: 'tile',
    availableIn: ['easy', 'medium', 'hard'],
    icon: '✍️',
  },
  {
    id: 'revealRomanization',
    name: 'Show the romanisation',
    description: 'Reveal one tile’s word in the Latin alphabet, where one exists.',
    cost: 18,
    scope: 'tile',
    availableIn: ['easy', 'medium', 'hard'],
    icon: '🔤',
  },
  {
    id: 'revealTileLanguage',
    name: 'Name that language',
    description: 'Reveal which language one tile actually is. The expensive way out.',
    cost: 45,
    scope: 'tile',
    availableIn: ['easy', 'medium'],
    icon: '🎯',
  },
  {
    id: 'colorCode',
    name: 'Colour-code the board',
    description: 'Tiles sharing a language get a matching colour. Which language is still up to you.',
    cost: 80,
    scope: 'board',
    availableIn: ['easy', 'medium', 'hard'],
    icon: '🎨',
  },
  {
    id: 'revealLanguageCount',
    name: 'How many languages?',
    description: 'Reveal how many distinct languages are on the board.',
    cost: 30,
    scope: 'board',
    availableIn: ['hard'],
    icon: '🔢',
  },
];

export function clueById(id: ClueId): ClueDefinition {
  const clue = CLUES.find((c) => c.id === id);
  if (!clue) throw new Error(`Unknown clue: ${id}`);
  return clue;
}

/** Everything a purchased clue has unlocked in the current round. */
export interface ClueState {
  revealedWords: string[];
  revealedRomanizations: string[];
  revealedLanguages: string[];
  colorCoded: boolean;
  languageCountRevealed: boolean;
  /** Total coins spent this round, for the results screen. */
  spent: number;
  /** Purchase log, so stats can report which clues a player leans on. */
  purchases: { id: ClueId; tileId?: string; cost: number }[];
}

export function emptyClueState(): ClueState {
  return {
    revealedWords: [],
    revealedRomanizations: [],
    revealedLanguages: [],
    colorCoded: false,
    languageCountRevealed: false,
    spent: 0,
    purchases: [],
  };
}

export type PurchaseResult =
  | { ok: true; state: ClueState; coins: number }
  | { ok: false; reason: 'insufficient-coins' | 'already-owned' | 'needs-tile' | 'unavailable' };

/**
 * Attempt to buy a clue.
 *
 * Pure: returns the next state rather than mutating, so the caller decides when
 * to commit and the whole thing is trivially testable.
 */
export function purchaseClue(
  state: ClueState,
  coins: number,
  round: Round,
  id: ClueId,
  tileId?: string,
): PurchaseResult {
  const clue = clueById(id);

  if (!clue.availableIn.includes(round.difficulty)) return { ok: false, reason: 'unavailable' };
  if (clue.scope === 'tile' && !tileId) return { ok: false, reason: 'needs-tile' };
  if (coins < clue.cost) return { ok: false, reason: 'insufficient-coins' };

  const next: ClueState = {
    ...state,
    revealedWords: [...state.revealedWords],
    revealedRomanizations: [...state.revealedRomanizations],
    revealedLanguages: [...state.revealedLanguages],
    purchases: [...state.purchases],
  };

  switch (id) {
    case 'revealWord':
      if (next.revealedWords.includes(tileId!)) return { ok: false, reason: 'already-owned' };
      next.revealedWords.push(tileId!);
      break;
    case 'revealRomanization':
      if (next.revealedRomanizations.includes(tileId!)) return { ok: false, reason: 'already-owned' };
      next.revealedRomanizations.push(tileId!);
      break;
    case 'revealTileLanguage':
      if (next.revealedLanguages.includes(tileId!)) return { ok: false, reason: 'already-owned' };
      next.revealedLanguages.push(tileId!);
      break;
    case 'colorCode':
      if (next.colorCoded) return { ok: false, reason: 'already-owned' };
      next.colorCoded = true;
      break;
    case 'revealLanguageCount':
      if (next.languageCountRevealed) return { ok: false, reason: 'already-owned' };
      next.languageCountRevealed = true;
      break;
  }

  next.spent += clue.cost;
  next.purchases.push({ id, tileId, cost: clue.cost });

  return { ok: true, state: next, coins: coins - clue.cost };
}

/**
 * Stable colour index for the `colorCode` clue.
 *
 * Crucially this keys off the *position of the language in the board's shuffled
 * language list*, not the language's own identity colour. Colour-coding is meant
 * to tell you which tiles belong together, not which language they are — that
 * would make it a full answer key for a fraction of the price.
 */
export function colorGroupIndex(round: Round, language: string): number {
  const index = round.languages.indexOf(language);
  return index < 0 ? 0 : index;
}

/** Palette used by the colour-code clue. Deliberately not the language colours. */
export const CLUE_PALETTE = [
  '#e879f9',
  '#38bdf8',
  '#fbbf24',
  '#4ade80',
  '#fb7185',
] as const;
