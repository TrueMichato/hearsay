import { db, type RoundRecord } from './database';
import type { LanguageMeta } from '../content/types';

/**
 * Derived statistics.
 *
 * Nothing here is stored — every function reads the append-only round log and
 * the aggregate tables and computes a view. Keeping derivation separate from
 * storage means a bug in a chart can never corrupt a player's history.
 */

export interface ConfusionCell {
  actual: string;
  guessed: string;
  count: number;
  /** `count` as a fraction of everything the player heard as `actual`. */
  rate: number;
}

export interface ConfusionMatrix {
  languages: string[];
  cells: ConfusionCell[];
  /** Row totals: how many times each language was heard and answered. */
  totals: Record<string, number>;
  /** The most-confused ordered pairs, worst first, excluding the diagonal. */
  worstPairs: ConfusionCell[];
}

/**
 * Build the confusion matrix.
 *
 * A confusion matrix answers the question that plain accuracy cannot: *what*
 * are you getting wrong? Knowing you score 60% on Portuguese is much less
 * useful than knowing that when you hear Portuguese you say "Spanish" a third
 * of the time. Rows are the truth, columns are the answer; the diagonal is
 * where you were right.
 */
export async function buildConfusionMatrix(known: LanguageMeta[]): Promise<ConfusionMatrix> {
  const records = await db.confusions.toArray();

  const totals: Record<string, number> = {};
  for (const r of records) totals[r.actual] = (totals[r.actual] ?? 0) + r.count;

  const seen = new Set<string>();
  for (const r of records) {
    seen.add(r.actual);
    seen.add(r.guessed);
  }
  // Preserve manifest ordering so clusters stay adjacent and the matrix reads well.
  const languages = known.map((l) => l.id).filter((id) => seen.has(id));

  const cells: ConfusionCell[] = records.map((r) => ({
    actual: r.actual,
    guessed: r.guessed,
    count: r.count,
    rate: totals[r.actual] ? r.count / totals[r.actual] : 0,
  }));

  const worstPairs = cells
    .filter((c) => c.actual !== c.guessed && c.count > 0)
    .sort((a, b) => b.rate - a.rate || b.count - a.count)
    .slice(0, 5);

  return { languages, cells, totals, worstPairs };
}

export interface LanguageAccuracy {
  language: string;
  correct: number;
  total: number;
  accuracy: number;
}

export async function languageAccuracies(): Promise<LanguageAccuracy[]> {
  const rows = await db.languageStats.toArray();
  return rows
    .map((r) => ({
      language: r.language,
      correct: r.correct,
      total: r.total,
      accuracy: r.total ? r.correct / r.total : 0,
    }))
    .sort((a, b) => b.accuracy - a.accuracy);
}

export interface ProgressPoint {
  playedAt: number;
  accuracy: number;
  score: number;
  /** Mean accuracy over this point and the four before it. */
  rollingAccuracy: number;
}

/**
 * Accuracy over time, smoothed with a 5-round rolling mean.
 *
 * Raw per-round accuracy is far too noisy to show improvement: a single unlucky
 * board swings it wildly. The rolling mean is what actually makes a trend legible.
 */
export async function progressOverTime(limit = 50): Promise<ProgressPoint[]> {
  const rounds = await db.rounds.orderBy('playedAt').reverse().limit(limit).toArray();
  const ordered = rounds.reverse();

  const window = 5;
  return ordered.map((r, i) => {
    const slice = ordered.slice(Math.max(0, i - window + 1), i + 1);
    return {
      playedAt: r.playedAt,
      accuracy: r.accuracy,
      score: r.score,
      rollingAccuracy: slice.reduce((s, x) => s + x.accuracy, 0) / slice.length,
    };
  });
}

export interface DifficultyBreakdown {
  difficulty: RoundRecord['difficulty'];
  rounds: number;
  meanScore: number;
  meanAccuracy: number;
  bestScore: number;
}

export async function difficultyBreakdown(): Promise<DifficultyBreakdown[]> {
  const rounds = await db.rounds.toArray();
  const byDifficulty = new Map<RoundRecord['difficulty'], RoundRecord[]>();

  for (const r of rounds) {
    const list = byDifficulty.get(r.difficulty);
    if (list) list.push(r);
    else byDifficulty.set(r.difficulty, [r]);
  }

  return (['easy', 'medium', 'hard'] as const)
    .map((difficulty) => {
      const list = byDifficulty.get(difficulty) ?? [];
      return {
        difficulty,
        rounds: list.length,
        meanScore: list.length ? list.reduce((s, r) => s + r.score, 0) / list.length : 0,
        meanAccuracy: list.length ? list.reduce((s, r) => s + r.accuracy, 0) / list.length : 0,
        bestScore: list.length ? Math.max(...list.map((r) => r.score)) : 0,
      };
    })
    .filter((d) => d.rounds > 0);
}

export async function recentRounds(limit = 10): Promise<RoundRecord[]> {
  return db.rounds.orderBy('playedAt').reverse().limit(limit).toArray();
}

export async function clueUsage() {
  return (await db.clueUsage.toArray()).sort((a, b) => b.timesBought - a.timesBought);
}
