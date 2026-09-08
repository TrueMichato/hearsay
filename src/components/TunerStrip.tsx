import { Waveform } from './Waveform';
import type { Peaks } from '../hooks/useWaveforms';

export interface TunerStripProps {
  /** 1-based station number of the tuned tile, or null if nothing is tuned. */
  station: number | null;
  peaks: Peaks | null;
  heard: boolean;
  playing: boolean;
  progress: number;
  held: boolean;
  /** Group label the tuned tile is filed under, if any. */
  filedUnder: string | null;
  heldCount: number;
  onReplay: () => void;
  onToggleHold: () => void;
  onReleaseAll: () => void;
}

/**
 * The tuner readout: what the controls are currently pointed at.
 *
 * This exists because filing and listening had to be separated, and once they
 * are, the player needs to know *which* station a group button is about to file.
 * The strip answers that question in one place, permanently, in the same spot on
 * every round — which is also where the set's live waveform belongs, so the
 * separation buys the interface its most alive element rather than costing it
 * screen space.
 *
 * It owns the two controls that would otherwise have to be crammed onto a 78px
 * tile: replay, and hold. Hold is what makes filing several stations at once
 * deliberate: it is a labelled press on a stationary target, not something that
 * can happen by accident while comparing clips.
 */
export function TunerStrip({
  station,
  peaks,
  heard,
  playing,
  progress,
  held,
  filedUnder,
  heldCount,
  onReplay,
  onToggleHold,
  onReleaseAll,
}: TunerStripProps) {
  const idle = station === null;

  const status = idle
    ? 'Press a station to hear it — listening files nothing'
    : [
        heard ? 'heard' : 'not heard yet',
        filedUnder ? `filed under ${filedUnder}` : 'not filed',
        held ? 'held' : null,
      ]
        .filter(Boolean)
        .join(' · ');

  return (
    <section
      aria-label="Tuner"
      className="panel grain relative overflow-hidden rounded-lg px-3 py-2.5"
    >
      <div className="relative z-10 flex items-center gap-3">
        <span
          aria-hidden="true"
          className="readout w-[2.1rem] shrink-0 text-[1.6rem] leading-none font-bold"
          style={{ color: idle ? 'var(--color-legend-dim)' : 'var(--color-signal)' }}
        >
          {idle ? '--' : String(station).padStart(2, '0')}
        </span>

        <span className="engrave relative flex h-11 flex-1 items-center overflow-hidden rounded px-2">
          <Waveform
            peaks={peaks}
            silent={idle || !heard}
            progress={playing ? progress : undefined}
            tone={held ? 'ember' : 'signal'}
            className="h-7 w-full"
          />
          {/* The scan line, only while a carrier is actually present. */}
          {playing && (
            <span
              aria-hidden="true"
              className="anim-sweep pointer-events-none absolute inset-y-0 w-10 bg-gradient-to-r from-transparent via-[color:var(--color-signal)]/22 to-transparent"
            />
          )}
        </span>
      </div>

      {/* The status owns a full-width line of its own. Sharing the row with the
          buttons truncated it to "Press a station to he…", which turned the one
          sentence explaining the whole interaction into an ellipsis. */}
      <p aria-live="polite" className="legend relative z-10 mt-1.5 normal-case">
        {status}
      </p>

      <div className="relative z-10 mt-1.5 flex items-center gap-2">
        <span className="flex-1" />
        <button
          type="button"
          onClick={onReplay}
          disabled={idle}
          data-testid="tuner-replay"
          className="well legend flex h-9 items-center gap-1.5 rounded px-2.5 text-[color:var(--color-legend)] transition-colors enabled:hover:text-[color:var(--color-signal)] disabled:opacity-40"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor">
            <path d="M12 5V2L7 6l5 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7Z" />
          </svg>
          Replay
        </button>

        <button
          type="button"
          onClick={onToggleHold}
          disabled={idle}
          aria-pressed={held}
          data-testid="tuner-hold"
          className={[
            'legend flex h-9 items-center gap-1.5 rounded px-2.5 transition-colors disabled:opacity-40',
            held
              ? 'well-held text-[color:var(--color-ember)]'
              : 'well text-[color:var(--color-legend)] enabled:hover:text-[color:var(--color-ember)]',
          ].join(' ')}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor">
            {held ? (
              <path d="M8 5h3v14H8zM13 5h3v14h-3z" />
            ) : (
              <path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z" />
            )}
          </svg>
          {held ? 'Held' : 'Hold'}
        </button>
      </div>

      {heldCount > 0 && (
        <div className="relative z-10 mt-2 flex items-center gap-2 border-t border-[color:var(--color-hairline)]/60 pt-2">
          <p className="legend flex-1 text-[color:var(--color-ember)]">
            {heldCount} held — the next group files all of them
          </p>
          <button
            type="button"
            onClick={onReleaseAll}
            data-testid="release-held"
            className="legend rounded px-2 py-1 text-[color:var(--color-legend)] underline-offset-4 hover:underline"
          >
            Release
          </button>
        </div>
      )}
    </section>
  );
}
