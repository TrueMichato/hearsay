import { useLiveQuery } from 'dexie-react-hooks';
import manifestJson from '../content/manifest.json';
import type { ContentManifest } from '../content/types';
import {
  buildConfusionMatrix,
  clueUsage,
  difficultyBreakdown,
  languageAccuracies,
  progressOverTime,
} from '../db/stats';
import { resetAllData } from '../db/database';
import { useProfile } from '../hooks/useProfile';

const manifest = manifestJson as ContentManifest;

export function Stats({ onBack }: { onBack: () => void }) {
  const profile = useProfile();
  const matrix = useLiveQuery(() => buildConfusionMatrix(manifest.languages), []);
  const accuracies = useLiveQuery(() => languageAccuracies(), []);
  const byDifficulty = useLiveQuery(() => difficultyBreakdown(), []);
  const progress = useLiveQuery(() => progressOverTime(), []);
  const clues = useLiveQuery(() => clueUsage(), []);

  const nameOf = (id: string) => manifest.languages.find((l) => l.id === id)?.name ?? id;
  const shortOf = (id: string) => nameOf(id).slice(0, 3);

  if (!profile || profile.totalRounds === 0) {
    return (
      <Shell onBack={onBack}>
        <p className="mt-8 text-center text-sm text-slate-400">
          No rounds yet. Play one and your stats will appear here.
        </p>
      </Shell>
    );
  }

  return (
    <Shell onBack={onBack}>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Rounds" value={profile.totalRounds} testId="stat-rounds" />
        <Stat label="Best score" value={profile.bestScore} />
        <Stat label="Day streak" value={`${profile.dayStreak} (best ${profile.bestDayStreak})`} />
        <Stat label="Win streak" value={`${profile.winStreak} (best ${profile.bestWinStreak})`} />
      </dl>

      {matrix && matrix.languages.length > 0 && (
        <Section
          title="Confusion matrix"
          hint="Rows are what you heard, columns are what you answered. The diagonal is where you were right — everything off it is a language pair worth practising."
        >
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-center text-[11px]">
              <caption className="sr-only">
                Confusion matrix: rows are the language played, columns are the language you chose.
              </caption>
              <thead>
                <tr>
                  <th scope="col" className="p-1 text-left font-normal text-slate-400">
                    heard ↓ said →
                  </th>
                  {matrix.languages.map((id) => (
                    <th key={id} scope="col" className="p-1 font-semibold text-slate-300">
                      <abbr title={nameOf(id)} className="no-underline">
                        {shortOf(id)}
                      </abbr>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrix.languages.map((actual) => (
                  <tr key={actual}>
                    <th scope="row" className="p-1 text-left font-semibold text-slate-300">
                      {nameOf(actual)}
                    </th>
                    {matrix.languages.map((guessed) => {
                      const cell = matrix.cells.find(
                        (c) => c.actual === actual && c.guessed === guessed,
                      );
                      const rate = cell?.rate ?? 0;
                      const isDiagonal = actual === guessed;
                      return (
                        <td
                          key={guessed}
                          className="p-1"
                          style={{
                            backgroundColor: rate
                              ? isDiagonal
                                ? `rgb(74 222 128 / ${0.15 + rate * 0.55})`
                                : `rgb(251 113 133 / ${0.15 + rate * 0.65})`
                              : undefined,
                          }}
                        >
                          <span className="tabular-nums">{cell?.count ?? 0}</span>
                          <span className="sr-only">
                            {` heard ${nameOf(actual)}, answered ${nameOf(guessed)}`}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {matrix.worstPairs.length > 0 && (
            <ul className="mt-3 space-y-1 text-xs text-slate-300">
              {matrix.worstPairs.map((pair) => (
                <li key={`${pair.actual}-${pair.guessed}`}>
                  You call <strong className="text-slate-100">{nameOf(pair.actual)}</strong>{' '}
                  <strong className="text-rose-300">{nameOf(pair.guessed)}</strong>{' '}
                  <span className="tabular-nums">{Math.round(pair.rate * 100)}%</span> of the time.
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}

      {accuracies && accuracies.length > 0 && (
        <Section title="Accuracy by language">
          <ul className="space-y-2">
            {accuracies.map((row) => (
              <li key={row.language} className="flex items-center gap-2 text-xs">
                <span className="w-24 shrink-0 truncate">{nameOf(row.language)}</span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-slate-700">
                  <span
                    className="block h-full rounded-full bg-sky-400"
                    style={{ width: `${row.accuracy * 100}%` }}
                  />
                </span>
                <span className="w-16 shrink-0 text-right tabular-nums text-slate-400">
                  {Math.round(row.accuracy * 100)}% ({row.total})
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {progress && progress.length > 1 && (
        <Section title="Improvement over time" hint="Smoothed over the last five rounds.">
          <Sparkline points={progress.map((p) => p.rollingAccuracy)} />
        </Section>
      )}

      {byDifficulty && byDifficulty.length > 0 && (
        <Section title="By difficulty">
          <ul className="space-y-1 text-xs">
            {byDifficulty.map((row) => (
              <li key={row.difficulty} className="flex justify-between gap-2">
                <span className="capitalize">{row.difficulty}</span>
                <span className="tabular-nums text-slate-400">
                  {row.rounds} rounds · avg {Math.round(row.meanScore)} · best {row.bestScore}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {clues && clues.length > 0 && (
        <Section title="Clues you lean on">
          <ul className="space-y-1 text-xs">
            {clues.map((row) => (
              <li key={row.clueId} className="flex justify-between gap-2">
                <span>{row.clueId}</span>
                <span className="tabular-nums text-slate-400">
                  ×{row.timesBought} · {row.coinsSpent} coins
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <button
        type="button"
        onClick={() => {
          if (confirm('Delete all local progress? This cannot be undone.')) void resetAllData();
        }}
        className="mt-4 w-full rounded-xl border border-rose-500/40 py-2.5 text-xs font-semibold text-rose-300 hover:bg-rose-500/10"
      >
        Reset all local data
      </button>
    </Shell>
  );
}

/** Minimal inline sparkline. A charting library would dwarf the whole app. */
function Sparkline({ points }: { points: number[] }) {
  if (points.length < 2) return null;
  const width = 300;
  const height = 60;
  const path = points
    .map((value, i) => {
      const x = (i / (points.length - 1)) * width;
      const y = height - value * height;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  const first = Math.round(points[0] * 100);
  const last = Math.round(points[points.length - 1] * 100);

  return (
    <figure>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-16 w-full"
        role="img"
        aria-label={`Rolling accuracy moved from ${first}% to ${last}% over the last ${points.length} rounds.`}
      >
        <path d={path} fill="none" stroke="#38bdf8" strokeWidth="2" strokeLinejoin="round" />
      </svg>
      <figcaption className="text-[11px] text-slate-400">
        {first}% → {last}% over {points.length} rounds
      </figcaption>
    </figure>
  );
}

function Shell({ children, onBack }: { children: React.ReactNode; onBack: () => void }) {
  return (
    <div className="mx-auto w-full max-w-lg space-y-4 p-4 pb-10">
      <header className="flex items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          className="rounded-lg px-2 py-1 text-sm text-slate-300 hover:text-white"
        >
          ← Back
        </button>
        <h1 className="text-lg font-bold">Your stats</h1>
      </header>
      {children}
    </div>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl bg-slate-800/50 p-3">
      <h2 className="text-sm font-bold">{title}</h2>
      {hint && <p className="mt-0.5 mb-2 text-[11px] text-slate-400">{hint}</p>}
      <div className={hint ? '' : 'mt-2'}>{children}</div>
    </section>
  );
}

function Stat({
  label,
  value,
  testId,
}: {
  label: string;
  value: number | string;
  testId?: string;
}) {
  return (
    <div className="rounded-xl bg-slate-800/60 px-2 py-2 text-center">
      <dt className="text-[11px] text-slate-400">{label}</dt>
      <dd data-testid={testId} className="text-base font-bold tabular-nums">
        {value}
      </dd>
    </div>
  );
}
