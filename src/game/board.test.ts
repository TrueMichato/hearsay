import { describe, expect, it } from 'vitest';
import manifest from '../content/manifest.json';
import type { ContentManifest } from '../content/types';
import { generateRound, partitionTiles } from './board';
import { createRng } from './rng';
import { BOARD_SIZE } from './types';

const content = manifest as ContentManifest;

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

  it('usually draws from a single confusable cluster', () => {
    // The premise of the game is telling *similar* languages apart, so most
    // boards must be intra-cluster. This asserts the bias actually took effect.
    let intraCluster = 0;
    const samples = 60;
    for (let s = 0; s < samples; s++) {
      const round = generateRound(content, { difficulty: 'easy', seed: `cluster-${s}` });
      const clusters = new Set(
        round.languages.map((id) => content.languages.find((l) => l.id === id)?.cluster),
      );
      if (clusters.size === 1) intraCluster++;
    }
    expect(intraCluster / samples).toBeGreaterThan(0.5);
  });
});
