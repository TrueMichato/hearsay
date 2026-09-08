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
 * Probability that a *Hard* board is drawn from a single confusable cluster
 * rather than from unrelated languages. High, because "Spanish vs Portuguese vs
 * Italian" is the game; "Japanese vs Polish" is a warm-up.
 *
 * Only Hard. Easy and Medium are governed by `SIMILARITY_POLICY` below.
 */
const CLUSTER_BIAS = 0.75;

/**
 * How much confusability each difficulty is allowed to serve.
 *
 * Difficulty used to control *scaffolding* only — whether buckets exist and
 * whether they are labelled — and left language choice to the same
 * cluster-biased draw at every level. The result was an Easy board of
 * Spanish / Portuguese / Catalan / Italian: the four hardest languages in the
 * corpus to tell apart, served with training wheels. Scaffolding is not
 * difficulty if the underlying task is impossible.
 *
 * `maxPerCluster` caps how many languages a single similarity cluster may
 * contribute; `clustersAtMax` caps how many clusters may hit that ceiling. So:
 *
 *   easy   — every language from a different cluster. No confusable pair at all.
 *   medium — at most one confusable pair, the rest unrelated.
 *   hard   — unconstrained, and actively biased *towards* a single cluster.
 *
 * This is expressed against cluster metadata rather than a hardcoded list of
 * language triples, so adding languages to `content.config.ts` keeps it correct.
 */
const SIMILARITY_POLICY: Record<Difficulty, { maxPerCluster: number; clustersAtMax: number }> = {
  easy: { maxPerCluster: 1, clustersAtMax: Number.POSITIVE_INFINITY },
  medium: { maxPerCluster: 2, clustersAtMax: 1 },
  hard: { maxPerCluster: Number.POSITIVE_INFINITY, clustersAtMax: Number.POSITIVE_INFINITY },
};

/** Group labels for Medium (anonymous buckets) and Hard (player-made groups). */
export const GROUP_LABELS = ['A', 'B', 'C', 'D', 'E'] as const;

/** Cluster id for a language, falling back to the language's own id. */
function clusterOf(manifest: ContentManifest, language: string): string {
  return manifest.clusters.find((c) => c.languages.includes(language))?.id ?? `solo:${language}`;
}

/** Languages that actually have clips, grouped by similarity cluster. */
function usableClusters(manifest: ContentManifest, usable: string[]): Map<string, string[]> {
  const byCluster = new Map<string, string[]>();
  for (const language of usable) {
    const id = clusterOf(manifest, language);
    const list = byCluster.get(id);
    if (list) list.push(language);
    else byCluster.set(id, [language]);
  }
  return byCluster;
}

/**
 * Maximum languages a difficulty can field, given the clusters available.
 *
 * Easy takes one language per cluster, so it can never exceed the cluster
 * count: three clusters means three buckets, however many languages exist. The
 * caller clamps to this rather than throwing, so a thin corpus yields a smaller
 * correct board instead of a crash — and `board.test.ts` asserts the shipped
 * manifest is rich enough that the clamp never actually bites.
 */
export function maxLanguagesFor(manifest: ContentManifest, difficulty: Difficulty): number {
  const withClips = new Set(manifest.clips.map((c) => c.language));
  const usable = manifest.languages.filter((l) => withClips.has(l.id)).map((l) => l.id);
  const clusters = usableClusters(manifest, usable);
  const { maxPerCluster, clustersAtMax } = SIMILARITY_POLICY[difficulty];

  if (maxPerCluster === Number.POSITIVE_INFINITY) return usable.length;

  // Every cluster may contribute `maxPerCluster - 1`; only `clustersAtMax` of
  // them may contribute the full `maxPerCluster`.
  let total = 0;
  let atMax = 0;
  for (const members of clusters.values()) {
    const base = Math.min(members.length, maxPerCluster - 1);
    total += base;
    if (members.length > base && atMax < clustersAtMax) {
      total += 1;
      atMax += 1;
    }
  }
  return total;
}

/**
 * Pick `count` languages obeying the difficulty's similarity policy.
 *
 * Greedy over shuffled clusters: take from a fresh cluster while any remain,
 * and only double up on a cluster once the policy's spare capacity allows it.
 * Returns fewer than `count` only when the corpus genuinely cannot supply more.
 */
function pickBySimilarity(
  byCluster: Map<string, string[]>,
  rng: Rng,
  count: number,
  policy: { maxPerCluster: number; clustersAtMax: number },
): string[] {
  const clusters = rng.shuffle([...byCluster.values()].map((m) => rng.shuffle(m)));
  const takenFrom = new Map<number, number>();
  const chosen: string[] = [];
  let clustersAtMax = 0;

  // Allowance rises one step at a time, so a second language is only ever drawn
  // from a cluster after every other cluster has contributed its first. Bounded
  // by `count` as well as by the policy, because no board can need more than
  // `count` languages from one cluster — without that, an unconstrained policy
  // whose target is unreachable would spin forever.
  const ceiling = Math.min(policy.maxPerCluster, count);
  for (let allowance = 1; allowance <= ceiling && chosen.length < count; allowance += 1) {
    for (const [i, members] of clusters.entries()) {
      if (chosen.length >= count) break;
      const taken = takenFrom.get(i) ?? 0;
      if (taken >= allowance || taken >= members.length) continue;
      if (taken + 1 === policy.maxPerCluster && policy.maxPerCluster > 1) {
        if (clustersAtMax >= policy.clustersAtMax) continue;
        clustersAtMax += 1;
      }
      chosen.push(members[taken]);
      takenFrom.set(i, taken + 1);
    }
  }

  return chosen;
}

/**
 * Choose which languages appear on a board.
 *
 * Hard is mostly drawn from a single cluster of confusable languages. Easy and
 * Medium are drawn *across* clusters, under `SIMILARITY_POLICY`.
 */
function chooseLanguages(
  manifest: ContentManifest,
  rng: Rng,
  count: number,
  difficulty: Difficulty,
): string[] {
  const withClips = new Set(manifest.clips.map((c) => c.language));
  const usable = manifest.languages.filter((l) => withClips.has(l.id)).map((l) => l.id);

  if (usable.length < count) {
    throw new Error(
      `Board needs ${count} languages but the manifest only has ${usable.length} with clips. ` +
        `Run \`npm run content\` to populate src/content/manifest.json.`,
    );
  }

  const byCluster = usableClusters(manifest, usable);
  const policy = SIMILARITY_POLICY[difficulty];

  if (difficulty !== 'hard') {
    return pickBySimilarity(byCluster, rng, count, policy);
  }

  if (rng.next() < CLUSTER_BIAS) {
    // Only consider clusters that can fill the board on their own. A cluster
    // smaller than `count` would force a mix of unrelated languages, quietly
    // turning a hard board into an easy one.
    const viable = [...byCluster.values()].filter((members) => members.length >= count);
    if (viable.length > 0) {
      return rng.shuffle(rng.pick(viable)).slice(0, count);
    }

    // No cluster is large enough (only happens on 5-language Hard boards).
    // Seed from the biggest cluster so the board is still cluster-dominated,
    // then top up rather than returning a smaller board.
    const largest = [...byCluster.values()].sort((a, b) => b.length - a.length)[0] ?? [];
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

  // Clamp to what the corpus and the difficulty's similarity policy can supply.
  // Easy takes one language per cluster, so a corpus with three clusters caps
  // Easy at three buckets no matter how many languages it holds.
  const available = Math.min(
    new Set(pool.clips.map((c) => c.language)).size,
    maxLanguagesFor(pool, difficulty),
  );
  const languages = chooseLanguages(pool, rng, Math.min(count, available), difficulty);
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
