import type { ClipMeta, ContentManifest } from '../content/types';
import { createRng, type Rng } from './rng';
import { BOARD_SIZE, toClipTile, type Bucket, type Difficulty, type Round } from './types';

/**
 * How many languages appear on a board, by difficulty.
 *
 * Hard deliberately spans 2-5 and never tells the player the count: working out
 * *how many* distinct languages you are hearing is most of the challenge once
 * labelled buckets are gone.
 */
const LANGUAGE_COUNT: Record<Difficulty, [min: number, max: number]> = {
  easy: [3, 4],
  medium: [3, 4],
  hard: [2, 5],
};

/** Minimum tiles per language, so no language is represented by a single clip. */
const MIN_TILES_PER_LANGUAGE = 2;

/**
 * Probability that a board is drawn from a single confusable cluster rather
 * than from unrelated languages. High, because "Spanish vs Portuguese vs
 * Italian" is the game; "Japanese vs Polish" is a warm-up.
 */
const CLUSTER_BIAS = 0.75;

/** Group labels for Medium (anonymous buckets) and Hard (player-made groups). */
export const GROUP_LABELS = ['A', 'B', 'C', 'D', 'E'] as const;

/**
 * Choose which languages appear on a board.
 *
 * Mostly drawn from a single cluster of confusable languages. When the chosen
 * cluster is smaller than the required count (East Asian has only two members),
 * we top up from the nearest available languages rather than silently returning
 * a smaller board.
 */
function chooseLanguages(manifest: ContentManifest, rng: Rng, count: number): string[] {
  const withClips = new Set(manifest.clips.map((c) => c.language));
  const usable = manifest.languages.filter((l) => withClips.has(l.id)).map((l) => l.id);

  if (usable.length < count) {
    throw new Error(
      `Board needs ${count} languages but the manifest only has ${usable.length} with clips. ` +
        `Run \`npm run content\` to populate src/content/manifest.json.`,
    );
  }

  if (rng.next() < CLUSTER_BIAS) {
    // Only consider clusters that can fill the board on their own. A cluster
    // smaller than `count` would force a mix of unrelated languages, quietly
    // turning a hard board into an easy one.
    const viable = manifest.clusters.filter(
      (c) => c.languages.filter((id) => usable.includes(id)).length >= count,
    );
    if (viable.length > 0) {
      const cluster = rng.pick(viable);
      const members = cluster.languages.filter((id) => usable.includes(id));
      return rng.shuffle(members).slice(0, count);
    }

    // No cluster is large enough (only happens on 5-language Hard boards).
    // Seed from the biggest cluster so the board is still cluster-dominated,
    // then top up rather than returning a smaller board.
    const largest = [...manifest.clusters]
      .map((c) => c.languages.filter((id) => usable.includes(id)))
      .sort((a, b) => b.length - a.length)[0] ?? [];
    const chosen = rng.shuffle(largest).slice(0, count);
    const rest = rng.shuffle(usable.filter((id) => !chosen.includes(id)));
    return [...chosen, ...rest].slice(0, count);
  }

  return rng.shuffle(usable).slice(0, count);
}

/**
 * Split `total` tiles across `parts` languages, unevenly.
 *
 * An even split would be a free clue: on a 4-language board, a player who found
 * three groups of four would know the rest without listening. Random-but-bounded
 * counts remove that deduction while guaranteeing every language is audible
 * more than once.
 */
export function partitionTiles(total: number, parts: number, rng: Rng): number[] {
  if (parts * MIN_TILES_PER_LANGUAGE > total) {
    throw new Error(`Cannot place ${parts} languages on ${total} tiles`);
  }
  const counts = new Array<number>(parts).fill(MIN_TILES_PER_LANGUAGE);
  let remaining = total - parts * MIN_TILES_PER_LANGUAGE;
  while (remaining > 0) {
    counts[rng.int(parts)] += 1;
    remaining -= 1;
  }
  return counts;
}

function buildBuckets(difficulty: Difficulty, languages: string[], manifest: ContentManifest, rng: Rng): Bucket[] {
  if (difficulty === 'hard') return []; // the player creates their own groups

  // Bucket order is shuffled independently of tile order so that bucket
  // position leaks nothing about which language is most common on the board.
  const shuffled = rng.shuffle(languages);

  return shuffled.map((id, i) => {
    const meta = manifest.languages.find((l) => l.id === id);
    return {
      id: `bucket-${i}`,
      language: id,
      label: difficulty === 'easy' ? (meta?.name ?? id) : `Group ${GROUP_LABELS[i]}`,
    };
  });
}

export interface GenerateRoundOptions {
  difficulty: Difficulty;
  seed: string;
  /** Restrict the board to these languages. Used by practice mode. */
  languageFilter?: string[];
}

/**
 * Build a complete, deterministic round.
 *
 * Deterministic means: same manifest + same seed + same difficulty => byte-identical
 * board. That is what makes rounds shareable and makes the scoring tests stable.
 */
export function generateRound(manifest: ContentManifest, options: GenerateRoundOptions): Round {
  const { difficulty, seed, languageFilter } = options;
  const rng = createRng(`${seed}:${difficulty}`);

  const [min, max] = LANGUAGE_COUNT[difficulty];
  const count = min + rng.int(max - min + 1);

  const pool: ContentManifest = languageFilter?.length
    ? { ...manifest, clips: manifest.clips.filter((c) => languageFilter.includes(c.language)) }
    : manifest;

  const languages = chooseLanguages(pool, rng, Math.min(count, new Set(pool.clips.map((c) => c.language)).size));
  const counts = partitionTiles(BOARD_SIZE, languages.length, rng);

  const byLanguage = new Map<string, ClipMeta[]>();
  for (const clip of pool.clips) {
    const list = byLanguage.get(clip.language);
    if (list) list.push(clip);
    else byLanguage.set(clip.language, [clip]);
  }

  const tiles = languages.flatMap((language, i) => {
    const available = byLanguage.get(language) ?? [];
    if (available.length < counts[i]) {
      throw new Error(`Language ${language} has ${available.length} clips, need ${counts[i]}`);
    }
    // Prefer clips from different speakers within a single language, so a player
    // cannot shortcut by matching timbre instead of phonology.
    const shuffled = rng.shuffle(available);
    const picked: ClipMeta[] = [];
    const usedSpeakers = new Set<string>();
    for (const clip of shuffled) {
      if (picked.length >= counts[i]) break;
      if (usedSpeakers.has(clip.speaker) && usedSpeakers.size < new Set(available.map((c) => c.speaker)).size) {
        continue;
      }
      picked.push(clip);
      usedSpeakers.add(clip.speaker);
    }
    for (const clip of shuffled) {
      if (picked.length >= counts[i]) break;
      if (!picked.includes(clip)) picked.push(clip);
    }
    return picked.map(toClipTile);
  });

  return {
    id: `${seed}-${difficulty}`,
    seed,
    difficulty,
    languages,
    tiles: rng.shuffle(tiles),
    buckets: buildBuckets(difficulty, languages, manifest, rng),
    createdAt: Date.now(),
  };
}
