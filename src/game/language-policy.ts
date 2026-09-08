/**
 * Language-selection policy: *which* languages appear on a board.
 *
 * Deliberately separated from `board.ts`, which is about board *construction* —
 * how many tiles each language gets, how buckets are built, how the grid is
 * shuffled. Those are different concerns that change for different reasons, and
 * keeping the policy in its own module means tuning difficulty never touches
 * layout or interaction code.
 *
 * Two independent axes govern the choice, and conflating them caused a real
 * failure in play.
 *
 *  1. **Similarity** (`cluster`) — how easily two languages are mistaken for
 *     each other. Easy avoids confusable pairs; Hard seeks them out.
 *  2. **Familiarity** — whether a player can *name* the language at all.
 *
 * The second exists because the first is not sufficient. An Easy board of
 * Polish / Basque / Swedish satisfies the similarity rule perfectly — three
 * unrelated families — yet most players cannot name Basque, have never
 * knowingly heard it, and so have nothing to reason with. Being asked to
 * identify a language you did not know existed is not an easy question, however
 * acoustically distinct it is. Familiarity is an *additional* constraint, not a
 * replacement: Easy boards must satisfy both.
 */

import type { ContentManifest, Familiarity } from '../content/types';
import type { Rng } from './rng';
import type { Difficulty } from './types';

/**
 * How many languages appear on a board, by difficulty.
 *
 * Hard deliberately spans 2-5 and never tells the player the count: working out
 * *how many* distinct languages you are hearing is most of the challenge once
 * labelled buckets are gone.
 */
export const LANGUAGE_COUNT: Record<Difficulty, [min: number, max: number]> = {
  easy: [3, 4],
  medium: [3, 4],
  hard: [2, 5],
};

/**
 * Probability that a *Hard* board is drawn from a single confusable cluster
 * rather than from unrelated languages. High, because "Spanish vs Portuguese vs
 * Italian" is the game; "Japanese vs Polish" is a warm-up.
 *
 * Only Hard. Easy and Medium are governed by `SIMILARITY_POLICY`.
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
export const SIMILARITY_POLICY: Record<
  Difficulty,
  { maxPerCluster: number; clustersAtMax: number }
> = {
  easy: { maxPerCluster: 1, clustersAtMax: Number.POSITIVE_INFINITY },
  medium: { maxPerCluster: 2, clustersAtMax: 1 },
  hard: { maxPerCluster: Number.POSITIVE_INFINITY, clustersAtMax: Number.POSITIVE_INFINITY },
};

/**
 * Which familiarity tiers each difficulty may draw from.
 *
 * Ordered widest-last so the tiers can be relaxed progressively when a thin
 * corpus cannot satisfy the strictest setting.
 */
export const FAMILIARITY_POLICY: Record<Difficulty, Familiarity[]> = {
  easy: ['household'],
  medium: ['household', 'known'],
  hard: ['household', 'known', 'obscure'],
};

/** Widening order used when a tier restriction cannot be satisfied. */
const TIER_ORDER: Familiarity[] = ['household', 'known', 'obscure'];

/** Cluster id for a language, falling back to the language's own id. */
export function clusterOf(manifest: ContentManifest, language: string): string {
  return manifest.clusters.find((c) => c.languages.includes(language))?.id ?? `solo:${language}`;
}

/** Every language id that actually has clips in the manifest. */
function languagesWithClips(manifest: ContentManifest): string[] {
  const withClips = new Set(manifest.clips.map((c) => c.language));
  return manifest.languages.filter((l) => withClips.has(l.id)).map((l) => l.id);
}

/**
 * Restrict `languages` to a difficulty's allowed familiarity tiers.
 *
 * Widens one tier at a time if the restriction leaves too little to build a
 * board from. Degrading gracefully matters more than holding the line here: a
 * slightly-too-obscure Easy board is a worse game, but a crash is no game, and
 * the corpus is data that can change underneath this code.
 */
export function withinFamiliarity(
  manifest: ContentManifest,
  languages: string[],
  difficulty: Difficulty,
  needed: number,
): string[] {
  const tierOf = new Map(manifest.languages.map((l) => [l.id, l.familiarity]));
  const allowed = FAMILIARITY_POLICY[difficulty];

  for (let extra = 0; extra <= TIER_ORDER.length; extra += 1) {
    const tiers = new Set<Familiarity>([
      ...allowed,
      ...TIER_ORDER.slice(allowed.length, allowed.length + extra),
    ]);
    const filtered = languages.filter((id) => {
      const tier = tierOf.get(id);
      // A language with no tier recorded is treated as usable rather than
      // dropped, so an older manifest still produces a playable board.
      return tier === undefined || tiers.has(tier);
    });
    // Enough languages *and* enough distinct clusters to satisfy the
    // similarity rule, which for Easy needs one cluster per language.
    const clusters = new Set(filtered.map((id) => clusterOf(manifest, id)));
    const clustersNeeded =
      SIMILARITY_POLICY[difficulty].maxPerCluster === 1 ? needed : 1;
    if (filtered.length >= needed && clusters.size >= clustersNeeded) return filtered;
  }

  return languages;
}

/** Languages that actually have clips, grouped by similarity cluster. */
export function usableClusters(
  manifest: ContentManifest,
  usable: string[],
): Map<string, string[]> {
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
  const usable = withinFamiliarity(
    manifest,
    languagesWithClips(manifest),
    difficulty,
    LANGUAGE_COUNT[difficulty][1],
  );
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
 * Medium are drawn *across* clusters under `SIMILARITY_POLICY`, and restricted
 * to recognisable languages by `FAMILIARITY_POLICY`.
 */
export function chooseLanguages(
  manifest: ContentManifest,
  rng: Rng,
  count: number,
  difficulty: Difficulty,
): string[] {
  const all = languagesWithClips(manifest);

  if (all.length < count) {
    throw new Error(
      `Board needs ${count} languages but the manifest only has ${all.length} with clips. ` +
        `Run \`npm run content\` to populate src/content/manifest.json.`,
    );
  }

  const usable = withinFamiliarity(manifest, all, difficulty, count);
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
