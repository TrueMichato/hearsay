/**
 * Seeded pseudo-random number generation.
 *
 * `Math.random()` cannot be reproduced, which would mean a round can never be
 * replayed, shared, or asserted on in a test. Every random choice in board
 * generation therefore flows through a seeded generator: the same seed always
 * produces the same board, on any device.
 *
 * The algorithm is mulberry32 — small, fast, and statistically fine for
 * shuffling a 16-tile board. It is emphatically not cryptographic.
 */

export interface Rng {
  /** Float in [0, 1). */
  next(): number;
  /** Integer in [0, max). */
  int(max: number): number;
  /** Uniform pick. Throws on an empty array, which is always a caller bug. */
  pick<T>(items: readonly T[]): T;
  /** Fisher-Yates shuffle. Returns a new array; does not mutate the input. */
  shuffle<T>(items: readonly T[]): T[];
}

/** Turn an arbitrary string seed into a 32-bit integer (xmur3). */
function hashSeed(seed: string): number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

export function createRng(seed: string): Rng {
  let state = hashSeed(seed);

  const next = (): number => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const int = (max: number): number => Math.floor(next() * max);

  return {
    next,
    int,
    pick<T>(items: readonly T[]): T {
      if (items.length === 0) throw new Error('createRng().pick called with an empty array');
      return items[int(items.length)];
    },
    shuffle<T>(items: readonly T[]): T[] {
      const out = [...items];
      for (let i = out.length - 1; i > 0; i--) {
        const j = int(i + 1);
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
  };
}

/** A fresh, human-typable seed for a new round. */
export function randomSeed(): string {
  return Math.random().toString(36).slice(2, 10);
}
