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
 * The end-of-round breakdown.
 *
 * It shows the arithmetic rather than just the total, because "you scored 740"
 * teaches nothing — "eleven right at +100, three wrong at -60, times 1.25 for
 * Medium" tells the player exactly what to change.
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
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 sm:items-center"
    >
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-slate-900 p-5 shadow-2xl sm:rounded-2xl">
        <p className="text-xs tracking-wide text-slate-400 uppercase">Round complete</p>
        <p
          data-testid="final-score"
          className={`text-4xl font-black tabular-nums ${result.score < 0 ? 'text-rose-400' : 'text-emerald-400'}`}
        >
          {result.score > 0 ? '+' : ''}
          {result.score}
        </p>

        <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
          <Stat label="Correct" value={result.correct} tone="positive" />
          <Stat label="Wrong" value={result.wrong} tone="negative" />
          <Stat label="Skipped" value={result.unassigned} />
        </dl>

        <div className="mt-4 rounded-xl bg-slate-800/60 p-3 text-xs text-slate-300">
          <p className="font-semibold text-slate-200">How that was worked out</p>
          {round.difficulty === 'hard' ? (
            <p className="mt-1">
              Hard mode scores every <em>pair</em> of tiles: pairs you grouped together that really
              share a language earn points, pairs you grouped together that do not lose points, and
              splitting one language across groups costs half as much. Normalised, that came to{' '}
              <strong className="tabular-nums">{result.baseScore}</strong>, then ×
              {result.multiplier} for Hard.
            </p>
          ) : (
            <p className="mt-1">
              {result.correct} correct × 100 − {result.wrong} wrong × 60 ={' '}
              <strong className="tabular-nums">{result.baseScore}</strong>, then ×{result.multiplier}{' '}
              for {round.difficulty}.
            </p>
          )}
          <p className="mt-2">
            Coins: <strong className="text-amber-300 tabular-nums">+{result.coinsEarned}</strong>
            {result.score < 0 && ' — a negative score earns nothing.'}
          </p>
        </div>

        {mistakes.length > 0 && (
          <div className="mt-4">
            <h3 className="text-sm font-semibold">What tripped you up</h3>
            <ul className="mt-2 space-y-1 text-sm">
              {mistakes
                .sort((a, b) => b.count - a.count)
                .slice(0, 4)
                .map((m) => (
                  <li key={`${m.actual}-${m.guessed}`} className="flex justify-between gap-2 text-slate-300">
                    <span>
                      Heard <strong className="text-slate-100">{nameOf(m.actual)}</strong>, said{' '}
                      <strong className="text-rose-300">{nameOf(m.guessed)}</strong>
                    </span>
                    <span className="tabular-nums text-slate-400">×{m.count}</span>
                  </li>
                ))}
            </ul>
          </div>
        )}

        <div className="mt-4">
          <h3 className="text-sm font-semibold">The answer key</h3>
          <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
            {round.languages.map((id) => {
              const stat = result.perLanguage[id];
              return (
                <li key={id} className="flex justify-between gap-2 text-slate-300">
                  <span className="truncate">{nameOf(id)}</span>
                  <span className="shrink-0 tabular-nums text-slate-400">
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
            className="flex-1 rounded-xl bg-sky-500 py-3 text-sm font-bold text-slate-900 hover:bg-sky-400"
          >
            Play again
          </button>
          <button
            type="button"
            onClick={onHome}
            className="rounded-xl bg-slate-700 px-4 py-3 text-sm font-semibold hover:bg-slate-600"
          >
            Home
          </button>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'positive' | 'negative' }) {
  const color =
    tone === 'positive' ? 'text-emerald-400' : tone === 'negative' ? 'text-rose-400' : 'text-slate-300';
  return (
    <div className="rounded-xl bg-slate-800/60 py-2">
      <dt className="text-[11px] text-slate-400">{label}</dt>
      <dd className={`text-xl font-bold tabular-nums ${color}`}>{value}</dd>
    </div>
  );
}
