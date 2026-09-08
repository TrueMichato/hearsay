import type { ClipMeta, ContentManifest } from '../content/types';
import { createRng, type Rng } from './rng';
// Language *selection* lives in its own module so that tuning difficulty never
// touches board construction. See `language-policy.ts` for why familiarity and
// similarity are separate axes.
import { chooseLanguages, LANGUAGE_COUNT, maxLanguagesFor } from './language-policy';
import { BOARD_SIZE, toClipTile, type Bucket, type Difficulty, type Round } from './types';

/** Minimum tiles per language, so no language is represented by a single clip. */
const MIN_TILES_PER_LANGUAGE = 2;

/** Group labels for Medium (anonymous buckets) and Hard (player-made groups). */
export const GROUP_LABELS = ['A', 'B', 'C', 'D', 'E'] as const;

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
