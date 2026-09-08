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
  MIN_SPEAKERS_PER_LANGUAGE,
  SCHEMA_VERSION,
  WORDS_PER_LANGUAGE,
} from './content.config.ts';
import {
  categoryFileCount,
  downloadFile,
  fetchFileInfo,
  listCategoryFiles,
} from './lib/wikimedia.ts';
import {
  curateWord,
  parseFilename,
  refineWord,
  selectWithSpeakerDiversity,
  type RejectionReason,
} from './lib/curate.ts';
import { clipAudioPath, clipId } from './lib/clip-id.ts';
import { romanize } from './lib/romanize.ts';
import { probeDuration, resolveFfmpeg, transcodeToOpus } from './lib/transcode.ts';

const ROOT = process.cwd();
const AUDIO_CACHE = join(ROOT, '.cache', 'audio');
const AUDIO_OUT = join(ROOT, 'public', 'audio');
const MANIFEST_OUT = join(ROOT, 'src', 'content', 'manifest.json');
const ATTRIBUTION_OUT = join(ROOT, 'ATTRIBUTION.md');

const MAX_PER_SPEAKER = Math.max(1, Math.round(WORDS_PER_LANGUAGE * MAX_SPEAKER_SHARE));

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

  // Over-select so that clips lost to bad duration or transcode failure below
  // do not leave the language short of its target.
  const selected = selectWithSpeakerDiversity(
    candidates,
    Math.ceil(WORDS_PER_LANGUAGE * 1.6),
    Math.ceil(MAX_PER_SPEAKER * 1.6),
    tally,
  );

  const info = await fetchFileInfo(selected.map((c) => c.title));
  await mkdir(AUDIO_OUT, { recursive: true });
  await mkdir(join(AUDIO_CACHE, lang.id), { recursive: true });

  const clips: ClipMeta[] = [];

  for (const candidate of selected) {
    if (clips.length >= WORDS_PER_LANGUAGE) break;
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
    const id = clipId(lang.id, word, speaker);

    // The download cache is keyed by the Commons title — the clip's true
    // identity — so changing our own id scheme never invalidates 34 MB of
    // already-fetched audio. It lives under a per-language directory purely
    // for human legibility; `.cache/` is gitignored and never shipped.
    const wavPath = join(AUDIO_CACHE, lang.id, `${sourceCacheKey(candidate.title)}.src`);
    const opusPath = join(AUDIO_OUT, `${id}.opus`);

    try {
      await downloadFile(meta.url, wavPath);
      // Resumability: an already-transcoded clip only needs its duration read
      // back, which is far cheaper than re-running the filter chain.
      const duration = existsSync(opusPath)
        ? await probeDuration(opusPath)
        : await transcodeToOpus(wavPath, opusPath);

      if (duration < MIN_DURATION_S || duration > MAX_DURATION_S) {
        bump('bad-duration');
        await rm(opusPath, { force: true });
        continue;
      }

      clips.push({
        id,
        language: lang.id,
        word,
        romanization: romanize(word, lang.id, lang.script),
        audio: clipAudioPath(id),
        duration: Number(duration.toFixed(2)),
        speaker,
        license: meta.license,
        licenseUrl: meta.licenseUrl,
        sourceUrl: meta.descriptionUrl,
      });
    } catch (err) {
      bump('download-or-transcode-failed');
      console.warn(`    ! ${candidate.title}: ${(err as Error).message.split('\n')[0]}`);
    }
  }

  printTally(tally, clips.length);

  const speakers = new Set(clips.map((c) => c.speaker));
  console.log(`  speakers: ${speakers.size} (${[...speakers].slice(0, 6).join(', ')}${speakers.size > 6 ? ', …' : ''})`);

  if (clips.length < WORDS_PER_LANGUAGE) {
    console.warn(
      `  WARNING: ${lang.name} yielded ${clips.length}/${WORDS_PER_LANGUAGE} clips. ` +
        `Raise CANDIDATE_POOL_SIZE or relax curation for this script.`,
    );
  }
  if (speakers.size < MIN_SPEAKERS_PER_LANGUAGE) {
    console.warn(
      `  WARNING: only ${speakers.size} distinct speakers for ${lang.name}. ` +
        `Players may learn the voice rather than the language.`,
    );
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

async function main() {
  const only = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const targets = only.length ? LANGUAGES.filter((l) => only.includes(l.id)) : LANGUAGES;

  console.log(`ffmpeg: ${await resolveFfmpeg()}`);
  console.log(`target: ${targets.length} languages x ${WORDS_PER_LANGUAGE} words`);

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
}

main().catch((err) => {
  console.error(`\nFAILED: ${(err as Error).message}`);
  process.exit(1);
});
