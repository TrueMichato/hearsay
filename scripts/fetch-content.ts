/**
 * Hearsay content pipeline.
 *
 *   node --experimental-strip-types scripts/fetch-content.ts
 *   npm run content
 *
 * Fetches Lingua Libre recordings from Wikimedia Commons, curates the word
 * list, transcodes audio to Opus, and emits a typed manifest.
 *
 * Design notes:
 *  - **Resumable.** API responses cache to `.cache/wikimedia`, source WAVs to
 *    `.cache/audio`, and finished Opus files are skipped if present. A rerun
 *    after a network failure costs almost nothing.
 *  - **Polite.** Requests are serialised with a delay and send `maxlag=5`.
 *  - **Auditable.** Every run prints how many candidates were rejected and why.
 *    A filter nobody can see is a filter nobody can check.
 */

import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { ClipMeta, ContentManifest, LanguageMeta } from '../src/content/types.ts';
import {
  CANDIDATE_POOL_SIZE,
  CLUSTERS,
  LANGUAGES,
  MAX_DURATION_S,
  MAX_SPEAKER_SHARE,
  MIN_DURATION_S,
  MIN_TILE_DURATION_S,
  MIN_SPEAKERS_PER_LANGUAGE,
  ABSOLUTE_MIN_SPEAKERS,
  MIN_WORDS_PER_SPEAKER,
  OPUS_BITRATE,
  SCHEMA_VERSION,
  TILE_GAP_S,
  TILES_PER_LANGUAGE,
  WORDS_PER_LANGUAGE,
  WORDS_PER_TILE,
} from './content.config.ts';
import {
  categoryFileCount,
  downloadFile,
  fetchFileInfo,
  listCategoryFiles,
} from './lib/wikimedia.ts';
import {
  curateWord,
  estimateSyllables,
  parseFilename,
  refineWord,
  selectWithSpeakerDiversity,
  type RejectionReason,
} from './lib/curate.ts';
import { clipAudioPath, clipId } from './lib/clip-id.ts';
import { romanize } from './lib/romanize.ts';
import {
  assembleUtterance,
  prepareWord,
  probeDuration,
  resolveFfmpeg,
} from './lib/transcode.ts';

/** One fetched, curated and level-normalised source word, ready for assembly. */
interface PreparedWord {
  word: string;
  romanization: string | null;
  speaker: string;
  license: string;
  licenseUrl: string | null;
  sourceUrl: string;
  duration: number;
  /** Path to the normalised intermediate WAV in `.cache/`. */
  path: string;
  /** Approximate syllable count, used to prefer longer words. */
  syllables: number;
}

/**
 * Licence restrictiveness, least to most.
 *
 * A tile is a derivative of every word in it, so it can only be offered under
 * terms that satisfy all of them: mixing a CC0 word with a CC BY-SA word yields
 * a CC BY-SA tile. Anything not recognised sorts last, so an unfamiliar licence
 * is treated as the most restrictive rather than silently assumed permissive.
 */
const LICENSE_ORDER = ['CC0', 'CC BY 4.0', 'CC BY-SA 4.0'];

function mostRestrictiveLicense(licenses: string[]): string {
  const rank = (l: string) => {
    const i = LICENSE_ORDER.indexOf(l);
    return i === -1 ? LICENSE_ORDER.length : i;
  };
  return [...licenses].sort((a, b) => rank(b) - rank(a))[0];
}

/** The deed URL belonging to whichever source carries the effective licence. */
function licenseUrlFor(license: string, sources: PreparedWord[]): string | null {
  return sources.find((s) => s.license === license)?.licenseUrl ?? null;
}

const ROOT = process.cwd();
const AUDIO_CACHE = join(ROOT, '.cache', 'audio');
const AUDIO_OUT = join(ROOT, 'public', 'audio');
const MANIFEST_OUT = join(ROOT, 'src', 'content', 'manifest.json');
const ATTRIBUTION_OUT = join(ROOT, 'ATTRIBUTION.md');

const MAX_TILES_PER_SPEAKER = Math.max(1, Math.round(TILES_PER_LANGUAGE * MAX_SPEAKER_SHARE));

interface Candidate {
  title: string;
  speaker: string;
  word: string;
  /** Whole `speaker-word` segment; re-split by `refineWord` once Artist is known. */
  rest: string;
}

/**
 * Extract the speaker's display name from the HTML Commons puts in `Artist`.
 * The field reads `Speaker: <name> Recorder: <name> Language: <name>` once the
 * markup is stripped, so we must stop at the first following label.
 */
function speakerFromArtist(artistRaw: string, fallback: string): string {
  const m = /Speaker:\s*(.+?)(?:\s+(?:Recorder|Recorded|Language|Licence|License)\b|$)/i.exec(artistRaw);
  const name = (m?.[1] ?? '').trim();
  return name || fallback;
}

/**
 * Filesystem-safe cache key for a Commons title.
 *
 * Titles contain spaces, parentheses, apostrophes and arbitrary non-Latin
 * script, none of which travel well across filesystems. A readable prefix keeps
 * the cache browsable; the hash suffix keeps it collision-free.
 */
function sourceCacheKey(title: string): string {
  const slug = title.replace(/^File:/, '').replace(/[^A-Za-z0-9]+/g, '-').slice(0, 48);
  return `${slug}-${createHash('sha1').update(title).digest('hex').slice(0, 10)}`;
}

function printTally(tally: Map<RejectionReason, number>, kept: number) {
  const rejected = [...tally.entries()].sort((a, b) => b[1] - a[1]);
  const total = rejected.reduce((s, [, n]) => s + n, 0);
  console.log(`  curation: kept ${kept}, rejected ${total}`);
  for (const [reason, n] of rejected) {
    console.log(`    - ${reason.padEnd(28)} ${n}`);
  }
}

async function processLanguage(lang: LanguageMeta): Promise<ClipMeta[]> {
  console.log(`\n=== ${lang.name} (${lang.iso639_3}) ===`);

  const available = await categoryFileCount(lang.iso639_3);
  console.log(`  Commons category holds ${available} recordings`);
  if (available === 0) {
    throw new Error(
      `Category:Lingua Libre pronunciation-${lang.iso639_3} reports 0 files. ` +
        `If you expected recordings, check the User-Agent header first — Commons ` +
        `answers UA-less requests with an empty body that looks identical to this.`,
    );
  }

  const members = await listCategoryFiles(lang.iso639_3, Math.min(CANDIDATE_POOL_SIZE, available));
  console.log(`  enumerated ${members.length} candidates`);

  const tally = new Map<RejectionReason, number>();
  const bump = (r: RejectionReason) => tally.set(r, (tally.get(r) ?? 0) + 1);

  const candidates: Candidate[] = [];
  for (const member of members) {
    const parsed = parseFilename(member.title);
    if (!parsed) {
      bump('unparseable-filename');
      continue;
    }
    if (parsed.iso !== lang.iso639_3) {
      bump('wrong-language');
      continue;
    }
    const verdict = curateWord(parsed.word, lang.script);
    if (!verdict.ok) {
      bump(verdict.reason!);
      continue;
    }
    candidates.push({ title: member.title, speaker: parsed.speaker, word: parsed.word, rest: parsed.rest });
  }

  // What the corpus can actually deliver, measured rather than assumed.
  //
  // The speaker floor is a target — "10 where the corpus allows". Whether the
  // corpus allows it is a fact about Lingua Libre, not a knob: it is volunteer
  // recorded, and several languages were contributed by a handful of people.
  // Counting distinct speakers who have at least a tile's worth of *curated*
  // words gives the real ceiling, and it is often far below the raw speaker
  // count because curation is what removes voices, not selection. German has 84
  // contributors in the category but only 31 survive curation, because German
  // capitalises every noun and the proper-noun filter is necessarily blunt.
  //
  // Comparing against this ceiling rather than a hardcoded per-language table
  // keeps the gate honest in both directions: it cannot demand the impossible,
  // and it still fires if selection ever stops using a roster that *is*
  // available — which is the regression actually worth catching. It also scales
  // to new languages with no table to maintain.
  // Counted with the same global word de-duplication that selection applies,
  // otherwise the estimate is optimistic: two speakers who both recorded the
  // same common word do not both get to use it, so a naive per-speaker count
  // credits a voice that selection will find has nothing left. That produced a
  // consistent off-by-one against this gate on four languages.
  const wordsPerCandidateSpeaker = new Map<string, Set<string>>();
  const seenAcrossSpeakers = new Set<string>();
  for (const c of candidates) {
    const word = c.word.toLowerCase();
    if (seenAcrossSpeakers.has(word)) continue;
    seenAcrossSpeakers.add(word);
    const set = wordsPerCandidateSpeaker.get(c.speaker) ?? new Set<string>();
    set.add(word);
    wordsPerCandidateSpeaker.set(c.speaker, set);
  }
  const achievableSpeakers = [...wordsPerCandidateSpeaker.values()].filter(
    (s) => s.size >= WORDS_PER_TILE,
  ).length;

  // Over-select heavily. Every tile needs WORDS_PER_TILE words from a *single*
  // speaker, so losses are far more expensive than before: a speaker who ends
  // up one word short of a multiple of three wastes the remainder entirely.
  // Selection now works in whole tiles' worth of words per speaker, and the
  // per-speaker cap is expressed in *tiles* rather than words, because that is
  // what actually controls how many voices reach the board.
  //
  // The multipliers are deliberately generous because the duration filter runs
  // *after* this point: a word's length is only known once it is downloaded, so
  // MAX_DURATION_S punches holes in blocks that were already chosen. A speaker
  // selected with exactly three words who loses one to that filter drops below
  // MIN_WORDS_PER_SPEAKER and vanishes from the board entirely. That is what
  // held Ukrainian to 9 speakers when the corpus could field 13, and Dutch to 9
  // out of 16. Selecting extra words per speaker lets stage 2 re-form whole
  // blocks from whatever survives, and costs only cached downloads.
  //
  // The real per-speaker limit is still enforced in stage 2, where the tile
  // round-robin caps each voice at MAX_TILES_PER_SPEAKER, so over-selecting
  // words here cannot concentrate the finished board.
  const selected = selectWithSpeakerDiversity(
    candidates,
    Math.ceil(WORDS_PER_LANGUAGE * 2.5),
    MAX_TILES_PER_SPEAKER * WORDS_PER_TILE * 2,
    tally,
    WORDS_PER_TILE,
  );

  const info = await fetchFileInfo(selected.map((c) => c.title));
  await mkdir(AUDIO_OUT, { recursive: true });
  await mkdir(join(AUDIO_CACHE, lang.id), { recursive: true });

  // --- Stage 1: fetch and normalise each source word individually ----------
  //
  // Normalising per word, before assembly, fixes something assembly alone
  // cannot: the same speaker often recorded across several sessions at
  // different levels, so concatenating raw words produces a tile that lurches
  // in volume. The tile is levelled again after assembly; this pass is about
  // making the *constituents* consistent with each other.
  const prepared: PreparedWord[] = [];

  for (const candidate of selected) {
    const meta = info.get(candidate.title);
    if (!meta) {
      bump('download-or-transcode-failed');
      continue;
    }

    const speaker = speakerFromArtist(meta.artistRaw, candidate.speaker);
    // Only now is the speaker's real name known, so only now can `speaker-word`
    // be split correctly when either half contains a hyphen. Re-curate, because
    // the corrected word may fail a check the mis-split one passed.
    const word = refineWord(candidate.rest, speaker);
    const recheck = curateWord(word, lang.script);
    if (!recheck.ok) {
      bump(recheck.reason!);
      continue;
    }

    // The download cache is keyed by the Commons title — the clip's true
    // identity — so changing our own id scheme never invalidates 100+ MB of
    // already-fetched audio. It lives under a per-language directory purely
    // for human legibility; `.cache/` is gitignored and never shipped.
    const key = sourceCacheKey(candidate.title);
    const wavPath = join(AUDIO_CACHE, lang.id, `${key}.src`);
    const normPath = join(AUDIO_CACHE, lang.id, `${key}.norm.wav`);

    try {
      await downloadFile(meta.url, wavPath);
      const duration = existsSync(normPath)
        ? await probeDuration(normPath)
        : await prepareWord(wavPath, normPath);

      if (duration < MIN_DURATION_S || duration > MAX_DURATION_S) {
        bump('bad-duration');
        await rm(normPath, { force: true });
        continue;
      }

      prepared.push({
        word,
        romanization: romanize(word, lang.id, lang.script),
        speaker,
        license: meta.license,
        licenseUrl: meta.licenseUrl,
        sourceUrl: meta.descriptionUrl,
        duration,
        path: normPath,
        syllables: estimateSyllables(word, lang.script),
      });
    } catch (err) {
      bump('download-or-transcode-failed');
      console.warn(`    ! ${candidate.title}: ${(err as Error).message.split('\n')[0]}`);
    }
  }

  // --- Stage 2: group by speaker and assemble tiles ------------------------
  const bySpeaker = new Map<string, PreparedWord[]>();
  for (const w of prepared) {
    const list = bySpeaker.get(w.speaker) ?? [];
    list.push(w);
    bySpeaker.set(w.speaker, list);
  }

  // Prefer multi-syllable words, but only as a *partition*, not as a ranking.
  //
  // Three monosyllables carry barely more prosody than the single short words
  // this redesign exists to replace, so polysyllables go first and monosyllables
  // are used only to top up. Sorting by length outright was tried and was
  // worse: it packs a speaker's three longest words into one tile, which
  // produced a 6.3-second outlier against a 3.4-second median. Uneven tile
  // length is itself a tell — a player can start guessing on duration rather
  // than on sound — so an even spread beats a maximised one.
  for (const list of bySpeaker.values()) {
    list.sort((a, b) => Number(a.syllables < 2) - Number(b.syllables < 2));
  }

  const usableSpeakers = [...bySpeaker.entries()].filter(
    ([, list]) => list.length >= MIN_WORDS_PER_SPEAKER,
  );
  for (const [, list] of bySpeaker) {
    if (list.length < MIN_WORDS_PER_SPEAKER) {
      // Their words are unusable: a tile needs WORDS_PER_TILE from one voice.
      for (let i = 0; i < list.length; i++) bump('speaker-too-few-words');
    }
  }

  // Round-robin across speakers rather than draining one at a time, so that if
  // the target is reached early the tiles still span as many voices as possible.
  const groups: PreparedWord[][] = [];
  const cursors = new Map<string, number>(usableSpeakers.map(([n]) => [n, 0]));
  let progressed = true;
  while (groups.length < TILES_PER_LANGUAGE && progressed) {
    progressed = false;
    for (const [name, list] of usableSpeakers) {
      if (groups.length >= TILES_PER_LANGUAGE) break;
      const at = cursors.get(name)!;
      if (at + WORDS_PER_TILE > list.length) continue;
      const group = list.slice(at, at + WORDS_PER_TILE);
      cursors.set(name, at + WORDS_PER_TILE);
      progressed = true;

      // Reject a tile too short to be judged, before paying to encode it.
      // Word durations are already known, so the finished length is predictable
      // to within a few milliseconds: the words plus the gaps between them.
      const predicted =
        group.reduce((sum, w) => sum + w.duration, 0) + TILE_GAP_S * (WORDS_PER_TILE - 1);
      if (predicted < MIN_TILE_DURATION_S) {
        bump('tile-too-short');
        continue;
      }
      groups.push(group);
    }
  }

  const clips: ClipMeta[] = [];
  for (const group of groups) {
    const words = group.map((w) => w.word);
    const speaker = group[0].speaker;
    const utterance = words.join(' ');
    const id = clipId(lang.id, utterance, speaker);
    const opusPath = join(AUDIO_OUT, `${id}.opus`);

    try {
      const duration = existsSync(opusPath)
        ? await probeDuration(opusPath)
        : await assembleUtterance(
            group.map((w) => w.path),
            opusPath,
            TILE_GAP_S,
            OPUS_BITRATE,
          );

      const romanizations = group.map((w) => w.romanization);
      clips.push({
        id,
        language: lang.id,
        word: utterance,
        romanization: romanizations.every((r) => r) ? romanizations.join(' ') : null,
        audio: clipAudioPath(id),
        duration: Number(duration.toFixed(2)),
        speaker,
        sources: group.map((w) => ({
          word: w.word,
          romanization: w.romanization,
          speaker: w.speaker,
          license: w.license,
          licenseUrl: w.licenseUrl,
          sourceUrl: w.sourceUrl,
          duration: Number(w.duration.toFixed(2)),
        })),
        license: mostRestrictiveLicense(group.map((w) => w.license)),
        licenseUrl: licenseUrlFor(
          mostRestrictiveLicense(group.map((w) => w.license)),
          group,
        ),
        sourceUrl: group[0].sourceUrl,
      });
    } catch (err) {
      bump('download-or-transcode-failed');
      console.warn(`    ! assemble ${id}: ${(err as Error).message.split('\n')[0]}`);
    }
  }

  printTally(tally, clips.length);

  const speakers = new Set(clips.map((c) => c.speaker));
  const durations = clips.map((c) => c.duration).sort((a, b) => a - b);
  if (durations.length > 0) {
    const at = (q: number) => durations[Math.min(durations.length - 1, Math.floor(q * durations.length))];
    console.log(
      `  duration: min ${durations[0].toFixed(2)}s  median ${at(0.5).toFixed(2)}s  max ${durations[durations.length - 1].toFixed(2)}s`,
    );
  }
  console.log(`  speakers: ${speakers.size} (${[...speakers].slice(0, 6).join(', ')}${speakers.size > 6 ? ', …' : ''})`);

  if (clips.length < TILES_PER_LANGUAGE) {
    console.warn(
      `  WARNING: ${lang.name} yielded ${clips.length}/${TILES_PER_LANGUAGE} tiles. ` +
        `Raise CANDIDATE_POOL_SIZE or relax curation for this script.`,
    );
  }

  // Recorded now, raised as a hard failure once every language has been
  // processed. Failing loudly is the requirement — with too few voices a player
  // learns the people rather than the language, and per-language accuracy
  // silently becomes a measure of voice recall — but throwing here would
  // abandon a half-hour run over a language listed near the top, and the
  // operator would then fix them one slow run at a time. Collecting first
  // reports every offender in one pass.
  // Two distinct failures, deliberately separated.
  //
  // Falling short of what the corpus can supply is a pipeline regression and
  // fails the build. Having a corpus that simply cannot reach the target floor
  // is a fact to report, not a bug to fail on — unless it is so thin that the
  // language should not ship at all.
  const attainable = Math.min(MIN_SPEAKERS_PER_LANGUAGE, achievableSpeakers);
  if (speakers.size < attainable) {
    speakerFloorFailures.push(
      `${lang.name} (${lang.id}): ${speakers.size} speakers across ${clips.length} tiles, ` +
        `but the curated corpus can field ${achievableSpeakers} — selection is losing voices`,
    );
    console.warn(`  SPEAKER FLOOR FAILED: ${speakers.size} < ${attainable} (attainable)`);
  } else if (speakers.size < MIN_SPEAKERS_PER_LANGUAGE) {
    console.warn(
      `  thin roster: ${speakers.size} speakers (target ${MIN_SPEAKERS_PER_LANGUAGE}, ` +
        `corpus ceiling ${achievableSpeakers}) — at the corpus limit, not a pipeline fault`,
    );
  }

  if (speakers.size < ABSOLUTE_MIN_SPEAKERS) {
    speakerFloorFailures.push(
      `${lang.name} (${lang.id}): ${speakers.size} speakers is below the absolute ` +
        `minimum of ${ABSOLUTE_MIN_SPEAKERS}; drop the language rather than ship it`,
    );
    console.warn(`  BELOW ABSOLUTE MINIMUM: ${speakers.size} < ${ABSOLUTE_MIN_SPEAKERS}`);
  }

  return clips;
}

/**
 * Emit a repository-level attribution file.
 *
 * The credits page inside the app covers the *running game*, but publishing
 * this repository redistributes the audio in its own right, and CC BY / CC BY-SA
 * attach to the files wherever they travel. Someone browsing `public/audio/`
 * on GitHub sees 560 anonymous `.opus` files; this is what tells them whose
 * voices those are and under what terms.
 *
 * Generated rather than hand-written, so it cannot drift from the corpus.
 */
async function writeAttribution(manifest: ContentManifest): Promise<void> {
  const tally = new Map<string, number>();
  for (const clip of manifest.clips) tally.set(clip.license, (tally.get(clip.license) ?? 0) + 1);

  const lines: string[] = [
    '# Audio attribution',
    '',
    '<!-- Generated by `npm run content`. Do not edit by hand. -->',
    '',
    `Every recording in \`public/audio/\` was made by a volunteer native speaker for`,
    '[Lingua Libre](https://lingualibre.org/), a Wikimedia project, and published on',
    '[Wikimedia Commons](https://commons.wikimedia.org/).',
    '',
    '**These files are modified.** Each was trimmed of leading and trailing silence,',
    'loudness-normalised to a common target, stripped of metadata and re-encoded from',
    '48 kHz WAV to Opus. The spoken words themselves are unaltered.',
    '',
    'Each recording keeps the licence it carries on Commons, listed per file below.',
    'Recordings under **CC BY-SA 4.0** are redistributed here under CC BY-SA 4.0, as',
    'ShareAlike requires. Recordings under CC BY 4.0 and CC0 keep their own terms.',
    'These licences cover the audio only; the source code is licensed separately.',
    '',
    '| Licence | Recordings |',
    '| --- | --- |',
    ...[...tally.entries()].sort((a, b) => b[1] - a[1]).map(([l, n]) => `| ${l} | ${n} |`),
    '',
    `Filenames are opaque hashes so that the game does not give away its own answers;`,
    '`src/content/manifest.json` maps every filename to its word, speaker and licence.',
    '',
  ];

  for (const language of manifest.languages) {
    const clips = manifest.clips.filter((c) => c.language === language.id);
    if (clips.length === 0) continue;
    const speakers = [...new Set(clips.map((c) => c.speaker))].sort();
    lines.push(`## ${language.name}`, '', `${clips.length} recordings by ${speakers.length} speakers.`, '');
    lines.push('| File | Word | Speaker | Licence | Source |', '| --- | --- | --- | --- | --- |');
    for (const clip of [...clips].sort((a, b) => a.id.localeCompare(b.id))) {
      const licence = clip.licenseUrl ? `[${clip.license}](${clip.licenseUrl})` : clip.license;
      lines.push(
        `| \`${clip.id}.opus\` | ${clip.word} | ${clip.speaker} | ${licence} | [Commons](${clip.sourceUrl}) |`,
      );
    }
    lines.push('');
  }

  await writeFile(ATTRIBUTION_OUT, `${lines.join('\n')}\n`);
  console.log(`  attribution: ${ATTRIBUTION_OUT}`);
}

/**
 * Delete anything in `public/audio` the manifest does not reference.
 *
 * Two reasons this is not merely tidiness. Orphans from a previous run get
 * picked up by the service worker's precache glob, so they cost every player
 * bandwidth for audio the game will never play. And the old id scheme wrote
 * `public/audio/<lang>/`, so a leftover directory would keep announcing the
 * language in the very file tree the opaque ids exist to anonymise.
 */
async function pruneAudio(keep: Map<string, ClipMeta>): Promise<void> {
  if (!existsSync(AUDIO_OUT)) return;
  let removed = 0;

  for (const entry of await readdir(AUDIO_OUT, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      await rm(join(AUDIO_OUT, entry.name), { recursive: true, force: true });
      console.log(`  pruned legacy per-language directory audio/${entry.name}/`);
      continue;
    }
    const id = entry.name.replace(/\.opus$/, '');
    if (!entry.name.endsWith('.opus') || !keep.has(id)) {
      await rm(join(AUDIO_OUT, entry.name), { force: true });
      removed += 1;
    }
  }

  if (removed) console.log(`  pruned ${removed} unreferenced audio file(s)`);
}

/** Languages that fell below the speaker floor; fatal, reported after the run. */
const speakerFloorFailures: string[] = [];

async function main() {
  const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const targets = only.length ? LANGUAGES.filter((l) => only.includes(l.id)) : LANGUAGES;

  console.log(`ffmpeg: ${await resolveFfmpeg()}`);
  console.log(`target: ${targets.length} languages x ${TILES_PER_LANGUAGE} tiles x ${WORDS_PER_TILE} words`);

  const clips: ClipMeta[] = [];
  for (const lang of targets) {
    clips.push(...(await processLanguage(lang)));
  }

  const manifest: ContentManifest = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    languages: LANGUAGES,
    clusters: CLUSTERS,
    clips,
  };

  // Merge with any existing manifest when only some languages were rebuilt, so
  // `npm run content -- jpn` does not wipe the other languages.
  if (only.length && existsSync(MANIFEST_OUT)) {
    const previous = JSON.parse(await readFile(MANIFEST_OUT, 'utf8')) as ContentManifest;
    const untouched = previous.clips.filter((c) => !only.includes(c.language));
    manifest.clips = [...untouched, ...clips];
  }

  // Sort by opaque id, never by language. Manifest order is itself a channel:
  // grouping clips by language would hand the answers to anyone who opened the
  // bundled JSON, undoing the point of the opaque ids. Hash order interleaves
  // languages for free, and sorting keeps the file diff-stable across runs.
  manifest.clips.sort((a, b) => a.id.localeCompare(b.id));

  const seen = new Map<string, ClipMeta>();
  for (const clip of manifest.clips) {
    const clash = seen.get(clip.id);
    if (clash) {
      throw new Error(
        `Clip id collision on ${clip.id}: ` +
          `${clash.language}/${clash.word}/${clash.speaker} vs ` +
          `${clip.language}/${clip.word}/${clip.speaker}. ` +
          `Raise CLIP_ID_LENGTH in scripts/lib/clip-id.ts.`,
      );
    }
    seen.set(clip.id, clip);
  }

  await writeFile(MANIFEST_OUT, `${JSON.stringify(manifest, null, 2)}\n`);
  await writeAttribution(manifest);
  await pruneAudio(seen);

  console.log('\n=== summary ===');
  const licenses = new Map<string, number>();
  for (const c of manifest.clips) licenses.set(c.license, (licenses.get(c.license) ?? 0) + 1);
  for (const lang of LANGUAGES) {
    const n = manifest.clips.filter((c) => c.language === lang.id).length;
    console.log(`  ${lang.name.padEnd(12)} ${String(n).padStart(3)} clips`);
  }
  console.log(`  licences: ${[...licenses.entries()].map(([l, n]) => `${l} x${n}`).join(', ')}`);
  console.log(`  manifest: ${MANIFEST_OUT} (${manifest.clips.length} clips)`);

  if (speakerFloorFailures.length > 0) {
    throw new Error(
      `${speakerFloorFailures.length} language(s) below their speaker floor ` +
        `(target ${MIN_SPEAKERS_PER_LANGUAGE}, capped by each corpus ceiling):\n    ` +
        `${speakerFloorFailures.join('\n    ')}\n` +
        `  With so few voices players learn the speakers, not the language, and ` +
        `per-language accuracy stops measuring the skill the game claims to teach.\n` +
        `  Fix by raising CANDIDATE_POOL_SIZE, relaxing curation for the script, ` +
        `or removing the language from LANGUAGES in scripts/content.config.ts.`,
    );
  }
}

main().catch((err) => {
  console.error(`\nFAILED: ${(err as Error).message}`);
  process.exit(1);
});
