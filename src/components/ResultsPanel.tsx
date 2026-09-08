import type { RoundResult } from '../game/scoring';
import type { LanguageMeta } from '../content/types';
import type { Round } from '../game/types';

export interface ResultsPanelProps {
  round: Round;
  result: RoundResult;
  languages: LanguageMeta[];
  onPlayAgain: () => void;
  onHome: () => void;
}

/**
 * The end-of-round readout.
 *
 * Two jobs. First, make scoring *feel* like something happened: the needle
 * swings up from rest and settles on the round's accuracy, which is the one
 * authored motion moment in the game. Second, show the arithmetic rather than
 * just the total, because "you scored 740" teaches nothing while "eleven right
 * at +100, three wrong at -60, times 1.25" tells the player exactly what to
 * change.
 */
export function ResultsPanel({ round, result, languages, onPlayAgain, onHome }: ResultsPanelProps) {
  const nameOf = (id: string) => languages.find((l) => l.id === id)?.name ?? id;
  const mistakes = Object.entries(result.confusion).flatMap(([actual, row]) =>
    Object.entries(row)
      .filter(([guessed]) => guessed !== actual)
      .map(([guessed, count]) => ({ actual, guessed, count })),
  );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Round results"
      className="fixed inset-0 z-50 flex items-end justify-center bg-[#050301]/90 sm:items-center"
    >
      <div className="panel grain anim-tune-in relative max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-xl p-5 sm:rounded-xl">
        <div className="relative z-10">
          <p className="legend">Transmission logged</p>

          <SignalGauge accuracy={result.accuracy} negative={result.score < 0} />

          <p
            data-testid="final-score"
            className="readout text-center text-5xl leading-none font-bold"
            style={{
              color: result.score < 0 ? 'var(--color-fault)' : 'var(--color-signal)',
            }}
          >
            {result.score > 0 ? '+' : ''}
            {result.score}
          </p>
          <p className="legend mt-1.5 text-center text-[color:var(--color-legend-dim)]">
            {Math.round(result.accuracy * 100)}% accuracy
          </p>

          <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
            <Stat label="Correct" value={result.correct} tone="var(--color-phosphor)" />
            <Stat label="Wrong" value={result.wrong} tone="var(--color-fault)" />
            <Stat label="Skipped" value={result.unassigned} tone="var(--color-legend)" />
          </dl>

          <div className="well mt-4 rounded-lg p-3 text-xs leading-relaxed text-[color:var(--color-legend)]">
            <p className="legend mb-1">How that was worked out</p>
            {round.difficulty === 'hard' ? (
              <p>
                Hard mode scores every <em>pair</em> of stations: pairs you grouped together that
                really share a language earn points, pairs you grouped together that do not lose
                points, and splitting one language across groups costs half as much. Normalised,
                that came to{' '}
                <strong className="readout text-[color:var(--color-ink)]">
                  {result.baseScore}
                </strong>
                , then ×{result.multiplier} for Hard.
              </p>
            ) : (
              <p>
                {result.correct} correct × 100 − {result.wrong} wrong × 60 ={' '}
                <strong className="readout text-[color:var(--color-ink)]">
                  {result.baseScore}
                </strong>
                , then ×{result.multiplier} for {round.difficulty}.
              </p>
            )}
            <p className="mt-2">
              Coins:{' '}
              <strong className="readout text-[color:var(--color-signal)]">
                +{result.coinsEarned}
              </strong>
              {result.score < 0 && ' — a negative score earns nothing.'}
            </p>
          </div>

          {mistakes.length > 0 && (
            <div className="mt-4">
              <h3 className="legend">What tripped you up</h3>
              <ul className="mt-1.5 space-y-1 text-sm">
                {mistakes
                  .sort((a, b) => b.count - a.count)
                  .slice(0, 4)
                  .map((m) => (
                    <li
                      key={`${m.actual}-${m.guessed}`}
                      className="flex justify-between gap-2 text-[color:var(--color-legend)]"
                    >
                      <span>
                        Heard <strong className="text-[color:var(--color-ink)]">{nameOf(m.actual)}</strong>,
                        said{' '}
                        <strong className="text-[color:var(--color-fault)]">
                          {nameOf(m.guessed)}
                        </strong>
                      </span>
                      <span className="readout shrink-0 text-[color:var(--color-legend-dim)]">
                        ×{m.count}
                      </span>
                    </li>
                  ))}
              </ul>
            </div>
          )}

          <div className="mt-4">
            <h3 className="legend">The answer key</h3>
            <ul className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
              {round.languages.map((id) => {
                const stat = result.perLanguage[id];
                return (
                  <li
                    key={id}
                    className="flex justify-between gap-2 text-[color:var(--color-legend)]"
                  >
                    <span className="truncate">{nameOf(id)}</span>
                    <span className="readout shrink-0 text-[color:var(--color-legend-dim)]">
                      {stat ? `${stat.correct}/${stat.total}` : '—'}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="mt-5 flex gap-2">
            <button
              type="button"
              onClick={onPlayAgain}
              data-testid="play-again"
              className="nameplate flex-1 rounded-lg bg-[color:var(--color-signal)] py-3 text-lg tracking-[0.06em] text-[#140e07]"
            >
              Next band
            </button>
            <button
              type="button"
              onClick={onHome}
              className="nameplate well rounded-lg px-5 py-3 text-lg tracking-[0.06em] text-[color:var(--color-legend)]"
            >
              Home
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The signal-strength meter, swinging to the round's accuracy.
 *
 * The needle animates from its rest position and overshoots slightly before
 * settling, which is what a real moving-coil meter does. It is the one place in
 * the game where motion is the point rather than a transition, so it is worth
 * the frames — and `prefers-reduced-motion` collapses it to the final position
 * with no swing at all.
 */
function SignalGauge({ accuracy, negative }: { accuracy: number; negative: boolean }) {
  // -62° is empty, +62° is a perfect board.
  const angle = -62 + Math.max(0, Math.min(1, accuracy)) * 124;
  const color = negative ? 'var(--color-fault)' : 'var(--color-signal)';

  return (
    <div aria-hidden="true" className="engrave relative mx-auto mt-2 h-[86px] w-full rounded-lg">
      <svg viewBox="0 0 200 96" className="h-full w-full">
        {/* The scale: ticks across the arc, taller every fifth. */}
        {Array.from({ length: 21 }, (_, i) => {
          const t = i / 20;
          const a = (-62 + t * 124) * (Math.PI / 180);
          const inner = i % 5 === 0 ? 56 : 62;
          const cx = 100 + Math.sin(a) * inner;
          const cy = 88 - Math.cos(a) * inner;
          const ox = 100 + Math.sin(a) * 68;
          const oy = 88 - Math.cos(a) * 68;
          return (
            <line
              key={i}
              x1={cx}
              y1={cy}
              x2={ox}
              y2={oy}
              stroke={t > 0.72 ? 'var(--color-ember)' : 'var(--color-legend-dim)'}
              strokeWidth={i % 5 === 0 ? 1.6 : 0.9}
              strokeLinecap="round"
            />
          );
        })}

        <text
          x="100"
          y="46"
          textAnchor="middle"
          className="legend"
          fill="var(--color-legend-dim)"
          style={{ fontSize: '9px', letterSpacing: '0.18em' }}
        >
          SIGNAL
        </text>

        <g
          className="anim-needle"
          style={
            {
              transformOrigin: '100px 88px',
              '--needle-from': '-62deg',
              '--needle-to': `${angle}deg`,
            } as React.CSSProperties
          }
        >
          <line x1="100" y1="88" x2="100" y2="24" stroke={color} strokeWidth="2" strokeLinecap="round" />
        </g>
        <circle cx="100" cy="88" r="5" fill="var(--color-hairline)" />
        <circle cx="100" cy="88" r="2" fill={color} />
      </svg>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="well rounded-lg py-2">
      <dt className="legend text-[color:var(--color-legend-dim)]">{label}</dt>
      <dd className="readout text-2xl font-bold" style={{ color: tone }}>
        {value}
      </dd>
    </div>
  );
}
