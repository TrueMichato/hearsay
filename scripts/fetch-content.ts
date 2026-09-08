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

import { mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
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
  selectWithSpeakerDiversity,
  type RejectionReason,
} from './lib/curate.ts';
import { romanize } from './lib/romanize.ts';
import { probeDuration, resolveFfmpeg, transcodeToOpus } from './lib/transcode.ts';

const ROOT = process.cwd();
const AUDIO_CACHE = join(ROOT, '.cache', 'audio');
const AUDIO_OUT = join(ROOT, 'public', 'audio');
const MANIFEST_OUT = join(ROOT, 'src', 'content', 'manifest.json');

const MAX_PER_SPEAKER = Math.max(1, Math.round(WORDS_PER_LANGUAGE * MAX_SPEAKER_SHARE));

interface Candidate {
  title: string;
  speaker: string;
  word: string;
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
    candidates.push({ title: member.title, speaker: parsed.speaker, word: parsed.word });
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
  await mkdir(join(AUDIO_OUT, lang.id), { recursive: true });

  const clips: ClipMeta[] = [];
  let index = 0;

  for (const candidate of selected) {
    if (clips.length >= WORDS_PER_LANGUAGE) break;
    const meta = info.get(candidate.title);
    if (!meta) {
      bump('download-or-transcode-failed');
      continue;
    }

    const id = `${lang.id}-${String(++index).padStart(4, '0')}`;
    const wavPath = join(AUDIO_CACHE, lang.id, `${id}.src`);
    const opusPath = join(AUDIO_OUT, lang.id, `${id}.opus`);

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
        word: candidate.word,
        romanization: romanize(candidate.word, lang.id, lang.script),
        audio: `audio/${lang.id}/${id}.opus`,
        duration: Number(duration.toFixed(2)),
        speaker: speakerFromArtist(meta.artistRaw, candidate.speaker),
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
  // `npm run content -- jpn` does not wipe the other seven languages.
  if (only.length && existsSync(MANIFEST_OUT)) {
    const previous = JSON.parse(
      await (await import('node:fs/promises')).readFile(MANIFEST_OUT, 'utf8'),
    ) as ContentManifest;
    const untouched = previous.clips.filter((c) => !only.includes(c.language));
    manifest.clips = [...untouched, ...clips].sort((a, b) => a.id.localeCompare(b.id));
  }

  await writeFile(MANIFEST_OUT, `${JSON.stringify(manifest, null, 2)}\n`);

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
