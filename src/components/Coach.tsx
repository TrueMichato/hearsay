export interface CoachFacts {
  /** Stations the player has played at least once. */
  heard: number;
  /** Stations filed into a group. */
  placed: number;
  /** Stations currently held back. */
  held: number;
  shopOpened: boolean;
}

export interface TutorialStep {
  title: string;
  body: string;
  /**
   * Where the panel sits, chosen per step so it never covers the control the
   * step is asking the player to press.
   */
  anchor: 'top' | 'bottom';
  /** When true, the player has done the thing and the step advances itself. */
  done?: (facts: CoachFacts) => boolean;
}

/**
 * The guided first round.
 *
 * The game shipped with no onboarding of any kind: a new player met sixteen
 * identical grey squares, three language names, an unexplained coin badge and a
 * disabled button. Nothing said the tiles made sound.
 *
 * This teaches by watching instead of lecturing. Every step that asks for an
 * action advances when the player performs it on the real board — there is no
 * fake board and no forced click target, so a player who ignores the prompt and
 * explores still makes progress. The two steps that explain rather than ask
 * (holding, and the clue economy) carry a Next button.
 */
export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    title: 'Sixteen stations',
    body: 'Every tile up there is a recording of one word, spoken by a native speaker. Press one to hear it.',
    anchor: 'bottom',
    done: (f) => f.heard >= 1,
  },
  {
    title: 'Listening is free',
    body: 'Notice nothing was filed. You can play any station as often as you like without committing to anything. Hear two more and compare them.',
    anchor: 'bottom',
    done: (f) => f.heard >= 3,
  },
  {
    title: 'File what you hear',
    body: 'The tuner shows the station you are on, and its waveform. When you think you recognise the language, press it in the bank below — that files the tuned station.',
    anchor: 'top',
    done: (f) => f.placed >= 1,
  },
  {
    title: 'Two at once',
    body: 'Sure two stations are the same language but not which one? Press Hold on each, then press a group: both get filed together.',
    anchor: 'top',
  },
  {
    title: 'Coins buy clues',
    body: 'Scoring well earns coins. Clues spend them — the written word, its romanisation, or the answer outright. Guessing by ear is always cheaper.',
    anchor: 'bottom',
    done: (f) => f.shopOpened,
  },
  {
    title: 'Then transmit',
    body: 'File as many as you can and press Transmit. A station you skip costs nothing; a wrong guess does. Good luck.',
    anchor: 'bottom',
  },
];

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
