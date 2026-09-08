import { BRANDING } from '../config/branding';
import { useProfile } from '../hooks/useProfile';
import type { Difficulty } from '../game/types';

const BANDS: { difficulty: Difficulty; label: string; blurb: string }[] = [
  {
    difficulty: 'easy',
    label: 'Easy',
    blurb: 'Groups are named. Match what you hear to a language.',
  },
  {
    difficulty: 'medium',
    label: 'Medium',
    blurb: 'Same groups, unnamed. Separate the languages without being told which is which.',
  },
  {
    difficulty: 'hard',
    label: 'Hard',
    blurb: 'No groups at all. Build your own — and work out how many languages there even are.',
  },
];

export function Home({
  onStart,
  onStats,
  onCredits,
  onManual,
}: {
  onStart: (difficulty: Difficulty) => void;
  onStats: () => void;
  onCredits: () => void;
  onManual: () => void;
}) {
  const profile = useProfile();
  const played = Boolean(profile && profile.totalRounds > 0);

  return (
    <div className="chassis grain mx-auto flex min-h-full w-full max-w-lg flex-col gap-4 p-4">
      <DialPlate />

      <nav aria-label="Difficulty" className="flex flex-1 flex-col gap-2.5">
        <p className="legend">Select a band</p>
        {BANDS.map((band, i) => (
          <button
            key={band.difficulty}
            type="button"
            onClick={() => onStart(band.difficulty)}
            data-testid={`start-${band.difficulty}`}
            className="panel group relative flex flex-1 flex-col justify-center gap-2 overflow-hidden rounded-lg p-3.5 text-left transition-transform active:scale-[0.99]"
          >
            <span className="flex items-center gap-3.5">
            <span
              aria-hidden="true"
              className="readout engrave grid h-11 w-11 shrink-0 place-items-center rounded-md text-lg font-bold text-[color:var(--color-signal)] transition-shadow group-hover:shadow-[inset_0_0_0_1.5px_var(--color-signal),0_0_16px_-2px_var(--color-signal-deep)]"
            >
              {i + 1}
            </span>
            <span className="relative z-10 min-w-0 flex-1">
              <span className="nameplate block text-xl text-[color:var(--color-ink)]">
                {band.label}
              </span>
              <span className="mt-0.5 block text-xs leading-snug text-[color:var(--color-legend)]">
                {band.blurb}
              </span>
            </span>
            </span>
            <BandSignal noise={i} />
          </button>
        ))}
      </nav>

      {played && profile && (
        <dl className="grid grid-cols-3 gap-2 text-center">
          <Gauge label="Coins" value={profile.coins} tone="var(--color-signal)" />
          <Gauge label="Day streak" value={profile.dayStreak} tone="var(--color-phosphor)" />
          <Gauge label="Best" value={profile.bestScore} tone="var(--color-ink)" />
        </dl>
      )}

      <div className="mt-auto flex flex-col gap-2 pt-2">
        <button
          type="button"
          onClick={onManual}
          data-testid="open-manual-home"
          className="panel nameplate rounded-lg py-2.5 text-center text-base tracking-[0.06em] text-[color:var(--color-legend)]"
        >
          {played ? 'Reopen the manual' : 'How to play'}
        </button>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onStats}
            data-testid="open-stats"
            className="panel legend flex-1 rounded-lg py-2.5 text-[color:var(--color-legend)]"
          >
            Your log
          </button>
          <button
            type="button"
            onClick={onCredits}
            className="panel legend flex-1 rounded-lg py-2.5 text-[color:var(--color-legend)]"
          >
            Credits
          </button>
        </div>
        <p className="text-center text-[11px] text-[color:var(--color-legend-dim)]">
          Everything stays on this device. No account, no server.
        </p>
      </div>
    </div>
  );
}

/**
 * The hero: a receiver's tuning plate.
 *
 * The old home screen was three near-identical grey cards of prose above half a
 * screen of nothing — it read like a settings page. This replaces the top third
 * with the object the game is about. The scale is a real drawn dial with a
 * needle parked on the station, and it drifts slowly the way an analog receiver
 * does, which is the whole personality of the screen in one element.
 *
 * It is decoration and says so: `aria-hidden`, with the actual name in a real
 * heading underneath.
 */
function DialPlate() {
  return (
    <header className="panel grain relative overflow-hidden rounded-xl px-4 pt-5 pb-4">
      <div className="relative z-10">
        <p className="legend text-[color:var(--color-signal)]">Shortwave · 16 stations</p>
        <h1 className="nameplate mt-0.5 text-5xl leading-[0.92] text-[color:var(--color-ink)]">
          {BRANDING.name}
        </h1>
        <p className="mt-1 text-sm text-[color:var(--color-legend)]">{BRANDING.tagline}</p>

        <div className="engrave anim-lamp relative mt-4 h-14 overflow-hidden rounded-md">
          <svg
            aria-hidden="true"
            viewBox="0 0 320 56"
            preserveAspectRatio="none"
            className="anim-drift h-full w-full"
          >
            {Array.from({ length: 49 }, (_, i) => {
              const x = 4 + i * 6.5;
              const major = i % 6 === 0;
              return (
                <line
                  key={i}
                  x1={x}
                  y1={major ? 8 : 16}
                  x2={x}
                  y2={30}
                  stroke="var(--color-legend-dim)"
                  strokeWidth={major ? 1.4 : 0.7}
                  strokeLinecap="round"
                />
              );
            })}
            {[6, 9, 12, 15, 18, 21].map((mhz, i) => (
              <text
                key={mhz}
                x={4 + i * 39}
                y={45}
                textAnchor="middle"
                fill="var(--color-legend-dim)"
                style={{ fontSize: '9px', fontFamily: 'var(--font-mono)' }}
              >
                {mhz}
              </text>
            ))}
          </svg>

          {/* The needle stays put while the scale drifts beneath it. */}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-1 left-1/2 w-[2px] -translate-x-1/2 rounded-full bg-[color:var(--color-signal)]"
            style={{ boxShadow: '0 0 12px 1px var(--color-signal-deep)' }}
          />
        </div>
      </div>
    </header>
  );
}

/**
 * A strip of signal under each band, getting noisier as the band gets harder.
 *
 * It does two jobs at once. It fills space the old home screen simply left
 * empty, and it says something true before the player has read a word: Easy is
 * a clean carrier you can pick out, Hard is a mess you have to work through.
 */
function BandSignal({ noise }: { noise: number }) {
  const bars = 76;
  // A fixed pattern, so the strip is stable between renders and identical on
  // every device — this is a printed legend, not a live meter. Easy is a clean
  // carrier with silence between the peaks; Hard buries the same signal in a
  // noise floor you have to listen through.
  const scatter = (i: number) => {
    const x = Math.sin(i * 127.1 + noise * 311.7) * 43758.5453;
    return x - Math.floor(x);
  };
  const heights = Array.from({ length: bars }, (_, i) => {
    const envelope = Math.abs(Math.sin(i * 0.21)) ** (3 - noise);
    const floor = noise * 0.24 * scatter(i);
    return Math.min(1, envelope * (0.92 - noise * 0.16) + floor);
  });

  return (
    <span aria-hidden="true" className="engrave block h-5 overflow-hidden rounded">
      <svg
        viewBox={`0 0 ${bars * 2.4 - 0.9} 20`}
        preserveAspectRatio="none"
        className="h-full w-full"
      >
        {heights.map((h, i) => (
          <rect
            key={i}
            x={i * 2.4}
            y={10 - h * 8.6}
            width="1.5"
            height={Math.max(0.8, h * 17.2)}
            rx="0.75"
            fill="var(--color-signal)"
            opacity={0.1 + h * 0.42}
          />
        ))}
      </svg>
    </span>
  );
}

function Gauge({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="well rounded-lg py-2">
      <dt className="legend text-[color:var(--color-legend-dim)]">{label}</dt>
      <dd className="readout text-xl font-bold" style={{ color: tone }}>
        {value}
      </dd>
    </div>
  );
}
