import type { ClipMeta } from '../content/types';

/**
 * Difficulty is not just a score multiplier — it changes what the player is
 * asked to do:
 *
 *   easy   — buckets exist and are labelled with language names.
 *   medium — buckets exist but are anonymous ("Group A"). The player must still
 *            separate the languages, but gets no help naming them.
 *   hard   — no buckets at all. The player creates groups, and even the *number*
 *            of languages on the board is unknown (2-5).
 */
export type Difficulty = 'easy' | 'medium' | 'hard';

export const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];

/** Number of tiles on a board. Fixed at 16 for the 4x4 grid. */
export const BOARD_SIZE = 16;

/** One playable tile. Deliberately carries the answer — the UI must not show it. */
export interface BoardTile {
  /** Clip id; also the tile's DOM id and stats key. */
  id: string;
  /** Ground truth. Never rendered unless a clue has been purchased. */
  language: string;
  word: string;
  romanization: string | null;
  audio: string;
  duration: number;
}

export interface Bucket {
  id: string;
  /**
   * The language this bucket represents, or `null` for a player-created group
   * in Hard mode (which stands for no particular language until scored).
   */
  language: string | null;
  /** What the player sees: a language name, or "Group A". */
  label: string;
}

export interface Round {
  id: string;
  seed: string;
  difficulty: Difficulty;
  /** Languages actually present on the board. Ground truth; never rendered raw. */
  languages: string[];
  tiles: BoardTile[];
  buckets: Bucket[];
  createdAt: number;
}

/** Tile id -> bucket id. A tile absent from the map is unassigned. */
export type Assignment = Readonly<Record<string, string>>;

export function toClipTile(clip: ClipMeta): BoardTile {
  return {
    id: clip.id,
    language: clip.language,
    word: clip.word,
    romanization: clip.romanization,
    audio: clip.audio,
    duration: clip.duration,
  };
}
