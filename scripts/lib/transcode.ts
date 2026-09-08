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
 * The filter chain applied to every clip, in order:
 *
 *  1/3. `silenceremove` (with the `areverse` sandwich) trims leading and
 *       trailing silence. Lingua Libre recordings often carry up to a second of
 *       room tone, which makes tiles feel unresponsive.
 *  4.   `loudnorm` normalises perceived loudness to a common target. This is a
 *       *fairness* measure, not polish: if one language's contributors happened
 *       to record hotter than another's, volume becomes an unintended tell and
 *       players could "identify" languages without listening to phonology.
 */
const FILTER_CHAIN = [
  'silenceremove=start_periods=1:start_duration=0.02:start_threshold=-45dB:detection=peak',
  'areverse',
  'silenceremove=start_periods=1:start_duration=0.02:start_threshold=-45dB:detection=peak',
  'areverse',
  'loudnorm=I=-18:TP=-1.5:LRA=11',
].join(',');

/** Parse `Duration: 00:00:01.23` out of ffmpeg's stderr banner. */
function parseDuration(stderr: string): number | null {
  const m = /Duration:\s*(\d+):(\d+):(\d+\.\d+)/.exec(stderr);
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/**
 * Transcode `input` to a mono 32 kbps Opus file at `output`.
 * Returns the duration of the *result* in seconds, so duration filtering
 * happens after silence trimming rather than before it.
 */
export async function transcodeToOpus(input: string, output: string): Promise<number> {
  const ffmpeg = await resolveFfmpeg();

  await exec(ffmpeg, [
    '-hide_banner',
    '-loglevel', 'error',
    '-y',
    '-i', input,
    '-af', FILTER_CHAIN,
    '-ac', '1',
    '-ar', '48000',
    '-c:a', 'libopus',
    '-b:a', '32k',
    '-vbr', 'on',
    '-application', 'voip',
    // Strip metadata: source tags can leak the word or language into the file,
    // which a curious player could read straight out of the network tab.
    '-map_metadata', '-1',
    output,
  ]);

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
