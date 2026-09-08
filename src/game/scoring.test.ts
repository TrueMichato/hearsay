import { describe, expect, it } from 'vitest';
import {
  DIFFICULTY_MULTIPLIER,
  POINTS_CORRECT,
  POINTS_WRONG,
  coinsFor,
  scoreRound,
} from './scoring';
import type { Assignment, BoardTile, Round } from './types';

/** Build a synthetic round so scoring tests do not depend on the manifest. */
function makeRound(difficulty: Round['difficulty'], languages: string[], counts: number[]): Round {
  const tiles: BoardTile[] = [];
  languages.forEach((language, li) => {
    for (let i = 0; i < counts[li]; i++) {
      tiles.push({
        id: `${language}-${i}`,
        language,
        word: `${language}${i}`,
        romanization: null,
        audio: `audio/${language}/${i}.opus`,
        duration: 1,
      });
    }
  });

  return {
    id: `test-${difficulty}`,
    seed: 'test',
    difficulty,
    languages,
    tiles,
    buckets:
      difficulty === 'hard'
        ? []
        : languages.map((language, i) => ({ id: `bucket-${i}`, language, label: language })),
    createdAt: 0,
  };
}

const perfect = (round: Round): Assignment =>
  Object.fromEntries(
    round.tiles.map((t) => [t.id, `bucket-${round.languages.indexOf(t.language)}`]),
  );

describe('scoreRound — easy and medium', () => {
  const round = makeRound('easy', ['spa', 'por', 'ita', 'pol'], [4, 4, 4, 4]);

  it('awards full marks for a perfect board', () => {
    const result = scoreRound(round, perfect(round));
    expect(result.correct).toBe(16);
    expect(result.wrong).toBe(0);
    expect(result.baseScore).toBe(16 * POINTS_CORRECT);
    expect(result.score).toBe(16 * POINTS_CORRECT * DIFFICULTY_MULTIPLIER.easy);
    expect(result.accuracy).toBe(1);
  });

  it('goes NEGATIVE when most tiles are placed wrongly', () => {
    // Shift every tile one bucket to the right: all 16 placed, all 16 wrong.
    const assignment: Assignment = Object.fromEntries(
      round.tiles.map((t) => [t.id, `bucket-${(round.languages.indexOf(t.language) + 1) % 4}`]),
    );
    const result = scoreRound(round, assignment);
    expect(result.correct).toBe(0);
    expect(result.wrong).toBe(16);
    expect(result.baseScore).toBe(-16 * POINTS_WRONG);
    expect(result.score).toBeLessThan(0);
    // A negative score must never mint currency.
    expect(result.coinsEarned).toBe(0);
  });

  it('mixes correct and wrong tiles arithmetically', () => {
    const assignment: Record<string, string> = { ...perfect(round) };
    assignment['spa-0'] = 'bucket-1';
    assignment['spa-1'] = 'bucket-2';
    const result = scoreRound(round, assignment);
    expect(result.correct).toBe(14);
    expect(result.wrong).toBe(2);
    expect(result.baseScore).toBe(14 * POINTS_CORRECT - 2 * POINTS_WRONG);
  });

  it('treats unassigned tiles as neither right nor wrong', () => {
    const assignment: Record<string, string> = { ...perfect(round) };
    delete (assignment as Record<string, string>)['ita-0'];
    delete (assignment as Record<string, string>)['ita-1'];
    const result = scoreRound(round, assignment);
    expect(result.unassigned).toBe(2);
    expect(result.correct).toBe(14);
    expect(result.wrong).toBe(0);
    expect(result.baseScore).toBe(14 * POINTS_CORRECT);
    // Accuracy is over placed tiles only, so caution is not punished.
    expect(result.accuracy).toBe(1);
  });

  it('applies the medium multiplier', () => {
    const mediumRound = makeRound('medium', ['rus', 'pol', 'ukr'], [6, 5, 5]);
    const result = scoreRound(mediumRound, perfect(mediumRound));
    expect(result.multiplier).toBe(DIFFICULTY_MULTIPLIER.medium);
    expect(result.score).toBe(Math.round(16 * POINTS_CORRECT * DIFFICULTY_MULTIPLIER.medium));
  });

  it('records confusions in the [heard][answered] direction', () => {
    const assignment: Record<string, string> = { ...perfect(round) };
    assignment['por-0'] = 'bucket-0'; // heard Portuguese, answered Spanish
    assignment['por-1'] = 'bucket-0';
    const result = scoreRound(round, assignment);
    expect(result.confusion.por.spa).toBe(2);
    expect(result.confusion.por.por).toBe(2);
    expect(result.confusion.spa.spa).toBe(4);
  });
});

describe('scoreRound — hard (pairwise agreement)', () => {
  const round = makeRound('hard', ['jpn', 'kor'], [8, 8]);

  const groupBy = (fn: (t: BoardTile) => string): Assignment =>
    Object.fromEntries(round.tiles.map((t) => [t.id, fn(t)]));

  it('awards a perfect score for a perfect partition regardless of group names', () => {
    const result = scoreRound(round, groupBy((t) => (t.language === 'jpn' ? 'g-zebra' : 'g-apple')));
    expect(result.baseScore).toBe(16 * POINTS_CORRECT);
    expect(result.score).toBe(Math.round(16 * POINTS_CORRECT * DIFFICULTY_MULTIPLIER.hard));
    expect(result.accuracy).toBe(1);
  });

  it('goes NEGATIVE when everything is lumped into one group', () => {
    // 120 pairs total; 56 same-language, 64 cross-language. All are "together",
    // so the cross-language pairs are all false merges.
    const result = scoreRound(round, groupBy(() => 'everything'));
    expect(result.baseScore).toBeLessThan(0);
    expect(result.score).toBeLessThan(0);
    expect(result.coinsEarned).toBe(0);
  });

  it('penalises splitting one language less than merging two', () => {
    // Split: Japanese correctly separated from Korean, but broken into halves.
    const split = scoreRound(
      round,
      groupBy((t) => (t.language === 'kor' ? 'k' : Number(t.id.split('-')[1]) < 4 ? 'j1' : 'j2')),
    );
    // Merge: half of Korean wrongly folded into the Japanese group.
    const merge = scoreRound(
      round,
      groupBy((t) =>
        t.language === 'jpn' || Number(t.id.split('-')[1]) < 4 ? 'a' : 'b',
      ),
    );
    expect(split.baseScore).toBeGreaterThan(merge.baseScore);
    expect(split.baseScore).toBeGreaterThan(0);
  });

  it('never rewards putting every tile in its own group', () => {
    // All 56 same-language pairs are split; nothing is merged. Should be firmly
    // negative, otherwise "refuse to group anything" would be a viable strategy.
    const result = scoreRound(round, groupBy((t) => t.id));
    expect(result.baseScore).toBeLessThan(0);
  });

  it('ignores unassigned tiles rather than counting them as errors', () => {
    const assignment = groupBy((t) => (t.language === 'jpn' ? 'a' : 'b'));
    const partial: Assignment = { ...assignment };
    delete (partial as Record<string, string>)['jpn-0'];
    const result = scoreRound(round, partial);
    expect(result.unassigned).toBe(1);
    expect(result.accuracy).toBe(1);
  });

  it('maps player groups onto languages so confusion data still works', () => {
    const assignment = groupBy((t) => (t.language === 'jpn' ? 'a' : 'b'));
    const strayed: Assignment = { ...assignment, 'kor-0': 'a' };
    const result = scoreRound(round, strayed);
    // Group 'a' is majority-Japanese, so the strayed Korean tile reads as
    // "heard Korean, answered Japanese".
    expect(result.confusion.kor.jpn).toBe(1);
    expect(result.groupMapping).toEqual({ a: 'jpn', b: 'kor' });
  });

  it('normalises across boards so a 5-language board is not worth less', () => {
    const two = makeRound('hard', ['jpn', 'kor'], [8, 8]);
    const five = makeRound('hard', ['spa', 'por', 'ita', 'rus', 'pol'], [4, 3, 3, 3, 3]);
    const scoreOf = (r: Round) =>
      scoreRound(
        r,
        Object.fromEntries(r.tiles.map((t) => [t.id, `g-${t.language}`])),
      ).score;
    expect(scoreOf(two)).toBe(scoreOf(five));
  });
});

describe('coinsFor', () => {
  it('never mints coins from a negative score', () => {
    expect(coinsFor(-500)).toBe(0);
    expect(coinsFor(0)).toBe(0);
    expect(coinsFor(1600)).toBe(64);
  });
});
