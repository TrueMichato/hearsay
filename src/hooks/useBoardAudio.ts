import { useCallback, useEffect, useRef, useState } from 'react';
import type { BoardTile } from '../game/types';

/**
 * Board audio.
 *
 * A few things make this less trivial than "call `.play()`":
 *
 *  - **Autoplay policies.** Browsers refuse to start audio until the user has
 *    interacted with the page. All playback here is triggered by a tap or key
 *    press, so we are fine, but the promise `play()` returns can still reject
 *    and must not become an unhandled rejection.
 *  - **Overlap.** Tapping a second tile while the first is still sounding would
 *    play both at once, which makes the board useless. We stop the previous
 *    clip first.
 *  - **Latency.** A tile that takes 300 ms to make a sound feels broken. We
 *    preload every clip on the board up front; the whole board is well under
 *    100 KB.
 */
export interface BoardAudio {
  play: (tileId: string) => void;
  stop: () => void;
  /** Tile id currently sounding, or null. */
  playing: string | null;
  /** Tile ids that have finished preloading. */
  loaded: Set<string>;
  /**
   * Tile ids whose audio has genuinely advanced past 0s.
   *
   * `timeupdate` only fires when the media clock actually moves, so this is
   * evidence of real decoded playback rather than of a play() call that
   * silently failed. The board surfaces it as a data attribute so end-to-end
   * tests can assert sound really happened.
   */
  progressed: Set<string>;
  /** True once every tile on the board can play without buffering. */
  ready: boolean;
  /** Set if the browser refused to play, so the UI can explain itself. */
  error: string | null;
}

/**
 * Owns one `<audio>` element per tile for the lifetime of a round.
 *
 * The caller must keep `tiles` stable for the life of the hook — `Play`
 * remounts the round view for each new seed, which guarantees it. That matters
 * because tile ids (`spa-0`) repeat across rounds while pointing at different
 * clips, so a hook that survived a board change could report a new clip as
 * already loaded.
 */
export function useBoardAudio(tiles: BoardTile[]): BoardAudio {
  const elements = useRef(new Map<string, HTMLAudioElement>());
  const current = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Set<string>>(new Set());
  const [progressed, setProgressed] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const map = elements.current;
    const wanted = new Set(tiles.map((t) => t.id));

    // Drop elements for tiles no longer on the board so a long session does not
    // accumulate one <audio> per clip ever seen.
    for (const [id, el] of map) {
      if (!wanted.has(id)) {
        el.pause();
        el.src = '';
        map.delete(id);
      }
    }

    for (const tile of tiles) {
      if (map.has(tile.id)) continue;
      const el = new Audio();
      el.preload = 'auto';
      // Vite serves `public/` at the site root; BASE_URL keeps this correct if
      // the app is ever deployed under a sub-path.
      el.src = `${import.meta.env.BASE_URL}${tile.audio}`;
      el.addEventListener('canplaythrough', () => {
        setLoaded((prev) => (prev.has(tile.id) ? prev : new Set(prev).add(tile.id)));
      });
      el.addEventListener('timeupdate', () => {
        if (el.currentTime <= 0) return;
        setProgressed((prev) => (prev.has(tile.id) ? prev : new Set(prev).add(tile.id)));
      });
      el.addEventListener('ended', () => setPlaying(null));
      el.load();
      map.set(tile.id, el);
    }

    return () => {
      current.current?.pause();
      current.current = null;
    };
  }, [tiles]);

  const stop = useCallback(() => {
    if (current.current) {
      current.current.pause();
      current.current.currentTime = 0;
      current.current = null;
    }
    setPlaying(null);
  }, []);

  const play = useCallback(
    (tileId: string) => {
      const el = elements.current.get(tileId);
      if (!el) return;

      if (current.current && current.current !== el) {
        current.current.pause();
        current.current.currentTime = 0;
      }

      el.currentTime = 0;
      current.current = el;
      setPlaying(tileId);
      setError(null);

      // `play()` returns a promise that rejects under autoplay restrictions or
      // if the element is torn down mid-play. Swallow the abort, surface the rest.
      void el.play().catch((err: DOMException) => {
        setPlaying(null);
        if (err.name !== 'AbortError') {
          setError('This browser blocked audio playback. Tap a tile to enable sound.');
        }
      });
    },
    [],
  );

  return {
    play,
    stop,
    playing,
    loaded,
    progressed,
    ready: tiles.length > 0 && tiles.every((t) => loaded.has(t.id)),
    error,
  };
}
