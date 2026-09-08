import { describe, expect, it } from 'vitest';
import manifest from '../content/manifest.json';
import type { ContentManifest } from '../content/types';
import { generateRound, partitionTiles } from './board';
import { maxLanguagesFor } from './language-policy';
import { createRng } from './rng';
import { BOARD_SIZE, type Difficulty } from './types';

const content = manifest as ContentManifest;

/** Similarity cluster a language belongs to, per the shipped manifest. */
const clusterOf = (id: string) =>
  content.languages.find((l) => l.id === id)?.cluster ?? `solo:${id}`;

describe('createRng', () => {
  it('is deterministic for a given seed', () => {
    const a = createRng('seed-1');
    const b = createRng('seed-1');
    expect([a.next(), a.next(), a.next()]).toEqual([b.next(), b.next(), b.next()]);
  });

  it('produces different streams for different seeds', () => {
    expect(createRng('a').next()).not.toEqual(createRng('b').next());
  });

  it('shuffles without dropping or duplicating elements', () => {
    const input = Array.from({ length: 16 }, (_, i) => i);
    const out = createRng('shuffle').shuffle(input);
    expect(out).toHaveLength(16);
    expect([...out].sort((x, y) => x - y)).toEqual(input);
    expect(input).toEqual(Array.from({ length: 16 }, (_, i) => i)); // input untouched
  });
});

describe('partitionTiles', () => {
  it('always sums to the board size and never starves a language', () => {
    for (let parts = 2; parts <= 5; parts++) {
      for (let s = 0; s < 50; s++) {
        const counts = partitionTiles(BOARD_SIZE, parts, createRng(`p${parts}-${s}`));
        expect(counts).toHaveLength(parts);
        expect(counts.reduce((a, b) => a + b, 0)).toBe(BOARD_SIZE);
        expect(Math.min(...counts)).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('does not always split evenly, so tile counts are not a free clue', () => {
    const partitions = Array.from({ length: 30 }, (_, i) =>
      partitionTiles(BOARD_SIZE, 4, createRng(`even-${i}`)).join(','),
    );
    expect(new Set(partitions).size).toBeGreaterThan(1);
  });
});

describe('generateRound', () => {
  it('always produces a full 16-tile board at every difficulty', () => {
    for (const difficulty of ['easy', 'medium', 'hard'] as const) {
      for (let s = 0; s < 25; s++) {
        const round = generateRound(content, { difficulty, seed: `s${s}` });
        expect(round.tiles).toHaveLength(BOARD_SIZE);
        expect(new Set(round.tiles.map((t) => t.id)).size).toBe(BOARD_SIZE);
        // Every language claimed by the round is actually on the board, and
        // every language on the board was claimed. No phantom buckets.
        expect(new Set(round.tiles.map((t) => t.language))).toEqual(new Set(round.languages));
      }
    }
  });

  it('is deterministic: same seed and difficulty give the same board', () => {
    const a = generateRound(content, { difficulty: 'medium', seed: 'repeat' });
    const b = generateRound(content, { difficulty: 'medium', seed: 'repeat' });
    expect(a.tiles.map((t) => t.id)).toEqual(b.tiles.map((t) => t.id));
    expect(a.buckets).toEqual(b.buckets);
  });

  it('labels buckets with language names on easy and hides them on medium', () => {
    const easy = generateRound(content, { difficulty: 'easy', seed: 'labels' });
    const medium = generateRound(content, { difficulty: 'medium', seed: 'labels' });

    const names = new Set(content.languages.map((l) => l.name));
    expect(easy.buckets.every((b) => names.has(b.label))).toBe(true);
    expect(medium.buckets.every((b) => /^Group [A-E]$/.test(b.label))).toBe(true);
    // Medium must not leak the language through the label.
    expect(medium.buckets.some((b) => names.has(b.label))).toBe(false);
  });

  it('gives hard mode no buckets at all', () => {
    const hard = generateRound(content, { difficulty: 'hard', seed: 'hard' });
    expect(hard.buckets).toEqual([]);
  });

  it('keeps language counts inside the documented range for each difficulty', () => {
    for (let s = 0; s < 40; s++) {
      expect(generateRound(content, { difficulty: 'easy', seed: `c${s}` }).languages.length).toBeGreaterThanOrEqual(3);
      expect(generateRound(content, { difficulty: 'easy', seed: `c${s}` }).languages.length).toBeLessThanOrEqual(4);
      const hard = generateRound(content, { difficulty: 'hard', seed: `c${s}` }).languages.length;
      expect(hard).toBeGreaterThanOrEqual(2);
      expect(hard).toBeLessThanOrEqual(5);
    }
  });

  it('usually draws hard boards from a single confusable cluster', () => {
    // The premise of the game is telling *similar* languages apart, so most
    // Hard boards must be intra-cluster. This asserts the bias took effect.
    let intraCluster = 0;
    const samples = 60;
    for (let s = 0; s < samples; s++) {
      const round = generateRound(content, { difficulty: 'hard', seed: `cluster-${s}` });
      if (new Set(round.languages.map(clusterOf)).size === 1) intraCluster++;
    }
    expect(intraCluster / samples).toBeGreaterThan(0.5);
  });
});

/**
 * Difficulty must control how *confusable* the languages are, not just whether
 * buckets carry names. An Easy round of Spanish/Portuguese/Catalan/Italian is
 * harder than most Hard rounds, and scaffolding does not redeem it.
 */
describe('similarity policy', () => {
  const sample = (difficulty: Difficulty, samples = 120) =>
    Array.from({ length: samples }, (_, s) =>
      generateRound(content, { difficulty, seed: `sim-${difficulty}-${s}` }).languages,
    );

  /** How many languages the most-represented cluster contributed. */
  const worstClusterLoad = (languages: string[]) => {
    const counts = new Map<string, number>();
    for (const id of languages) {
      const c = clusterOf(id);
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    return Math.max(...counts.values());
  };

  it('never puts two same-cluster languages on an easy board', () => {
    for (const languages of sample('easy')) {
      expect({ languages, load: worstClusterLoad(languages) }).toMatchObject({ load: 1 });
    }
  });

  it('allows medium at most one confusable pair', () => {
    for (const languages of sample('medium')) {
      const counts = new Map<string, number>();
      for (const id of languages) {
        const c = clusterOf(id);
        counts.set(c, (counts.get(c) ?? 0) + 1);
      }
      const doubled = [...counts.values()].filter((n) => n > 1);
      expect({ languages, doubled }).toMatchObject({ doubled: expect.any(Array) });
      expect(doubled.length).toBeLessThanOrEqual(1);
      expect(Math.max(...counts.values())).toBeLessThanOrEqual(2);
    }
  });

  it('does lean into tight clusters on hard', () => {
    const leaning = sample('hard').filter((languages) => worstClusterLoad(languages) >= 2);
    expect(leaning.length / 120).toBeGreaterThan(0.5);
  });

  it('holds the policy even when the corpus forces clusters to double up', () => {
    // With fourteen languages across six clusters the greedy pass never has to
    // take a second language from any cluster, so the ceilings above are not
    // actually exercised by the shipped manifest — a mutation to them survives.
    // This narrows the corpus to two clusters so the policy has to bite.
    const ids = ['spa', 'por', 'ita', 'cat', 'rus', 'pol', 'ukr', 'ces'];
    const twoClusters: ContentManifest = {
      ...content,
      languages: content.languages.filter((l) => ids.includes(l.id)),
      clusters: content.clusters.filter((c) => ['romance', 'slavic'].includes(c.id)),
      clips: content.clips.filter((c) => ids.includes(c.language)),
    };

    for (let s = 0; s < 60; s++) {
      const easy = generateRound(twoClusters, { difficulty: 'easy', seed: `tight-${s}` });
      expect(easy.languages, 'easy must shrink rather than serve a confusable pair').toHaveLength(2);
      expect(new Set(easy.languages.map(clusterOf)).size).toBe(2);

      const medium = generateRound(twoClusters, { difficulty: 'medium', seed: `tight-${s}` });
      const counts = new Map<string, number>();
      for (const id of medium.languages) counts.set(clusterOf(id), (counts.get(clusterOf(id)) ?? 0) + 1);
      expect([...counts.values()].filter((n) => n > 1).length).toBe(1);
      expect(medium.languages).toHaveLength(3);
    }
  });

  it('still gives easy the full 3-4 buckets the design promises', () => {
    // Easy takes one language per cluster, so the corpus must carry at least 4
    // clusters or Easy silently degrades to 3 buckets forever. This is the
    // guard on `maxLanguagesFor`'s clamp: if it ever bites, this fails first.
    expect(maxLanguagesFor(content, 'easy')).toBeGreaterThanOrEqual(4);
    const sizes = new Set(sample('easy').map((l) => l.length));
    expect([...sizes].sort()).toEqual([3, 4]);
  });

  it('reports a smaller ceiling when the corpus has too few clusters', () => {
    // A thin corpus must degrade to a smaller *correct* board, not crash and
    // not quietly serve confusable languages under an Easy label.
    const thin: ContentManifest = {
      ...content,
      languages: content.languages.filter((l) => ['spa', 'por', 'ita'].includes(l.id)),
      clips: content.clips.filter((c) => ['spa', 'por', 'ita'].includes(c.language)),
    };
    expect(maxLanguagesFor(thin, 'easy')).toBe(1);
    expect(maxLanguagesFor(thin, 'medium')).toBe(2);
    expect(maxLanguagesFor(thin, 'hard')).toBe(3);
    expect(generateRound(thin, { difficulty: 'medium', seed: 'thin' }).languages).toHaveLength(2);
  });
});
