/**
 * Audio transcoding.
 *
 * Source recordings are 48 kHz mono PCM WAV at roughly 100-140 KB per word.
 * Committing 320 of those would add ~40 MB to the repository for content that
 * compresses to a fraction of the size with no audible loss at this length.
 * We transcode to Opus, which is the best-in-class codec for speech at low
 * bitrates and is supported by every browser that can run this app.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';

const exec = promisify(execFile);

let cachedBinary: string | null = null;

/**
 * Resolve an ffmpeg binary: prefer one on PATH, else fall back to the
 * `ffmpeg-static` npm package so a fresh clone works with `npm install` alone.
 */
export async function resolveFfmpeg(): Promise<string> {
  if (cachedBinary) return cachedBinary;

  try {
    await exec('ffmpeg', ['-version']);
    cachedBinary = 'ffmpeg';
    return cachedBinary;
  } catch {
    /* not on PATH — try the bundled binary */
  }

  try {
    const mod = (await import('ffmpeg-static')) as { default: string | null };
    const bin = mod.default;
    if (bin) {
      await access(bin, constants.X_OK);
      await exec(bin, ['-version']);
      cachedBinary = bin;
      return cachedBinary;
    }
  } catch {
    /* fall through to the error below */
  }

  throw new Error(
    'ffmpeg is required to transcode audio but was not found.\n' +
      '  - Install it system-wide:  brew install ffmpeg   (macOS)\n' +
      '                             apt install ffmpeg    (Debian/Ubuntu)\n' +
      '  - Or install the bundled binary:  npm install\n' +
      '    (the ffmpeg-static devDependency ships a prebuilt ffmpeg)',
  );
}

/**
 * Trimming and levelling applied to each *source word* before assembly.
 *
 * `silenceremove` (in an `areverse` sandwich) trims leading and trailing room
 * tone, which Lingua Libre recordings carry up to a second of.
 *
 * The threshold is -55 dB rather than the -45 dB used originally, and that
 * change is measured rather than guessed. Running `silencedetect` at both
 * thresholds over 140 cached recordings showed how much real audio sits between
 * them at the start of a word:
 *
 *     median 6.7 ms | p75 82 ms | p90 187 ms | max 299 ms
 *     31% of clips lose more than 50 ms of onset at -45 dB
 *
 * That tail is not room tone, it is speech. Soft onsets — fricatives like /f/
 * and /s/, aspirated stops, a quiet initial /h/ — start well below -45 dB, so
 * nearly a third of words were being clipped into something that sounds
 * truncated and unnatural. Since phonotactics is exactly what this game asks
 * players to hear, chopping word onsets attacks the core mechanic.
 *
 * `apad`/`adelay` then restores a short lead-in so the waveform does not begin
 * on a loud sample, which would click.
 */
const TRIM_CHAIN = [
  'silenceremove=start_periods=1:start_duration=0.02:start_threshold=-55dB:detection=peak',
  'areverse',
  'silenceremove=start_periods=1:start_duration=0.02:start_threshold=-55dB:detection=peak',
  'areverse',
  // 40 ms of digital silence in front of the onset, so the first sample is zero.
  'adelay=40:all=1',
].join(',');

/**
 * Loudness target. A *fairness* measure, not polish: if one language's
 * contributors happened to record hotter than another's, volume becomes an
 * unintended tell and a player could "identify" languages without listening to
 * phonology at all.
 */
const LOUDNESS = { I: -18, TP: -1.5, LRA: 11 };

/** Parse `Duration: 00:00:01.23` out of ffmpeg's stderr banner. */
function parseDuration(stderr: string): number | null {
  const m = /Duration:\s*(\d+):(\d+):(\d+\.\d+)/.exec(stderr);
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/**
 * Measure a file with `loudnorm`'s analysis pass.
 *
 * Single-pass `loudnorm` is explicitly documented as approximate: it adapts as
 * it goes and cannot know a file's true peak until it has read the whole thing,
 * so results drift by a decibel or two between files. Across a board of sixteen
 * tiles that drift is audible, and inconsistent loudness reads as "bad sound"
 * even when every individual clip is fine. Measuring first and then applying
 * the measured values makes the second pass exact.
 */
async function measureLoudness(input: string, filters: string): Promise<string | null> {
  const ffmpeg = await resolveFfmpeg();
  const args = [
    '-hide_banner',
    '-i', input,
    '-af', `${filters},loudnorm=I=${LOUDNESS.I}:TP=${LOUDNESS.TP}:LRA=${LOUDNESS.LRA}:print_format=json`,
    '-f', 'null', '-',
  ];
  let stderr = '';
  try {
    const out = await exec(ffmpeg, args);
    stderr = out.stderr ?? '';
  } catch (err) {
    stderr = (err as { stderr?: string }).stderr ?? '';
  }
  // The JSON block is the last `{...}` ffmpeg prints.
  const start = stderr.lastIndexOf('{');
  const end = stderr.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const m = JSON.parse(stderr.slice(start, end + 1)) as Record<string, string>;
    // `measured_thresh` can come back as `-inf` on a silent or near-silent file,
    // which ffmpeg then refuses as a filter argument.
    if (Object.values(m).some((v) => typeof v === 'string' && v.includes('inf'))) return null;
    return (
      `loudnorm=I=${LOUDNESS.I}:TP=${LOUDNESS.TP}:LRA=${LOUDNESS.LRA}` +
      `:measured_I=${m.input_i}:measured_TP=${m.input_tp}` +
      `:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}` +
      `:offset=${m.target_offset}:linear=true`
    );
  } catch {
    return null;
  }
}

/**
 * Trim and level one source word into a normalised intermediate WAV.
 *
 * The intermediate is kept as WAV rather than Opus because it will be
 * concatenated and re-encoded; encoding twice would compound artefacts on
 * exactly the fine spectral detail (sibilants, formant transitions) that a
 * player needs in order to tell languages apart.
 */
export async function prepareWord(input: string, output: string): Promise<number> {
  const ffmpeg = await resolveFfmpeg();
  const measured = await measureLoudness(input, TRIM_CHAIN);
  const chain = `${TRIM_CHAIN},${measured ?? `loudnorm=I=${LOUDNESS.I}:TP=${LOUDNESS.TP}:LRA=${LOUDNESS.LRA}`}`;

  await exec(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-i', input,
    '-af', chain,
    '-ac', '1',
    '-ar', '48000',
    '-c:a', 'pcm_s16le',
    '-map_metadata', '-1',
    output,
  ]);

  return await probeDuration(output);
}

/**
 * Join prepared words into one utterance and encode it to Opus.
 *
 * A single word is the wrong unit of audio for this game. Telling languages
 * apart by ear needs prosody — rhythm, stress placement, intonation contour,
 * how syllables are allowed to join — and none of that exists inside a
 * 0.4-second word. The player hears a fragment and guesses, which feels
 * arbitrary and unfair. Three words from one speaker, separated by a natural
 * pause, give the ear something to actually work with while staying honest:
 * it is still real speech by a real native speaker, not synthesis.
 *
 * The gap is silence rather than a crossfade so that no word is coloured by its
 * neighbour, and so each constituent remains individually attributable.
 */
export async function assembleUtterance(
  inputs: string[],
  output: string,
  gapSeconds: number,
  bitrate: string,
): Promise<number> {
  const ffmpeg = await resolveFfmpeg();
  if (inputs.length === 0) throw new Error('assembleUtterance needs at least one input');

  // Interleave silence between inputs: [w0] gap [w1] gap [w2]
  const args: string[] = ['-hide_banner', '-loglevel', 'error', '-y'];
  for (const i of inputs) args.push('-i', i);

  const parts: string[] = [];
  const filters: string[] = [];
  inputs.forEach((_, i) => {
    if (i > 0) {
      filters.push(`aevalsrc=0:d=${gapSeconds}:s=48000:c=mono[g${i}]`);
      parts.push(`[g${i}]`);
    }
    parts.push(`[${i}:a]`);
  });
  filters.push(`${parts.join('')}concat=n=${parts.length}:v=0:a=1[out]`);

  args.push(
    '-filter_complex', filters.join(';'),
    '-map', '[out]',
    '-ac', '1',
    '-ar', '48000',
    '-c:a', 'libopus',
    '-b:a', bitrate,
    '-vbr', 'on',
    // `audio` rather than `voip`. VoIP mode is tuned for intelligibility over
    // a phone line and deliberately discards spectral detail this game depends
    // on; the whole task is discriminating fine phonetic differences.
    '-application', 'audio',
    // Strip metadata: source tags can leak the word or language into the file,
    // which a curious player could read straight out of the network tab.
    '-map_metadata', '-1',
    output,
  );

  await exec(ffmpeg, args);
  return await probeDuration(output);
}


/** Read a media file's duration by asking ffmpeg to open it. */
export async function probeDuration(file: string): Promise<number> {
  try {
    await exec(await resolveFfmpeg(), ['-hide_banner', '-i', file]);
    return 0;
  } catch (err) {
    // ffmpeg exits non-zero when given no output target, but still prints the
    // stream banner we want. This is the documented no-ffprobe workaround.
    const stderr = (err as { stderr?: string }).stderr ?? '';
    const duration = parseDuration(stderr);
    if (duration === null) throw new Error(`Could not determine duration of ${file}`);
    return duration;
  }
}
