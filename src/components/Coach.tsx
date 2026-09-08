import { TUTORIAL_STEPS } from '../game/tutorial';

export interface CoachProps {
  step: number;
  onNext: () => void;
  onSkip: () => void;
}

/**
 * The coach panel.
 *
 * Deliberately **not** a modal: it never traps focus and never blocks a press,
 * because everything it describes is something the player is meant to try on
 * the live board while reading it. A dialog here would make the tutorial the
 * task instead of the game.
 */
export function Coach({ step, onNext, onSkip }: CoachProps) {
  const current = TUTORIAL_STEPS[step];
  if (!current) return null;

  const waiting = Boolean(current.done);

  return (
    <div
      className={[
        'pointer-events-none fixed inset-x-0 z-40 mx-auto w-full max-w-lg px-3',
        current.anchor === 'top' ? 'top-3' : 'bottom-3',
      ].join(' ')}
    >
      <div
        role="status"
        aria-live="polite"
        data-testid="coach"
        className="panel grain anim-tune-in pointer-events-auto relative overflow-hidden rounded-lg p-3.5"
      >
        <div className="relative z-10">
          <div className="flex items-center justify-between gap-2">
            <p className="legend text-[color:var(--color-signal)]">
              Manual — {step + 1} of {TUTORIAL_STEPS.length}
            </p>
            <span aria-hidden="true" className="flex gap-1">
              {TUTORIAL_STEPS.map((_, i) => (
                <span
                  key={i}
                  className="h-1 w-3 rounded-full transition-colors"
                  style={{
                    backgroundColor:
                      i <= step ? 'var(--color-signal)' : 'rgb(255 226 178 / 0.16)',
                  }}
                />
              ))}
            </span>
          </div>

          <h2 className="nameplate mt-1.5 text-xl text-[color:var(--color-ink)]">
            {current.title}
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-[color:var(--color-legend)]">
            {current.body}
          </p>

          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={onSkip}
              data-testid="skip-manual"
              className="legend rounded px-2 py-2 text-[color:var(--color-legend-dim)] underline-offset-4 hover:underline"
            >
              Skip the manual
            </button>
            <span className="flex-1" />
            <button
              type="button"
              onClick={onNext}
              data-testid="coach-next"
              className="legend rounded bg-[color:var(--color-signal)] px-3.5 py-2 text-[#140e07]"
            >
              {waiting ? 'Skip this step' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
