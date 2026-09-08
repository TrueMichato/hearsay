import { memo } from 'react';
import { BAR_COUNT, type Peaks } from '../hooks/useWaveforms';

export type WaveformTone = 'signal' | 'ember' | 'dim' | 'ink';

export interface WaveformProps {
  peaks: Peaks | null;
  /** Hide the shape and draw a flat noise floor instead. */
  silent?: boolean;
  /** 0-1 playback position. Bars behind it are lit, bars ahead are dim. */
  progress?: number;
  tone?: WaveformTone;
  className?: string;
}

const TONE: Record<WaveformTone, string> = {
  signal: 'var(--color-signal)',
  ember: 'var(--color-ember)',
  dim: 'var(--color-legend-dim)',
  ink: 'var(--color-ink)',
};

/**
 * A clip drawn as a mirrored bar waveform.
 *
 * Drawn in SVG with a `viewBox`, which means the browser scales it to whatever
 * box it is put in without us knowing the pixel size — the same component fills
 * a 72px tile and a 340px tuner readout.
 *
 * `silent` draws the noise floor instead of the shape: a nearly flat line, the
 * dead band between stations. That is the "not heard yet" state, and it is a
 * different *kind* of picture rather than a dimmer version of the same one,
 * which is what makes heard and unheard readable at a glance.
 */
export const Waveform = memo(function Waveform({
  peaks,
  silent = false,
  progress,
  tone = 'signal',
  className = '',
}: WaveformProps) {
  const bars = peaks ?? [];
  const width = BAR_COUNT * 3 - 1;
  const color = TONE[tone];
  const playhead = progress === undefined ? null : Math.round(progress * BAR_COUNT);

  return (
    <svg
      aria-hidden="true"
      viewBox={`0 0 ${width} 24`}
      preserveAspectRatio="none"
      className={className}
      style={{ overflow: 'visible' }}
    >
      {silent || bars.length === 0 ? (
        <>
          {/* The dead band: a hairline with the faintest hiss on it. */}
          <line
            x1="0"
            y1="12"
            x2={width}
            y2="12"
            stroke="var(--color-legend-dim)"
            strokeWidth="1"
            strokeOpacity="0.75"
          />
          {Array.from({ length: BAR_COUNT }, (_, i) => {
            const h = i % 3 === 0 ? 1.6 : 0.8;
            return (
              <rect
                key={i}
                x={i * 3}
                y={12 - h / 2}
                width="2"
                height={h}
                fill="var(--color-legend-dim)"
                opacity="0.5"
              />
            );
          })}
        </>
      ) : (
        bars.map((peak, i) => {
          const height = Math.max(1.2, peak * 22);
          const ahead = playhead !== null && i > playhead;
          return (
            <rect
              key={i}
              x={i * 3}
              y={12 - height / 2}
              width="2"
              height={height}
              rx="0.8"
              fill={color}
              opacity={ahead ? 0.32 : 1}
            />
          );
        })
      )}
    </svg>
  );
});
