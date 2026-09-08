import { describe, expect, it } from 'vitest';
import manifest from '../content/manifest.json';
import type { ContentManifest, Familiarity } from '../content/types';
import { createRng } from './rng';
import {
  chooseLanguages,
  clusterOf,
  FAMILIARITY_POLICY,
  LANGUAGE_COUNT,
  maxLanguagesFor,
  withinFamiliarity,
} from './language-policy';

/**
 * Language-selection policy gate.
 *
 * Two independent things can make a board unfair, and both have actually
 * happened in play:
 *
 *  1. **Too confusable.** An Easy board of Spanish / Portuguese / Catalan /
 *     Italian — the four hardest languages in the corpus to separate — served
 *     with labelled buckets. Scaffolding is not difficulty when the underlying
 *     task is impossible.
 *  2. **Too obscure.** An Easy board of Polish / Basque / Swedish. Three
 *     unrelated families, so perfectly legal under rule 1, yet most players
 *     cannot name Basque and so have nothing to reason with.
 *
 * These tests run against the *shipped* manifest rather than a fixture, because
 * the property that matters is that the real corpus produces fair boards. A
 * fixture would pass while the game stayed broken.
 */

const content = manifest as ContentManifest;

/** Every seed a player could plausibly hit, rather than one lucky draw. */
const SEEDS = Array.from({ length: 400 }, (_, i) => `seed-${i}`);

function tierOf(language: string): Familiarity | undefined {
  return content.languages.find((l) => l.id === language)?.familiarity;
}

describe('language policy: similarity', () => {
  it('never puts two same-cluster languages on an Easy board', () => {
    for (const seed of SEEDS) {
      const rng = createRng(`${seed}:easy`);
      const [, max] = LANGUAGE_COUNT.easy;
      const languages = chooseLanguages(content, rng, max, 'easy');
      const clusters = languages.map((l) => clusterOf(content, l));

      expect(
        new Set(clusters).size,
        `easy board ${languages.join('/')} repeats a cluster (${clusters.join('/')})`,
      ).toBe(languages.length);
    }
  });

  it('allows at most one confusable pair on a Medium board', () => {
    for (const seed of SEEDS) {
      const rng = createRng(`${seed}:medium`);
      const languages = chooseLanguages(content, rng, LANGUAGE_COUNT.medium[1], 'medium');
      const counts = new Map<string, number>();
      for (const l of languages) {
        const c = clusterOf(content, l);
        counts.set(c, (counts.get(c) ?? 0) + 1);
      }
      // No cluster may contribute more than two...
      for (const [cluster, n] of counts) {
        expect(n, `medium board took ${n} from ${cluster}`).toBeLessThanOrEqual(2);
      }
      // ...and only one cluster may contribute two.
      const doubled = [...counts.values()].filter((n) => n === 2).length;
      expect(doubled, `medium board ${languages.join('/')} has ${doubled} confusable pairs`)
        .toBeLessThanOrEqual(1);
    }
  });

  it('does draw same-cluster languages on Hard boards', () => {
    // The complement of the Easy rule. Without this, a policy that simply never
    // produced a confusable pair would pass the Easy test while destroying the
    // actual game — Hard exists precisely to serve the tight clusters.
    let sameCluster = 0;
    for (const seed of SEEDS) {
      const rng = createRng(`${seed}:hard`);
      const languages = chooseLanguages(content, rng, 4, 'hard');
      const clusters = languages.map((l) => clusterOf(content, l));
      if (new Set(clusters).size < languages.length) sameCluster += 1;
    }
    // CLUSTER_BIAS is 0.75, so the great majority should be cluster-drawn.
    expect(sameCluster / SEEDS.length).toBeGreaterThan(0.5);
  });
});

describe('language policy: familiarity', () => {
  it('only serves recognisable languages on an Easy board', () => {
    const allowed = new Set(FAMILIARITY_POLICY.easy);
    for (const seed of SEEDS) {
      const rng = createRng(`${seed}:easy`);
      const languages = chooseLanguages(content, rng, LANGUAGE_COUNT.easy[1], 'easy');
      for (const language of languages) {
        expect(
          allowed.has(tierOf(language)!),
          `easy board served ${language} (${tierOf(language)}), which players cannot name`,
        ).toBe(true);
      }
    }
  });

  it('keeps obscure languages out of Medium but allows them in Hard', () => {
    for (const seed of SEEDS) {
      const rng = createRng(`${seed}:medium`);
      const languages = chooseLanguages(content, rng, LANGUAGE_COUNT.medium[1], 'medium');
      for (const language of languages) {
        expect(tierOf(language), `medium served obscure ${language}`).not.toBe('obscure');
      }
    }

    let sawObscure = false;
    for (const seed of SEEDS) {
      const rng = createRng(`${seed}:hard`);
      const languages = chooseLanguages(content, rng, 4, 'hard');
      if (languages.some((l) => tierOf(l) === 'obscure')) sawObscure = true;
    }
    expect(sawObscure, 'hard never served an obscure language').toBe(true);
  });

  it('the shipped corpus is rich enough that Easy is never degraded', () => {
    // `withinFamiliarity` widens its tier restriction rather than crashing when
    // the corpus is too thin. That fallback is correct, but if it ever fires on
    // the real manifest then Easy is quietly serving obscure languages again.
    // This asserts the fallback stays dormant in production.
    const withClips = content.languages
      .filter((l) => content.clips.some((c) => c.language === l.id))
      .map((l) => l.id);
    const easy = withinFamiliarity(content, withClips, 'easy', LANGUAGE_COUNT.easy[1]);

    expect(easy.every((l) => tierOf(l) === 'household')).toBe(true);
    // Easy takes one language per cluster, so it needs at least as many
    // distinct clusters as it has buckets.
    const clusters = new Set(easy.map((l) => clusterOf(content, l)));
    expect(clusters.size).toBeGreaterThanOrEqual(LANGUAGE_COUNT.easy[1]);
    expect(maxLanguagesFor(content, 'easy')).toBeGreaterThanOrEqual(LANGUAGE_COUNT.easy[1]);
  });

  it('degrades gracefully rather than crashing on a corpus with no household languages', () => {
    const thin: ContentManifest = {
      ...content,
      languages: content.languages
        .filter((l) => ['cat', 'ces', 'eus'].includes(l.id))
        .map((l) => ({ ...l, familiarity: 'obscure' as const })),
      clips: content.clips.filter((c) => ['cat', 'ces', 'eus'].includes(c.language)),
    };
    const chosen = chooseLanguages(thin, createRng('thin:easy'), 3, 'easy');
    expect(chosen).toHaveLength(3);
  });

  it('returns a short Easy board rather than doubling up a cluster', () => {
    // The Easy guarantee must be *enforced*, not merely emergent.
    //
    // On the shipped corpus, household languages span more clusters than a
    // board has buckets, so the picker satisfies the board on its first pass
    // and never reaches the code that would double up. That makes the real
    // manifest unable to distinguish a policy of "one per cluster" from "two
    // per cluster" — relaxing the constant changed no observable behaviour.
    //
    // This fixture removes that cushion: four buckets, but only two clusters
    // to draw from. A policy that permits doubling fills the board with a
    // confusable pair; the correct policy returns a shorter board instead.
    // Serving three Romance languages on Easy is the exact bug this whole
    // dimension was introduced to prevent, so a short board is the better
    // failure.
    const twoClusters = ['spa', 'por', 'ita', 'rus', 'pol'];
    const scarce: ContentManifest = {
      ...content,
      languages: content.languages
        .filter((l) => twoClusters.includes(l.id))
        .map((l) => ({ ...l, familiarity: 'household' as const })),
      clips: content.clips.filter((c) => twoClusters.includes(c.language)),
    };

    const clusters = new Set(scarce.languages.map((l) => clusterOf(scarce, l.id)));
    expect(clusters.size, 'fixture must actually be cluster-scarce').toBeLessThan(4);

    for (const seed of SEEDS.slice(0, 100)) {
      const chosen = chooseLanguages(scarce, createRng(`${seed}:scarce`), 4, 'easy');
      const picked = chosen.map((l) => clusterOf(scarce, l));
      expect(
        new Set(picked).size,
        `easy board ${chosen.join('/')} doubled a cluster (${picked.join('/')})`,
      ).toBe(chosen.length);
    }
  });

  it('lets Hard use every usable language, unconstrained by cluster', () => {
    // `SIMILARITY_POLICY.hard` is easy to mistake for dead configuration,
    // because `chooseLanguages` short-circuits Hard through CLUSTER_BIAS and
    // never consults the picker. It is still live here, and this is the only
    // place that observes it: Hard must be able to field the whole corpus,
    // where Easy is capped at one language per cluster.
    const usable = content.languages.filter((l) =>
      content.clips.some((c) => c.language === l.id),
    ).length;

    expect(maxLanguagesFor(content, 'hard')).toBe(usable);
    expect(maxLanguagesFor(content, 'hard')).toBeGreaterThan(maxLanguagesFor(content, 'easy'));
  });
});
