import { BRANDING } from '../config/branding';
import { useProfile } from '../hooks/useProfile';
import type { Difficulty } from '../game/types';

const MODES: { difficulty: Difficulty; title: string; blurb: string }[] = [
  {
    difficulty: 'easy',
    title: 'Easy',
    blurb: 'Buckets are labelled with the language names. Just match what you hear.',
  },
  {
    difficulty: 'medium',
    title: 'Medium',
    blurb: 'Same buckets, no names. Separate the languages without being told which is which.',
  },
  {
    difficulty: 'hard',
    title: 'Hard',
    blurb: 'No buckets. Make your own groups — and work out how many languages there even are.',
  },
];

export function Home({
  onStart,
  onStats,
  onCredits,
}: {
  onStart: (difficulty: Difficulty) => void;
  onStats: () => void;
  onCredits: () => void;
}) {
  const profile = useProfile();

  return (
    <div className="mx-auto flex min-h-full w-full max-w-lg flex-col gap-5 p-5">
      <header className="pt-6 text-center">
        <h1 className="text-4xl font-black tracking-tight">{BRANDING.name}</h1>
        <p className="mt-1 text-sm text-slate-400">{BRANDING.tagline}</p>
      </header>

      {profile && profile.totalRounds > 0 && (
        <dl className="grid grid-cols-3 gap-2 text-center">
          <Stat label="Coins" value={profile.coins} accent />
          <Stat label="Day streak" value={profile.dayStreak} />
          <Stat label="Best score" value={profile.bestScore} />
        </dl>
      )}

      <nav aria-label="Difficulty" className="flex flex-col gap-3">
        {MODES.map((mode) => (
          <button
            key={mode.difficulty}
            type="button"
            onClick={() => onStart(mode.difficulty)}
            data-testid={`start-${mode.difficulty}`}
            className="rounded-2xl border-2 border-slate-700 bg-slate-800/60 p-4 text-left transition-colors hover:border-sky-500 hover:bg-slate-800"
          >
            <span className="block text-lg font-bold">{mode.title}</span>
            <span className="mt-0.5 block text-sm text-slate-400">{mode.blurb}</span>
          </button>
        ))}
      </nav>

      <div className="mt-auto flex gap-2 pt-4">
        <button
          type="button"
          onClick={onStats}
          data-testid="open-stats"
          className="flex-1 rounded-xl bg-slate-800 py-3 text-sm font-semibold hover:bg-slate-700"
        >
          Your stats
        </button>
        <button
          type="button"
          onClick={onCredits}
          className="flex-1 rounded-xl bg-slate-800 py-3 text-sm font-semibold hover:bg-slate-700"
        >
          Credits
        </button>
      </div>

      <p className="text-center text-[11px] text-slate-400">
        Everything stays on this device. No account, no server.
      </p>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="rounded-xl bg-slate-800/60 py-2">
      <dt className="text-[11px] text-slate-400">{label}</dt>
      <dd className={`text-xl font-bold tabular-nums ${accent ? 'text-amber-300' : 'text-slate-100'}`}>
        {value}
      </dd>
    </div>
  );
}
