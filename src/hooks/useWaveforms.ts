import { useEffect, useMemo, useRef, useState } from 'react';
import type { BoardTile } from '../game/types';

/**
 * A drawable waveform for every clip on the board.
 *
 * ## Why the game needs this
 *
 * Sixteen identical grey squares are unmemorable: a player who has listened to
 * nine clips cannot point at the one that sounded like the third. A waveform
 * gives every tile a shape of its own, so "the one with the long tail" becomes
 * something you can actually say. It is also the honest picture of what a tile
 * *is* — a recording — which is what makes the receiver metaphor work rather
 * than decorate.
 *
 * ## How a waveform is computed
 *
 * An audio file decodes to a long list of numbers, one per sample, each the
 * speaker-cone position at that instant (44,100 of them per second). Drawing
 * all of them is pointless at 78 device pixels wide, so we slice the samples
 * into `BAR_COUNT` equal buckets and keep the loudest absolute value in each.
 * That peak-per-bucket summary is exactly what audio editors draw.
 *
 * The result is normalised against the clip's own loudest peak, so a quiet
 * recording still fills its tile. That matters here beyond looks: absolute
 * loudness varies by microphone, not by language, so showing it would add
 * visual noise that means nothing.
 *
 * ## Why it never leaks the answer
 *
 * The shape comes from one speaker saying one word. It carries no language
 * label, no id, and no text, and `e2e/leak.spec.ts` scans every tile attribute
 * to keep it that way. Board code additionally hides the waveform until the
 * player has actually played the clip, so the picture is a *reward* for
 * listening rather than a way to skip it.
 */

/** Bars per waveform. Enough to read a syllable shape, few enough to stay crisp. */
export const BAR_COUNT = 40;

export type Peaks = readonly number[];

/**
 * A stand-in waveform derived from the clip id.
 *
 * Used when the browser has no Web Audio support, or when a decode fails. It is
 * deterministic (the same tile always looks the same) and derived from a hash
 * that is itself language-free, so it distinguishes tiles without inventing a
 * signal. A player never sees a tile with no shape at all.
 */
export function fallbackPeaks(id: string): number[] {
  // A small xorshift PRNG seeded from the id. Deterministic across reloads.
  let state = 2166136261;
  for (let i = 0; i < id.length; i++) {
    state ^= id.charCodeAt(i);
    state = Math.imul(state, 16777619);
  }
  const next = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) % 1000) / 1000;
  };

  const peaks: number[] = [];
  for (let i = 0; i < BAR_COUNT; i++) {
    // An envelope that rises and falls, so it reads as an utterance rather than
    // as static: quiet at the edges, loud in the middle.
    const t = i / (BAR_COUNT - 1);
    const envelope = Math.sin(Math.PI * t) ** 0.6;
    peaks.push(Math.max(0.08, Math.min(1, envelope * (0.45 + next() * 0.75))));
  }
  return peaks;
}

/** Reduce decoded audio to one peak per bar. */
function summarise(buffer: AudioBuffer): number[] {
  const channel = buffer.getChannelData(0);
  const perBar = Math.max(1, Math.floor(channel.length / BAR_COUNT));
  const peaks: number[] = [];
  let loudest = 0;

  for (let bar = 0; bar < BAR_COUNT; bar++) {
    const start = bar * perBar;
    const end = Math.min(channel.length, start + perBar);
    let peak = 0;
    for (let i = start; i < end; i++) {
      const value = Math.abs(channel[i]);
      if (value > peak) peak = value;
    }
    peaks.push(peak);
    if (peak > loudest) loudest = peak;
  }

  if (loudest === 0) return peaks.map(() => 0.08);
  // Normalise, then floor every bar so silence still draws a noise line rather
  // than a gap the eye reads as a rendering bug.
  return peaks.map((p) => Math.max(0.06, p / loudest));
}

/**
 * Decodes every clip on the board once, in the background.
 *
 * Deliberately eager rather than on-first-play: the waveform is revealed the
 * instant a tile is played, and a shape that faded in 200 ms late would feel
 * like lag rather than like a station coming in. Sixteen clips of ~1-4 seconds
 * decode in well under a second, and the bytes are already in the HTTP or
 * service-worker cache because `useBoardAudio` preloaded the same URLs.
 */
export function useWaveforms(tiles: BoardTile[]): Record<string, Peaks> {
  const [decoded, setDecoded] = useState<Record<string, Peaks>>({});
  const contextRef = useRef<AudioContext | null>(null);

  // The fallback shape is derived during render rather than seeded into state,
  // so a tile is never blank for even one frame and there is no extra render
  // pass on mount. Decoded results are keyed by clip id, so a stale entry from
  // a previous board is simply never looked up.
  const peaks = useMemo(
    () =>
      Object.fromEntries(
        tiles.map((tile) => [tile.id, decoded[tile.id] ?? fallbackPeaks(tile.id)]),
      ) as Record<string, Peaks>,
    [tiles, decoded],
  );

  useEffect(() => {
    let cancelled = false;

    const AudioContextClass: typeof AudioContext | undefined =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;

    // One context for the whole board. Created suspended (no user gesture has
    // necessarily happened yet); `decodeAudioData` works regardless, because
    // decoding is not playback.
    const context = contextRef.current ?? new AudioContextClass();
    contextRef.current = context;

    void (async () => {
      for (const tile of tiles) {
        if (cancelled) return;
        try {
          const response = await fetch(`${import.meta.env.BASE_URL}${tile.audio}`);
          if (!response.ok) continue;
          const bytes = await response.arrayBuffer();
          const decoded = await context.decodeAudioData(bytes);
          if (cancelled) return;
          const summary = summarise(decoded);
          setDecoded((prev) => ({ ...prev, [tile.id]: summary }));
        } catch {
          // Keep the fallback shape. A missing waveform must never break a
          // round the player can otherwise hear perfectly well.
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tiles]);

  useEffect(() => {
    return () => {
      void contextRef.current?.close().catch(() => {});
      contextRef.current = null;
    };
  }, []);

  return peaks;
}
