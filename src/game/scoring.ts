import { BOARD_SIZE, type Assignment, type Difficulty, type Round } from './types';

/**
 * Scoring.
 *
 * Easy and Medium score per tile: a tile in the right bucket is worth points, a
 * tile in the wrong bucket costs points. Leaving a tile unassigned is worth
 * nothing — neither rewarded nor punished, so a cautious player is not
 * penalised for admitting they do not know.
 *
 * Hard cannot work that way. The player never names a language, so "the right
 * bucket" has no meaning. Instead we score *pairwise agreement*: for every pair
 * of tiles, did the player make the same call the truth makes? Two tiles in the
 * same group should share a language; two tiles of the same language should not
 * be split apart. This needs no labels, degrades gracefully when the player
 * guesses the wrong number of groups, and still yields confusion data.
 */

/** Points for a tile placed in the bucket matching its language. */
export const POINTS_CORRECT = 100;
/** Points deducted for a tile placed in a bucket of a different language. */
export const POINTS_WRONG = 60;

/**
 * Weight of a "split" error in Hard relative to a "merge" error: putting two
 * same-language tiles in different groups is a milder mistake than declaring
 * two different-language tiles to be the same language.
 */
export const SPLIT_PENALTY_WEIGHT = 0.5;

/**
 * Difficulty multipliers, applied to the final score.
 * Harder modes give the player less information for the same task.
 */
export const DIFFICULTY_MULTIPLIER: Record<Difficulty, number> = {
  easy: 1,
  medium: 1.25,
  hard: 1.5,
};

/**
 * Score a Hard round is normalised against this ceiling so that a perfect Hard
 * board is worth roughly the same as a perfect Easy board before multipliers.
 */
const PERFECT_BASE = BOARD_SIZE * POINTS_CORRECT;

export interface RoundResult {
  score: number;
  /** Score before the difficulty multiplier. Useful for explaining the maths. */
  baseScore: number;
  multiplier: number;
  correct: number;
  wrong: number;
  unassigned: number;
  /** Fraction of *placed* tiles that were correct, in [0, 1]. */
  accuracy: number;
  /** In-game currency awarded. Never negative — a bad round costs no coins. */
  coinsEarned: number;
  /**
   * `confusion[trueLanguage][guessedLanguage] = count`.
   * The diagonal is correct answers; everything else is a mistake worth studying.
   */
  confusion: Record<string, Record<string, number>>;
  /** Per-language tallies for the stats screen. */
  perLanguage: Record<string, { correct: number; total: number }>;
  /** Hard mode only: how the player's groups mapped onto real languages. */
  groupMapping?: Record<string, string | null>;
}

/** Coins are a gentle function of score so clue-buying stays affordable. */
export function coinsFor(score: number): number {
  return Math.max(0, Math.round(score / 25));
}

function emptyConfusion(): Record<string, Record<string, number>> {
  return {};
}

function bump(matrix: Record<string, Record<string, number>>, actual: string, guess: string) {
  const row = (matrix[actual] ??= {});
  row[guess] = (row[guess] ?? 0) + 1;
}

/** Group tile ids by the bucket they were assigned to. */
function groupsOf(round: Round, assignment: Assignment): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const tile of round.tiles) {
    const bucket = assignment[tile.id];
    if (!bucket) continue;
    const list = groups.get(bucket);
    if (list) list.push(tile.id);
    else groups.set(bucket, [tile.id]);
  }
  return groups;
}

/** Easy / Medium: the bucket carries a ground-truth language, so compare directly. */
function scoreLabelled(round: Round, assignment: Assignment): RoundResult {
  const bucketLanguage = new Map(round.buckets.map((b) => [b.id, b.language]));
  const confusion = emptyConfusion();
  const perLanguage: RoundResult['perLanguage'] = {};

  let correct = 0;
  let wrong = 0;
  let unassigned = 0;

  for (const tile of round.tiles) {
    const stats = (perLanguage[tile.language] ??= { correct: 0, total: 0 });
    const bucket = assignment[tile.id];

    if (!bucket) {
      unassigned += 1;
      stats.total += 1;
      continue;
    }

    stats.total += 1;
    const guessed = bucketLanguage.get(bucket) ?? null;
    if (guessed === tile.language) {
      correct += 1;
      stats.correct += 1;
    } else {
      wrong += 1;
    }
    if (guessed) bump(confusion, tile.language, guessed);
  }

  const baseScore = correct * POINTS_CORRECT - wrong * POINTS_WRONG;
  const multiplier = DIFFICULTY_MULTIPLIER[round.difficulty];
  const score = Math.round(baseScore * multiplier);
  const placed = correct + wrong;

  return {
    score,
    baseScore,
    multiplier,
    correct,
    wrong,
    unassigned,
    accuracy: placed === 0 ? 0 : correct / placed,
    coinsEarned: coinsFor(score),
    confusion,
    perLanguage,
  };
}

/**
 * Hard: pairwise agreement.
 *
 * For every unordered pair of *placed* tiles we ask two yes/no questions —
 * "did the player put these together?" and "are they actually the same
 * language?" — and score the four combinations:
 *
 *   together + same language  -> reward       (a correct merge)
 *   together + different      -> full penalty (a false merge: the real error)
 *   apart    + same language  -> half penalty (a split: over-cautious, not wrong)
 *   apart    + different      -> nothing      (correct, but trivially so)
 *
 * The raw total is then normalised by the best score achievable on this exact
 * board, so a Hard board with five languages is not worth less than one with two.
 */
function scorePairwise(round: Round, assignment: Assignment): RoundResult {
  const placed = round.tiles.filter((t) => assignment[t.id]);
  const groups = groupsOf(round, assignment);
  const languageOf = new Map(round.tiles.map((t) => [t.id, t.language]));

  let togetherSame = 0;
  let togetherDifferent = 0;
  let apartSame = 0;
  let maxTogetherSame = 0;

  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i];
      const b = placed[j];
      const sameLanguage = a.language === b.language;
      const sameGroup = assignment[a.id] === assignment[b.id];

      if (sameLanguage) maxTogetherSame += 1;
      if (sameGroup && sameLanguage) togetherSame += 1;
      else if (sameGroup) togetherDifferent += 1;
      else if (sameLanguage) apartSame += 1;
    }
  }

  const raw = togetherSame - togetherDifferent - SPLIT_PENALTY_WEIGHT * apartSame;
  // A board where every placed tile is the only one of its language has no
  // same-language pairs at all; treat that as a neutral zero rather than /0.
  const baseScore = maxTogetherSame === 0 ? 0 : Math.round((raw / maxTogetherSame) * PERFECT_BASE);

  const multiplier = DIFFICULTY_MULTIPLIER.hard;
  const score = Math.round(baseScore * multiplier);

  // Map each player group onto the language that dominates it, so we can still
  // report per-language accuracy and populate the confusion matrix.
  const confusion = emptyConfusion();
  const perLanguage: RoundResult['perLanguage'] = {};
  const groupMapping: Record<string, string | null> = {};

  for (const [groupId, tileIds] of groups) {
    const counts = new Map<string, number>();
    for (const id of tileIds) {
      const lang = languageOf.get(id)!;
      counts.set(lang, (counts.get(lang) ?? 0) + 1);
    }
    const majority = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    groupMapping[groupId] = majority?.[0] ?? null;
  }

  // Two groups can share a majority language. The larger group keeps it; the
  // smaller is treated as an unidentified group so we don't double-count.
  const claimed = new Map<string, string>();
  for (const [groupId, lang] of Object.entries(groupMapping)) {
    if (!lang) continue;
    const incumbent = claimed.get(lang);
    const size = groups.get(groupId)?.length ?? 0;
    if (incumbent === undefined) {
      claimed.set(lang, groupId);
    } else if ((groups.get(incumbent)?.length ?? 0) < size) {
      groupMapping[incumbent] = null;
      claimed.set(lang, groupId);
    } else {
      groupMapping[groupId] = null;
    }
  }

  let correct = 0;
  let wrong = 0;
  let unassigned = 0;

  for (const tile of round.tiles) {
    const stats = (perLanguage[tile.language] ??= { correct: 0, total: 0 });
    stats.total += 1;
    const group = assignment[tile.id];
    if (!group) {
      unassigned += 1;
      continue;
    }
    const guessed = groupMapping[group] ?? null;
    if (guessed === tile.language) {
      correct += 1;
      stats.correct += 1;
    } else {
      wrong += 1;
    }
    if (guessed) bump(confusion, tile.language, guessed);
  }

  return {
    score,
    baseScore,
    multiplier,
    correct,
    wrong,
    unassigned,
    accuracy: correct + wrong === 0 ? 0 : correct / (correct + wrong),
    coinsEarned: coinsFor(score),
    confusion,
    perLanguage,
    groupMapping,
  };
}

/** Score a completed round. Dispatches on difficulty. */
export function scoreRound(round: Round, assignment: Assignment): RoundResult {
  return round.difficulty === 'hard' ? scorePairwise(round, assignment) : scoreLabelled(round, assignment);
}
