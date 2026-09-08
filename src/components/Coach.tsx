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
 *
 * It is also not an overlay. Floating it over the board was tried and abandoned:
 * pinned to the top it hid the stations the player was being told to press, and
 * making the panel click-through only moved the problem to its own buttons,
 * which still sat on top of a tile. Sitting in the column, it cannot cover
 * anything by construction — the layout's spare space absorbs most of its
 * height, so the board and the controls both stay on screen.
 */
export function Coach({ step, onNext, onSkip }: CoachProps) {
  const current = TUTORIAL_STEPS[step];
  if (!current) return null;

  const waiting = Boolean(current.done);

  return (
      <div
        role="status"
        aria-live="polite"
        data-testid="coach"
        className="panel grain anim-tune-in relative overflow-hidden rounded-lg p-3"
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

          <h2 className="nameplate mt-1 text-lg text-[color:var(--color-ink)]">
            {current.title}
          </h2>
          <p className="mt-0.5 text-sm leading-snug text-[color:var(--color-legend)]">
            {current.body}
          </p>

          {/* While a step is waiting for the player to do something, the thing
              to do is on the board — so nothing here is allowed to look like
              the primary action. A filled button appears only on the steps that
              have nothing to wait for. */}
          <div className="mt-2 flex items-center gap-2">
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
              className={[
                'legend rounded px-3.5 py-2',
                waiting
                  ? 'text-[color:var(--color-legend-dim)] underline-offset-4 hover:underline'
                  : 'bg-[color:var(--color-signal)] text-[#140e07]',
              ].join(' ')}
            >
              {waiting ? 'Skip this step' : 'Next'}
            </button>
          </div>
        </div>
      </div>
  );
}
